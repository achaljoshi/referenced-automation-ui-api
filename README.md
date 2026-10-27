# referenced-automation-ui-api

Composes [`referenced-automation-ui`](../referenced-automation-ui), [`referenced-automation-api`](../referenced-automation-api), and [`referenced-automation-utils`](../referenced-automation-utils) as plain npm dependencies - **zero duplicated framework code**. This repo's only original content is glue: a tiny sample server, a page object, and specs proving both frameworks work together in one test - including sharing session state between an API-driven step and a UI step with no manual token copy-pasting, and mocking a UI page's runtime API data with a helper imported from the API package.

## Why this repo is almost entirely glue

Both dependencies are complete on their own (the `actions` layer for UI, `ApiClient` for API). Neither needs anything from this repo to work - what only exists here is the proof that combining them is straightforward, plus the pattern for doing it correctly.

## Sharing a session between an API step and a UI step

Playwright's `BrowserContext.request` is an `APIRequestContext` that **shares its cookie jar with the browser context it belongs to**. So instead of logging in via the API and manually copying a token/cookie into the browser, you construct the API client on top of the browser context's own request context:

```ts
test('an API-issued session cookie is honoured by the UI', async ({ page, context }) => {
  const apiClient = new ApiClient(context.request, baseUrl); // <- shares context's cookies

  const loginResponse = await apiClient.post('/login', { json: { username, password } });
  loginResponse.expectStatus(200);

  await page.goto(`${baseUrl}/dashboard.html`); // the cookie the login just set is already there
  // ... assert the UI reflects the logged-in state
});
```

No `document.cookie` scripting, no `context.addCookies()` bookkeeping - the session genuinely is one session, not two synchronised ones. See `tests/hybridSession.spec.ts` for the full working example (including the negative cases: no login → anonymous state, failed login → no session granted).

**The sample server checks the session itself**, so these tests can fail for the right reason. `POST /login` issues a *different* signed session per login (a random id, the user and an expiry, signed with a key) as an `HttpOnly` cookie; `dashboard.html` is rendered for whatever session the server finds and `/api/profile` answers 401 without a valid one. A forged, expired or missing cookie gets the anonymous page - `tests/sessionValidation.spec.ts` proves each (forged constant, tampered payload, someone else's signature, expiry with the server's clock moved on, a login the browser never received, two logins giving two sessions) and `tests/storageState.spec.ts` proves the saved login is worthless to a server that did not issue it. The default signing key is random per checkout (`.auth/session.key`, git-ignored; `AUTH_SESSION_KEY` overrides it): one key shared by every sample server is what lets the session saved by the `setup` project - a server that no longer exists - be recognised later, because the server checks the signature rather than remembering the login. `server.seen` records what the server made of each request's cookie, so a test can assert the cookie really was sent.

## Log in once, start every test logged in

`tests/auth.setup.ts` logs in by API once and saves the browser state to `.auth/user.json` (git-ignored - it is a credential). `playwright.config.ts` passes `auth: { setupMatch, storageState }` to the shared `createPlaywrightConfig`, which adds a `setup` project and makes every browser project start with that state. `tests/storageState.spec.ts` shows a test that does no login of its own.

A test that needs a clean browser - the anonymous state, or doing the login itself - opts out with `test.use({ storageState: ANONYMOUS })` (see `hybridSession.spec.ts`).

## One scenario across SAP GUI, API, database and SFTP

`tests/orderToCash.spec.ts` is the worked example of a cross-system flow - and its tests are **harness self-tests**: the SAP GUI is the simulator and the test itself calls `landscape.deliver(...)` (awaited) with data it built from what it typed, so a green run proves the harness can create an order, read it back from every system, tie them together with one correlation id and report a disagreement or a *missing delivery* (one test per system left out: database, SFTP, fulfilment API) - not that a real SAP interface delivers. Only the simulator's order number is independent of the test. Against a real landscape, drop the `deliver()` call and keep `collectTrace` / `reconcile`. The order is registered in the SAP data registry as **kept**, not cleaned (nothing here undoes it); a real project passes `{ cleanup }` to `createOrderInSap`.

The flow: look up a price over REST, create a sales
order in SAP GUI, then read the order back from the database, the SFTP drop and the fulfilment API and check they all
agree with SAP. **One correlation id ties it together** - it is on the REST request header, written into the SAP order's
*Customer Reference*, in the database row, in the SFTP file name and on the fulfilment API call - so a failing order can
be followed through every system by searching for one value.

| Piece | Where |
|---|---|
| the scenario | `tests/orderToCash.spec.ts` |
| the reusable steps (`lookUpPrice`, `createOrderInSap`, `collectTrace`, `reconcile`) - each a `test.step` | `tests/support/flows/orderToCash.ts` |
| the SAP screens as page objects | `tests/support/sap/pages.ts` |
| the stand-in for the order interface and the three systems it feeds | `tests/support/orderLandscape.ts` |

