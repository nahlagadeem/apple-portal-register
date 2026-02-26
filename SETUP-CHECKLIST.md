# Setup Checklist (You + Me)

## A) You create cloud resources (once)
1. Create new GitHub repo (example: `shopify-customer-profile`).
2. Create new Render Web Service (separate from discount app).
3. Create new Render Postgres DB for this project.
4. Share with me:
   - Repo URL
   - Render service URL
   - Confirmation DB is attached (`DATABASE_URL` available)

## B) Shopify admin configuration (you)
1. Confirm Customer Accounts = New Customer Accounts.
2. Install this new app on your store.
3. Approve required scopes for customer data + metafields.
4. Add account entry point link to reach profile UI.

## C) What I will do
1. Scaffold app code in this separate project.
2. Implement profile completion + edit flows.
3. Add AR/EN localization.
4. Add Saudi phone normalization/validation.
5. Wire deploy config and environment docs.
6. Provide test script + go-live checklist.

## D) Env vars for Render
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES`
- `SHOPIFY_APP_URL`
- `DATABASE_URL`
- `SESSION_SECRET`
- `NODE_ENV=production`
