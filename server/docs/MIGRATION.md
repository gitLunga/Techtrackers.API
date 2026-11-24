# Migration map: ASP.NET Core → Node.js

Every endpoint in the old API and what replaces it, so the React frontend can be moved over
methodically.

**Base URL changes from** `http://localhost:5xxx/api/...` **to** `http://localhost:5000/api/v1/...`

**Every request now needs** `Authorization: Bearer <accessToken>` (except login, refresh and the
three password-reset endpoints).

---

## The URL style changed, and why

The old controllers used `[Route("api/[controller]/[action]")]`. That generates URLs **from C#
method names** — rename a method and the frontend breaks silently. It also produced verbs in
paths and state in URL segments:

```
PUT /api/ManageLogs/ChangeLogStatus/{issueId}/{newStatus}
```

Here the URL names a **resource** and the HTTP method is the verb:

```
PATCH /api/v1/logs/:id/status     body: { "status": "IN_PROGRESS", "note": "..." }
```

---

## Auth

| Old | New | Notes |
|---|---|---|
| `POST /api/User/login` | `POST /api/v1/auth/login` | Now returns `accessToken` + `refreshToken`. Old version returned only a user object — there was no credential to send on later requests |
| — | `POST /api/v1/auth/refresh` | New |
| — | `POST /api/v1/auth/logout` | New |
| — | `GET /api/v1/auth/me` | New |
| — | `POST /api/v1/auth/change-password` | New |
| `POST /api/Account/request-otp` | `POST /api/v1/auth/forgot-password` | Now rate-limited; identical response for unknown emails |
| `POST /api/Account/verify-otp` | `POST /api/v1/auth/verify-otp` | Attempts counted |
| `POST /api/Account/reset-password` | `POST /api/v1/auth/reset-password` | Enforces a password policy; revokes all sessions |

**Frontend change:** store `accessToken` and send it on every request. Handle `401` by calling
`/auth/refresh` once, then retrying. The old app had nothing to store.

---

## Tickets

Four old controllers collapse into one resource, because visibility is now derived from the
token rather than from which URL you chose.

| Old | New |
|---|---|
| `POST /api/Log/CreateLog` | `POST /api/v1/logs` |
| `GET /api/Log/GetLogsForStaff?userId=` | `GET /api/v1/logs` |
| `GET /api/Log/GetLogsTechnician?userId=` | `GET /api/v1/logs` |
| `GET /api/AdminLog/GetLogs` | `GET /api/v1/logs` |
| `GET /api/AdminLog/GetAdminLoggedIssues/admin/{adminId}` | `GET /api/v1/logs` |
| `GET /api/ManageLogs/GetOpenLogs` | `GET /api/v1/logs?open=true` |
| `GET /api/ManageLogs/GetIssue/{id}` | `GET /api/v1/logs/:id` |
| `POST /api/Log/AssignTechnician` | `POST /api/v1/logs/:id/assign` |
| `PUT /api/ManageLogs/ChangeLogStatus/{issueId}/{newStatus}` | `PATCH /api/v1/logs/:id/status` |
| `PUT /api/ManageLogs/CloseLog/{logId}` | `PATCH /api/v1/logs/:id/status` → `CLOSED` |
| `PUT /api/ManageLogs/OpenLog/{logId}` | `POST /api/v1/logs/:id/reopen` |
| `GET /api/ManageLogs/CountAllLogs` | `GET /api/v1/logs/counts` |
| `GET /api/ManageLogs/CountLogsByStatus/{status}` | `GET /api/v1/logs/counts` |
| `GET /api/Log/GetEscalationResults?logId=` | `GET /api/v1/logs/:id/sla` |
| — | `GET /api/v1/logs/:id/history` |
| — | `DELETE /api/v1/logs/:id/assign` |
| — | `GET /api/v1/logs/:id/suggest-technician` |
| — | `POST /api/v1/logs/:id/escalate` |
| — | `GET /api/v1/logs/:id/attachments/:attachmentId` |

**Note the five endpoints that became one `GET /api/v1/logs`.** Each old URL existed to apply a
different hard-coded filter. Now the filter comes from your JWT — staff get their own tickets,
technicians get theirs, HODs get their department, admins get everything. Same URL.

### Field renames on a ticket

