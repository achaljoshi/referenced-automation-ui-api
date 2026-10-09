# Changelog

## Unreleased

### Added
- **Order-to-cash across SAP GUI, REST API, database and SFTP**, traced by one correlation id (`tests/orderToCash.spec.ts`, reusable flow steps, SAP page objects, a landscape stand-in, reconciliation, negative controls).
- **Gherkin / BDD example** with `playwright-bdd` and the shared SAP step vocabulary (`features/`, `npm run test:bdd`).
- Log-in-once `storageState` via the shared config's `auth` project (`tests/auth.setup.ts`).
- `typecheck` and `security` scripts and pipeline job.

### Changed
- `playwright.config.ts` uses the shared `createPlaywrightConfig`; duplicated SMTP/SFTP test servers removed (use `testing` from utils); specs use the UI package's `test` (correlation id, scenario banner).
