"""Optional in-process scheduler (SCHEDULER_ENABLED=true).

Runs three jobs on a fixed tick, reusing the exact endpoint functions so
scheduled and manual runs can never drift:
  * scheduled WhatsApp campaigns whose scheduled_at has passed,
  * KYC update reminders at the configured interval,
  * membership-expiry reminders (once a day).

Use a single worker when enabling it; with several workers, trigger the
endpoints from cron instead.
"""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import BackgroundTasks, HTTPException

from core.config import settings

logger = logging.getLogger("hms.scheduler")

_last_daily: dict = {}


def _system_user(db):
    from models.users import Role, User
    return (
        db.query(User)
        .join(Role, Role.id == User.role_id)
        .filter(Role.is_all_access == True, User.is_deleted == False, User.status == True)  # noqa: E712
        .order_by(Role.rank_level, User.id)
        .first()
    )


async def run_due_campaigns() -> int:
    from api.v1.endpoints.notifications import send_campaign
    from db.session import SessionLocal
    from models.notifications import NotificationCampaign

    sent = 0
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        due = db.query(NotificationCampaign).filter(
            NotificationCampaign.status.in_(("PENDING", "SCHEDULED")),
            NotificationCampaign.scheduled_at.isnot(None),
            NotificationCampaign.scheduled_at <= now,
            NotificationCampaign.is_deleted == False,  # noqa: E712
        ).all()
        for c in due:
            from models.users import User
            user = db.query(User).filter(User.id == c.created_by).first() or _system_user(db)
            bt = BackgroundTasks()
            try:
                await send_campaign(db=db, current_user=user, campaign_id=c.id, background_tasks=bt)
                await bt()
                sent += 1
            except HTTPException as exc:
                logger.warning("scheduled campaign %s not sent: %s", c.id, exc.detail)
                db.rollback()
                c = db.query(NotificationCampaign).filter(NotificationCampaign.id == c.id).first()
                c.status = "FAILED"
                db.commit()
    finally:
        db.close()
    return sent


def _run_kyc_sync() -> None:
    from api.v1.endpoints.magazines import send_kyc_reminders
    from db.session import SessionLocal

    db = SessionLocal()
    try:
        user = _system_user(db)
        if not user:
            return
        bt = BackgroundTasks()
        send_kyc_reminders(
            db=db, current_user=user, background_tasks=bt,
            interval_days=settings.KYC_REMINDER_INTERVAL_DAYS,
            channel=settings.KYC_REMINDER_CHANNEL, limit=500,
        )
        return bt
    finally:
        db.close()


def _run_expiry_sync():
    from api.v1.endpoints.notifications import send_expiry_reminders
    from db.session import SessionLocal

    db = SessionLocal()
    try:
        user = _system_user(db)
        if not user:
            return None
        bt = BackgroundTasks()
        send_expiry_reminders(
            db=db, current_user=user, days_ahead=settings.EXPIRY_REMINDER_DAYS_AHEAD, background_tasks=bt,
        )
        return bt
    finally:
        db.close()


def _due_today(job: str) -> bool:
    today = datetime.now(timezone.utc).date()
    if _last_daily.get(job) == today:
        return False
    _last_daily[job] = today
    return True


async def tick() -> None:
    try:
        await run_due_campaigns()
    except Exception:
        logger.exception("campaign job failed")
    for enabled, job, fn in (
        (settings.KYC_REMINDER_ENABLED, "kyc", _run_kyc_sync),
        (settings.EXPIRY_REMINDER_ENABLED, "expiry", _run_expiry_sync),
    ):
        if enabled and _due_today(job):
            try:
                bt = await asyncio.to_thread(fn)
                if bt:
                    await bt()
            except Exception:
                logger.exception("%s job failed", job)


async def run_forever() -> None:
    logger.info("scheduler started (tick=%ss)", settings.SCHEDULER_TICK_SECONDS)
    while True:
        await tick()
        await asyncio.sleep(settings.SCHEDULER_TICK_SECONDS)
