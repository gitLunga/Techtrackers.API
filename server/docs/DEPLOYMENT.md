# Running, hosting and deploying Techtrackers

Three questions, answered in order:

1. [Running it](#1-running-it) — locally, in about five minutes
2. [Hosting it](#2-hosting-it) — what has to change first, then where to put it
3. [Phones: Android, iOS, HarmonyOS](#3-phones-android-ios-and-harmonyos) — what is realistic and what is a separate project
4. [A dedicated server](#4-a-dedicated-server-and-what-owning-one-means) — and what owning one actually commits you to

> **§2.1 is now fixed.** Attachments can be stored in an S3-compatible bucket
> instead of on the container's disk. It is one environment variable plus a
> one-off migration — but it is **not the default**, so read §2.1 and decide
> deliberately before you deploy.

---

## 1. Running it

Two processes and a database. Full narrated walkthrough with what you should
see on each screen is in [WALKTHROUGH.md](WALKTHROUGH.md); this is the short
version.

### Backend

```bash
cd Techtrackers.API/server
cp .env.example .env            # runs as-is, no editing needed
docker compose up -d --wait     # PostgreSQL 16, credentials already match .env
npm install
npx prisma migrate deploy
npm run db:seed                 # roles, departments, categories, SLAs, one user per role
npm run db:seed:demo            # ~40 believable tickets so screens aren't empty
npm run dev                     # http://localhost:5000
```

Haven't got Docker? Install PostgreSQL 16 yourself, create a `techtrackers`
database and role, and point `DATABASE_URL` at it.

Check it came up: `curl http://localhost:5000/health` →
`{"success":true,"status":"healthy","database":"connected"}`.

### Frontend

```bash
cd Techtrackers.Web
npm install
npm run dev                     # http://localhost:3000
```

Vite proxies `/api` and `/socket.io` to port 5000, so no frontend config is
needed in development.

### Signing in

`npm run db:seed` prints the accounts. Password is `Password123` for all of
them — a development seed value, which is why `.env.example` and this file can
state it openly:

| Role | Email |
|---|---|
| Admin | `admin@techtrackers.local` |
| HOD | `hod@techtrackers.local` |
| Technician | `tech1@techtrackers.local` |
| Staff | `staff@techtrackers.local` |

Sign in as Staff to log a fault, HOD to assign it, Technician to work it. That
is the loop the whole system exists for.

### Checking it works

```bash
npm test                   # 91 tests: 52 unit, 39 integration
npm run lint
npm run check:concurrency  # needs the server running
npx newman run docs/Techtrackers.postman_collection.json \
  --env-var baseUrl=http://localhost:5000   # 104 requests, 194 assertions
```

CI runs all of these on every push — see `.github/workflows/ci.yml`. Details in
[AUTOMATED-TESTS.md](AUTOMATED-TESTS.md).

---

## 2. Hosting it

### 2.1 Attachments: pick a storage driver deliberately

`STORAGE_DRIVER` decides where ticket attachments are kept, and it is the one
setting that determines whether they survive a deployment.

| Value | Where files go | Use it when |
|---|---|---|
| `local` *(default)* | Under `UPLOAD_DIR` | Development, or production on a host with a genuinely persistent disk — a VPS, or a container with a mounted volume |
| `s3` | Any S3-compatible bucket | **Everything else.** Render, Heroku, Fly without a volume, Cloud Run, or anything that autoscales |

**Why it matters.** A container's filesystem is ephemeral: discarded on every
redeploy, restart, crash and scale event. With `local` on such a host, every
file a user attached disappears the next time the process restarts — while the
row in `log_attachments` survives, so the ticket still lists the attachment and
the download 404s.

Nobody catches it in testing, because a developer redeploys and re-seeds
constantly. It surfaces weeks later, when a technician opens an old ticket to
read the error message somebody screenshotted.

#### Switching to S3

Works with AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO.
R2 and B2 charge no egress, which is the line item that surprises people on S3.

**Do it in this order.** The app keeps serving from disk the whole time, and
the cutover is a restart rather than a window where attachments are missing.

```bash
# 1. Put the S3 settings in .env, but leave STORAGE_DRIVER=local for now
S3_BUCKET=techtrackers-attachments
S3_REGION=auto
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for AWS S3
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false                                # true for MinIO

# 2. Dry run — reports what it would copy, writes nothing
npm run storage:migrate

# 3. Copy the files you already have into the bucket
npm run storage:migrate -- --commit

# 4. Only now: set STORAGE_DRIVER=s3 and restart
```

Step 3 is not optional. `log_attachments.storedName` holds the same opaque key
for both drivers, so without it those rows stay valid-looking while pointing at
objects the bucket has never heard of — every old attachment would 404, caused
by the fix rather than the bug.

The migration is **safe to re-run**: it skips objects already present, so an
interrupted run just gets started again. It never deletes the local copies —
keep those until you have confirmed downloads work from the bucket, then remove
them deliberately.

It also reports any row whose file is **already missing from disk**. Those are
attachments lost to an earlier redeploy, which is the bug this closes. Nothing
can recover them; they are listed so you know which tickets have a broken
download.

#### Two things worth knowing

**Credentials never go in the repo.** With `STORAGE_DRIVER=s3` the app refuses
to boot unless the bucket and keys are set, rather than failing at the moment a
user first attaches a file.

**Downloads are proxied, not redirected.** The API streams the object rather
than handing out a presigned URL. That costs this server the bandwidth and buys
one thing worth more: authorisation stays in a single place. A presigned URL is
a second grant that outlives the permission check and can be forwarded to
anyone. Attachments are capped by `MAX_UPLOAD_BYTES`, so the bandwidth is not
the bottleneck. If that ever changes, the switch is confined to
`s3.driver.js#openStream` and the download controller.

### 2.2 The other things that bite in production

| Thing | Current state | What to do |
|---|---|---|
| **Dockerfile** | Doesn't exist. `docker-compose.yml` only starts PostgreSQL for development. | Write one for the API, plus a production compose that runs API + Postgres + a reverse proxy. |
| **Socket.IO** | In-memory adapter. | Fine on one instance. Two or more needs sticky sessions **and** the Redis adapter, or real-time silently breaks for half your users. |
| **SLA sweep** | Runs in-process on a timer (`SLA_JOB_ENABLED`). | Runs once per instance, so two instances sweep twice. Escalation is idempotent (unique on `logId + level`) so it won't double-escalate, but set `SLA_JOB_ENABLED=false` on all but one instance anyway. |
| **CORS** | `CORS_ORIGINS` defaults to `http://localhost:3000`. | Must list your real frontend origin, or every browser request fails. |
| **JWT secrets** | `.env.example` has obvious placeholders. | Generate real ones: `openssl rand -base64 48`. Two different values. |
| **VAPID keys** | Unset. | `npx web-push generate-vapid-keys`. Push notifications are silently dead without them. |
| **SMTP** | Unset; OTP codes print to the console. | Password reset does not work for real users until this is configured. |
| **Backups** | Nothing. | §4. |
| **HTTPS** | Nothing. | Required, and not only for security — see §3. |

### 2.3 Deployment shapes

**A — One VPS, Docker Compose.** Recommended for a TUT pilot.

Hetzner, DigitalOcean, Vultr, or a South African host (Afrihost, Xneelo) if
data residency matters — see §4. One €5–20/month box runs API, PostgreSQL and
Caddy comfortably for a department.

```
Internet → Caddy (TLS, auto-renew) ─→ /api, /socket.io → Node API ─→ PostgreSQL
                                   └─→ /*              → static frontend build
```

Caddy gets you HTTPS with no certificate work. You own backups and patching.

**B — Managed PaaS.** Fastest to a URL.

- API → Render / Railway / Fly.io (a Web Service, not a static site)
- Database → the platform's managed PostgreSQL, or Neon / Supabase
- Frontend → Vercel / Netlify / Cloudflare Pages (static build, needs a
  rewrite rule so client-side routes don't 404 on refresh)

Convenient, and **requires `STORAGE_DRIVER=s3`** (§2.1) — every one of these
hosts has an ephemeral filesystem.

**C — TUT's own infrastructure.** Probably where this ends up.

A university will likely require student and staff data to stay on
institution-controlled hardware, and will want LDAP/Active Directory or SSO
instead of local passwords. Worth asking TUT IT early, because it changes the
authentication design — not the deployment.

### 2.4 Frontend build

```bash
cd Techtrackers.Web
npm run build        # → dist/
```

`dist/` is static files; serve from anything. Two things to get right:

- **API and socket URLs.** Both default to same-origin relative paths —
  `src/api/client.js` falls back to `/api/v1` and `useSocket.js` to `/`. So
  **shape A needs no configuration at all**: put the frontend and API behind one
  reverse proxy and it works, with no CORS to configure either. Only if you
  split them across origins (shape B) do you need to set `VITE_API_BASE_URL`
  and `VITE_SOCKET_URL` at build time — and they are baked in at build, not
  read at runtime, so a change means rebuilding.
- **SPA fallback.** All unknown paths must serve `index.html`, or refreshing on
  `/tickets/42` returns 404.

This is a real argument for shape A: same origin removes the API URL config,
the CORS list and the cross-site cookie questions in one move.

Also worth tidying: `index.html` still carries leftover Create React App
comments (`%PUBLIC_URL%`, "run `npm start`") from the Vite migration. Cosmetic,
but confusing for the next person.

---

## 3. Phones: Android, iOS and HarmonyOS

### The honest starting point

Techtrackers is a React web app. **There is no native mobile app today**, and
no iOS, Android or HarmonyOS build to submit anywhere.

What there *is* turns out to be most of the way there: the app is already a
working **PWA**. `public/manifest.json` is complete and linked from
`index.html`, `public/sw.js` is a real service worker, and
`src/hooks/usePushNotifications.js` registers it and subscribes to web push,
which the backend already sends via VAPID.

So it is **installable to a phone's home screen right now**, with working push
notifications, on both Android and iOS. That gets you ~90% of what staff
actually want from "an app" — an icon, full screen, no browser chrome,
notifications — with no new codebase.

**One hard requirement: HTTPS.** Service workers, installability and push all
refuse to work over plain `http://` outside `localhost`. Without TLS there is
no app on any platform.

### Android — easy

**Installable today.** Chrome shows an install prompt on a qualifying PWA.
Nothing to build.

**Play Store** is genuinely achievable, via a **Trusted Web Activity** — a thin
native shell that opens your site full screen with no browser bar. Google's
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) CLI generates the
Android project and a signed bundle for you.

```bash
npx @bubblewrap/cli init --manifest https://techtrackers.tut.ac.za/manifest.json
npx @bubblewrap/cli build
```

The part people get wrong: **Digital Asset Links.** You must serve
`/.well-known/assetlinks.json` from your domain, listing the Android package
name and the SHA-256 fingerprint of the signing certificate. Use the
fingerprint **Play App Signing** signs with, not your upload key. Serve it as
`application/json` with no redirect. Get it wrong and the app still opens but
shows a browser address bar, which looks broken.

Note Play's spam policy forbids wrapping a site you don't own — fine here,
since it's your own.

Effort: **a day or two**, mostly Play Console paperwork.

### iOS — installable, but the App Store is a different story

**Installable today** via Safari → Share → *Add to Home Screen*. From iOS 26,
home-screen sites open as web apps in their own window by default.

**Push works, with real constraints** (iOS 16.4+, March 2023):

- Only from a **home-screen install**. A site in a Safari tab cannot subscribe
  at all — only the home-screen instance can call `pushManager.subscribe()`.
- The permission request must come from a **user tap**, which your
  `usePushNotifications` hook already does correctly.
- Every push must display a visible notification. Silent pushes get the
  subscription revoked.

**Safari has no install prompt.** Users must know to use the Share menu. For
TUT that is a training and onboarding problem, not a technical one — budget a
one-page "how to install" with screenshots, or staff simply won't have it.

**The App Store will almost certainly reject a bare web wrapper.** Apple's
guidelines target apps with "minimum functionality" that are just repackaged
websites. To ship on the App Store properly you would use
[Capacitor](https://capacitorjs.com/) and add genuine native integration —
native camera for attachments, native push via APNs, biometric sign-in,
offline capability. You also need an Apple Developer account (~$99/year) and a
Mac with Xcode to build and submit.

Effort: **weeks, not days** — and it is a real native project with its own
release cycle, not a build step.

### HarmonyOS — a separate app entirely

Taking "harmony" to mean Huawei's HarmonyOS. This is the one with a genuinely
hard answer, and it depends on version:

- **HarmonyOS 4 and earlier** keeps the Android compatibility layer, so an
  Android APK (including the TWA above) installs and runs normally.
- **HarmonyOS NEXT / HarmonyOS 5 dropped that layer.** It **cannot run Android
  APKs at all**. Apps must be built as **HAP** packages in **ArkTS**, Huawei's
  own language — and a HAP cannot be produced by repackaging an APK.
  Distribution is through Huawei AppGallery, with mandatory code signing tied
  to your AppGallery account.

So for HarmonyOS NEXT there is no path from this codebase to a native app
short of **writing a second application in a language nobody on this project
uses**. That is a months-long project, not a port.

**What does work on HarmonyOS today:** the browser. HarmonyOS ships a
Chromium-based browser, so the web app loads and can be added to the home
screen. Push support is not something I can confirm without testing on a real
device — verify before promising it.

**My recommendation:** treat HarmonyOS as a supported *browser* target, not an
app target, unless TUT has a specific population on Huawei devices that
justifies a dedicated build. Check that before spending anything.

### Summary

| Platform | Install today | Push | Store | Realistic effort |
|---|---|---|---|---|
| **Android (browser/PWA)** | ✅ prompt | ✅ | — | **Done** |
| **Android (Play Store)** | ✅ | ✅ | ✅ TWA | **1–2 days** |
| **iOS (home screen)** | ✅ manual via Share | ✅ 16.4+, install only | — | **Done**, plus a how-to guide |
| **iOS (App Store)** | — | APNs | ⚠️ needs real native features | **Weeks** + Mac + $99/yr |
| **HarmonyOS 4 and earlier** | ✅ via APK | ✅ | ✅ AppGallery | Same as Android |
| **HarmonyOS NEXT / 5** | Browser only | Unverified | ❌ needs ArkTS/HAP | **Months — separate app** |

**The sensible order:** get HTTPS and the PWA working properly on real phones →
Play Store via Bubblewrap → then decide whether iOS App Store and HarmonyOS are
worth their cost. Do not start with the native apps.

---

## 4. A dedicated server, and what owning one means

### What "dedicated" buys you

A machine you control, that nothing else shares, that does not sleep. That
matters here for three specific reasons:

1. **Free tiers sleep.** Render's free tier idles out after inactivity, so the
   first request after a quiet spell takes 30+ seconds. For a service desk that
   reads as broken. It also stops the SLA sweep, so escalations silently don't
   fire overnight — which defeats the point of the system.
2. **The SLA sweep must run continuously.** It's an in-process timer. If the
   process isn't running, nothing escalates.
3. **Attachments need somewhere durable.** A VPS has a real disk, so
   `STORAGE_DRIVER=local` is a legitimate choice here rather than a trap — the
   one place in this document where that is true (§2.1). You then own backing
   that directory up.

### A workable setup

**Server:** 2 vCPU / 4GB RAM is plenty for a department. Hetzner CX22 (~€4/mo),
DigitalOcean (~$12/mo), or a South African host if residency matters.

**Data residency and POPIA.** This system stores named staff, their reported
faults and their locations. POPIA governs that. Hosting in Germany or the US is
not automatically unlawful, but it brings cross-border transfer obligations,
and a university may simply require local or on-prem hosting. **Ask TUT IT
before picking a region** — it is cheap to ask now and expensive to migrate
later.

**Always-on:** `systemd` or Docker's `restart: unless-stopped`, so it comes
back after a reboot or crash.

**Domain and TLS:** a real hostname, and Caddy or nginx + certbot for
auto-renewing certificates. Non-negotiable — the PWA needs it (§3).

**Backups — nothing in this repo does this yet.** Nightly `pg_dump` to
somewhere *off that machine*, plus the uploads directory if you went the volume
route. A backup on the same disk as the database is not a backup. Test a
restore once; an untested backup is a guess.

**Monitoring:** the app exposes `/health`, which reports database connectivity.
Point any uptime checker at it (UptimeRobot's free tier is fine) so you hear
about an outage before a user tells you.

**Patching:** unattended-upgrades for the OS, and a plan for Node and
PostgreSQL versions. A dedicated server means these are now your job.

### The honest trade

A dedicated server gives you control, no cold starts, a real disk, and a clear
data-residency story. It also makes you responsible for backups, TLS renewal,
OS patching, monitoring and recovery — work that a managed platform does for
you.

For a TUT pilot the VPS is the right call, mostly because of the SLA sweep and
the data-residency question below. But go in knowing that "dedicated server" means "I am now the sysadmin",
and budget for that rather than discovering it during an incident.

---

## What is not done yet

Honest list, so nothing here reads as more finished than it is:

- **No Dockerfile or production compose**
- **No backups**
- **SMTP unconfigured** — password reset does not work for real users
- **VAPID keys unset** — push is dead until generated
- **Business-hours SLA** — the clock is wall-clock, so a ticket logged Friday
  16:00 burns the weekend and breaches by Monday while campus is shut. This is
  Phase 3 and it makes every current SLA figure wrong for TUT.
- **`ON_HOLD` does not stop the clock** — a ticket waiting on a part keeps
  escalating
- **No frontend tests** — lint and build only
