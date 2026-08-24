# Techtrackers — Node.js Backend

Technical Support Logging System: ticket logging, automated SLA assignment and escalation,
role-based access control, real-time updates and management reporting.

A ground-up rewrite of the original ASP.NET Core / SQL Server backend, in
**Node.js + Express + PostgreSQL (Prisma)**.

---

## Quick start

```bash
# 1. Install PostgreSQL 14+ and create the database
sudo -u postgres psql -c "CREATE USER techtrackers WITH PASSWORD 'techtrackers' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE techtrackers OWNER techtrackers;"

# 2. Configure
cd server
cp .env.example .env          # then edit DATABASE_URL and the two JWT secrets

# 3. Install, migrate, seed
npm install
npm run prisma:migrate        # creates every table
npm run db:seed               # roles, departments, categories, SLAs, test users

# 4. Run
npm run dev                   # http://localhost:5000
```

Confirm it is alive:

```bash
curl http://localhost:5000/health
# {"success":true,"status":"healthy","database":"connected",...}
```

### Seeded test accounts

All use the password `Password123`.

| Role                  | Email                          | Can do                                      |
|-----------------------|--------------------------------|---------------------------------------------|
| `ADMIN`               | admin@techtrackers.local       | Everything                                  |
| `HOD`                 | hod@techtrackers.local         | Their department's tickets, reports          |
| `TECHNICIAN`          | tech1@techtrackers.local       | Work their assigned tickets                  |
| `TECHNICIAN`          | tech2@techtrackers.local       | Work their assigned tickets                  |
| `EXTERNAL_TECHNICIAN` | external@techtrackers.local    | Same, flagged as external                    |
| `STAFF`               | staff@techtrackers.local       | Log issues, track their own                  |
| `STAFF`               | staff2@techtrackers.local      | Log issues, track their own                  |

---

## Testing it

**[`docs/TESTING.md`](docs/TESTING.md)** walks through every endpoint in Postman — what to send,
what you should get back, and what specifically to look at to confirm each behaviour.

Import both files from `docs/` into Postman:

- `Techtrackers.postman_collection.json` — 104 requests, grouped by feature, with assertions
- `Techtrackers.postman_environment.json` — variables the requests fill in for you

Run **01 Auth → Login (Admin)** first; it saves your token automatically.

You can also run the whole suite headlessly:

```bash
npx newman run docs/Techtrackers.postman_collection.json \
                -e docs/Techtrackers.postman_environment.json
```

---

## How the code is organised

