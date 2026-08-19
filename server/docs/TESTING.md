# Testing the API in Postman

Every endpoint, what to send, what you should get back, and **what to look at to confirm it
actually worked**.

---

## Setup (once)

**1. Start the API**

```bash
cd server
npm run dev
```

Leave this terminal visible — with no SMTP configured, **emails print here**, including the
password-reset codes you will need.

**2. Import into Postman**

`File → Import`, then select both:

- `server/docs/Techtrackers.postman_collection.json`
- `server/docs/Techtrackers.postman_environment.json`

**3. Select the environment**

Top-right dropdown → **Techtrackers Local**. Nothing will work without this — every request
uses `{{baseUrl}}`.

**4. Sanity check**

Run **00 Health & Index → Health check**. You want:

```json
{ "success": true, "status": "healthy", "database": "connected" }
```

`"database": "disconnected"` means Postgres is not running or `DATABASE_URL` is wrong.

---

## How the automation works

You never copy-paste a token or an id.

Each request has a **Tests** tab that writes values into the environment:

```js
pm.environment.set("accessToken", pm.response.json().data.accessToken);
pm.environment.set("logId",       pm.response.json().data.id);
```

Later requests read them back as `{{accessToken}}`, `{{logId}}`. So:

> **Run the folders in order, top to bottom.** Folder 03 needs the token from folder 01 and the
> category id from folder 02.

The **Tests** tab is also the verification: green ticks mean the response matched what the
endpoint promised. Click a request → **Test Results** after sending.

### Run everything at once

`Collection → ⋯ → Run collection → Run Techtrackers API v1`.

Expect **104 requests / 193 assertions passing**. Or headlessly:

```bash
npx newman run docs/Techtrackers.postman_collection.json \
                -e docs/Techtrackers.postman_environment.json
```

---

## Reading a response

Every response in the system has the same shape.

**Success**
```json
{ "success": true, "message": "Ticket HR-0001 logged successfully", "data": { } }
```

**Failure**
```json
{ "success": false, "message": "The submitted data failed validation",
  "errors": [ { "source": "body", "field": "title", "message": "Title must be at least 5 characters" } ] }
```

**List** — adds `meta`
```json
{ "success": true, "data": [ ], "meta": { "page": 1, "limit": 20, "total": 47, "totalPages": 3 } }
```

Status codes:

