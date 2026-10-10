import { createPlaywrightConfig } from '@automation/referenced-automation-utils';
import { defineBddConfig } from 'playwright-bdd';
import { AUTH_FILE } from './tests/support/authState';

// Every repo in the family runs Playwright the same way, defined once in
// utils - see createPlaywrightConfig's doc comment for every env var it reads.
// Gherkin features: `bddgen` turns features/*.feature + features/steps/*.ts into runnable tests in .features-gen/
// (the npm scripts run it first). They are their own project, so they do not wait for the browser login setup.
const bddTestDir = defineBddConfig({
  features: 'features/*.feature',
  steps: 'features/steps/*.ts',
  outputDir: '.features-gen',
});

export default createPlaywrightConfig({
  dir: __dirname,
  name: '@automation/referenced-automation-ui-api',
  baseUrlKey: 'BASE_URL',
  // A `setup` project logs in once (tests/auth.setup.ts) and every browser
  // project starts with that saved session. Tests that need a clean browser
  // opt out with `test.use({ storageState: ANONYMOUS })`.
  auth: { setupMatch: /auth\.setup\.ts/, storageState: AUTH_FILE },
  extraProjects: [{ name: 'bdd', testDir: bddTestDir, use: { sapGuiMode: 'attach' } as Record<string, unknown> }],
  // Keep the output of passing tests too (CI already does). These specs attach SAP evidence screenshots even when they pass;
  // with 'failures-only' Playwright deletes a passing test's folder while the Allure reporter is still copying those files,
  // which fails the run with ENOENT although every test passed.
  overrides: { preserveOutput: 'always' },
});
