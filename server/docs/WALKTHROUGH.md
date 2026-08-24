# Running and testing Techtrackers locally

A scripted pass through the whole system. Roughly **45 minutes** end to end.

Every step says three things: **what to do**, **what you should see**, and **what
it proves**. If a "should see" does not match, that is a bug worth reporting —
not you doing it wrong.

You will need **two terminals** open the whole time: one for the API, one for the
web app. Keep the API terminal visible — password-reset codes and SLA escalations
print there.

---

## Part 0 — Setup (once, ~10 minutes)

### Prerequisites

| | Version | Check with |
|---|---|---|
| Node.js | 20 or newer | `node -v` |
| Docker Desktop | any recent | `docker --version` |
| Git | any | `git --version` |

> **No Docker?** Install PostgreSQL 16 yourself, create a database and user, and
> point `DATABASE_URL` at it. Everything else is identical.

### 1. Get both repositories

```bash
git clone https://github.com/gitLunga/Techtrackers.API.git
git clone https://github.com/gitLunga/Techtrackers.Web.git

cd Techtrackers.API   && git checkout backend_node_version   && cd ..
cd Techtrackers.Web   && git checkout frontend_ui_overhaul   && cd ..
```

### 2. Start the database and the API — **terminal 1**

```bash
cd Techtrackers.API/server

docker compose up -d --wait      # PostgreSQL, ready when this returns

cp .env.example .env             # Windows cmd:  copy .env.example .env
                                 # PowerShell:   Copy-Item .env.example .env

npm install
npm run prisma:migrate           # creates every table
npm run db:seed                  # roles, departments, categories, SLA targets, users
npm run db:seed:demo             # 39 realistic tickets so nothing is empty
npm run dev
```

The demo seed prints what it created. You should get:

```
  CLOSED  10 | IN_PROGRESS  7 | RESOLVED  6 | PENDING  6
  ASSIGNED 4 | ESCALATED    3 | ON_HOLD   3
  3 ticket(s) are past their SLA deadline.
```

Plus conversation on about half of them, seven pieces of feedback, and two
pending collaboration invitations — so every screen has something real on it.

**You should see:**

```
Database connection established
SLA monitor started; sweeping every 60s
Techtrackers API listening on http://localhost:5000
```

A few seconds later, a short burst of escalation warnings:

```
[WARN] Ticket HR-0019 escalated to level 1
[WARN] Ticket HR-0019 escalated to level 2
[WARN] Ticket HR-0019 escalated to level 3
[INFO] Escalation sweep: 7 escalation(s) raised across 23 open ticket(s)
```

That is **expected and is the point** — the demo data deliberately includes three
tickets already past their deadline, and the SLA monitor catches them on its
first sweep. It will not repeat: run it again and the sweep reports 0.

**Leave this terminal running and visible.**

### 3. Start the web app — **terminal 2**

```bash
cd Techtrackers.Web

npm install
npm run dev
```

**You should see** `Local: http://localhost:3000` within a second or two.

### 4. Sanity check

Open **http://localhost:5000/health** in a browser.

```json
{ "success": true, "status": "healthy", "database": "connected" }
```

If `database` says `disconnected`, the API is up but Postgres is not — check
`docker compose ps`.

### Your test accounts

All use the password **`Password123`**.

| Role | Email | What they can do |
|---|---|---|
| Admin | `admin@techtrackers.local` | Everything |
| Head of Dept | `hod@techtrackers.local` | Their department + reports |
| Technician | `tech1@techtrackers.local` | Resolve tickets assigned to them |
| Technician | `tech2@techtrackers.local` | Second technician, for collaboration |
| External tech | `external@techtrackers.local` | Same, flagged external |
| Staff | `staff@techtrackers.local` | Log and track their own issues |
| Staff | `staff2@techtrackers.local` | Second reporter |

> **Tip:** open each role in a **separate browser profile or incognito window**.
> Sessions are per-browser, so otherwise you will be logging in and out
> constantly. Chrome: `⋮ → New Incognito window` for the second role.

---

## Part 1 — The staff journey

**Sign in as `staff@techtrackers.local`.**

### 1.1 The dashboard

**You should see:** four tiles (Total logged / Still open / Resolved / Past SLA),
then a Recent tickets table with real SLA countdowns like *"in 6h 20m"*.

**What it proves:** the token from sign-in is being attached to API calls, and
the backend is scoping results — this staff member sees only their own tickets,
not all 40.

### 1.2 Log an issue

