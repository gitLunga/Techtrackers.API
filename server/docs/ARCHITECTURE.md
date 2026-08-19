# Architecture

How this backend is put together, and **why each piece exists**.

If you are coming from the ASP.NET version, the mental model transfers almost directly —
the names change, the responsibilities do not.

| ASP.NET Core | Here | Notes |
|---|---|---|
| `Program.cs` (services) | `src/app.js` | Assembles Express, sets middleware order |
| `Program.cs` (`app.Run()`) | `src/server.js` | Binds the port, graceful shutdown |
| `appsettings.json` + `IConfiguration` | `.env` + `src/config/env.js` | Validated at startup |
| `[Route]` / `[HttpGet]` attributes | `src/routes/*.routes.js` | URLs written down, not generated from method names |
| `Controllers/*.cs` | `src/controllers/*.controller.js` | Now genuinely thin |
| `Service/*.cs` | `src/services/*.service.js` | All business logic |
| `TechTrackersDbContext` | `src/config/prisma.js` | **Singleton**, not scoped — see below |
| `Model/*.cs` + `OnModelCreating` | `prisma/schema.prisma` | 16 files collapsed into one |
| `dto/*.cs` | `src/validators/*.validator.js` | Contracts that actually *validate* |
| `[Authorize(Roles=...)]` | `middleware/authorize.js` | Applied in the route table |
| `[Required]` + ModelState | `middleware/validate.js` (Zod) | Every failure reported at once |
| `AddHostedService<SLAMonitoringService>` | `jobs/slaMonitor.job.js` | Schedule split from rules |
| `Hubs/ChatHub.cs` (SignalR) | `realtime/socket.js` (Socket.IO) | Now authenticated |
| `dotnet ef migrations add` | `npx prisma migrate dev` | Same idea |

> **One important difference.** EF Core registers `DbContext` as **scoped** — a new one per
> request — because it tracks entity state. `PrismaClient` is stateless and owns a connection
> **pool**, so the correct pattern is the opposite: one instance for the whole process.
> Creating one per request would exhaust Postgres connections in seconds.

---

## The layers

```
                    HTTP request
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  routes/           WHICH url, WHO may call it                    │
│                    Reads as a table of contents.                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  middleware/       authenticate  → who are you?          401     │
│                    authorize     → may you do this?      403     │
│                    validate      → is the input sane?    422     │
│                    upload        → files to disk         400     │
│                    Each link can stop the request.               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  controllers/      Translate HTTP → service call → HTTP.         │
│                    NO business rules. Typically 3-5 lines.       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  services/         THE SYSTEM. Every rule lives here.            │
│                    Knows nothing about req, res, or status codes.│
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  config/prisma.js  →  PostgreSQL                                 │
└──────────────────────────────────────────────────────────────────┘

         Anything thrown at any level lands in
         middleware/errorHandler.js  →  one JSON envelope
```

### The rule that keeps it honest

> **A controller may not contain an `if` about business rules.**

If you are writing one, it belongs in a service. This is the boundary the old code lost:
`LogController.AssignTechnician` was 80 lines of database queries, SLA arithmetic and
notification building inside an HTTP handler — while `AssignTechnicianService.cs`, the file
named for the job, only listed technicians.

Business logic in a controller can only ever be reached over HTTP. Move it to a service and
the SLA job, the socket handler and a future CLI can all call the same code.

---

## Walkthrough: `POST /api/v1/logs`

Logging an issue, all the way down.

**1. `routes/log.routes.js`** — the entry
```js
router.use(authenticate);                                   // everything below needs a token
router.post('/', withAttachments, validate(createLogSchema), logController.createLog);
```
`withAttachments` runs *before* `validate` deliberately: multipart bodies are not parsed until
multer has consumed the stream, so validation before it would fail on every field.

**2. `middleware/authenticate.js`** — verifies the JWT, re-reads the user (so an account
deactivated a minute ago loses access immediately), attaches `req.user`.

**3. `middleware/validate.js`** — parses the body against the Zod schema and *replaces* it with
the parsed result. From here the controller can trust its input completely.

Note what the create schema does **not** accept: no `status`, no `reportedById`. The old
`LogDto` carried `Staff_ID`, so a request could claim to be someone else.

**4. `controllers/log.controller.js`** — five lines:
```js
const log = await logService.createLog({
  payload: req.body,
  reporterId: req.user.id,     // from the token, never the body
  files: req.files ?? [],
});
return created(res, log, `Ticket ${log.reference} logged successfully`);
```

**5. `services/log.service.js`** — the actual work, in **one transaction**:
- look up the reporter and their department
- `slaService.resolveSlaForPriority(priority)` — **this is the automated SLA assignment**
- `computeDeadlines(sla, now)` — both `responseDueAt` and `resolutionDueAt`
- `nextReference(tx, department)` — `HR-0007`, allocated inside the transaction
- create the ticket, its attachment rows and its opening history row

Notifications are sent *after* the transaction commits: a mail or socket hiccup must never
roll back a successfully logged ticket.

**6. Response** — `utils/apiResponse.js` wraps it in the standard envelope.

If anything threw — a missing category, a priority with no SLA — `asyncHandler` forwards it to
`errorHandler`, which maps it to the right status code. No try/catch anywhere in the path.

