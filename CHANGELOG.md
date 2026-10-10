# Changelog

## Unreleased

### Added
- **Order-to-cash across SAP GUI, REST API, database and SFTP**, traced by one correlation id (`tests/orderToCash.spec.ts`, reusable flow steps, SAP page objects, a landscape stand-in, reconciliation, negative controls).
- **Gherkin / BDD** (`playwright-bdd` 9.2.1): scenarios mixing SAP, UI and API steps with one shared `vars` (`features/hybrid-login.feature`: log in through the API and the browser is signed in; `features/order-to-cash.feature`: an order number remembered from SAP is `{{order}}` to the API step that polls the fulfilment service; the sales-order feature), one test merging the SAP, UI and API tests, `npm run test:bdd`.
- **Converters wired in**: `npm run convert:ui` (`ui-codegen-to-playwright`) and `npm run convert:api` (`api-curl-to-playwright`) with worked examples (`recordings/`, `curl/`), their output committed and run in `tests/generated/`, and `tests/converters.spec.ts` guarding against drift.
- Log-in-once `storageState` via the shared config's `auth` project (`tests/auth.setup.ts`).
- `typecheck` and `security` scripts and pipeline job.

### Changed
- **Playwright 1.64.0** (was 1.62.1): the `@playwright/test` / `playwright-core` floor is `^1.64.0` and the peer range is `>=1.64.0 <2.0.0` where the package declares one; run `npx playwright install chromium` after upgrading.
- `playwright-bdd` pinned exactly to 9.2.1.
- `playwright.config.ts` uses the shared `createPlaywrightConfig`; duplicated SMTP/SFTP test servers removed (use `testing` from utils); specs use the UI package's `test` (correlation id, scenario banner).
