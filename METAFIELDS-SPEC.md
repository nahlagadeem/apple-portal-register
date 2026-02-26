# Customer Metafields Spec

## Namespace
- `custom`

## Definitions
1. `custom.full_name`
- Type: `single_line_text_field`
- Required: yes

2. `custom.institute_name`
- Type: `single_line_text_field`
- Required: yes

3. `custom.role`
- Type: `single_line_text_field`
- Required: yes
- Allowed values: `student`, `teacher`, `parent`, `other`

4. `custom.role_other`
- Type: `single_line_text_field`
- Required: conditional
- Required only when `custom.role = other`

5. `custom.phone_sa`
- Type: `single_line_text_field`
- Required: no
- Allowed input examples:
  - `0551234567`
  - `+966551234567`
- Stored normalized format:
  - `+9665XXXXXXXX`

## Validation Logic
- `role != other` => `role_other` will be cleared to empty.
- Invalid phone returns validation error.
- Empty optional phone is accepted.