| Old | New |
|---|---|
| `LogId` | `id` |
| `IssueId` | `reference` |
| `IssueTitle` | `title` |
| `LogStatus` | `status` |
| `StaffId` / `Staff_ID` | `reportedById` — **now taken from the token, not the body** |
| `TechnicianId` | `technicianId` |
| `CategoryId` / `Category_ID` | `categoryId` |
| `AttachmentFile` (base64 blob) | `attachments[]` (metadata; fetch bytes separately) |
| `ResolutionDue` | `timestamps.resolutionDueAt` |
| `ResponseDue` | `timestamps.responseDueAt` |
| `CreatedAt` | `timestamps.createdAt` |
| `Note` | `note` |
| `AssignedTo` (string) | `technician` object, plus `assignedTo` string for convenience |

### Status values changed

| Old (inconsistent) | New |
|---|---|
| `"PENDING"` | `PENDING` |
| — | `ASSIGNED` (new: assigned but not started) |
| `"INPROGRESS"` | `IN_PROGRESS` |
| `"ONHOLD"` / `"On Hold"` | `ON_HOLD` |
| `"ESCALATED"` | `ESCALATED` |
| `"RESOLVED"` | `RESOLVED` |
| `"CLOSED"` | `CLOSED` |

These are now **Postgres enums**. The old free-text column drifted — writers stored `"ONHOLD"`
while reports counted `"On Hold"`, so that report figure was permanently zero.

Priority gains `CRITICAL` alongside `LOW` / `MEDIUM` / `HIGH`.

---

## Technicians & users

| Old | New |
|---|---|
| `GET /api/AssignTechnician/GetAll` | `GET /api/v1/technicians` |
| `GET /api/TechnicianHandler` | `GET /api/v1/technicians` |
| `POST /api/TechnicianHandler/add` | `POST /api/v1/users` with `roles: ["TECHNICIAN"]` |
| `PUT /api/TechnicianHandler/{id}` | `PATCH /api/v1/users/:id` |
| `DELETE /api/TechnicianHandler/{id}` | `DELETE /api/v1/users/:id` (**deactivates**) |
| `GET /api/ExternalTechnicianHandler` | `GET /api/v1/technicians?type=EXTERNAL` |
| `POST /api/ExternalTechnicianHandler/add` | `POST /api/v1/users` with `roles: ["EXTERNAL_TECHNICIAN"]` |
| `GET /api/Tech/{id}/countResolved` | `GET /api/v1/technicians/:id/stats` |
| `GET /api/Tech/{id}/countInProgress` | `GET /api/v1/technicians/:id/stats` |
| `GET /api/Tech/{id}/countOnHold` | `GET /api/v1/technicians/:id/stats` |
| `GET /api/Tech/{id}/countPending` | `GET /api/v1/technicians/:id/stats` |
| — | `GET /api/v1/users`, `POST /api/v1/users`, `GET/PATCH /api/v1/users/:id` |
| — | `GET /api/v1/users/roles` |

Two things collapsed here. `TechnicianHandler` and `ExternalTechnicianHandler` were near-identical
copies differing only in a hard-coded `"internal"` / `"external"` string — a technician is a
**user with a role**, not a separate entity. And the four `Tech/{id}/count*` endpoints are one
`stats` call, so a dashboard makes one request instead of five.

---

## Reference data

| Old | New |
|---|---|
| `GET /api/CRUDDepartment` | `GET /api/v1/departments` |
| `GET /api/CRUDDepartment/{id}` | `GET /api/v1/departments/:id` |
| `POST /api/CRUDDepartment` | `POST /api/v1/departments` |
| `PUT /api/CRUDDepartment/{id}` | `PATCH /api/v1/departments/:id` |
| `DELETE /api/CRUDDepartment/{id}` | `DELETE /api/v1/departments/:id` |
| — | `GET/POST/PATCH/DELETE /api/v1/categories` (**none existed**) |
| — | `GET/POST/DELETE /api/v1/slas` (**none existed**) |

Departments now carry a stored `code` (`ICT`, `HR`) which becomes the ticket reference prefix.
The old code derived initials at runtime, differently in two services.

---

## Collaboration, feedback, chat, notifications

