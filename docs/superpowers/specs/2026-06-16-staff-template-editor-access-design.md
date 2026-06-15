# Staff Template Editor Access Design

## Problem

Encoder and releasing-staff users can open the shared template editor through
`/staff/templates/editor/:id`, but the editor contains hardcoded navigation to
`/admin/templates`.

This causes two reproducible failures:

- Clicking **Back** sends staff to an admin-only route and displays Access Denied.
- Any delayed or failed template-version request redirects staff to the same
  admin-only route. With the current Axios timeout, this can appear about 30
  seconds after the editor opens.

The backend already permits `ADMIN`, `ENCODER`, and `RELEASING_STAFF` template
operations within their assigned department. Cross-department access remains
blocked by the existing controller checks.

## Design

Add one small frontend helper that returns the template list route for the
current role:

- `ADMIN` and `SUPERADMIN` use `/admin/templates`.
- `ENCODER` and `RELEASING_STAFF` use `/staff/templates`.

Use this helper in both shared template components:

- `IDTemplatesPage` derives the editor URL from the role-specific list route.
- `TemplatePlacerEditor` uses the role-specific list route for the Back button
  and for recovery after a failed initial version request.

The editor will show the request error before returning to the correct template
page, rather than silently routing staff into an unauthorized area.

No backend role expansion or database change is required.

## Authorization

Staff may configure templates only for their own department. Existing backend
checks remain authoritative:

- `SUPERADMIN` may access all departments.
- Other allowed roles use the department in their authenticated token.
- A staff user cannot fetch, activate, preview, or configure another
  department's template version.

## Testing

Add focused frontend tests for the role-to-template-route helper and editor
navigation behavior where the existing test setup permits it. Verify the
complete workflow in a browser for both `ENCODER` and `RELEASING_STAFF`:

1. Open the staff template page.
2. Enter the placeholder editor.
3. Save configuration successfully.
4. Click Back and return to `/staff/templates`.
5. Simulate an initial load failure and confirm recovery returns to
   `/staff/templates`, never `/admin/templates` or `/unauthorized`.

Run the frontend build and relevant backend authorization tests to ensure the
navigation fix does not weaken API permissions.

## Out Of Scope

- Changing which roles may upload or activate template versions.
- Refactoring the application into a single shared `/templates` route.
- Changing token lifetimes or global Axios timeout behavior.
