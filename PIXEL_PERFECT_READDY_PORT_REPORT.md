# Pixel-Perfect Readdy Port Report

Date: 2026-10-08

## Reference Files Used

- `src/index.css`
- `tailwind.config.ts`
- `src/pages/dashboard/page.tsx`
- `src/pages/dashboard/components/Sidebar.tsx`
- `src/pages/dashboard/components/TopBar.tsx`
- `src/pages/dashboard/components/FilterBar.tsx`
- `src/pages/dashboard/components/GroupHeading.tsx`
- `src/pages/dashboard/components/StatCard.tsx`
- `src/pages/dashboard/components/ChartCard.tsx`
- `src/pages/dashboard/components/SourceList.tsx`
- `src/pages/dashboard/components/LoadingScreen.tsx`
- `src/pages/dashboard/components/charts/*`
- `src/hooks/useChartPalette.ts`

`src/mocks/dashboard.ts` was not used.

## Values Preserved

- Fonts: `Sora` for headings and metric values, `Manrope` for body/UI text.
- OKLCH tokens: copied Readdy `background`, `primary`, `accent`, `secondary`, and `foreground` variables.
- Sidebar: `240px`, `20px 16px`, sticky/fixed left shell, `background-100`, `background-200` border.
- Main shell: full-width dashboard, no centered max-width.
- Top bar: sticky, `background-50 / .9`, backdrop blur, `16px 24px`.
- Filter bar: `12px 24px`, `10px` gap, exact control widths `168/176/164/172/180px`.
- Group headings: `13px`, Sora, `600`, uppercase, `0.14em`, `primary-600`.
- Cards: `8px` radius, `16px` padding, `background-50`, `background-200` border.
- Shadow: `0 1px 2px rgba(26,20,42,.04), 0 2px 8px rgba(26,20,42,.05)`.
- Dashboard section order: Planner, Emails, Events & Zoom, Zoho & Sources, Leads & Enrolments, Data Quality.

## Pages Migrated

- Admin dashboard / Monitoring: rebuilt into the Readdy section composition using live KBC dashboard metrics.
- Shared shell: sidebar, topbar, cards, buttons, filters, badges, tables, and form surfaces now inherit the Readdy token layer.
- Table/workflow pages retain KBC functionality while using the Readdy typography, border, card, control, and background language.

## Real KBC Content

- KBC user name, role, avatar initials, navigation labels, and route actions are preserved.
- Dashboard values come from existing KBC APIs and workspace records.
- Existing auth, PostgreSQL/Neon access, pagination, integrations, monitoring, and optimized dashboard endpoints were not replaced with Readdy mock data.

## Screenshot Verification

Reference server: `http://127.0.0.1:3002/` from `project-14546607.zip`.

KBC server: existing local server on `http://127.0.0.1:3000/`.

Captured comparison screenshots:

- `reports/readdy-visual/kbc-admin-1440x900.png`
- `reports/readdy-visual/readdy-reference-1440x900.png`
- `reports/readdy-visual/kbc-admin-1366x768.png`
- `reports/readdy-visual/readdy-reference-1366x768.png`
- `reports/readdy-visual/kbc-admin-1920x1080.png`
- `reports/readdy-visual/readdy-reference-1920x1080.png`

Second-pass fixes after screenshot review:

- Removed old rounded sidebar gutter by overriding desktop sidebar margin and radius.
- Restored the Readdy-width filter controls at 1366px.
- Replaced the tiny sidebar logo treatment with a Readdy-sized brand block.
- Bumped frontend and service-worker cache keys to `20261008-readdy-ui-exact4`.

## Remaining Differences

- KBC uses real navigation routes and labels instead of Readdy section anchors.
- KBC brand text and user identity replace Readdy's `Admissions CRM`, `Amara Osei`, and `AO`.
- KBC charts display real production aggregates; empty planner task charts show no-data states when the current data has no matching rows.
- KBC keeps its existing SVG icon helper instead of importing Remix Icon.
