# HMS MMA Backend

**Havyaka MahaSabha Membership Management App** — FastAPI + PostgreSQL + SQLAlchemy

---

## 🚀 Quick Start

### Option A — Docker (Recommended)
```bash
cp .env.example .env
# Edit .env with your credentials
docker-compose up --build
```
App will be live at: **http://localhost:8000/api/v1/docs**

### Option B — Local Development
```bash
# 1. Create virtual environment
python -m venv venv
venv\Scripts\activate  # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Setup environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 4. Run database migrations
alembic revision --autogenerate -m "Initial schema"
alembic upgrade head

# 5. Start server
uvicorn main:app --reload
```

---

## 📁 Project Structure

```
backend/
├── main.py                  # FastAPI app entry point
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── alembic/                 # Database migrations
│   ├── env.py
│   ├── versions/            # Baseline (0001, ORM) + constraints (0002)
│   └── attic/               # Superseded draft migrations (never loaded)
├── core/
│   ├── config.py            # App settings (from .env)
│   ├── security.py          # JWT, password hashing
│   ├── pagination.py        # Pagination helper
│   └── exceptions.py        # Global error handlers
├── db/
│   └── session.py           # DB engine & session
├── models/                  # SQLAlchemy ORM models
│   ├── base.py              # Base + AuditMixin
│   ├── masters.py
│   ├── users.py
│   ├── members.py
│   ├── receipts.py
│   ├── magazines.py
│   ├── events.py
│   ├── engagements.py
│   ├── notifications.py
│   ├── activity.py
│   └── system.py
├── schemas/                 # Pydantic request/response models
├── crud/                    # Database CRUD operations
├── services/                # Business logic services
│   ├── sequences.py         # Auto number generation
│   ├── file_upload.py       # File upload handling
│   ├── whatsapp.py          # WhatsApp API integration (gupshup | wati | twilio)
│   ├── permissions.py       # Permission catalog + first-run bootstrap
│   └── audit.py             # Auto activity logging
├── tests/                   # pytest suite (runs against throwaway SQLite)
└── api/
    ├── deps.py              # Auth dependencies + RBAC
    └── v1/
        ├── router.py
        └── endpoints/
            ├── auth.py      # Login, refresh, forgot password
            ├── masters.py
            ├── users.py
            ├── members.py
            ├── receipts.py
            ├── magazines.py
            ├── events.py
            ├── engagements.py
            ├── notifications.py
            ├── reports.py
            ├── activity.py
            └── system.py
```

---

## 🔐 Authentication

All endpoints (except `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`) require a Bearer JWT token.

```
Authorization: Bearer <access_token>
```

---

## 🔑 Authorization (RBAC)

Every mutating endpoint requires a `<module>.write` permission (e.g. `members.write`, `approvals.write`), enforced with `deps.require_permission()`.

- The permission catalog lives in `services/permissions.py` and is **seeded automatically on startup**.
- Users with `user_type = SUPERADMIN` bypass permission checks.
- Grant a permission to a role: `POST /api/v1/users/roles/{role_id}/permissions?code=members.write`
- Revoke: `DELETE /api/v1/users/roles/{role_id}/permissions/{permission_id}`
- Inspect: `GET /api/v1/users/permissions`, `GET /api/v1/users/{id}/permissions`

Reads only require a valid token; member-submitted flows (profile-change and deletion *requests*, WhatsApp delivery callback) stay authentication-free/only as noted in code.

---

## 🌱 First-run bootstrap

When the `users` table is empty **and** `BOOTSTRAP_ADMIN_PASSWORD` is set, the app creates the initial superadmin (`BOOTSTRAP_ADMIN_USERNAME`, default `admin`) during startup, alongside the permission catalog.

---

## 🧪 Tests

```bash
cd backend
python -m pytest tests
```

The suite (68 tests) runs against a throwaway SQLite database **with foreign keys enforced** (no PostgreSQL required) and covers auth, RBAC enforcement/grants, audit logging (user + member timelines), approvals history, pagination shapes, receipt sequencing, KYC links, permanent-delete cascades, rate limiting and the printable label PDF.

CI runs it on every push via `.github/workflows/tests.yml`.

---

## 🔒 Security notes

- **Uploads are authenticated**: the world-readable static `/uploads` mount was removed; use `GET /api/v1/system/files?path=...` (path traversal rejected).
- **Delivery callbacks** require `X-Callback-Secret` matching `WHATSAPP_CALLBACK_SECRET`; rejected entirely while unset.
- **Rate limits**: login 10 / 5 min per IP+user, forgot-password 5 / 15 min (in-process — move to Redis if you scale to multiple workers).
- **Password policy**: minimum 8 characters, not all digits. Hashing uses `bcrypt` directly (passlib 1.7.4 is unmaintained and broken with bcrypt ≥ 4.1).
- **Profile/KYC change requests** only accept whitelisted member fields — `approval_status`, `member_code`, `is_deleted` etc. can never be set through them.
- **`ENVIRONMENT=production`** refuses to boot with a placeholder or short `SECRET_KEY`.
- **DB-level backstops**: partial unique indexes for one active grant per role/permission, one active role per user, one live member per mobile; `users.user_type` has a CHECK constraint.
- **KYC tokens** are stored as SHA-256, single-use and expire end-of-day.
- Every response carries an `X-Request-ID`, and requests are access-logged with duration.

---

## 📊 API Modules

| Module | Prefix | Description |
|---|---|---|
| Auth | `/api/v1/auth` | Login, refresh, password reset (rate-limited) |
| KYC | `/api/v1/kyc` | Public, token-authenticated KYC updates |
| Masters | `/api/v1/masters` | States, Districts, Taluks, Pincodes, Membership types |
| Users | `/api/v1/users` | Staff users, roles, permissions |
| Members | `/api/v1/members` | Registration, approval, memberships, documents |
| Receipts | `/api/v1/receipts` | Payments and allocations |
| Magazines | `/api/v1/magazines` | Subscriptions, label batches + printable PDF, KYC links |
| Events | `/api/v1/events` | Events, participants, attachments, member notifications |
| Engagements | `/api/v1/engagements` | Affiliates, associates, press, committee |
| Notifications | `/api/v1/notifications` | WhatsApp templates and campaigns |
| Reports | `/api/v1/reports` | Members, receipts, labels (CSV/Excel export) |
| Activity | `/api/v1/activity` | User and member audit trails |
| System | `/api/v1/system` | Authenticated file downloads, error logs |
