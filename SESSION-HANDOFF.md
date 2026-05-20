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