It runs anywhere: SAP GUI is the SAP package's built-in simulator and the landscape is in-process (SQLite, the shared SFTP
test server, a mock REST server). To run it against a real landscape, use a real SAP session (`SAP_GUI_MODE`, see the SAP
package) and point `OrderLandscape` at the real database, SFTP host and API - then delete `deliver()`, because SAP's
interface does that part. Verification polls (the interface is asynchronous) and never sleeps; a mismatch names the
system and the field (`database: quantity is 30, SAP has 3`); an order that never arrives is reported as missing in the
first system that lacks it, quoting the correlation id.

## Gherkin / BDD (`playwright-bdd` 9.2.1)

Scenarios that mix SAP, the web UI and APIs, in business language, with one vocabulary per package shared by every project (not copied):

| Piece | Where |
|---|---|
| UI sentences (`I click the button "Log in"`, `I should see "Welcome back!"`) | `registerUiSteps` in `@automation/referenced-automation-ui` |
| API sentences (`I send a POST request to "/login" with JSON:`, `the response status is 200`) | `registerApiSteps` in `@automation/referenced-automation-api` |
| SAP sentences (`I open transaction "VA01"`, `I remember the number from the status bar ... as "order"`) | `registerSapSteps` in `@automation/referenced-automation-sap` |
| data sentences (`I generate a random email called "login"`, `the variable "x" matches "..."`) | `registerDataSteps` (UI and API packages carry the same one - register it once) |
| the scenarios | `features/hybrid-login.feature`, `features/order-to-cash.feature`, `features/sap-sales-order.feature` |
| wiring: ONE test that merges the SAP, UI and API tests, and where to add this project's own steps | `features/steps/fixtures.ts`, `features/steps/steps.ts` |
| config: its own `bdd` project; `bddgen` turns features into runnable tests in `.features-gen/` (git-ignored) | `playwright.config.ts` |

```gherkin
Scenario: An order created in SAP reaches the fulfilment API
  Given I am logged on to SAP
  When I open transaction "VA01"
  ...
  And I click the toolbar button "Save"
  And I remember the number from the status bar matching "Order (\d+)" as "order"
  When the order interface delivers order "{{order}}" for customer "1000"
  And I wait until a GET request to "{{fulfilmentApi}}/fulfilments?orderNo={{order}}" returns "[0].status" equal to "RECEIVED" within 10 seconds
  Then the response field "[0].orderNo" equals "{{order}}"
```

What makes the libraries one framework: they share **one `vars`** (a value remembered from SAP is `{{order}}` to the next API step) and one correlation id, and every string in every step understands `{{placeholders}}` (`{{env:X}}`, `{{uuid}}`, `{{random:email}}`, `{{date:+7d}}`). The hybrid feature logs in through the API and the browser is signed in, because the API client is built on the browser context's own request context (the same cookie jar).

```bash
npm run test:bdd      # bddgen && playwright test --project=bdd   (npm test / test:smoke run bddgen first too)
```