| Old | New |
|---|---|
| `POST /api/Collaboration/Request` | `POST /api/v1/collaborations` |
| `PUT /api/Collaboration/Respond/{collaborationId}` | `PATCH /api/v1/collaborations/:id` |
| `GET /api/Collaboration/Pending/{technicianId}` | `GET /api/v1/collaborations?direction=incoming&status=PENDING` |
| `GET /api/Collaboration/List/{technicianId}` | `GET /api/v1/collaborations` |
| — | `DELETE /api/v1/collaborations/:id` |
| `POST /api/Feedback/SubmitFeedback` | `POST /api/v1/feedback` |
| `GET /api/Feedback/GetFeedbackByLog/{logId}` | `GET /api/v1/logs/:id/feedback` |
| `POST /api/LiveChat/SendMessage` | `POST /api/v1/logs/:id/chat` |
| `GET /api/LiveChat/GetMessages/{logId}` | `GET /api/v1/logs/:id/chat` |
| `GET /api/NewNotification/{userId}/staged` | `GET /api/v1/notifications` |
| `POST /api/NewNotification/markAsRead/{notificationId}` | `PATCH /api/v1/notifications/:id/read` |
| `GET /api/Log/GetNotifications/{userId}` | `GET /api/v1/notifications` |
| — | `GET /api/v1/notifications/unread-count` |
| — | `PATCH /api/v1/notifications/read-all` |

**Every user id disappeared from these URLs.** They now read the caller from the token. In the
old API, `/Pending/{technicianId}` and `/{userId}/staged` returned whoever's data you asked for.

---

## Reports

| Old | New |
|---|---|
| `GET /api/GenerateReport/GetIssueByStatusReport` | `GET /api/v1/reports/issues` |
| `GET /api/GenerateReport/GetIssueStatusCount` | `GET /api/v1/reports/status-counts` |
| `GET /api/MonthlySummaryReport/GetMonthlySummaryReport` | `GET /api/v1/reports/monthly-summary` |
| `GET /api/TechPerformanceReport/GetTechnicianPerformanceReport` | `GET /api/v1/reports/technician-performance` |
| — | `GET /api/v1/reports/sla-compliance` |

All accept `?from=` / `?to=`, and are scoped to what the caller may see.

**The numbers changed** — the old ones were wrong. Both `MonthlySummaryReport` and
`TechPerformanceReport` computed "average resolution time" from `resolutionDue − assignedAt`,
which is the **SLA window**, not how long the work took. They reported the same figure whether a
ticket was fixed in an hour or never fixed at all. These use `resolvedAt − createdAt`.

---

## Removed

| Old | Why |
|---|---|
| `GET /WeatherForecast` | The .NET project template's sample endpoint |
| `CollaControllerB` | An empty stub |
| `NotificationController.ReceiveNotification` | Returned a hard-coded string |

---

## Real-time

| Old | New |
|---|---|
| SignalR hub at `/chatHub` | Socket.IO at `/` (same port) |
| `connection.invoke("SendMessage", ...)` | `socket.emit('chat:send', { logId, message }, cb)` |
| `connection.on("ReceiveMessage", ...)` | `socket.on('chat:message', cb)` |
| — | `socket.on('notification:new', cb)` |
| — | `socket.on('log:status-changed', cb)` |
| — | `socket.on('log:escalated', cb)` |

```js
// old
const connection = new signalR.HubConnectionBuilder().withUrl('/chatHub').build();

// new — the same JWT that protects the REST API protects the socket
const socket = io('http://localhost:5000', { auth: { token: accessToken } });
```

---

## Frontend migration checklist

1. **Point the API client at** `http://localhost:5000/api/v1`.
2. **Unwrap the envelope once.** Every response is `{ success, message, data }` — write a single
   `apiClient` that returns `data` and throws on `success: false`. The old API returned a
   different shape per endpoint, including bare strings.
3. **Store the tokens** from `/auth/login`; attach `Authorization: Bearer` to every request.
4. **Handle `401` centrally**: call `/auth/refresh` once, retry, and redirect to login if that fails.
5. **Delete the role-based URL switching.** There is one `GET /logs` for everyone now.
6. **Delete any user id you were putting in a URL.** The token carries it.
7. **Update status strings** to the new enum values (`IN_PROGRESS`, `ON_HOLD`).
8. **Attachments:** read `attachments[]` for metadata and point `<img src>` at
   `/logs/:id/attachments/:attachmentId` instead of decoding base64.
9. **Read the new `slaStatus` block** on every ticket — `percentConsumed`, remaining minutes,
   breach flags. Enough to render a live SLA progress bar with no extra call.
10. **Paginate.** List endpoints return at most 100 rows and include `meta.totalPages`.