**Do:** click **Log an issue**. Fill in a title and description, pick a category,
then **change the Priority dropdown** and watch the right-hand panel.

**You should see:** the *Service targets* panel update instantly:

| Priority | First response | Resolution |
|---|---|---|
| Critical | 15 min | 4h |
| High | 1h | 8h |
| Medium | 4h | 24h |
| Low | 8h | 3 days |

**What it proves:** those numbers come from the live SLA table, not hard-coded.
Change one at **Admin → SLA Targets** and this panel changes with it.

### 1.3 Validation

**Do:** try to submit with a two-character title.

**You should see:** the field goes red with *"Title must be at least 5
characters"*, and the form does not submit.

**What it proves:** the same rules the API enforces are checked before the
request, so you get told immediately rather than after a round trip.

### 1.4 Attachments

**Do:** attach a screenshot, then submit.

**You should see:** you land on the new ticket, reference like **HR-0004**, status
**Pending**, and your file listed with its size.

**Then check** `Techtrackers.API/server/uploads/` — your file is there under a
**randomised name** like `1787125460067-b0f68fb1.png`.

**What it proves:** files go to disk, not into the database, and the client
cannot control the path on disk. Try attaching a `.exe` — it is rejected.

### 1.5 The ticket page

**You should see:** status and priority chips, the SLA panel with a countdown,
and three tabs — Conversation, History, Feedback.

**Open History.** Even on a brand-new ticket there is already one entry:
*"Ticket logged"*, with your name and timestamp.

**What it proves:** the audit trail is being written. In the old system this
table existed and was never written to.

---

## Part 2 — The admin journey

**Sign in as `admin@techtrackers.local`** (second browser window).

### 2.1 Scope

**Do:** go to **All Tickets**.

**You should see:** ~40 tickets — including the one staff just logged, and
tickets from other people that staff could not see.

**What it proves:** *the same endpoint* returns different data per role. There is
no separate "admin list" — the backend filters on the token.

### 2.2 Filters live in the URL

**Do:** set Status to **Escalated**, then click **Past SLA**.

**You should see:** the list narrow, and the address bar become something like
`/admin/tickets?status=ESCALATED&overdue=true`.

**Now copy that URL into a new tab.** It reproduces the exact same filtered view.

**What it proves:** filtered views are shareable and survive a refresh — you can
send a colleague "here are the breached tickets" as a link.

### 2.3 Assign work

**Do:** open the ticket staff just logged → **Assign**.

**You should see:** each technician with a **live open-ticket count**,
colour-coded (green ≤2, amber ≤5, red beyond), plus a **Suggested** technician at
the top — the least-loaded one, preferring the reporter's own department.

**Do:** assign someone.

**You should see:** status becomes **Assigned**, and in the SLA panel *First
response* is now stamped with a time.

**What it proves:** assignment stops the response clock. This is what the response
SLA is measured against.

### 2.4 Reassignment is possible

**Do:** click **Reassign** and pick someone else.

**You should see:** it works, and both technicians get notified.

**What it proves:** worth calling out because the old system returned "a
technician has already been assigned" and offered **no way to ever change it** —
a mis-assignment was permanent.

---

## Part 3 — The technician journey

**Sign in as whichever technician you assigned** (third window, or reuse one).

### 3.1 The queue

**You should see:** the ticket in **Assigned to me**, and a notification in the
bell menu.

### 3.2 Work the lifecycle — the important test

Open the ticket and use **Update status**. Do these **in order**:

| Step | Choose | You should see |
|---|---|---|
| 1 | In Progress | Accepted |
| 2 | On Hold | **A dialog demanding a reason** — you cannot proceed without one |
| 3 | *(type a reason, confirm)* | Status becomes On Hold, reason shown on the ticket |
| 4 | Open the menu again | **"Mark as Resolved" is not offered** |
| 5 | In Progress | Accepted |
| 6 | Resolved | Accepted |

**What step 4 proves — this is the key test.** The status menu only offers
transitions the API will actually accept. You cannot jump from On Hold straight
to Resolved; you must come off hold first, so the audit trail records that work
genuinely resumed. In the old system any string could be written over any status,
including reviving a closed ticket.

### 3.3 Conversation

**Do:** post a message on the ticket. Now switch to the **staff** window with the
same ticket open.

**You should see:** the message appear **without refreshing**.

**What it proves:** Socket.IO is live *and* the message was persisted — refresh
the page and it is still there. In the old system the controller saved messages
and the SignalR hub broadcast them, and the two were never connected, so half a
conversation vanished on refresh.

