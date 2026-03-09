# MMS Code Review (Current Snapshot)

Date: 2026-03-08
Reviewer: Codex

## Scope Reviewed

- API (`api/`) structure, auth middleware, and work-order/task services.
- Web portal (`web/`) build/lint readiness and routing structure.
- Mobile app (`mms-mobile/`) TypeScript compile health.
- Top-level project organization and Docker wiring.

## High-Level Assessment

The project shows solid architectural direction (clear API layering, role-aware access checks, and an offline-first mobile strategy), and the web app currently produces a successful production build. However, there are several delivery blockers that should be addressed next: missing lint configuration in two apps, TypeScript compile failures in the mobile app, and duplicate/stale web app trees that can create drift.

## What Looks Good

1. **API layering is clear and maintainable**
   - Routes are thin and delegate to services.
   - Auth helpers and role gates are centralized middleware.
2. **Security baseline is present in API bootstrap**
   - Helmet, CORS, and rate limiting are enabled.
3. **Web app build is currently healthy**
   - `npm run build` in `web/` completed successfully.

## Findings (Prioritized)

### 1) Missing ESLint configuration blocks linting (Web + Mobile)

**Severity:** High (quality gate blocked)

- `web/package.json` and `mms-mobile/package.json` both define lint scripts.
- Running those scripts fails because no ESLint config is present in either project root.

**Impact**
- CI/local quality checks are non-functional.
- Regressions become easier to introduce.

**Recommendation**
- Add root ESLint config files for `web/` and `mms-mobile/` (flat config or legacy format).
- Align package versions (ESLint v9 in web wants flat config by default).

### 2) Mobile TypeScript does not compile cleanly

**Severity:** High (shipping risk)

`npx tsc --noEmit` in `mms-mobile/` reports multiple errors, including:
- Expo FileSystem API symbol mismatches.
- Bad/missing import path in `src/db/syncEngine.ts` (`./api` not found).
- Type issues in checklist/work-order screens.

**Impact**
- Runtime defects are likely in untyped/incorrect paths.
- Developer feedback loop is weaker until compile is clean.

**Recommendation**
- Fix import path and API surface mismatches first.
- Then address screen typing errors and enforce `tsc --noEmit` in CI.

### 3) Duplicate web codebases (`web/` and `web/web/`) increase drift risk

**Severity:** Medium

- There are two similar web app trees: `web/src/...` and `web/web/src/...`.
- Their `App.jsx` files are already diverged (different default route/pages).
- Docker compose builds `./web`, so `web/web` appears stale or experimental.

**Impact**
- Team may edit the wrong tree.
- Future merges and bugfixes can silently go to non-deployed code.

**Recommendation**
- Remove or archive `web/web/` if unused.
- Keep a single canonical web app path and document it.

### 4) Stale/likely-unused page with broken imports in web app

**Severity:** Medium

- `web/src/pages/WorkOrders.jsx` imports components from `../components/...`, but active implementations live in `web/src/pages/workorders/...`.
- Current `App.jsx` uses `pages/workorders/WorkOrdersPage.jsx`, so this appears to be legacy code.

**Impact**
- Confusing for contributors.
- May break if accidentally wired back into routes.

**Recommendation**
- Delete stale page or fix imports and add comments if intentionally retained.

## Suggested Next Milestone Plan

1. **Establish quality gates**
   - Add ESLint configs and make lint pass in web/mobile.
2. **Restore mobile compile health**
   - Make `npx tsc --noEmit` pass.
3. **Repository hygiene**
   - Consolidate duplicate web directories.
   - Remove stale pages and dead files.
4. **Add CI checks**
   - Web build + lint
   - Mobile TypeScript check + lint
   - API smoke/integration harness

## Commands Run

- `cd web && npm run lint` (fails: missing ESLint config)
- `cd mms-mobile && npm run lint` (fails: missing ESLint config)
- `cd web && npm run build` (passes)
- `cd mms-mobile && npx tsc --noEmit` (fails with type/import errors)

---

## Expedited Fix Plan (Single Combined PR)

To move quickly, the issues above can be fixed in one coordinated pass rather than split into multiple PRs.

### Phase 1 — Re-enable quality gates (same day)

1. Add lint config for `web/` using ESLint v9 flat config.
2. Add lint config for `mms-mobile/` (either flat config or `.eslintrc.cjs` pinned to ESLint v8 behavior).
3. Keep lint rules lightweight initially (syntax + obvious bug catches), then tighten in later PRs.

**Exit criteria:**
- `cd web && npm run lint` passes.
- `cd mms-mobile && npm run lint` passes.

### Phase 2 — Make mobile compile clean (same PR)

1. Fix bad relative import in `mms-mobile/src/db/syncEngine.ts` (`./api` → correct alias/path).
2. Update Expo FileSystem usage to match installed SDK typings (document directory + upload enum access).
3. Resolve strict typing issues in:
   - `ChecklistScreen.tsx` (`never` assignment errors)
   - `WorkOrderDetailScreen.tsx` (argument count + missing `type` field assumptions)
4. Add a `typecheck` script in `mms-mobile/package.json` (`tsc --noEmit`) for repeatable CI checks.

**Exit criteria:**
- `cd mms-mobile && npm run typecheck` passes.

### Phase 3 — Repository hygiene and source-of-truth cleanup (same PR)

1. Confirm `web/` is canonical and remove or archive `web/web/`.
2. Remove stale `web/src/pages/WorkOrders.jsx` (or wire it correctly if intentionally kept).
3. Update top-level docs to explicitly call out canonical web path and expected checks.

**Exit criteria:**
- No duplicate active web source trees.
- Routing/docs align with shipped web app structure.

### Phase 4 — CI/check command baseline (same PR)

Add/standardize a minimal check sequence (local script or CI job):

1. `cd web && npm run lint`
2. `cd web && npm run build`
3. `cd mms-mobile && npm run lint`
4. `cd mms-mobile && npm run typecheck`

Optional (if environment is available): run API integration harness against Docker stack.

### Risk controls while doing all fixes together

- Commit in small logical chunks inside the same branch (lint config, TS fixes, cleanup, docs).
- Re-run full check sequence after each chunk.
- Avoid behavioral refactors beyond what is needed to restore correctness and build health.

### Definition of Done for the expedited pass

- Lint passes in web and mobile.
- Mobile TypeScript compile passes.
- Duplicate/stale web source paths are cleaned up.
- Updated docs reflect canonical structure and check commands.
