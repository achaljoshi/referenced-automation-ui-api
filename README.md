# Referenced Automation UI+API Composition Framework

Composes `referenced-automation-ui`, `referenced-automation-api` and
`referenced-automation-utils` as plain Maven dependencies - **zero
duplicated framework code**. This repo's only original content is glue: its
own page objects, step definitions, and sample `.feature` files that
exercise both frameworks together in a single Cucumber scenario, including
sharing Playwright browser session state between an API-driven step and a
UI step. Cucumber + Java + Maven, published to Nexus and imported as a
Maven dependency like any other library.

## Table of contents

- [Why this repo is almost entirely glue](#why-this-repo-is-almost-entirely-glue)
- [Resolving the resource collisions](#resolving-the-resource-collisions)
- [What's included](#whats-included)
- [Project layout](#project-layout)
- [Quick start](#quick-start)
- [A note on the sample scenarios](#a-note-on-the-sample-scenarios)
- [Sharing session state between the API and UI frameworks](#sharing-session-state-between-the-api-and-ui-frameworks)
- [Using this as a dependency in another project](#using-this-as-a-dependency-in-another-project)
- [Configuration](#configuration)
- [Reporting & logging](#reporting--logging)
- [Retry logic & parallel execution](#retry-logic--parallel-execution)
- [CI/CD](#cicd)
- [Publishing to Nexus](#publishing-to-nexus)
- [IntelliJ IDEA setup](#intellij-idea-setup)
- [A note on verification](#a-note-on-verification)

## Why this repo is almost entirely glue

`referenced-automation-ui` ships a full Playwright browser lifecycle
(`BasePage`, `PlaywrightFactory`/`PlaywrightManager`, `WaitUtils`,
`ScreenshotUtils`, `ConfigReader`, an untagged `Hooks` that runs for every
scenario). `referenced-automation-api` ships the equivalent for REST API
testing (`ApiClient`/`ApiRequestSpec`/`ApiResponseWrapper`,
`ApiContextFactory`/`ApiContextManager`, an untagged `ApiHooks`). Both are
compile dependencies here, and both untagged hook classes are wired
directly onto this repo's Cucumber glue path (see
`junit-platform.properties`) - **unmodified, not reimplemented**. Since
every scenario in this repo is inherently hybrid (it exists specifically to
prove UI + API composition), there is no need for the tag-scoped hooks
`referenced-automation-sap` uses to keep two *mutually exclusive*
technologies apart - here both lifecycles simply run for every scenario,
side by side.

That leaves this repo with almost nothing of its own to write:
`src/main` holds only the merged resource files described below (no Java at
all), and `src/test` holds two page objects for SauceDemo (not shipped by
either dependency - see next section for why they had to be written here)
plus step definitions and feature files for the two sample scenarios.

## Resolving the resource collisions

Composing two independently-built, independently-self-sufficient framework
jars on one classpath surfaces two real collisions neither
`referenced-automation-ui` nor `referenced-automation-api` had to worry
about on their own. Both are handled deliberately, not accidentally:

**1. Bundled classpath resources at identical paths.** Both dependency jars
ship `config/config.properties`, `log4j2.xml`, `extent.properties`,
`extent-spark-config.xml` and `allure.properties` at the exact same root
classpath paths (each was built to work completely standalone, per its own
README). Whichever jar's copy the classloader happens to resolve first
would silently win if this repo did nothing - so this repo ships its **own**
copy of every one of those five files under `src/main/resources`. Maven (and
IntelliJ) always place a project's own `target/classes` ahead of its
dependency jars on the runtime classpath, so this repo's own copies
deterministically win regardless of dependency declaration order. See
`config/config.properties`'s own header comment for the full reasoning.

**2. The same property key, two different meanings.** Both
`referenced-automation-ui`'s `ConfigReader` and `referenced-automation-api`'s
`ConfigReader` read a key literally named `base.url` - for the UI framework
it means "the web app under test" (default SauceDemo), for the API
framework it means "the REST API's base URL" (default JSONPlaceholder).
One shared `config/config.properties` cannot correctly serve both meanings
for two genuinely different target applications at once. Resolution: this
repo's `base.url` is unambiguously the **API** framework's meaning (set to
`https://jsonplaceholder.typicode.com`), and its own page objects
(`SauceLoginPage`, `SauceProductsPage`) hardcode SauceDemo's URL directly
instead of calling `ConfigReader.baseUrl()` - the same pattern
`referenced-automation-sap`'s `FioriCartPage` already uses for its own
target URL, for the same reason.

**A known family-wide gap worth naming honestly:** neither collision would
exist if `referenced-automation-api`'s bundled resources used unique paths
the way `referenced-automation-sap`'s `sap/sap-gui.properties` does. That
fix belongs in a future revision of `referenced-automation-api` itself
(rename its resources to e.g. `api/config.properties`, `api/log4j2.xml`,
etc.) - this repo works around the gap correctly today via classpath
precedence, but the cleaner long-term fix is upstream.

## What's included

- **Reused, unmodified**: everything in `referenced-automation-ui`'s and
  `referenced-automation-api`'s `src/main` - `BasePage`, `PlaywrightFactory`/
  `PlaywrightManager`, `Hooks`, `ApiClient`/`ApiRequestSpec`/
  `ApiResponseWrapper`, `ApiHooks`, `StepLoggerPlugin` (ui's copy - see
  above), and both frameworks' Extent/Allure/Log4j2 reporting stack.
- **This repo's own glue** (`src/test`, not shipped in the published jar):
  - `SauceLoginPage` / `SauceProductsPage` - page objects for SauceDemo,
    extending `referenced-automation-ui`'s `BasePage`
  - `hybrid-identity.feature` / `HybridIdentitySteps` - fetches a user via
    `referenced-automation-api`'s `ApiClient`, feeds the result into a
    `referenced-automation-ui`-driven SauceDemo login attempt
  - `session-sharing.feature` / `SessionSharingSteps` - Playwright
    `storageState()` reuse across `BrowserContext`s (see below)
  - `RunCucumberTest` / `RunSmokeTest` runners

## Project layout

```
referenced-automation-ui-api/
├── pom.xml
├── src/main/resources/           (merged config/log4j2/extent/allure - see above)
│   ├── config/config.properties
│   ├── log4j2.xml
│   ├── extent.properties
│   ├── extent-spark-config.xml
│   └── allure.properties
└── src/test/                      (sample suite - not shipped in the jar)
    ├── java/com/company/automation/uiapi/
    │   ├── pages/{SauceLoginPage,SauceProductsPage}.java
    │   ├── stepdefinitions/{HybridIdentitySteps,SessionSharingSteps}.java
    │   └── runners/{RunCucumberTest,RunSmokeTest}.java
    └── resources/
        ├── features/{hybrid-identity,session-sharing}.feature
        └── junit-platform.properties
```

## Quick start

```bash
git clone <this-repo>
cd referenced-automation-ui-api
./mvnw exec:java@install-playwright-browsers   # one-time, downloads Chromium
./mvnw test
```

## A note on the sample scenarios

JSONPlaceholder (the API demo target, also used by
`referenced-automation-api`'s own sample suite) and SauceDemo (the UI demo
target, also used by `referenced-automation-ui`'s own sample suite) are two
unrelated, credential-free public demo services with **no shared backend**.
`hybrid-identity.feature` is an honest illustration of framework
composition - a real value fetched via the API framework genuinely drives a
real UI interaction, and the UI's genuine response is verified - but it is
not a claim that JSONPlaceholder and SauceDemo are integrated systems. A
team adopting this repo as a starting template would point both halves at
their own application's UI and API, which - unlike these two public demos -
presumably do share a real backend, making the composition considerably
more meaningful (e.g., create a record via the API, then verify it renders
correctly in the UI).

## Sharing session state between the API and UI frameworks

`session-sharing.feature` demonstrates the actual mechanism a hybrid suite
uses to avoid repeating an expensive login flow: Playwright's
`BrowserContext.storageState(new BrowserContext.StorageStateOptions().setPath(path))`
captures cookies and local storage to a file, and
`Browser.newContext(new Browser.NewContextOptions().setStorageStatePath(path))`
replays it into a fresh `BrowserContext` - which then starts already
authenticated, with no login form to fill in.

This sample keeps the technique entirely on the UI side (SauceDemo's own
login already demonstrates it, since - per the note above - SauceDemo and
JSONPlaceholder share no backend to seed a session from). In a real
application where the UI and API genuinely share a backend, the equivalent
flow would be: authenticate via `referenced-automation-api`'s `ApiClient`
against the shared backend, extract the resulting session token/cookie, and
either inject it directly into a new `BrowserContext` (via
`BrowserContext.addCookies(...)` or a hand-built storage-state JSON payload)
or use the API-obtained credentials to drive one real UI login and *then*
capture/replay `storageState()` from there, exactly as this sample does.

## Using this as a dependency in another project

```xml
<dependency>
    <groupId>com.company.automation</groupId>
    <artifactId>referenced-automation-ui-api</artifactId>
    <version>1.0.0-SNAPSHOT</version>
</dependency>
```

In practice, most teams will treat this repo as a **starting template to
fork/clone** rather than a library to import further - its value is almost
entirely in its sample scenarios and composed configuration, not in
reusable classes (there are none of its own). It is still structured and
published exactly like every other repo in this family for consistency, and
nothing prevents importing it if a genuine use case for that exists (e.g.
sharing this repo's own page objects with a sibling test module).

## Configuration

See `src/main/resources/config/config.properties`'s header comment for the
full explanation of which keys serve which framework, and why `base.url`
specifically is reserved for the API framework's meaning in this repo.
Every other key follows the same three-tier override rule as the rest of
this family: `-D` system property > OS env var (upper-cased, dots ->
underscores) > properties file.

## Reporting & logging

Identical mechanism to `referenced-automation-ui`/`referenced-automation-api`
(Extent Spark HTML report under `target/extent-report`, Allure results
under `target/allure-results`, console + `logs/automation.log` via Log4j2,
`StepLoggerPlugin` for per-step logging) - one canonical copy of each
config file and plugin class, per "Resolving the resource collisions" above.

## Retry logic & parallel execution

Same rerun-file retry pattern as the rest of this framework family. Parallel
execution is enabled (`fixed`, parallelism 2) - safe here because
`referenced-automation-ui`'s `Hooks` and `referenced-automation-api`'s
`ApiHooks` each manage their own independent `ThreadLocal`-held resources,
so every thread gets its own fresh browser+context+page *and* its own fresh
`APIRequestContext`, exactly as if either framework were running standalone.

## CI/CD

`.gitlab-ci.yml` / `.github/workflows/ci.yml` both clone and `mvn install`
**all three** of `referenced-automation-utils`, `referenced-automation-ui`
and `referenced-automation-api` from source (temporary bring-up workaround -
delete once all three are published to Nexus), install Playwright's
Chromium binary, run the suite, retry failures once via the rerun file,
publish Cucumber/Extent/Allure artifacts and an Allure Pages site, and
deploy to Nexus on `main`/tags.

## Publishing to Nexus

Same as every repo in this family:

```bash
./mvnw -s settings.xml deploy
```

## IntelliJ IDEA setup

Open the folder - IntelliJ IDEA Ultimate detects the Maven project and its
Cucumber/Gherkin plugin needs automatically. Pre-built run configurations
(`.idea/runConfigurations/`): **Maven: install-playwright-browsers**,
**Maven: clean test**, **Regression (RunCucumberTest)**, **Smoke
(RunSmokeTest)** - same shape as every other repo in this family.

## A note on verification

This sandbox cannot reach Maven Central (`mvn`/`mvnw` fail with HTTP 403 on
every attempt) and therefore cannot compile or execute anything in this
repo. Every non-trivial API call was verified by reading real, current
upstream source:

- `BrowserContext.StorageStateOptions.setPath(Path)`,
  `BrowserContext.storageState(StorageStateOptions)` (returns the captured
  state as a `String`; also writes it to `path` as a side effect if one is
  set), and `Browser.NewContextOptions.setStorageStatePath(Path)` were all
  confirmed against the actual `microsoft/playwright-java` source
  (`BrowserContext.java`/`Browser.java`) at the pinned
  `com.microsoft.playwright:playwright:1.62.0` version, the same
  verification method used throughout this framework family.
- Every class this repo calls into on `referenced-automation-ui` and
  `referenced-automation-api` (`BasePage`, `PlaywrightManager`, `ApiClient`,
  `ApiResponseWrapper`, etc.) is that repo's own already-verified,
  already-delivered class - not a reimplementation - so no new verification
  risk is introduced there.
- The JSONPlaceholder `/users/{id}` response shape (a `username` field, HTTP
  200 for a valid id) is that service's well-documented, stable schema,
  consistent with `referenced-automation-api`'s own already-verified sample
  suite against the same service.
- SauceDemo's exact login-error copy
  ("Epic sadface: Username and password do not match any user in this
  service") is reused verbatim from `referenced-automation-ui`'s own sample
  suite (`login.feature`), not retyped from memory.

As with every repo in this family: review before relying on it in
production, and please report anything that turns out to be wrong.
