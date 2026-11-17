# Admin login: spec (approved 2026-11-17)

Roles: `admin` (logged in) and `general` (everyone else, public read, no login).

## Server
- Env: `ADMIN_PASSWORD`, `SESSION_SECRET`. If either is missing, login returns 503 and every guarded write returns 503 ("Admin login is not configured"). Fail loud, never open.
- `src/lib/server/session.ts` (pure where possible, Web Crypto only, runs in Edge middleware and Node routes):
  - `signSession(secret, expMs): Promise<string>` returns `admin.<expMs>.<hex HMAC-SHA256 of "admin.<expMs>">`.
  - `verifySession(secret, token, nowMs): Promise<boolean>`: format check, expiry check, constant-time HMAC compare.
  - `passwordMatches(given, expected): Promise<boolean>`: constant-time (compare SHA-256 digests).
  - Cookie name `wd_session`, 30-day life, HttpOnly, Secure, SameSite=Strict, Path=/.
- Routes:
  - `POST /api/login` body `{ password: string }` (1..200 chars else 400). Wrong password: 401. Right: 200 `{ role: "admin" }` and sets the cookie.
  - `POST /api/logout`: clears the cookie, 200 `{ role: "general" }`.
  - `GET /api/session`: 200 `{ role: "admin" | "general" }`.
- `src/middleware.ts`: for these method + path pairs, without a valid cookie return 401 `{ error: "Admin login required" }`:
  - POST `/api/activity`
  - POST `/api/candidates`, POST `/api/candidates/bulk`
  - PATCH `/api/entities/<id>`
  - POST `/api/signals`
  - All GETs, `/api/tick`, `/api/ingest` (own key), login/logout/session stay open.
- Remove the "Unauthenticated" comments in `activity/route.ts` and `entities/[id]/route.ts` that the guard makes false.

## UI
- `src/hooks/useSession.ts`: fetches `/api/session`; exposes `{ role, login(password), logout() }`. `role` is `"general"` until the fetch answers.
- Header (`HeaderBar.tsx`): general shows "Admin login" (opens a small password form); admin shows "Log out". Restore `PauseActivityButton.tsx` from git (`git show 7cae022^:src/components/PauseActivityButton.tsx`), shown to admin only.
- Hide admin-only controls for general: Track/Ignore buttons (Newsfeed, Entity map NameCard, candidate queue), entity admin edits (Entities tab status/type/fame/follow edits), signal actions (seen/dismissed/promoted/reopen). Read views stay.
- A 401 from a guarded write shows "Admin login required" via the existing error path (no silent failure).
