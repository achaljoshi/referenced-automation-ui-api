# Changelog

## Unreleased

### Fixed (audit 2026-10-10)
- **ORC-01** The sample auth server issues a random signed session per login (`HttpOnly`) and validates it itself: `dashboard.html` is rendered per session and `/api/profile` is 401 without a valid one. New `tests/sessionValidation.spec.ts` (forged cookies, expired session, a cookie the browser never received, distinct sessions per login, HttpOnly) and a storageState test against a server that did not issue the session. The hybrid and storageState tests assert with web-first `expectWelcome()` / `expectNoWelcome()` instead of `{ timeout: 0 }` snapshots (UI-01).
- **ORC-02** The order-to-cash tests await `landscape.deliver(...)` (no floating promises), 'every order gets its own correlation id' really uses two ids and checks each is found only in its own order's rows, the end-to-end test is titled and documented as a harness self-test, the SAP order is registered as *kept* instead of a no-op "cleanup", and a delivery that skips the database, SFTP or fulfilment API is caught (one test each, fresh landscape per case).
- **ORC-05** `tests/utilsMethods.spec.ts` and `tests/apiMethods.spec.ts` are thin import checks, no longer `@smoke`.
- **CI** matrix legs run `--project=$BROWSER`; the Gherkin features run once in their own `bdd` job (Chromium; this includes the accessibility step of the hybrid feature); `npm run typecheck` is in the build job.

### Changed (behaviour)
- The sample server's `/api/profile` answers 401 without a session, and `profile.html` then shows "Please log in to see your profile": `recordings/profile-and-dashboard.spec.ts`, `curl/auth.curl`, their `tests/generated/` output and `features/hybrid-login.feature` follow. The login response's `token` is the (random) session, not a constant.
- `tests/generated/ui` and `tests/converters.spec.ts` compare with the **installed** `referenced-automation-ui` converter: when a UI release with the new converter header is installed, re-run `npm run convert:ui`.

### Added
- **Configuration reference**: `.env.example` now documents EVERY environment variable this repo reads or that the shared packages read on its behalf (what it is for, where it is read from, values, default, required, secret, example), in the same format as `referenced-automation-utils`; `.env.local.example` is the template for the secret `.env.<ENV>.local` file; the README has a "Configuration reference" table of the same keys. `tests/envDocs.spec.ts` keeps them true: it fails when the code (this repo's files, or the built utils config / logger / random files) reads a variable that is not listed, when the file lists one nothing reads, when a block lacks a metadata line, when the README table or its Secret column disagrees, when a secret has no template line, and has negative controls for each.
- **Windows first run** README section (PowerShell: `.\scripts\setup.bat`, running one file / title / project, the common first errors with fixes) and PowerShell forms for every environment-variable example in the README and CONTRIBUTING. `tests/windowsDocs.spec.ts` checks that every bin a `package.json` script (or an `npx` in the docs) names is in `node_modules/.bin`, that no doc snippet is POSIX-only, that no doc shows a backslash path after `playwright test`, and that the Windows section is there.
- **Worked example for a remote desktop host**: `tests/remoteHost.spec.ts` (UI steps in the browser, API and database steps on the RDP host through the remote-desktop utility, against its stand-in agent; NOT VERIFIED on a real RDP host) and a README section.
- **Order-to-cash across SAP GUI, REST API, database and SFTP**, traced by one correlation id (`tests/orderToCash.spec.ts`, reusable flow steps, SAP page objects, a landscape stand-in, reconciliation, negative controls).
- **Gherkin / BDD** (`playwright-bdd` 9.2.1): scenarios mixing SAP, UI and API steps with one shared `vars` (`features/hybrid-login.feature`: log in through the API and the browser is signed in; `features/order-to-cash.feature`: an order number remembered from SAP is `{{order}}` to the API step that polls the fulfilment service; the sales-order feature), one test merging the SAP, UI and API tests, `npm run test:bdd`.
- **Converters wired in**: `npm run convert:ui` (`ui-codegen-to-playwright`) and `npm run convert:api` (`api-curl-to-playwright`) with worked examples (`recordings/`, `curl/`), their output committed and run in `tests/generated/`, and `tests/converters.spec.ts` guarding against drift.
- Log-in-once `storageState` via the shared config's `auth` project (`tests/auth.setup.ts`).
- `typecheck` and `security` scripts and pipeline job.

### Changed
- **tsconfig works with TypeScript 7**: `"module": "node16"` and `"moduleResolution": "node16"` replace `commonjs` / `node` (TypeScript 7 removed `moduleResolution: node` and stops with TS5108). The compiled JavaScript is identical; checked with TypeScript 5.9.3 and 7.0.2. The fortnightly audit flags the old setting (`tsconfig-removed-option`).
- `scripts/setup.bat` prints the PowerShell form (`$env:BROWSER = "msedge"; npm test`) next to the cmd.exe one when the browser download is skipped; the committed `.env.dev` / `.env.qa` / `.env.stage` say that `LOG_LEVEL` in a `.env` file has no effect (the logger reads the real environment only).
- README: the converters section says the bins come from the dependencies (`npm run convert:ui -- <args>` and `npx ui-codegen-to-playwright <args>` both work); the stale "`npm run build`" step is gone (this repo has no build).
- **`@automation/*` dependencies are version ranges (`^1.0.0`)**, installed from the registry in `NPM_REGISTRY_URL` (`setup` runs `npm config set registry` first); `setup.sh --local` installs locally built tarballs instead. The pipeline no longer clones sibling repos. README: upgrading, local generation.
- **Playwright 1.64.0** (was 1.62.1): the `@playwright/test` / `playwright-core` floor is `^1.64.0` and the peer range is `>=1.64.0 <2.0.0` where the package declares one; run `npx playwright install chromium` after upgrading.
- `playwright-bdd` pinned exactly to 9.2.1.
- `playwright.config.ts` uses the shared `createPlaywrightConfig`; duplicated SMTP/SFTP test servers removed (use `testing` from utils); specs use the UI package's `test` (correlation id, scenario banner).

### Fixed
- `.vscode/launch.json` works on Windows: it starts `node_modules/@playwright/test/cli.js` (the `node_modules/.bin/playwright` entry is a shell script there, not JavaScript) and passes `${fileBasename}` instead of `${relativeFile}` (backslashes on Windows give "No tests found"); checked by `tests/windowsDocs.spec.ts`.
- A passing run could exit 1 with "1 error was not a part of any test": the Allure reporter copying a SAP evidence screenshot lost a race with Playwright deleting the passing test's output folder. `preserveOutput: 'always'` (as CI already had) removes it.