### 3.4 Collaboration

**Do:** on a ticket assigned to you, click **Invite a colleague**, pick the other
technician, send.

**Then sign in as that other technician** → **Collaborations** → **Accept**.

**Now try to open the ticket as them.**

**You should see:** they can now see it. Before accepting, that URL gave them a
**404**.

**What it proves:** accepting a collaboration grants *real* access. In the old
system it flipped a status column and the collaborator still could not see the
ticket they had agreed to help with.

### 3.5 History

**Open the History tab.**

**You should see:** every transition in order — logged → assigned → in progress →
on hold (with your reason) → in progress → resolved — each with who did it and
when.

---

## Part 4 — Closing the loop

**Back in the staff window**, open the resolved ticket.

### 4.1 Only the reporter closes

**You should see:** you can mark it **Closed** — but **not** Resolved.

**What it proves:** a reporter confirms a fix; they cannot declare their own issue
fixed. Per-record permission, not just role-based.

### 4.2 Rate it

**Do:** Feedback tab → stars → comment → submit. **Then try again.**

**You should see:** *"You have already given feedback on this ticket."*

**Also try:** rating it as the **technician** — refused.

**What it proves:** feedback is once, by the reporter only, after resolution. The
old endpoint took the rater's id from the request body and checked nothing, so
anyone could post unlimited five-star ratings as anyone — which made every
technician performance score meaningless.

---

## Part 5 — Reports

**As admin.**

| Screen | You should see | Why it matters |
|---|---|---|
| **Reports → Overview** | Donut by status, logged-vs-resolved bars, compliance line | Charts use the brand teal — they are themed, not chart-library defaults |
| **Reports → SLA Compliance** | Headline %, breakdown per priority, breached-now count | **This report did not exist before.** The data was stored and nothing could answer "are we meeting our SLAs?" |
| **Reports → Technician Performance** | Assigned / resolved / avg resolution / SLA% / rating | The numbers are real now — see below |

**Look at "Avg resolution".** Different technicians show different values.

**What it proves:** it is measured from *logged* to *actually resolved*. The old
report computed `resolutionDue − assignedAt` — the **SLA window**, not elapsed
time — so it printed the same number whether a ticket was fixed in an hour or
never fixed at all.

**Also check Overview.** The **On Hold** count is non-zero. In the old code the
writer stored `"ONHOLD"` and the report counted `"On Hold"`, so that figure was
permanently zero.

---

## Part 6 — Watch escalation fire (the fun one)

The SLA monitor sweeps every 60 seconds. To see it work without waiting hours,
shorten an SLA temporarily.

**Do:**

1. As admin → **SLA Targets** → edit **Critical** → respond **1** minute, resolve
   **2** minutes → save.
2. As staff → log a new **Critical** ticket.
3. **Watch the API terminal** (terminal 1).

**Within about two minutes you should see:**

```
[WARN] Ticket ICT-0004 escalated to level 1
[WARN] Ticket ICT-0004 escalated to level 2
[WARN] Ticket ICT-0004 escalated to level 3
[INFO] Escalation sweep: 3 escalation(s) raised across 1 open ticket
```

**Then in the browser:**

- The ticket shows a red **SLA breached** banner and status **Escalated**
- **History** shows all three escalation levels with timestamps
- The **staff** member, the **technician** and the **admin** each have a
  notification
- The **Past SLA** tile has gone up

**Now wait another two minutes and watch the terminal.** Nothing more appears.

**What that proves:** escalation is idempotent — each level fires exactly once,
guaranteed by a unique constraint. The old job re-notified on **every** pass, and
its loop ran every six seconds.

**Remember to set Critical back** to 15 / 240 afterwards.

---

## Part 7 — Password reset without a mail server

**Do:** sign out → **Forgot your password?** → enter `staff2@techtrackers.local`.

**Now look at the API terminal:**

```
[MAIL:CONSOLE] To: staff2@techtrackers.local | Subject: Techtrackers password reset code
Your Techtrackers one-time code is 037208.
```

**Do:** paste the code, set a new password (needs 8+ chars, upper, lower, number).

**Then verify all four:**

| Try | You should see |
|---|---|
| Sign in with the **new** password | Works |
| Sign in with the **old** password | Rejected |
| Reuse the same code | *"No active one-time code"* — codes are single use |
| Request a code for an email that **does not exist** | **Still says "if an account exists"** |

**What the last one proves:** the endpoint cannot be used to discover which email
addresses have accounts. Compare the response to a real address — byte identical.

