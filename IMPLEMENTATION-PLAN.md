# Implementation Plan

## 1) Architecture
- Use Shopify New Customer Accounts for authentication.
- Build a separate app surface for profile onboarding/editing.
- Store custom data in customer metafields.

## 2) Data Contract (Metafields)
- Namespace: `custom`
- Keys:
  - `full_name` (single_line_text_field, required)
  - `institute_name` (single_line_text_field, required)
  - `role` (single_line_text_field, required: student|teacher|parent|other)
  - `role_other` (single_line_text_field, required when role=other)
  - `phone_sa` (single_line_text_field, optional, Saudi format)

## 3) User Flow
1. User signs up / logs in via Shopify native account flow.
2. On first visit to profile area:
   - If required metafields are missing -> show "Complete profile" form.
3. On later visits:
   - Show profile summary page with Edit option.
4. Edit page:
   - Update all custom fields except email.
   - Password change uses Shopify native account management path.

## 4) Validation
- Full name: non-empty.
- Institute: non-empty.
- Role: one of the 4 allowed values.
- Role other: non-empty only when role is `other`.
- Saudi phone (optional):
  - Accept `05XXXXXXXX` or `+9665XXXXXXXX`.
  - Normalize storage to `+9665XXXXXXXX`.

## 5) Localization (AR/EN)
- Translation dictionary for:
  - Labels, errors, buttons, section titles.
- Locale switch from customer/account locale if available.

## 6) Security
- No plaintext password storage.
- No custom auth system (delegated to Shopify).
- Server-side validation before metafield write.
- Basic request logging for update events (no sensitive payload logs).

## 7) QA Checklist
- New signup -> complete profile -> save -> profile visible.
- Existing customer with missing fields -> prompted to complete.
- Role `other` requires extra input.
- Invalid Saudi phone blocked.
- Arabic and English labels render correctly.
- Email displayed as read-only.

## 8) Rollout
1. Deploy standalone service.
2. Configure app URL and callback URLs.
3. Add account navigation entry point.
4. Soft launch with test customers.
5. Go live.
