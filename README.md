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

## Log in once, start every test logged in

`tests/auth.setup.ts` logs in by API once and saves the browser state to `.auth/user.json` (git-ignored - it is a credential). `playwright.config.ts` passes `auth: { setupMatch, storageState }` to the shared `createPlaywrightConfig`, which adds a `setup` project and makes every browser project start with that state. `tests/storageState.spec.ts` shows a test that does no login of its own.

A test that needs a clean browser - the anonymous state, or doing the login itself - opts out with `test.use({ storageState: ANONYMOUS })` (see `hybridSession.spec.ts`).

## One scenario across SAP GUI, API, database and SFTP

`tests/orderToCash.spec.ts` is the worked example of a cross-system flow: look up a price over REST, create a sales
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

The features run against in-process stand-ins (SAP simulator, the sample web server, the order landscape) so they work anywhere; for real systems remove the overrides in `features/steps/fixtures.ts` and set `SAP_GUI_MODE` / `BASE_URL` / `API_BASE_URL`.

## Converting recordings and curl commands

Both converters ship in the packages this repo depends on, so they are here already:

```bash
npx playwright codegen http://localhost:3000/profile.html --output recordings/profile.spec.ts
npm run convert:ui        # ui-codegen-to-playwright recordings --out tests/generated/ui   -> actions / locators / assertions
npm run convert:api       # api-curl-to-playwright curl --out tests/generated/api          -> apiClient / auth classes / response assertions
```

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
./scripts/setup.sh      # npm ci + playwright install --with-deps (scripts/setup.bat on Windows)
npm test
```

`setup.sh`/`setup.bat` run `npm ci`. They first run `npm config set registry "$NPM_REGISTRY_URL"` when that variable is set, so every package - the `@automation/*` ones too (`referenced-automation-utils`, `referenced-automation-api`, `referenced-automation-ui`, `referenced-automation-sap`), each **by the version in `package.json`** - is fetched from your organisation's npm registry. If those packages are not published there yet, or you want to try a change you have not published, run `./scripts/setup.sh --local` (`scripts\setup.bat --local` on Windows): it builds the sibling repos this one depends on - they must be checked out next to this one - into `../shared-packages` and installs those instead, without touching `package.json` or the lockfile. See [Publishing a package](#publishing-a-package-to-the-registry-jfrog-artifactory) and [Using a package without a registry](#using-a-package-without-a-registry-local-generation).

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
- A package that is itself depended on (`utils`, `api`, `ui`, `sap`) must be published again before its consumers can ask for the new version - see [Publishing a package](#publishing-a-package-to-the-registry-jfrog-artifactory) in that repo.

## First rollout: publish, then install from the registry

To see the whole chain work from the registry (no `--local`): set `NPM_REGISTRY_URL`, publish `utils`, `api`, `ui`, `sap` **in that order** (`./scripts/publish-package.sh --dry-run`, then without `--dry-run`, in each repo; the first publish uses the current version, 1.0.0), confirm with `npm view @automation/referenced-automation-<name> versions --registry "$NPM_REGISTRY_URL"`, then in a consumer run `rm -rf node_modules && ./scripts/setup.sh` and check `npm ls @automation/referenced-automation-utils` and the `resolved` address in `package-lock.json`. The full walkthrough is [section 4.3 of the cross-repo guide](https://github.com/achaljoshi/referenced-automation-utils/blob/master/CROSS_REPO_GUIDE.md#43-first-rollout-publish-everything-then-install-from-the-registry).

## Using a package without a registry (local generation)

Use this when the packages are not in a registry yet, or you want to try a change before publishing it. Nothing in `package.json` or the lockfile changes.

**Automatic - when the repos are checked out next to each other:**

```bash
./scripts/setup.sh --local          # Windows: scripts\setup.bat --local
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
   Each file is named `automation-<package>-<version>.tgz` after the version in that repo's `package.json` and lands in `../shared-packages`.
2. Leave the files in `../shared-packages`, or copy them into the consuming repo (any folder works, for example `libs/` - keep it out of git).
3. Install them, all in one command (change the folder if you copied the files elsewhere):
   ```bash
   npm install --no-save ../shared-packages/automation-referenced-automation-utils-<version>.tgz ../shared-packages/automation-referenced-automation-api-<version>.tgz ../shared-packages/automation-referenced-automation-ui-<version>.tgz ../shared-packages/automation-referenced-automation-sap-<version>.tgz
   ```
   `--no-save` keeps `package.json` and the lockfile unchanged. Run it again after every `npm ci`, because `npm ci` removes what is not in the lockfile. When you rebuild a tarball with the same version, run the command again to pick up the new contents.
4. Build and test as usual (`npm run build`, `npm test`).

When you are done experimenting, run `npm ci` to go back to what the registry provides.

## Environments

Same `.env.<name>` + `ENV=<name>` pattern as the rest of this family (see `referenced-automation-utils`'s README). This repo's own tests spin up an in-process server and don't read `BASE_URL`/`API_BASE_URL` themselves - they're here as the template a real hybrid project's env files follow.

## Allure reporting

Every test run writes raw results to `allure-results/` via the `allure-playwright` reporter (pure JS/TS, no extra runtime needed). Turning those into the viewable HTML report needs a JRE on `PATH` (Allure's report generator is a Java tool) - that's why it's a separate step, not part of `npm test` itself:

```bash
npm test               # also writes allure-results/
npm run allure:report  # generates allure-report/ and opens it in a browser
```

## IDE setup

Same as the other repos in this family: VS Code prompts for recommended extensions on open; IntelliJ/WebStorm ships ESLint/Prettier wired in plus an `npm: test` run configuration.
