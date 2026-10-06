import { createPlaywrightConfig } from '@automation/referenced-automation-utils';
import { AUTH_FILE } from './tests/support/authState';

// Every repo in the family runs Playwright the same way, defined once in
// utils - see createPlaywrightConfig's doc comment for every env var it reads.
export default createPlaywrightConfig({
  dir: __dirname,
  name: '@automation/referenced-automation-ui-api',
  baseUrlKey: 'BASE_URL',
  // A `setup` project logs in once (tests/auth.setup.ts) and every browser
  // project starts with that saved session. Tests that need a clean browser
  // opt out with `test.use({ storageState: ANONYMOUS })`.
  auth: { setupMatch: /auth\.setup\.ts/, storageState: AUTH_FILE },
});
