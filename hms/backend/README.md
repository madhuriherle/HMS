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

Every mutating endpoint requires a granular `<module>.create` / `<module>.update` / `<module>.delete` permission (e.g. `members.create`, `receipts.delete`), enforced with `deps.require_permission()`. `approvals.write` is the one meta-permission (reviewing requests) and isn't itself split.

- The permission catalog lives in `services/permissions.py` and is **seeded automatically on startup**, generated from `_CRUD_MODULES` for every module.
- The `modules` master table (`GET/POST/PUT/DELETE /api/v1/users/modules`) lists/manages the module list itself; `Permission.module_id` is a real FK into it.
- Users with `user_type = SUPERADMIN` bypass permission checks entirely.
- Grant a permission to a role: `POST /api/v1/users/roles/{role_id}/permissions?code=members.create`
- Revoke: `DELETE /api/v1/users/roles/{role_id}/permissions/{permission_id}`
- Inspect: `GET /api/v1/users/permissions`, `GET /api/v1/users/{id}/permissions`

Reads only require a valid token; member-submitted flows (profile-change and deletion *requests*, WhatsApp delivery callback) stay authentication-free/only as noted in code.

### Listing conventions (pagination / search / filters)

Every list endpoint returns the same paginated envelope — `{total, page, limit, pages, data}` — with `?page=&limit=` (limit clamped to 500).

- **`search=`** (case-insensitive `ilike`) is supported on: members (names KN/EN, mobile, member_code, email), receipts + receipt tracking (payer, receipt no, transaction/cheque ref, and payee names through allocations), associates/press-media (name/org/mobile/email), events (title, location), users, roles' modules and the masters.
- **Common filters**: members by geo/status/type; receipts by mode/status/type/source/dates/year/month/member; events by date range; magazines by status/geo; reports additionally export to CSV/Excel.

---

## ✅ Approval gating (maker-checker)

Permission and approval are independent. **Permission** decides whether a role can call an endpoint at all (`403` if not). **Approval** decides whether holding that permission means the action runs immediately or queues for sign-off — configured per **role-permission grant**, not globally:

```
POST /api/v1/users/roles/{role_id}/permissions?code=members.delete&requires_approval=true
```

When a caller's *only* grants of a permission code are `requires_approval=true`, the mutating call doesn't execute — it's captured into a generic `approval_requests` row (`GET /api/v1/approvals/requests`) instead, and the endpoint returns `{"status": "PENDING", "approval_request_id": ...}`. A holder of `approvals.write` then calls `PUT /api/v1/approvals/requests/{id}/approve` (or `/reject`), which **replays the exact original endpoint function** as the original requester — not a separate copy of the logic, so an approved request can never drift from what a direct call would have done. If *any* role grants the caller the same permission ungated, that grant wins and the call executes immediately.

**To gate a new mutating endpoint**, two small changes, no body rewrite:

```python
@router.post("/states", response_model=Union[schemas_masters.State, PendingApproval])
@approval_gate.gated("masters", "CREATE", "State", "masters.create")
def create_state(*, db=Depends(get_db), current_user=Depends(require_permission("masters.create")), state_in: StateCreate) -> Any:
    ...unchanged body...
```

`response_model` becomes a `Union[Entity, PendingApproval]` (`schemas/common.py`) since a gated call may return either shape.

**Deliberately NOT gated** (see the `# Not @approval_gate.gated:` comment above each): endpoints taking `UploadFile` (bytes can't be captured into JSON and replayed), endpoints taking `BackgroundTasks` (queued tasks only run inside the live request that created them), `create_user`/`update_user` (the body can carry a plaintext password — never stored at rest in a payload column), and `delete_member` (uses its own richer `MemberDeletionRequest` flow — SOFT/PERMANENT, reason master, cascading purge — instead of the generic engine).

Core files: `models/approval_requests.py`, `services/approval_registry.py`, `services/approval_gate.py`, `api/deps.permission_requires_approval()`, generic endpoints in `api/v1/endpoints/approvals.py`.

---

## 🌱 First-run bootstrap

When the `users` table is empty **and** `BOOTSTRAP_ADMIN_PASSWORD` is set, the app creates the initial superadmin (`BOOTSTRAP_ADMIN_USERNAME`, default `admin`) during startup, alongside the permission catalog.

---

## 🧪 Tests

```bash
cd backend
python -m pytest tests
```

The suite (148 tests) runs against a throwaway SQLite database **with foreign keys enforced** (no PostgreSQL required) and covers auth, RBAC enforcement/grants, audit logging (user + member timelines), approvals history, pagination shapes, receipt sequencing, KYC links, permanent-delete cascades, rate limiting and the printable label PDF.

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
- **No horoscope data**: gotra/nakshatra/rashi/masa/mithi/samvathsara were removed from the membership core (migration 0014) — the Mangalya/matrimony sub-product owns that data and will model it in its own tables.

## 📄 Database schema reference

```bash
cd backend
python scripts/dump_db_schema.py   # regenerates docs/db_schema.xlsx + docs/db_schema.md
```

`docs/db_schema.xlsx` has Overview / All Columns / Relationships sheets; `docs/db_schema.md` is a per-table Markdown reference.
- **KYC tokens** are stored as SHA-256, single-use and expire end-of-day.
- Every response carries an `X-Request-ID`, and requests are access-logged with duration.

---

## 📊 API Modules

| Module | Prefix | Description |
|---|---|---|
| Auth | `/api/v1/auth` | Login, refresh, password reset (rate-limited) |
| KYC | `/api/v1/kyc` | Public, token-authenticated KYC updates |
| Masters | `/api/v1/masters` | States, Districts, Taluks, Pincodes, Membership types, Service types (seeded on startup), Qualification & Native place masters |
| Users | `/api/v1/users` | Staff users, roles, permissions |
| Members | `/api/v1/members` | Registration, approval, memberships, documents, service opt-ins (Magazine, Temple, Mangalya, Hall…) |
| Receipts | `/api/v1/receipts` | Payments (Membership, General Donation, Scholarship…) allocated to members **or** associates; tracking register (`GET /receipts/tracking`, CSV/Excel export) and profile activation from a receipt (`POST /receipts/{id}/activate-member`); renewal worklist (`GET /receipts/renewals-due`) for memberships expiring within N days |
| Magazines | `/api/v1/magazines` | Subscriptions, label batches + printable PDF, KYC links |
| Events | `/api/v1/events` | Events, participants, attachments, member notifications |
| Engagements | `/api/v1/engagements` | Affiliates, associates, press, committee |
| Notifications | `/api/v1/notifications` | WhatsApp templates and campaigns |
| Reports | `/api/v1/reports` | Members, receipts, labels (CSV/Excel export) |
| Activity | `/api/v1/activity` | User and member audit trails |
| System | `/api/v1/system` | Authenticated file downloads, error logs |
