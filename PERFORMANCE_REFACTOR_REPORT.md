# Performance Refactor Before Notes

Date: 2026-09-27

## Scope

This first measurement pass focused on high-frequency CRM writes:

- Lead stage / owner / priority update: `PATCH /api/leads/:id`
- Lead note: `POST /api/leads/:id/notes`
- Task create: `POST /api/tasks`
- Task complete: `POST /api/tasks/:id/complete`
- Application create: `POST /api/applications`

## Before Table

Authenticated live timings were not available from the current local session because the saved `.env` login did not match the active workspace password. No synthetic timing numbers are reported here.

| Action | Previous critical path | Expensive work identified |
| --- | --- | --- |
| Lead stage / owner / priority update | `loadDb()` -> mutate one lead -> `saveDb()` | Full workspace load, global `recalculate()`, full-table save path |
| Add note | `loadDb()` -> append audit item -> `saveDb()` | Full workspace load/save for one audit row |
| Create task | `loadDb()` -> push one task -> `saveDb()` | Full workspace load/save for one task row |
| Complete task | `loadDb()` -> mutate one task -> `saveDb()` | Full workspace load/save for one task row |
| Create application | `loadDb()` -> push one app -> `saveDb()` | Full workspace load/save for one application row |

## Instrumentation Added

The legacy `handleApi` full-state fallback now measures `loadDb()` duration and warns when normal CRM write routes fall through to the legacy path.

Expected warning format:

```text
[perf] PATCH /api/leads/:id used legacy loadDb path in 1234.5ms
```

The migrated routes should not emit this warning.
