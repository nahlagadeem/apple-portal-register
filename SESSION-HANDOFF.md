## Session Handoff (2026-03-04)

### Project
- Repo: `C:\Windows\System32\studend-register`
- Branch: `main`
- Remote: `git@github.com:nahlagadeem/apple-portal-register.git`
- Live app: `https://apple-portal-register.onrender.com`
- Live shop: `7shdka-4d.myshopify.com`

### Current behavior
- Register page uses app proxy endpoint:
  - `POST /apps/student-register/register`
- Profile page uses app proxy endpoint:
  - `GET/POST /apps/student-register/profile-data`
- Native Shopify login is used on storefront (OTP flow).

### Important fixes shipped
- Register route supports JSON mode and login redirect payload:
  - `app/routes/register.jsx`
- Profile-data auth resolution hardened:
  - resolves shop/customer from query + app-proxy/header context
  - fallback by customer email when customer-id lookup fails
  - fallback to Postgres `PortalUser` when Shopify Admin session is unavailable
  - `app/routes/profile-data.ts`
- Admin API auth fallback for profile-data:
  - uses offline `Session` token first
  - then `SHOPIFY_ADMIN_TOKEN`/`SHOPIFY_ADMIN_API_ACCESS_TOKEN` env fallback

### Theme integration notes
- Register page should redirect logged-in customers away from register page.
- Profile page endpoint must include:
  - `shop`
  - `logged_in_customer_id`
  - `customer_email`
- Current requested UX:
  - Address creation/list in custom page removed
  - “Manage addresses” button should redirect to native customer profile page.

### Known operational gotchas
- If `Session` table is cleared, Shopify Admin API calls may fail until:
  - app is re-authed and offline token recreated, or
  - `SHOPIFY_ADMIN_TOKEN` env var is set on Render.
- Clearing all DB rows can break app auth-dependent features.

### Quick verify
- Ping app:
  - `curl -i "https://apple-portal-register.onrender.com/ping?shop=7shdka-4d.myshopify.com"`
- Register proxy:
  - `curl -i "https://7shdka-4d.myshopify.com/apps/student-register/ping"`
- Profile data (storefront context needed):
  - `GET /apps/student-register/profile-data?shop=...&logged_in_customer_id=...&customer_email=...`

---

## Session Handoff (2026-04-20)

### Backend changes completed
- Added skippable storefront profile prompt support.
- New Postgres table:
  - `ProfilePromptState`
- Backend files changed and already pushed/deployed:
  - `prisma/schema.prisma`
  - `prisma/migrations/20260419120000_add_profile_prompt_state_table/migration.sql`
  - `app/portal-auth.server.js`
  - `app/routes/register.jsx`
  - `app/routes/profile-data.ts`
- Git commit deployed:
  - `2137b3f` - `Make storefront profile completion skippable`

### Live status
- GitHub push completed.
- Shopify app version released:
  - `studend-register-7`
- Live Render checks passed:
  - `https://apple-portal-register.onrender.com/ping?shop=7shdka-4d.myshopify.com`
  - `https://www.jawraa.sa/apps/student-register/ping`
- Live `profile-data` returns prompt state correctly:
  - missing portal profile now returns `200` with:
    - `hasPortalProfile: false`
    - `skippedProfilePrompt`
    - `shouldPromptProfileCompletion`

### Current storefront behavior implemented
- If customer has no portal profile and has not skipped:
  - `theme.liquid` redirects them to `/pages/student-register`
- If customer clicks `Skip for now`:
  - row is written to `ProfilePromptState`
  - redirect suppression works on later pages
  - user is redirected to `/collections/all`
- Incognito testing confirmed the skip flow works correctly.

### Theme-side progress
- `student-register-form.liquid`
  - skip button added
  - skip action works
  - skip redirect moved to `/collections/all`
- `theme.liquid`
  - storefront logic updated to use `shouldPromptProfileCompletion`

### Open blocker
- Completing profile / creating portal account currently fails when backend tries Shopify Admin API customer operations.
- Live error shown on register flow:
  - `Registration failed. Shopify Admin HTTP 401: {"errors":"[API] Invalid API key or access token (unrecognized login or wrong password)"}`
- DB check confirmed an offline session row exists:
  - shop: `7shdka-4d.myshopify.com`
  - id: `offline_7shdka-4d.myshopify.com`
- Reinstall/re-auth did not resolve the Admin API 401 yet.

### Most likely next steps
- Verify whether the stored offline token is actually valid with a direct Admin GraphQL request.
- Check Render env vars for stale admin token fallback values:
  - `SHOPIFY_ADMIN_TOKEN`
  - `SHOPIFY_ADMIN_API_ACCESS_TOKEN`
- Re-run auth explicitly via:
  - `https://apple-portal-register.onrender.com/auth?shop=7shdka-4d.myshopify.com`
- Confirm `Session.updatedAt` changes after re-auth.

### Useful DB checks
- Existing offline session:
  - `SELECT "id", "shop", "isOnline", "accessToken" FROM "Session" WHERE "shop" = '7shdka-4d.myshopify.com' AND "isOnline" = false;`
- Session freshness:
  - `SELECT "id", "shop", "isOnline", "createdAt", "updatedAt" FROM "Session" WHERE "shop" = '7shdka-4d.myshopify.com' ORDER BY "updatedAt" DESC;`
- Skip state:
  - `SELECT * FROM "ProfilePromptState" WHERE "shop" = '7shdka-4d.myshopify.com' AND "customerEmail" = '...';`

### Browser note
- Normal browser session had stale/corrupted site state causing misleading failures.
- Incognito worked correctly.
- Clearing site data for `jawraa.sa` / `www.jawraa.sa` fixed that local issue.

---

## Session Note (2026-05-19)

### Current status
- We reviewed the existing DB/model shape for the student register app.
- Local checked-in SQLite only contains `Session` plus Prisma migrations.
- No local `PortalUser` rows or `ProfilePromptState` rows exist in `prisma/dev.sqlite`.

### Relevant tables
- `PortalUser` is the completed-profile record.
- `ProfilePromptState` is the skip/prompt tracking record.
- `Session` stores Shopify app sessions.

### OTP plan
- The OTP flow can be added safely if it uses a new additive draft table in the same DB.
- No destructive schema changes should be made to tables shared with other apps.
- The final profile should only be written after Shopify OTP succeeds.

### Not started yet
- No schema changes for the OTP draft flow.
- No implementation changes for pending OTP / verified / expired states.

---

## Session Note (2026-05-20)

### OTP flow implemented
- Added additive `ProfileOtpDraft` storage in Prisma and runtime fallback DDL.
- Register submit now branches on `complete-native-profile` and redirects to Shopify customer auth with `login_hint`.
- Added `/profile-otp` callback route to finalize `PortalUser` only after the Shopify return path resolves.
- `profile-data` now exposes:
  - `pendingProfileOtpDraft`
  - `pendingProfileOtpDraftStatus`

### Deployment surfaces
- GitHub repo stays unchanged structurally; changes are additive only.
- Render deployment continues to use the existing Docker / React Router setup.
- Shopify app config remains on:
  - `application_url = https://apple-portal-register.onrender.com`
  - app proxy subpath `student-register`

### Validation
- `npm run lint` passes
- `npm run build` passes
- `npm run typecheck` passes
