# Contributing to referenced-automation-ui-api

The shared rules (tests with negative controls, no hard waits, no secrets, ADRs, review checklist, deprecation policy) are in
[`referenced-automation-utils/docs/governance/CONTRIBUTING.md`](../referenced-automation-utils/docs/governance/CONTRIBUTING.md).
Release and upgrade steps: [`RELEASING.md`](../referenced-automation-utils/docs/governance/RELEASING.md). Decisions: [`docs/adr`](../referenced-automation-utils/docs/adr/README.md).

## Before you push
```bash
npm run lint && npm run typecheck && npm test && npm run security
```
Windows PowerShell 5.1 has no `&&` (PowerShell 7 and cmd.exe do): run the four commands one per line (a `;` would carry on after a failure):
```powershell
npm run lint
npm run typecheck
npm test
npm run security
```
`npm test` runs `bddgen` first (it generates the Gherkin tests into `.features-gen/`).

## Reading a new environment variable
Document it in `.env.example` (the same block as the others: what it is for, `Read from`, `Values`, `Default | Required | Secret`, `Example`) and add a row to the README "Configuration reference" table. A secret also goes into `.env.local.example`. `tests/envDocs.spec.ts` fails until the code, `.env.example`, the table and `.env.local.example` agree. In docs, show an environment variable for bash AND PowerShell (`$env:NAME = "value"; npx playwright test`); `tests/windowsDocs.spec.ts` fails on a POSIX-only snippet.

Update `CHANGELOG.md`. This repo is in the chain `utils` -> `api`/`ui` -> `sap` -> `ui-api`: nothing depends on this repo.