**[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** explains the layering in full — what each
folder is for, why the boundaries sit where they do, and how a request flows through them.

The short version:

```
Request
   │
   ▼
routes/        URL + who may call it        ── the API's table of contents
   │
   ▼
middleware/    authenticate → authorize → validate
   │           (401)          (403)        (422)
   ▼
controllers/   HTTP in, HTTP out. No business rules. Usually 3-5 lines.
   │
   ▼
services/      ALL business logic. Knows nothing about HTTP.
   │
   ▼
config/prisma  PostgreSQL
```

```
server/
├── prisma/
│   ├── schema.prisma          every table + enum, in one file
│   ├── migrations/            versioned SQL, generated from the schema
│   └── seed.js                a working system in one command
└── src/
    ├── config/                env validation, Prisma client, logger
    ├── constants/             roles, statuses, the ticket state machine
    ├── middleware/            auth, RBAC, validation, uploads, errors
    ├── validators/            Zod request contracts
    ├── routes/                URL → middleware → controller
    ├── controllers/           thin HTTP adapters
    ├── services/              the actual system
    ├── jobs/                  the SLA escalation timer
    ├── realtime/              Socket.IO (replaces SignalR)
    ├── utils/                 errors, responses, tokens, passwords
    ├── app.js                 assembles Express
    └── server.js              binds the port, graceful shutdown
```

Every file opens with a comment explaining **why it exists** and **what it achieves** — including,
where relevant, which specific problem in the old C# code it was written to fix.

---

## What changed from the ASP.NET version

**[`docs/MIGRATION.md`](docs/MIGRATION.md)** maps every old endpoint to its replacement.

The changes that matter most:

| Area | Before | Now |
|---|---|---|
| **Passwords** | Stored and compared as **plain text** (`PasswordHash == password` in SQL) | bcrypt, cost 12 |
| **Authentication** | **None.** `UseAuthorization()` was called with no scheme registered, and no controller had `[Authorize]` | JWT access + rotating refresh tokens |
| **Authorization** | Role names only chose a welcome message at login; never checked again | `authorize(...)` on every route, plus per-record ownership rules |
| **Identity** | Taken from URLs and request bodies (`/admin/{adminId}`, `Staff_ID`, `User_ID`) | Always from the verified token |
| **SLA deadlines** | `resolutionDue` left NULL until a job noticed; that job read an SLA it never loaded, so every ticket silently fell back to a **2-minute** window | Both deadlines computed at creation from the priority's SLA |
| **Escalation** | Re-notified on every pass (every 6 seconds), recorded nothing | One row per level, unique-constrained; idempotent |
| **Statuses** | Free-text; writers used `ONHOLD`, reports counted `On Hold` — that tile was permanently 0 | Postgres enums + an explicit transition table |
| **Ticket references** | `Random().Next(1000,9999)` with no uniqueness check | Per-department sequence in a transaction, unique index |
| **Attachments** | Raw bytes in the database, base64-inlined into every list response | On disk; only metadata in JSON |
| **Audit trail** | `LogStatusHistory` table existed and was never written to | Every transition recorded with who and why |
| **Reports** | Averaged `resolutionDue − assignedAt` — the SLA *window*, not elapsed time | Measured from `resolvedAt − createdAt`; real SLA compliance % |
| **Responses** | Different shape per endpoint, including bare strings | One envelope everywhere |
| **Errors** | Per-controller try/catch returning `details = ex.Message` | One handler; internals never leak |
| **Validation** | Hand-rolled `if` checks, easy to forget | Zod schemas at the route boundary |
| **Live chat** | Controller saved; SignalR hub broadcast; the two never met | One path — persist then broadcast |
| **User management** | `AddUserService.cs` was entirely commented out — no API to create a user | Full CRUD with roles |

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm start` | Start for production |
| `npm run prisma:migrate` | Create/apply a migration from `schema.prisma` |
| `npm run prisma:deploy` | Apply existing migrations (production) |
| `npm run prisma:studio` | Browse the database in a GUI |
| `npm run db:seed` | Load roles, departments, categories, SLAs, users |
| `npm run db:reset` | Drop, re-migrate and re-seed (destroys data) |
| `npm run check:concurrency` | Race-condition regression test (API must be running) |

---

## Known limitations

Honest list of what is *not* done, so nobody discovers these the hard way:

- **No unit test suite.** Coverage is the Postman collection (104 requests / 193 assertions) plus
  `npm run check:concurrency`. That exercises the API end to end but does not test services in
  isolation. `sla.service.evaluate()` is deliberately pure and is the obvious first thing to
  unit-test when you add Vitest or Jest.
- **Attachments are on local disk.** Fine for one server; on multiple instances or an ephemeral
  container filesystem you need a shared volume or object storage.
- **The SLA sweep must run on exactly one instance.** There is no distributed lock — set
  `SLA_JOB_ENABLED=false` on all but one, or two instances will both escalate.
- **`GET /reports/issues` is capped** at 500 rows by default (5000 max) and says so in the
  response message when the cap is hit. For a genuinely large export, add streaming or a
  background job rather than raising the ceiling.
- **Refresh tokens are never garbage-collected.** Revoked and expired rows accumulate in
  `refresh_tokens`; add a periodic cleanup before this matters.
- **No request tracing / correlation ids.** Logs are per-line, not per-request.
- **Email failures are logged, not retried.** A notification email lost to a transient SMTP
  outage is gone; the in-app notification still lands.

---

## Environment variables

See `.env.example`. Validated at startup — the process refuses to boot on anything missing
or malformed, and tells you exactly what.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing. Min 32 chars; use different values |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Token lifetimes (`15m`, `7d`) |
| `CORS_ORIGINS` | Comma-separated allowed origins for the React app |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | Attachment storage and size cap |
| `OTP_TTL_MINUTES`, `OTP_MAX_ATTEMPTS` | Password-reset code policy |
| `SLA_JOB_ENABLED`, `SLA_JOB_INTERVAL_MS` | Escalation sweep. Disable on all but one instance |
| `SMTP_*`, `MAIL_FROM` | Email. **Leave `SMTP_HOST` empty in development** — emails, including OTP codes, print to the console instead |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Browser push. **Leave both keys empty in development** — pushes print to the console instead. Generate a real pair with `npx web-push generate-vapid-keys` |

---

## Real-time (Socket.IO)

Replaces SignalR. Same port as the REST API, and the **same JWT** guards it.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', { auth: { token: accessToken } });

socket.on('notification:new', n => console.log(n.message));

socket.emit('log:join', logId, res => console.log(res));   // authorised server-side
socket.on('chat:message',     m => console.log(m));
socket.on('log:status-changed', e => console.log(e));
socket.on('log:escalated',      e => console.log(e));

socket.emit('chat:send', { logId, message: 'On my way' }, res => console.log(res));
```

---

## Deploying

1. `NODE_ENV=production`, and real secrets for both JWT keys.
2. `npm ci --omit=dev && npx prisma migrate deploy`
3. Run behind a reverse proxy with TLS (`trust proxy` is already set).
4. Set `SLA_JOB_ENABLED=true` on **exactly one** instance — otherwise every instance sweeps.
5. Move `uploads/` to a mounted volume or object storage; container filesystems are ephemeral.
6. `SIGTERM` is handled: in-flight requests drain before the process exits.