---

## Part 8 — Try to break the permissions

Worth doing deliberately. **As `staff@techtrackers.local`**, type these into the
address bar:

| URL | You should get |
|---|---|
| `localhost:3000/admin` | Bounced back to `/staff` |
| `localhost:3000/admin/users` | Bounced back to `/staff` |
| `localhost:3000/staff/tickets/1` *(someone else's ticket)* | **404, not 403** |

**Why 404 and not 403:** a 403 would confirm the ticket exists. A 404 tells you
nothing, so ticket ids cannot be probed by guessing.

**Now the real test** — the UI hiding a button proves nothing if the API still
allows it. Sign in as staff, open DevTools → Application → Local Storage, copy
`techtrackers.accessToken`, then:

```bash
curl -i http://localhost:5000/api/v1/users -H "Authorization: Bearer <paste>"
```

**You should see:** `403 Forbidden` — *"This action requires one of the following
roles: ADMIN"*.

**What it proves:** the permission is enforced by the **server**, not just hidden
in the interface. This is the check the old system did not have anywhere — it
called `UseAuthorization()` without ever registering an authentication scheme,
and no controller carried `[Authorize]`.

---

## Part 9 — Look at the data directly

```bash
cd Techtrackers.API/server
npm run prisma:studio        # opens http://localhost:5555
```

Worth checking:

| Table | Confirm |
|---|---|
| `users` | `passwordHash` is a bcrypt string (`$2a$12$...`), **not** a password |
| `logs` | every row has **both** `responseDueAt` and `resolutionDueAt` set |
| `log_status_history` | one row per transition, with `changedById` |
| `escalations` | at most **one row per (logId, level)** |
| `password_reset_otps` | `codeHash` is a hash, not six visible digits |
| `refresh_tokens` | `tokenHash` is a hash; rotated ones have `revokedAt` set |

---

## Also worth running

```bash
cd Techtrackers.API/server

npm run check:concurrency     # 20 simultaneous tickets, gapless references

npx newman run docs/Techtrackers.postman_collection.json \
                -e docs/Techtrackers.postman_environment.json
# 104 requests, 193 assertions
```

The concurrency check is worth understanding: it fires 20 ticket submissions at
once and confirms every one succeeds **and** the references come out gapless
(`HR-0074`…`HR-0083`, no holes). Postman fires sequentially and cannot catch that
class of bug.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ECONNREFUSED` on every page | API not running — `npm run dev` in terminal 1 |
| `"database": "disconnected"` | Postgres not up — `docker compose up -d --wait` |
| Port 5000 already in use | macOS: AirPlay Receiver uses it — turn it off in System Settings → General → AirDrop & Handoff, or set `PORT=5001` in `.env` and `target: 'http://localhost:5001'` in `vite.config.js` |
| Port 5432 already in use | You already have Postgres installed. Either use it (update `DATABASE_URL`) or change the left-hand port in `docker-compose.yml` |
| `Invalid environment configuration` | `.env` missing — copy it from `.env.example` |
| Signed out after ~15 minutes | Access tokens last 15 min and refresh silently. If it happens *every* time, the refresh call is failing — check the browser Network tab |
| Dashboards empty | Run `npm run db:seed:demo` |
| `429 Too many requests` | Auth endpoints are rate limited. Wait a minute |
| Escalation never fires | Check `SLA_JOB_ENABLED=true` in `.env`, and that the API terminal said *"SLA monitor started"* |

### Starting over

```bash
cd Techtrackers.API/server
npm run db:reset            # drops, re-migrates, re-seeds
npm run db:seed:demo
```

To remove only the demo tickets and keep anything you created:

```bash
npm run db:seed:demo -- --clear
```

---

## What a clean pass tells you

If everything above behaved as described, you have confirmed:

- **Identity** — sign-in, token refresh, password reset, and no account enumeration
- **Authorisation** — role-based *and* per-record, enforced server-side
- **The SLA engine** — automatic assignment by priority, live countdowns,
  escalation that fires once per level
- **The full lifecycle** — logging through to closure, with a complete audit trail
- **Real-time** — chat and notifications over an authenticated socket
- **Reporting** — figures that measure what actually happened

That is the system working as designed. The **[Readiness Review](https://claude.ai/code/artifact/6273e391-e4a3-4bcf-b377-93fccead1f94)**
covers what it would still need to run at TUT for real — most notably that SLA
here is wall-clock, so a Friday-evening ticket breaches overnight while the campus
is closed.