| Code | Means |
|---|---|
| `200` / `201` | Worked |
| `400` | Your request was understood but breaks a rule |
| `401` | No token, expired token, bad credentials |
| `403` | Authenticated, but not allowed |
| `404` | Not there — **or** there but not yours (deliberate; ids can't be probed) |
| `409` | Conflicts with current state (duplicate, already assigned) |
| `422` | Input failed validation — `errors[]` lists every problem |
| `429` | Rate limited |

---

# Folder-by-folder

## 01 — Auth

### `POST /auth/login` — **run this first**

```json
{ "email": "admin@techtrackers.local", "password": "Password123" }
```

**Verify:** `data.accessToken` is a JWT (three dot-separated parts); `data.user.roles` contains
`"ADMIN"`; `data.refreshToken` present.

Paste the access token into [jwt.io](https://jwt.io) — you will see `sub`, `roles`, `exp`. This
is what `authenticate` reads on every subsequent request.

The collection also logs in as staff, both technicians and the HOD, saving each token separately
(`{{staffToken}}`, `{{tech1Token}}`…) so later folders can prove that role checks bite.

### Security behaviours to confirm

| Request | Expect | Why it matters |
|---|---|---|
| Wrong password | `401` | |
| **Unknown email** | `401` — **identical message** | Compare the two bodies. Different messages would let someone discover which emails have accounts |
| `"email": "not-an-email"` | `422` naming the field | Validation runs before the controller |
| `GET /auth/me` with no token | `401` | |
| `GET /auth/me` with a garbage token | `401` | |

> In the old API none of this existed. `POST /api/User/login` compared plain-text passwords in
> SQL, returned a JSON blob with no credential, and every other endpoint was reachable without
> signing in at all.

### `GET /auth/me`

**Verify:** it returns *your* profile. There is no user id in the URL — the old
`/GetAdminLoggedIssues/admin/{adminId}` let you read anyone's data by changing the number.

### `POST /auth/refresh`

Send `{ "refreshToken": "{{refreshToken}}" }`.

**Verify — this is the interesting one:** run it **twice**. The second run returns `401`.
Refresh tokens rotate: using one revokes it. If a stolen token is ever replayed, it is already
dead — which is how theft becomes detectable.

### Password reset (three steps)

**Step 1 — `POST /auth/forgot-password`** with `{ "email": "staff2@techtrackers.local" }`

Look at the **API terminal**:

```
[MAIL:CONSOLE] To: staff2@techtrackers.local | Subject: Techtrackers password reset code
Your Techtrackers one-time code is 037208.
```

**Verify:** send an email that does not exist. You still get `200` with the same message —
no account enumeration.

**Step 2 — `POST /auth/verify-otp`** — paste the real code.

**Verify:** a wrong code returns `400`, and each failure is *counted*. After
`OTP_MAX_ATTEMPTS` (5) the code is locked, so a 6-digit number cannot be brute-forced.

**Step 3 — `POST /auth/reset-password`** — email + code + `newPassword`.

**Verify all four:**

1. `newPassword: "weak"` → `422` listing every unmet rule at once
2. A valid password → `200`
3. Log in with the **new** password → `200`; with the **old** → `401`
4. Reuse the same code → `400` — codes are single-use, and all your sessions were revoked

Then confirm it is genuinely hashed:

```bash
psql -U techtrackers -d techtrackers -c \
  'select email, "passwordHash" from users limit 1;'
# → $2a$12$Saps2d8ED87lY...   (bcrypt, cost 12)
```

> The old `users` table stored the password in clear text in a column *called* `PasswordHash`,
> and the OTP table stored codes in clear text too.

---

## 02 — Reference data

`GET /categories`, `/departments`, `/slas` — these populate the dropdowns on the log-an-issue form.

### `GET /slas` — **the automated SLA table**

This is what makes SLA assignment automatic: a ticket's priority selects its row.

| Priority | Respond within | Resolve within |
|---|---|---|
| `CRITICAL` | 15 min | 4 h |
| `HIGH` | 1 h | 8 h |
| `MEDIUM` | 4 h | 24 h |
| `LOW` | 8 h | 72 h |

### `POST /categories` — the RBAC proof

Send it twice, changing only the token:

| Token | Expect |
|---|---|
| `{{adminToken}}` | `201` |
| `{{staffToken}}` | **`403`** |

Same URL, same body — the *only* difference is who you are.

**Also verify:**
- POST the same category name twice → `409` (a Postgres unique violation turned into the right
  status, not a 500)
- `POST /slas` with `responseMinutes` > `resolutionMinutes` → `400`
- `DELETE` a category attached to tickets → `409` explaining why

> The old `DeleteDepartment` called `Remove()` unconditionally and surfaced the raw SQL
> foreign-key error to the client as a 500.

---

## 03 — Tickets: create & read

### `POST /logs` — the headline flow

```json
{
  "title": "Laptop will not power on",
  "description": "My work laptop stopped powering on this morning after a Windows update.",
  "categoryId": 1,
  "priority": "HIGH",
  "location": "HR Office, 2nd floor"
}
```

**Verify in the response:**

| Field | Should be | Why |
|---|---|---|
| `data.reference` | `HR-0001` | Department code + sequence, allocated in the transaction, unique-indexed |
| `data.status` | `PENDING` | You cannot set this — the field is not in the contract |
| `data.sla.priority` | `HIGH` | **Matched automatically** from the priority you sent |
| `data.timestamps.responseDueAt` | a timestamp | |
| `data.timestamps.resolutionDueAt` | **a timestamp** | **Both** deadlines exist from the moment the ticket is logged |

That last row is the important fix. The old code left `resolutionDue` NULL until a background
job noticed the response deadline had passed — so *"is this ticket overdue?"* was unanswerable
for any unassigned ticket.

Notice the body has no `Staff_ID`. You are the reporter because your **token** says so.

**Rejections to confirm:**

| Send | Expect |
|---|---|
| `"title": "hi"` | `422` — and `errors[]` lists **every** bad field, not just the first |
| `"categoryId": 999999` | `400` |
| No token | `401` |

### `POST /logs` with attachments

Switch the body to **form-data**, set `attachments` to type **File**, pick 1–5 files.

**Verify:**
- `data.attachments[]` lists name / type / size — **not the bytes**
- the files land in `server/uploads/` with **randomised** names like
  `1787125460067-b0f68fb1afca93e9.png` (a client cannot control the path on disk)
- a `.sh` or `.exe` → `400`, blocked by the mime allow-list
- a file over 5 MB → `400`
- `GET /logs` afterwards is a few kilobytes

> The old API stored raw bytes in a `varbinary` column and base64-inlined them into **every**
> list response. Twenty tickets with photos was tens of megabytes of JSON per page load.

### `GET /logs` — visibility scoping

**The single most important thing to test.** Send the *same request* with different tokens:

| Token | Sees |
|---|---|
| `{{staffToken}}` | Only tickets they reported |
| `{{tech1Token}}` | Only tickets assigned to them, plus accepted collaborations |
| `{{hodToken}}` | Everything in their department |
| `{{adminToken}}` | Everything |

Compare `meta.total` across the four. One endpoint, one code path — the filter is derived from
your JWT.

> The old `GetAllLogsAsync(userId, isTechnician)` took `isTechnician` as a **query-string
> boolean**. Callers chose their own permissions.

**Filters:** `?status=`, `?priority=`, `?categoryId=`, `?departmentId=`, `?technicianId=`,
`?open=true`, `?overdue=true`, `?search=`, `?sort=oldest`, `?page=`, `?limit=`.

Try `?overdue=true` — every ticket past its SLA deadline. The old API could not answer this.

### `GET /logs/:id`

**Verify:** as `{{tech2Token}}` (a technician with no connection to the ticket) you get **`404`,
not `403`** — 404 does not confirm the ticket exists, so ids cannot be probed.

### `GET /logs/:id/sla` — the countdown

```json
{
  "percentConsumed": 47,
  "resolutionRemainingMinutes": 254,
  "dueEscalationLevel": 0,
  "resolutionBreached": false
}
```

**Verify:** these are the numbers a progress bar would render. The background escalation job
calls the *same pure function*, so what the user sees and what the system acts on cannot drift.

---

## 04 — Assignment

### `GET /technicians`

**Verify:** each technician carries `openTaskCount` — their live workload. The old endpoint
returned name and email only, so dispatch was guesswork.

`GET /logs/:id/suggest-technician` recommends the least-loaded technician, preferring the
reporter's department.

### `POST /logs/:id/assign`

```json
{ "technicianId": 3 }
```

**Verify:**
- `data.status` → `ASSIGNED`
- `data.timestamps.respondedAt` is stamped — **this stops the response SLA clock**
- the technician now has a notification (folder 08)
- the technician can now `GET` the ticket (they got `404` a moment ago)

**Rejections — each one is a bug the old code had:**

| Send | Expect | The old behaviour |
|---|---|---|
| Assign again | `409` telling you to send `reassign: true` | Flat `400` with **no way to ever change it** — a mis-assignment was permanent |
| `technicianId` = a **staff member** | `400` naming their actual roles | Assigned them happily; it only checked `TechnicianId <= 0` |
| With `{{staffToken}}` | `403` | No check at all |

Then `{ "technicianId": <other>, "reassign": true }` → `200`. Both technicians are notified and
both workload counters corrected in one transaction.

---

## 05 — Ticket lifecycle

**Run these in order** — the point is that the lifecycle is enforced.

`PATCH /logs/:id/status` with `{ "status": "IN_PROGRESS" }`

| Step | Send | Expect |
|---|---|---|
| 1 | `IN_PROGRESS` | `200` |
| 2 | `ON_HOLD` with **no note** | **`400`** — a hold must be explained |
| 3 | `ON_HOLD` + `"note": "Awaiting parts"` | `200` |
| 4 | `RESOLVED` (still on hold) | **`400`**, and the message **lists the legal next states** |
| 5 | `IN_PROGRESS` | `200` |
| 6 | `RESOLVED` | `200`, `resolvedAt` stamped |
| 7 | `CLOSED` as `{{tech1Token}}` (uninvolved) | **`403`** |
| 8 | `CLOSED` as `{{staffToken}}` (the reporter) | `200` |

Step 4 is the state machine. Step 7 is per-record authorization: only the assigned technician,
an accepted collaborator, the reporter (to *close* a resolved ticket), an admin, or the ticket's
own HOD may drive it.

A reporter can **not** mark their own ticket `RESOLVED` — only close one the technician resolved.

> The old API let any authenticated caller write any string over any status, including reviving
> a `CLOSED` ticket.

### `GET /logs/:id/history`

**Verify:** one row per transition — from, to, who, when, why.

> This table existed in the old schema and **was never written to**. A ticket's past was
> unknowable.

### `POST /logs/:id/reopen` (admin/HOD)

`CLOSED` is terminal in the transition table, so reopening is its own endpoint with its own
audit note. **Verify:** `resolvedAt` is cleared, so reports stop counting it as solved.

---

## 06 — Collaboration

`POST /collaborations` — `{ "logId": 1, "inviteeId": 4, "message": "Need a second opinion" }`

Only the **assigned** technician (or an admin) may invite. Watch the API terminal for the
invitation email.

**Verify — each was a hole in the old version:**

| Action | Expect | Old behaviour |
|---|---|---|
| Invite yourself | `400` | Allowed |
| Invite a non-technician | `400` | Allowed |
| **Requester** accepts their own invite | **`403`** | **Allowed** — the endpoint took an id from the URL and had no idea who was calling |
| **Invitee** accepts | `200` | |
| After accepting, invitee `GET`s the ticket | **`200`** | **`404`** — accepting changed a status column and granted no actual access |

That last row is the substantive fix: accepting a collaboration now *means* something.

`GET /collaborations?direction=incoming&status=PENDING` — always scoped to you. The old API had
two endpoints that each took a technician id in the URL and would return anyone's.

---

## 07 — Chat & feedback

### `POST /logs/:id/chat`

**Verify:** as a non-participant → `403`. The old SignalR hub had **no authentication** —
anyone could join any ticket's conversation and post as anyone.

`GET /logs/:id/chat` returns the history. **Messages sent over the websocket appear here too**,
because both paths go through the same service.

> In the old stack the controller saved messages and the hub broadcast them, and the two were
> never connected — half a conversation vanished on refresh.

### `POST /feedback`

```json
{ "logId": 1, "rating": 5, "comments": "Sorted the same day." }
```

| Send | Expect |
|---|---|
| As the reporter, ticket resolved | `201` |
| Again | `409` — once per ticket |
| As the **technician** | `403` — you cannot rate your own work |
| `"rating": 11` | `422` |
| On a ticket still `IN_PROGRESS` | `409` |

> The old endpoint took the rater's id **from the request body** and checked nothing — so anyone
> could post unlimited five-star ratings as anyone. Technician performance scores are averaged
> from this table, which made them meaningless.

---

## 08 — Notifications

**Verify first:** no endpoint here takes a user id. Everything is implicitly yours.

| Request | Verify |
|---|---|
| `GET /notifications` | After logging + assigning, staff have several: logged, assigned, status changed |
| `GET /notifications?unreadOnly=true` | Only unread |
| `GET /notifications/unread-count` | The badge number — poll this, not the whole list |
| `PATCH /notifications/:id/read` | `200` |
| Same id, **another user's** token | **`404`** — scoped by userId as well as id |
| `PATCH /notifications/read-all` | Returns how many were updated |

> The old system had three notification controllers (one returning a hard-coded string), and
> its live endpoint was `GET /{userId}/staged` — change the number, read someone else's.

---

## 09 — Reports

| Endpoint | Returns |
|---|---|
| `/reports/status-counts` | Totals by status, plus open and overdue |
| `/reports/issues` | Row per ticket: real `resolutionHours`, `metSla` true/false |
| `/reports/monthly-summary?months=6` | Trend: logged, resolved, avg hours, compliance % |
| `/reports/technician-performance` | Per-technician scorecard |
| `/reports/sla-compliance` | **Are we meeting our SLAs?**, by priority |

All accept `?from=` / `?to=` as ISO timestamps, and are scoped to what you may see — an HOD's
report covers their department, an admin's covers everything. Same URL.

**Verify:** `{{staffToken}}` on any of these → `403`.

**Verify the numbers are real.** Check `status-counts`: the `ON_HOLD` figure is non-zero once
you have held a ticket.

> In the old code the writer stored `"ONHOLD"` and the report counted `"On Hold"` — that tile
> was permanently zero.
>
> And every "average resolution time" was computed as `resolutionDue − assignedAt` — the SLA
> *window*, not elapsed time. It reported the same figure whether a ticket was fixed in an hour
> or never fixed at all. Here it is `resolvedAt − createdAt`.

`sla-compliance` is a report the old system could not produce at all, despite storing the data.

---

## 10 — Technician stats

`GET /technicians/:id/stats` — counts by status, open/overdue, average resolution hours, SLA
compliance %, average rating: **one call**.

> The old `TechController` had five separate count endpoints, so a dashboard made five HTTP
> round-trips to draw four tiles — and could produce none of the performance figures.

**Verify:** a technician may read their own stats; another technician's id with their token → `403`.

---

## 11 — User administration (admin only)

`POST /users` creates the user **and** their technician profile in one transaction:

```json
{
  "surname": "Mahlangu", "initials": "K",
  "email": "k.mahlangu@techtrackers.local", "password": "Password123",
  "departmentId": 1, "roles": ["TECHNICIAN"],
  "technicianProfile": { "specialization": "Network Infrastructure",
                          "availableFrom": "08:00", "availableTo": "17:00" }
}
```

| Send | Expect |
|---|---|
| `"password": "abc"` | `422` listing every unmet rule |
| An email already in use | `409` |
| `PATCH` with an empty body | `422` — an update that changes nothing is a mistake |
| `DELETE` a technician with open tickets | `409` telling you to reassign first |
| Any of these as `{{staffToken}}` | `403` |

**Verify:** the response contains no password field, and `DELETE` **deactivates** rather than
deletes — a user is referenced by every ticket they touched, so deleting would destroy history.
It also revokes their sessions immediately.

> `AddUserService.cs` in the old repo was **entirely commented out**. There was no way to create
> a user through the API at all; you inserted rows by hand in SQL.

---

## 12 — Error handling

**Verify every one returns JSON in the standard envelope**, never an HTML page:

| Request | Expect |
|---|---|
| `GET /api/v1/does-not-exist` | `404` |
| `GET /logs/abc` | `422` |
| `GET /logs/999999` | `404` |
| Deliberately broken JSON body | `400` "Request body is not valid JSON" |
| No token | `401` |
| Garbage token | `401` |

Also confirm nothing internal leaks: no stack traces, no table names, no SQL. The old handlers
returned `details = ex.Message` straight to the client.

---

# Testing the SLA escalation engine

The one thing Postman cannot easily show, because it happens on a timer.

## Option A — watch it live (fastest)

Temporarily shorten an SLA so a ticket breaches in minutes:

```bash
# 1. Set CRITICAL to 1 minute response / 2 minutes resolution
curl -X POST http://localhost:5000/api/v1/slas \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"priority":"CRITICAL","responseMinutes":1,"resolutionMinutes":2}'

# 2. Log a CRITICAL ticket, then watch the API terminal
```

Within ~2 minutes:

```
[WARN] Ticket ICT-0004 escalated to level 1
[WARN] Ticket ICT-0004 escalated to level 2
[WARN] Ticket ICT-0004 escalated to level 3
[INFO] Escalation sweep: 3 escalation(s) raised across 1 open ticket(s)
```

Then in Postman:

- `GET /logs/:id` → `status` is `ESCALATED`, `escalationLevel` is `3`, `escalations[]` has three rows
- `GET /logs/:id/sla` → `resolutionBreached: true`, `percentConsumed: 100`
- `GET /notifications` as the technician, the reporter and the admin → each was told

**Then restore the real SLA** (`responseMinutes: 15, resolutionMinutes: 240`).

Escalation thresholds are **50%** → level 1, **75%** → level 2, **100%** → level 3
(`constants/index.js` → `ESCALATION_THRESHOLDS`).

## Option B — run the sweep directly

```bash
cd server
node -e "
import('./src/services/escalation.service.js').then(async m => {
  console.log(await m.runEscalationSweep());
  process.exit(0);
});
"
# → { scanned: 12, escalated: 3, at: 2026-08-19T07:43:59.834Z }
```

**Verify idempotency:** run it **twice**. The second call reports `escalated: 0`. Each level is
raised exactly once, guaranteed by `@@unique([logId, level])`.

> The old job re-notified on **every** pass, and its loop ran every six seconds.

---

# Testing concurrency

Postman and Newman fire requests **sequentially**, so they cannot catch a race. There is a
separate script for this:

```bash
npm run check:concurrency      # API must be running
```

It fires 10 simultaneous ticket submissions from each of two departments and checks four things:

| Check | Why |
|---|---|
| Every submission succeeded | A race here rejects real users' tickets |
| No duplicate references | Correctness |
| References are **gapless** per department | A missing `HR-0014` looks like a lost ticket to whoever was quoted it |
| Departments did not block each other | The lock must be per-department, not global |

Expected:

```
  20/20 succeeded in 171ms

  PASS  every concurrent submission succeeded
  PASS  no duplicate references issued
  PASS  HR references are gapless — HR-0074..HR-0083, 0 gap(s)
  PASS  ICT references are gapless — ICT-0011..ICT-0020, 0 gap(s)
  PASS  departments did not serialise against each other — 171ms
```

**Keep this in the suite.** Reference allocation is serialised by a `SELECT … FOR UPDATE` row
lock in `log.service.js → nextReference()`. That lock looks removable to anyone tidying the code,
and nothing else in the test suite would notice it going. Before the lock existed, 10 concurrent
submissions produced **3 tickets and 7 rejections**.

---

# Testing real-time (Socket.IO)

Save as `socket-test.html` and open it in a browser:

```html
<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
<script>
  const TOKEN = 'paste-an-access-token-here';
  const LOG_ID = 1;

  const socket = io('http://localhost:5000', { auth: { token: TOKEN } });

  socket.on('connect',    () => console.log('connected'));
  socket.on('connect_error', e => console.error('rejected:', e.message));

  socket.emit('log:join', LOG_ID, r => console.log('join:', r));

  socket.on('notification:new',   n => console.log('NOTIFICATION', n.message));
  socket.on('chat:message',       m => console.log('CHAT', m.sender.name, m.message));
  socket.on('log:status-changed', e => console.log('STATUS', e));
  socket.on('log:escalated',      e => console.log('ESCALATED', e));

  window.send = msg => socket.emit('chat:send', { logId: LOG_ID, message: msg },
                                    r => console.log('sent:', r));
</script>
```

**Verify:**

1. **No token** → `connect_error: Authentication required`. The old SignalR hub accepted anyone.
2. With a valid token → `connected`.
3. `log:join` on a ticket you are **not** a participant on → `{ success: false }`, same rule as REST.
4. Assign a ticket in Postman → a `notification:new` fires in the browser instantly.
5. `send('hello')` in the console, then `GET /logs/:id/chat` in Postman → **the message is there**.
   One path: persist, then broadcast.

---

# Inspecting the database

```bash
npm run prisma:studio      # GUI at http://localhost:5555
```

Worth looking at after a run:

| Table | What to check |
|---|---|
| `users` | `passwordHash` is a bcrypt string, not a password |
| `logs` | `reference` unique; `responseDueAt` **and** `resolutionDueAt` both set on every row |
| `log_status_history` | One row per transition, with `changedById` |
| `escalations` | At most one row per `(logId, level)` |
| `notifications` | Rows for the right recipients |
| `password_reset_otps` | `codeHash` is a hash, not six digits |
| `refresh_tokens` | `tokenHash` is a hash; rotated ones have `revokedAt` set |

---

# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ECONNREFUSED` on every request | The API is not running — `npm run dev` |
| `"database": "disconnected"` | Postgres is down, or `DATABASE_URL` is wrong |
| `401` on everything | Run **01 Auth → Login (Admin)**; check the environment is selected |
| `401` after ~15 minutes | The access token expired — run **Refresh access token** or log in again |
| `403` you did not expect | You are using the wrong role's token — check the `Authorization` header |
| `{{logId}}` literally in the URL | You skipped the request that sets it. Run folders in order |
| Invalid environment configuration at startup | Copy `.env.example` → `.env`; both JWT secrets need 32+ characters |
| No OTP email | Expected in development — the code prints to the **API terminal** |
| `429 Too many requests` | Auth endpoints are rate-limited. Wait, or raise the limit in `.env` |
