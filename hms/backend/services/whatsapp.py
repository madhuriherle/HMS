import asyncio
import logging
from typing import List, Optional
import httpx
from core.config import settings

logger = logging.getLogger("hms.whatsapp")

MAX_SEND_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 0.5

class WhatsAppService:
    """
    Pluggable WhatsApp service. Supports Gupshup, WATI, Twilio.
    Switch provider via WHATSAPP_PROVIDER in .env
    """

    async def send_message(self, to: str, message: str, template_id: Optional[str] = None) -> dict:
        provider = settings.WHATSAPP_PROVIDER.lower()
        last_error: Optional[Exception] = None
        for attempt in range(1, MAX_SEND_ATTEMPTS + 1):
            try:
                if provider == "gupshup":
                    return await self._send_gupshup(to, message, template_id)
                elif provider == "wati":
                    return await self._send_wati(to, message, template_id)
                elif provider == "twilio":
                    return await self._send_twilio(to, message, template_id)
                else:
                    raise ValueError(f"Unsupported WhatsApp provider: {provider}")
            except ValueError:
                raise  # configuration errors are not retryable
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Send to %s failed (attempt %s/%s): %s",
                    to, attempt, MAX_SEND_ATTEMPTS, exc,
                )
                if attempt < MAX_SEND_ATTEMPTS:
                    await asyncio.sleep(RETRY_BACKOFF_SECONDS * attempt)
        raise last_error

    async def send_bulk(self, recipients: List[str], message: str, template_id: Optional[str] = None) -> List[dict]:
        results = []
        for recipient in recipients:
            try:
                result = await self.send_message(recipient, message, template_id)
                results.append({"to": recipient, "result": result, "ok": True})
            except Exception as exc:
                # One bad number must not abort the whole campaign.
                logger.error("Send to %s failed permanently: %s", recipient, exc)
                results.append({"to": recipient, "error": str(exc), "ok": False})
        return results

    async def _send_gupshup(self, to: str, message: str, template_id: Optional[str]) -> dict:
        async with httpx.AsyncClient() as client:
            payload = {
                "channel": "whatsapp",
                "source": settings.WHATSAPP_FROM_NUMBER,
                "destination": to,
                "message": {"type": "text", "text": message},
                "src.name": "HMS_MMA",
            }
            if template_id:
                payload["message"] = {"type": "template", "template": {"id": template_id}}

            response = await client.post(
                settings.WHATSAPP_API_URL,
                json=payload,
                headers={"apikey": settings.WHATSAPP_API_KEY},
                timeout=10
            )
            return response.json()

    async def _send_wati(self, to: str, message: str, template_id: Optional[str]) -> dict:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.WHATSAPP_API_URL}/api/v1/sendTemplateMessage",
                json={
                    "template_name": template_id,
                    "broadcast_name": "HMS_MMA",
                    "receivers": [{"whatsappNumber": to, "customParams": []}]
                },
                headers={"Authorization": f"Bearer {settings.WHATSAPP_API_KEY}"},
                timeout=10
            )
            return response.json()

    async def _send_twilio(self, to: str, message: str, template_id: Optional[str]) -> dict:
        sid = settings.TWILIO_ACCOUNT_SID
        token = settings.TWILIO_AUTH_TOKEN
        if not sid or not token:
            raise ValueError(
                "WHATSAPP_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set"
            )
        base_url = (settings.WHATSAPP_API_URL or "https://api.twilio.com/2010-04-01").rstrip("/")
        destination = to if to.startswith("whatsapp:") else f"whatsapp:{to}"
        source = settings.WHATSAPP_FROM_NUMBER or ""
        if source and not source.startswith("whatsapp:"):
            source = f"whatsapp:{source}"
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/Accounts/{sid}/Messages.json",
                data={"From": source, "To": destination, "Body": message},
                auth=(sid, token),
                timeout=10
            )
            return response.json()

whatsapp_service = WhatsAppService()