---

## Where the important logic lives

| Question | File |
|---|---|
| Which SLA applies, and when is this due? | `services/sla.service.js` |
| When does a ticket escalate, and who hears about it? | `services/escalation.service.js` |
| How often is that checked? | `jobs/slaMonitor.job.js` |
| Who may see which tickets? | `services/log.service.js` → `visibilityFilter` |
| Who may *change* a ticket? | `services/log.service.js` → `assertCanModify` |
| Which status transitions are legal? | `constants/index.js` → `STATUS_TRANSITIONS` |
| Who may call this endpoint at all? | the `authorize(...)` in its routes file |
| What does this endpoint accept? | its schema in `validators/` |

---

## Three decisions worth explaining

### 1. Visibility is derived, never requested

```js
export function visibilityFilter(user) {
  if (user.roles.includes(ROLES.ADMIN)) return {};
  if (user.roles.includes(ROLES.HOD))   return { departmentId: user.departmentId };
  if (isTechnician(user)) return { OR: [
    { technicianId: user.id },
    { collaborations: { some: { inviteeId: user.id, status: 'ACCEPTED' } } },
  ]};
  return { reportedById: user.id };
}
```

Every ticket query composes this. `GET /logs` is one endpoint that returns the right data for
every role — which is why there is no separate "admin list" controller.

The old API asked the *client*: `GetAllLogsAsync(userId, isTechnician)` took a boolean from the
query string. Callers chose their own permissions.

**Seeing** and **changing** are separate rights, so `assertCanModify` is a stricter, second
check — a reporter can see their ticket but may only *close* one the technician already marked
resolved.

### 2. The SLA clock is one pure function

`sla.service.evaluate(log, now)` takes a ticket and a timestamp and returns percentages,
remaining minutes and the escalation level earned. It touches no database and calls no clock of
its own.

That matters because **both** `GET /logs/:id/sla` (what the user sees) and the background sweep
(what the system acts on) call it. They cannot disagree. It is also trivially unit-testable —
pass a fabricated ticket and a fabricated `now`.

The old code computed this in three places that each got it differently, and the background job
read an SLA relation it had never `.Include()`d, so `?? 2` gave every ticket a two-minute window.

### 3. Escalation is idempotent

The `escalations` table has `@@unique([logId, level])`. The sweep checks before inserting, so
running it every minute — or ten times in a row — raises each level exactly once.

The old job re-notified on every pass. With its `Task.Delay(TimeSpan.FromMinutes(0.1))`, that
was a notification storm every six seconds.

---

## Request lifecycle for errors

```
service throws  ApiError.conflict('Technician already assigned')
       │
       ▼
asyncHandler catches the rejection → next(err)
       │
       ▼
errorHandler
   ├── ApiError?                    → use its status + message
   ├── Prisma P2002 (unique)        → 409
   ├── Prisma P2003 (foreign key)   → 400
   ├── Prisma P2025 (not found)     → 404
   ├── body-parser parse failure    → 400
   └── anything else                → log the full stack SERVER-SIDE,
                                       return a generic 500 to the client
```

A service can raise a precise HTTP outcome from deep inside business logic without importing
Express or knowing what HTTP is. And unknown errors never leak their internals — the old
handlers returned `details = ex.Message`, which for EF exceptions could include schema detail.

---

## The ticket lifecycle

Declared as data in `constants/index.js`, not as scattered `if` statements.

```
                    ┌──────────┐
   staff logs  ───▶ │ PENDING  │
                    └────┬─────┘
             admin assigns │
                    ┌────▼─────┐
                    │ ASSIGNED │◀────────────┐
                    └────┬─────┘             │
        technician starts │                  │ reopened
                    ┌────▼────────┐          │
          ┌────────▶│ IN_PROGRESS │          │
          │         └──┬───────┬──┘          │
   resumed│            │       │             │
       ┌──┴──────┐     │       │        ┌────┴─────┐
       │ ON_HOLD │◀────┘       └───────▶│ RESOLVED │
       └─────────┘  needs a note        └────┬─────┘
                                  reporter   │
   any open state ──▶ ESCALATED   confirms   │
   (raised by the SLA sweep)            ┌────▼───┐
                                        │ CLOSED │  terminal
                                        └────────┘
                                   (reopen has its own endpoint)
```

`ON_HOLD → RESOLVED` is deliberately **not** legal: you must come off hold first, so the audit
trail records that the work actually resumed.

---

## Adding a feature

Say you want ticket templates.

1. **`prisma/schema.prisma`** — add the `LogTemplate` model → `npm run prisma:migrate`
2. **`src/services/template.service.js`** — the logic. Throw `ApiError.*` for expected failures.
3. **`src/validators/`** — a Zod schema for each endpoint's input.
4. **`src/controllers/template.controller.js`** — thin handlers wrapped in `asyncHandler`.
5. **`src/routes/template.routes.js`** — URLs with `authenticate` + `authorize(...)` + `validate(...)`.
6. **`src/routes/index.js`** — one line: `router.use('/templates', templateRouter);`
7. **`docs/Techtrackers.postman_collection.json`** — add a folder with assertions.

You will not touch `app.js`, and nothing existing changes.