The features run against in-process stand-ins (SAP simulator, the sample web server, the order landscape) so they work anywhere; for real systems remove the overrides in `features/steps/fixtures.ts` (they also fill in `SAP_USER`, `SAP_PASSWORD` and `SAP_CLIENT`, and a value set there beats a `.env` file) and the `sapGuiMode: 'attach'` pin of the `bdd` project in `playwright.config.ts`, then set `SAP_GUI_MODE` / `BASE_URL` / `API_BASE_URL` (see [Configuration reference](#configuration-reference)).

## Converting recordings and curl commands

(`tests/utilsMethods.spec.ts` and `tests/apiMethods.spec.ts` are thin import checks - the utils and API packages test their own methods in their own repos - and are deliberately not tagged `@smoke`.)

Both converters ship in the packages this repo depends on, so they are here already: this repo has no `bin` of its own, but the `bin` entries of its dependencies are linked into `node_modules/.bin` by `npm install`/`npm ci` (`ui-codegen-to-playwright` from the UI package, `api-curl-to-playwright` from the API package, `automation-remote`, `automation-scan-secrets` ... from utils), and `npm run` and `npx` both look there - on Windows too.

```bash
npx playwright codegen http://localhost:3000/profile.html --output recordings/profile.spec.ts
npm run convert:ui        # ui-codegen-to-playwright recordings --out tests/generated/ui   -> actions / locators / assertions
npm run convert:api       # api-curl-to-playwright curl --out tests/generated/api          -> apiClient / auth classes / response assertions
```

To run a converter with other arguments, pass them after `--` or call the bin directly (both work here because the packages are dependencies; the same lines work in bash and PowerShell):

```bash
npm run convert:ui -- recordings --out tests/generated/ui --page-objects
npx ui-codegen-to-playwright recordings/profile-and-dashboard.spec.ts --stdout
npx api-curl-to-playwright curl --out tests/generated/api --test-import ../../support/generatedTest
```

`tests/windowsDocs.spec.ts` checks that every `bin` a script in `package.json` runs is really in `node_modules/.bin`; if it fails, the install did not run or failed (see [Windows first run](#windows-first-run)).

Every converted test starts with objects its steps only refer to - change an input or fix a locator once, at the top: the UI test has `CONSTANTS` (URLs, typed values, expected values) and `LOCATORS` (every element, named once); the API test has `CONSTANTS` (queries, headers, bodies sent; expected status, fields, headers, timing) and `ENDPOINTS` (the path of every call). `recordings/profile-and-dashboard.spec.ts` and `curl/auth.curl` are worked examples; `tests/generated/` holds what they produce and runs in the suite (`tests/converters.spec.ts` fails if a package upgrade changes the output). Typed passwords and curl credentials are read from the environment, never written into the generated tests. See the UI and API READMEs for the options (`--page-objects`, `--data`, `--flow`, `--param`, `--strict`, ...).

## Mocking a UI page's runtime API data

`referenced-automation-api` exports `mockApiRoute`, a wrapper around Playwright's own `page.route()` - built there so it's one `import` away from any UI project, including this one:

```ts
import { mockApiRoute } from '@automation/referenced-automation-api';

test('mockApiRoute overrides the same fetch call with mock data instead', async ({ page }) => {
  await mockApiRoute(page, { url: '**/api/profile', method: 'GET', body: { name: 'Mocked Ada' } });

  await page.goto(`${server.baseUrl}/profile.html`);
  await expect(page.locator('#profile-name')).toHaveText('Mocked Ada');
});
```

See `tests/mockedProfile.spec.ts` for the full working example - `tests/support/authServer.ts`'s `profile.html` fetches `/api/profile` at runtime; one test asserts against the real endpoint's response, the other overrides it with `mockApiRoute` and asserts the mocked value renders instead. See `referenced-automation-api`'s own README ([Mocking](../referenced-automation-api/README.md#mocking)) for the other two mocking tools it ships (`MockServer` for API-level tests, `recordApiTraffic`/`playApiRecording` for record-once-replay-forever).

## Quick start

```bash
./scripts/setup.sh      # npm ci + playwright install --with-deps
npm test
```

```powershell
.\scripts\setup.bat    # Windows PowerShell (in cmd.exe: scripts\setup.bat)
npm test
```

On Windows read [Windows first run](#windows-first-run) too. `setup.sh`/`setup.bat` run `npm ci`. They first run `npm config set registry "$NPM_REGISTRY_URL"` when that variable is set, so every package - the `@automation/*` ones too (`referenced-automation-utils`, `referenced-automation-api`, `referenced-automation-ui`, `referenced-automation-sap`), each **by the version in `package.json`** - is fetched from your organisation's npm registry. If those packages are not published there yet, or you want to try a change you have not published, run `./scripts/setup.sh --local` (PowerShell: `.\scripts\setup.bat --local`): it builds the sibling repos this one depends on - they must be checked out next to this one - into `../shared-packages` and installs those instead, without touching `package.json` or the lockfile. See "Publishing a package to the registry" in the README of `referenced-automation-utils` (the same section is in `-api`, `-ui` and `-sap`) and [Using a package without a registry](#using-a-package-without-a-registry-local-generation).

**Setup stops with a certificate error** (`self-signed certificate in certificate chain`, `unable to get local issuer certificate`)? A company proxy that re-signs HTTPS with its own root certificate is the usual cause. `setup` checks for it first (`scripts/check-tls.js`: the npm registry and, where browsers are installed, the Playwright download host) and prints the exact fix: give Node the company root CA certificate (a `.pem` file from IT) through `NODE_EXTRA_CA_CERTS`, or on Node 22.15 or newer let it read the operating system's certificate store with `NODE_OPTIONS=--use-system-ca`. Do not work around it with `NODE_TLS_REJECT_UNAUTHORIZED=0`: that turns certificate checking off for every Node program started from that shell, npm included. The check connects directly from this machine; it does not use a proxy setting, so a machine that can only reach the registry through a proxy shows "could not connect" and setup carries on.

## Windows first run

PowerShell, from the repo root (VS Code: Terminal > New Terminal opens it there). The SAP part runs against the built-in simulator by default, so nothing on the machine needs SAP.

**1. Install.** The script runs `npm ci` and installs the browsers:

```powershell
.\scripts\setup.bat            # the @automation/* packages from the registry in NPM_REGISTRY_URL
.\scripts\setup.bat --local    # or: build the sibling repos and install those (see below)
```

In PowerShell the `.\` is required (`scripts\setup.bat` works only in `cmd.exe`). `--local` needs `referenced-automation-utils`, `referenced-automation-api`, `referenced-automation-ui` and `referenced-automation-sap` checked out next to this repo; it builds them into `..\shared-packages`. Install the browsers again later with `npm run install:browsers`.

**2. Run the tests.** Use forward slashes in a file path (`tests/x.spec.ts`), or select by title:

```powershell
npm test                                          # everything: bddgen (the Gherkin features), then playwright test
npx playwright test tests/hybridSession.spec.ts   # one file
npx playwright test -g "forged"                   # one title (a part of it is enough)
npx playwright test --project=chromium            # one project
npm run test:bdd                                  # only the Gherkin features
```

**3. Settings for one run.** PowerShell sets a variable for the whole session, so undo it afterwards (`cmd.exe`: `set BROWSER=firefox && npx playwright test`):

```powershell
$env:ENV = "stage"; $env:BROWSER = "firefox"; npx playwright test
Remove-Item Env:BROWSER; Remove-Item Env:ENV
```

On a locked-down machine that cannot download browsers, install with `$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"; .\scripts\setup.bat` and run with an installed one: `$env:BROWSER = "msedge"; npm test`.

**Common first errors:**

| You see | Why | Fix |
|---|---|---|
| `'tsc' is not recognized`, `'bddgen' is not recognized`, `'playwright' is not recognized`, or there is no `node_modules` folder | the install did not run or failed | run `.\scripts\setup.bat` again and read its FIRST error: the later ones are consequences |
| `The term 'scripts\setup.bat' is not recognized` | PowerShell does not run files from the current folder without a path | `.\scripts\setup.bat` |
| `Cannot find module '@automation/...'` or `Cannot find module '...dist...'` | a dependency is not installed or not built | run the setup script; `.\scripts\setup.bat --local` builds the sibling repos first (check that `node_modules\@automation\referenced-automation-utils\dist` exists) |
| `No tests found` | the path pattern matched nothing: a backslash path, another folder, a file that is not a `*.spec.ts` | `npx playwright test tests/hybridSession.spec.ts` (forward slashes) or `-g "title"`; run it from the repo root; the Gherkin features need `bddgen` first, which `npm test` and `npm run test:bdd` run for you |
| `error TS5108: Option 'moduleResolution=node10' has been removed` in `tsconfig.json` (VS Code or a machine with TypeScript 7) | TypeScript 7 removed `moduleResolution: "node"`; it has nothing to do with the Node.js version | `tsconfig.json` now uses `"module": "node16"` and `"moduleResolution": "node16"` (same compiled output): `git pull`, or change those two lines by hand |
| `Illegal characters in path` mentioning `*.tgz` | an old `clean` script in a sibling repo, which `--local` builds | fixed there (the script is `rimraf --glob dist "*.tgz"`): pull that repo and run `.\scripts\setup.bat --local` again |
| `Executable doesn't exist ... npx playwright install` | the browsers are not installed | `npx playwright install` (or `npm run install:browsers`); on a locked-down machine `$env:BROWSER = "msedge"` (or `chrome`) uses the browser that is already there |
| `The term 'ENV=qa' is not recognized` (or `'ENV' is not recognized`) | `NAME=value command` is bash syntax | PowerShell: `$env:ENV = "qa"; npx playwright test`; cmd.exe: `set ENV=qa && npx playwright test` |
| `The token '&&' is not a valid statement separator` | Windows PowerShell 5.1 has no `&&` (PowerShell 7 and cmd.exe do) | run the commands one per line, or use PowerShell 7 |
| `npm.ps1 cannot be loaded because running scripts is disabled on this system` | PowerShell's execution policy blocks npm's `.ps1` launcher | run `npm.cmd test` (or use cmd.exe), or ask your administrator about the policy - this repo does not change it |
| a change in a `.env` file seems ignored | the file name is wrong or a real variable wins | the files are `.env.<ENV>` and `.env.<ENV>.local` (ENV=qa reads `.env.qa.local`; a file called `.env.local` is never read); a variable set in the shell wins over a file; check `$env:ENV`; `ENV` itself is read from the real environment only |
| `LOG_LEVEL` (or another logger setting, `RANDOM_SEED`, `NO_COLOR`) in a `.env` file does nothing | these are read from the real environment only | `$env:LOG_LEVEL = "debug"; npx playwright test` |

The table in [Configuration reference](#configuration-reference) says for every variable where it is read from.

## Using this pattern in your own project

```jsonc
// package.json - versions, from the registry in NPM_REGISTRY_URL
"dependencies": {
  "@automation/referenced-automation-ui": "^1.0.0",
  "@automation/referenced-automation-api": "^1.0.0",
  "@automation/referenced-automation-utils": "^1.0.0"
}
```

Then write page objects as factory functions on top of `actions` and API calls on `ApiClient` exactly as documented in each of those repos' READMEs - this repo adds nothing to their APIs, it only demonstrates using both at once.

## Upgrading a package: change one version

This repo lists the `@automation/*` packages it uses in `package.json` with a version range, like any other dependency:

```jsonc
"dependencies": {
  "@automation/referenced-automation-utils": "^1.0.0",
  "@automation/referenced-automation-api": "^1.0.0",
  "@automation/referenced-automation-ui": "^1.0.0",
  "@automation/referenced-automation-sap": "^1.0.0"
}
```

To take a newer version, **change that number** (say `"^1.3.0"`), run `npm install`, run the tests and commit `package.json` and `package-lock.json`. npm downloads the new version from the registry in `NPM_REGISTRY_URL`; nothing is built, copied or placed by hand.

- `^1.3.0` accepts any `1.x` from 1.3.0 up (what `npm update` moves to); write `1.3.0` to pin exactly.
- `npm ci` (CI, `setup.sh`) installs exactly what the lockfile records, so a version only changes when someone commits a change.
- The lockfile in this repo records the version of each `@automation/*` package but not where it came from. The first `npm install` against the real registry adds that (`resolved` and `integrity`); commit the result.
- A package that is itself depended on (`utils`, `api`, `ui`, `sap`) must be published again before its consumers can ask for the new version - see "Publishing a package to the registry" in the README of `referenced-automation-utils` (the same section is in `-api`, `-ui` and `-sap`) in that repo.

## First rollout: publish, then install from the registry

To see the whole chain work from the registry (no `--local`): set `NPM_REGISTRY_URL` (bash: `export NPM_REGISTRY_URL=https://...`; PowerShell: `$env:NPM_REGISTRY_URL = "https://..."`), publish `utils`, `api`, `ui`, `sap` **in that order** (`./scripts/publish-package.sh --dry-run`, then without `--dry-run`, in each repo; the first publish uses the current version, 1.0.0), confirm with `npm view @automation/referenced-automation-<name> versions --registry "$NPM_REGISTRY_URL"`, then in a consumer delete `node_modules` (bash: `rm -rf node_modules`; PowerShell: `Remove-Item -Recurse -Force node_modules`) and run the setup script again (`./scripts/setup.sh`, PowerShell: `.\scripts\setup.bat`), and check `npm ls @automation/referenced-automation-utils` and the `resolved` address in `package-lock.json`. The full walkthrough is [section 4.3 of the cross-repo guide](https://github.com/achaljoshi/referenced-automation-utils/blob/master/CROSS_REPO_GUIDE.md#43-first-rollout-publish-everything-then-install-from-the-registry).

## Using a package without a registry (local generation)

Use this when the packages are not in a registry yet, or you want to try a change before publishing it. Nothing in `package.json` or the lockfile changes.

**Automatic - when the repos are checked out next to each other:**

```bash
./scripts/setup.sh --local
```

```powershell
.\scripts\setup.bat --local          # PowerShell (cmd.exe: scripts\setup.bat --local)
```

It builds the sibling repos this one depends on (`referenced-automation-utils`, `referenced-automation-api`, `referenced-automation-ui`, `referenced-automation-sap`) with their own `scripts/create-package.sh --local`, keeps the `.tgz` files in `../shared-packages` and installs them.

**Manual - generating a tarball and placing it yourself** (for example when the consuming repo is on another machine):

1. Generate a tarball of each package this repo needs, in that package's own repo (`--local` builds what it depends on in turn, without needing the registry):
   ```bash
   (cd ../referenced-automation-utils && ./scripts/create-package.sh --local)
   (cd ../referenced-automation-api && ./scripts/create-package.sh --local)
   (cd ../referenced-automation-ui && ./scripts/create-package.sh --local)
   (cd ../referenced-automation-sap && ./scripts/create-package.sh --local)
   ```
   ```powershell
   foreach ($repo in "utils", "api", "ui", "sap") {
     Push-Location "..\referenced-automation-$repo"
     .\scripts\create-package.bat --local
     Pop-Location
   }
   ```
   Each file is named `automation-<package>-<version>.tgz` after the version in that repo's `package.json` and lands in `../shared-packages`.
2. Leave the files in `../shared-packages`, or copy them into the consuming repo (any folder works, for example `libs/` - keep it out of git).
3. Install them, all in one command (change the folder if you copied the files elsewhere):
   ```bash
   npm install --no-save ../shared-packages/automation-referenced-automation-utils-<version>.tgz ../shared-packages/automation-referenced-automation-api-<version>.tgz ../shared-packages/automation-referenced-automation-ui-<version>.tgz ../shared-packages/automation-referenced-automation-sap-<version>.tgz
   ```
   `--no-save` keeps `package.json` and the lockfile unchanged. Run it again after every `npm ci`, because `npm ci` removes what is not in the lockfile. When you rebuild a tarball with the same version, run the command again to pick up the new contents.
4. Test as usual (`npm test`; this repo has no build step).

When you are done experimenting, run `npm ci` to go back to what the registry provides.

## UI here, API / database / SAP on a remote desktop

When the UI app is reachable from the machine that runs the tests (for example an AWS WorkSpace) but the APIs, the database and SAP GUI are reachable only from a remote RDP host, one test can still do all of it: the UI steps run in the browser on the test machine, and the other steps run on the RDP host through the remote-desktop utility in `referenced-automation-utils` (`docs/REMOTE_DESKTOP.md`).

```
your laptop --> AWS WorkSpace (tests + browser run here) --RDP--> RDP host (helper + SAP GUI; reaches the DB and the APIs)
```

Put the login in `.env.<env>.local` (never committed): `REMOTE_ENABLED=true`, `REMOTE_RDP_HOST`, `REMOTE_RDP_USER`, `REMOTE_RDP_PASSWORD`, plus `REMOTE_DB_PROVIDER` / `REMOTE_DB_CONNECTION_STRING` for database steps. Then:

```ts
const host = await remote.getRemoteHost();                         // logs in over RDP once per worker; undefined when REMOTE_ENABLED is off
const remoteApi = new ApiClient(new RemoteRequestContext(host!).asApiRequestContext(), 'http://api.internal');  // API calls made FROM the RDP host
const db = new remote.RemoteDbClient(host!);                       // SQL run ON the RDP host
```

or, with no code change, `API_VIA_REMOTE=true` makes the API fixtures (`apiClient`, `apiFor`) call from the RDP host, and `SAP_GUI_TRANSPORT=remote` runs the SAP steps through the bridge inside the RDP session (see the `-api` and `-sap` READMEs).

`tests/remoteHost.spec.ts` is a worked example: a UI step in the browser, API calls made from the remote host, a database step on it, and the clear failure when the remote agent stops. It runs against the utility's stand-in agent, so it proves the wiring and **not** a real RDP session (NOT VERIFIED on a real host: run `npx automation-remote check` on your machine first).

## Environments

Same `.env.<name>` + `ENV=<name>` pattern as the rest of this family (see `referenced-automation-utils`'s README): `ENV` picks `.env.<ENV>` (default `qa`), `.env.<ENV>.local` holds secrets (git-ignored; the name must match the environment - a file called just `.env.local` is never read), and a variable set in the shell or in CI wins over both. This repo's own tests spin up an in-process server and the SAP simulator, so they do not need `BASE_URL`/`API_BASE_URL` or any secret - the committed `.env.dev`, `.env.qa` and `.env.stage` are the template a real hybrid project's env files follow.

```bash
ENV=stage BROWSER=firefox npx playwright test
BROWSER=all-devices npm test
```

```powershell
$env:ENV = "stage"; $env:BROWSER = "firefox"; npx playwright test
Remove-Item Env:BROWSER; Remove-Item Env:ENV
$env:BROWSER = "all-devices"; npm test
```

## Configuration reference

Every environment variable this repo reads, or that the shared packages read on its behalf, is documented in [`.env.example`](.env.example) (what it is for, where it is read from, accepted values, default, whether it is required, whether it is a secret, an example). Copy the lines you need into `.env.<name>`; put the secrets (`Secret: YES`) in `.env.<name>.local` (template: [`.env.local.example`](.env.local.example); bash `cp .env.local.example .env.qa.local`, PowerShell `Copy-Item .env.local.example .env.qa.local`). `tests/envDocs.spec.ts` fails when the code reads a variable that is not listed, when the file lists one nothing reads, when a block lacks a metadata line, and when this table disagrees with the file.

- **Repo-specific keys**: `AUTH_SESSION_KEY`, `API_PASSWORD`, `HYBRID_PASSWORD` (the sample server and its made-up logins), `NPM_REGISTRY_URL`, `USE_LOCAL_PACKAGES`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, `PLAYWRIGHT_DOWNLOAD_HOST`, `AUDIT_RUN_GATES` (the install scripts and `.gitlab-ci.yml`). The `SAP_*` keys are read by the sap package, `REMOTE_*` by utils, `API_VIA_REMOTE` and `REMOTE_API_BASE_URL` by the api package; this repo documents the ones its examples use.
- **Shared keys** (`createPlaywrightConfig`, the logger, `loadEnv`, defined once in utils): everything from `ENV` to `TZ` except the keys above. Their full reference is [`.env.example` in referenced-automation-utils](https://github.com/achaljoshi/referenced-automation-utils/blob/master/.env.example); the other `REMOTE_*` keys and `docs/REMOTE_DESKTOP.md` are there too, and the other `SAP_GUI_*` keys are in the [sap `.env.example`](https://github.com/achaljoshi/referenced-automation-sap/blob/master/.env.example).
- **Read from**: a key is read from `.env` files or the real environment unless the table says "real env only" - then it is read straight from the process environment and a line for it in a `.env` file has no effect (bash `LOG_LEVEL=debug npx playwright test`, PowerShell `$env:LOG_LEVEL = "debug"; npx playwright test`, then `Remove-Item Env:LOG_LEVEL`).

### Environment selection

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `ENV` | Which environment: loads `.env.<ENV>` and `.env.<ENV>.local` (real env only) | qa | no | no |
| `ENVIRONMENT` | Fallback name for `ENV`; `ENV` wins (real env only) | unset | no | no |

### Target URLs

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `BASE_URL` | Web app base URL, Playwright's `baseURL`; `apiClient` also uses it before `API_BASE_URL` | unset | only for tests that open a relative URL | no |
| `API_BASE_URL` | API under test; used by `apiClient` when `BASE_URL` is empty | unset | only for tests that call a relative path against a real API | no |

### Browser and run selection

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `BROWSER` | Browser(s) to run: chromium, firefox, webkit, msedge, chrome, all, all-devices ... | chromium | no | no |
| `DEVICE` | Emulate one Playwright device; wins over `BROWSER` | unset | no | no |
| `HEADLESS` | Run without a browser window | true | no | no |
| `WORKERS` | Parallel workers (number or percentage) | half the cores | no | no |
| `RETRIES` | Re-runs of a failed test | 0 (1 when `CI` is set) | no | no |
| `MAX_FAILURES` | Stop the run after this many failures (0 = never) | 0 | no | no |
| `SLOW_MO_MS` | Slow browser actions down, in ms (debugging) | 0 | no | no |
| `VIEWPORT_WIDTH` | Browser window width, px | 1280 | no | no |
| `VIEWPORT_HEIGHT` | Browser window height, px | 800 | no | no |
| `LOCALE` | Browser language, e.g. en-GB | the browser's | no | no |
| `TIMEZONE_ID` | Browser time zone, e.g. Europe/London | the machine's | no | no |
| `COLOR_SCHEME` | Emulated prefers-color-scheme | the browser's | no | no |
| `IGNORE_HTTPS_ERRORS` | Accept invalid HTTPS certificates (test environments only) | false | no | no |
| `TEST_ID_ATTRIBUTE` | Attribute `getByTestId()` looks at | data-testid | no | no |

### Timeouts (milliseconds)

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `TEST_TIMEOUT_MS` | One test's time limit, ms | 30000 | no | no |
| `EXPECT_TIMEOUT_MS` | Web-first assertion wait, ms | 10000 | no | no |
| `ACTION_TIMEOUT_MS` | One action's wait, ms | 15000 | no | no |
| `NAVIGATION_TIMEOUT_MS` | One navigation's wait, ms | 30000 | no | no |
| `GLOBAL_TIMEOUT_MS` | Whole-run limit, ms (0 = none) | 0 | no | no |

### Logging and test data

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `LOG_LEVEL` | Minimum log level: error ... debug, silly (real env only) | info | no | no |
| `LOG_TO_FILE` | Also write the JSON-lines log file (real env only) | true | no | no |
| `LOG_FILE` | Log file path (real env only) | logs/automation.log | no | no |
| `LOG_FILE_PER_WORKER` | One log file per worker (real env only) | false | no | no |
| `NO_COLOR` | Console colour off (real env only) | unset | no | no |
| `FORCE_COLOR` | Console colour on even in CI or a pipe (real env only) | unset | no | no |
| `RANDOM_SEED` | Seed for the random-data generators, to replay a run (real env only) | unset (random) | no | no |

### This repo: the sample server and its logins

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `AUTH_SESSION_KEY` | Signing key of the sample server's session cookies (real env only; not a real secret) | random key in `.auth/session.key` | no | no |
| `API_PASSWORD` | Password the converted API tests send; the sample server accepts only its made-up login | secret (sample login) | only against a real API | YES |
| `HYBRID_PASSWORD` | Password `features/hybrid-login.feature` sends | secret (sample login) | only against a real system | YES |

### SAP GUI (read by the sap package)

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `SAP_GUI_MODE` | attach or open (sap package; pinned to attach in this repo's tests and `bdd` project) | attach | no | no |
| `SAP_GUI_SIMULATOR` | Run against the sap package's built-in fake SAP | false | no | no |
| `SAP_GUI_CONNECTION_NAME` | SAP Logon entry to open (open mode) | unset | with open mode, unless a connection string is set | no |
| `SAP_GUI_CONNECTION_STRING` | Open a system by connection string (open mode) | unset | no | no |
| `SAP_USER` | SAP user for the logon step | unset (simulator: TESTUSER) | for a real SAP logon | no |
| `SAP_PASSWORD` | Password of `SAP_USER` | unset (simulator: made-up) | for a real SAP logon | YES |
| `SAP_CLIENT` | SAP client typed on the logon screen | unset | no | no |
| `SAP_LANGUAGE` | Logon language, e.g. EN | unset | no | no |
| `SAP_GUI_TRANSPORT` | Bridge to SAP GUI: powershell, java or remote | powershell | no | no |
| `SAP_GUI_LOGON_PATH` | Path of saplogon.exe (open mode) | C:\Program Files (x86)\SAP\FrontEnd\SAPgui\saplogon.exe | no | no |
| `SAP_GUI_TIMEOUT_MS` | Longest one SAP GUI step waits, ms | 30000 | no | no |
| `SAP_GUI_EVIDENCE` | Evidence attached to the report: off, failure, steps | failure | no | no |

### Remote desktop host (read by utils and the api package)

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `REMOTE_ENABLED` | Master switch for the remote desktop host | false | no | no |
| `REMOTE_RDP_HOST` | Host name or address of the RDP host | unset | when `REMOTE_ENABLED=true` | no |
| `REMOTE_RDP_PORT` | RDP port | 3389 | no | no |
| `REMOTE_RDP_USER` | RDP login, may be DOMAIN\user | unset | with `REMOTE_AGENT_START=alternate-shell` | no |
| `REMOTE_RDP_PASSWORD` | Password of the RDP login | unset | with `REMOTE_AGENT_START=alternate-shell` | YES |
| `REMOTE_DB_PROVIDER` | .NET DbProviderFactories name for database steps on the host | unset | for database steps on the host | no |
| `REMOTE_DB_CONNECTION_STRING` | Database connection string as the host uses it | unset | for database steps on the host | YES |
| `API_VIA_REMOTE` | `apiClient` / `apiFor` call from the remote host (api package) | false | no | no |
| `REMOTE_API_BASE_URL` | The API's base URL as seen from the remote host | unset (then `baseURL`, `API_BASE_URL`) | no | no |

### Install scripts and the CI pipeline

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `NPM_REGISTRY_URL` | npm registry the setup scripts and CI install from (real env only) | unset (npm's current registry) | effectively yes in CI | no |
| `USE_LOCAL_PACKAGES` | 1 = install the sibling repos' tarballs, like `setup --local` (real env only) | unset | no | no |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | 1 = setup skips the browser download (real env only) | unset | no | no |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Mirror of Playwright's browser CDN for CI (real env only) | unset | no | no |
| `AUDIT_RUN_GATES` | Run lint, typecheck, test and security inside the manual `audit` CI job (real env only) | unset | no | no |

### Set by the machine

| Name | Purpose | Default | Required | Secret |
|---|---|---|---|---|
| `CI` | Set by CI systems: more retries, no `test.only`, no colour (real env only) | unset | no | no |
| `TEST_WORKER_INDEX` | Set by Playwright for each worker; do not set it (real env only) | unset | no | no |
| `TZ` | Time zone of the Node process (real env only) | the machine's | no | no |

## Allure reporting

Every test run writes raw results to `allure-results/` via the `allure-playwright` reporter (pure JS/TS, no extra runtime needed). Turning those into the viewable HTML report needs a JRE on `PATH` (Allure's report generator is a Java tool) - that's why it's a separate step, not part of `npm test` itself:

```bash
npm test               # also writes allure-results/
npm run allure:report  # generates allure-report/ and opens it in a browser
```

## IDE setup

Same as the other repos in this family: VS Code prompts for recommended extensions on open; IntelliJ/WebStorm ships ESLint/Prettier wired in plus an `npm: test` run configuration.

**Gherkin step navigation (VS Code).** Ctrl/Cmd-click on a step in a `.feature` file opens its definition when the official *Cucumber* extension (`cucumberopen.cucumber-official`, recommended when you open the folder) knows where the steps are. `.vscode/settings.json` tells it (`cucumber.glue`): this repo's `features/steps` and the vocabulary compiled into the `@automation/referenced-automation-ui`, `-api` and `-sap` packages. Without that setting the extension reads only `features/`, so the shared steps ("I click the button ...") show as undefined and do not open anything. If *Cucumber (Gherkin) Full Support* (`alexkrechik.cucumberautocomplete`) is also installed, disable it for this workspace so the two do not both answer. Run `npm ci` first (the packaged steps are read from `node_modules`) and reload the window once after changing the setting.

