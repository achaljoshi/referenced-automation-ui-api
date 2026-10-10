import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The two converters (`ui-codegen-to-playwright` from the UI package, `api-curl-to-playwright` from the API package)
 * are run here the way a user runs them. The tests they produced are committed in tests/generated/ and run in this suite;
 * this fails if those files drift from what the converters produce today (e.g. after upgrading a package).
 */
const root = path.join(__dirname, '..');
const bin = (pkg: string, file: string) => path.join(root, 'node_modules', '@automation', pkg, 'dist', 'cli', file);
const squash = (code: string) => code.replace(/[\s,]+/g, '');
const run = (script: string, args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });

test.describe('converters', () => {
  test('tests/generated/ui is what ui-codegen-to-playwright makes of recordings/', () => {
    const result = run(bin('referenced-automation-ui', 'codegenToTests.js'), ['recordings/profile-and-dashboard.spec.ts', '--stdout', '--test-import', '../../support/generatedTest']);
    expect(result.status, result.stderr).toBe(0);
    expect(squash(fs.readFileSync(path.join(root, 'tests/generated/ui/profile-and-dashboard.spec.ts'), 'utf8'))).toBe(squash(result.stdout));
    expect(result.stderr).toContain('waitForTimeout(1000) was removed');
  });

  test('tests/generated/api is what api-curl-to-playwright makes of curl/', () => {
    const result = run(bin('referenced-automation-api', 'curlToTests.js'), ['curl/auth.curl', '--stdout', '--test-import', '../../support/generatedTest']);
    expect(result.status, result.stderr).toBe(0);
    expect(squash(fs.readFileSync(path.join(root, 'tests/generated/api/auth.spec.ts'), 'utf8'))).toBe(squash(result.stdout));
    expect(result.stdout).not.toContain("'secret'"); // the password in the curl command is read from API_PASSWORD, never written into the test
    expect(result.stderr).toContain('API_PASSWORD');
  });

  test('the converters refuse input that is not theirs, with a message that says what they expect', () => {
    expect(run(bin('referenced-automation-ui', 'codegenToTests.js'), ['curl/auth.curl', '--stdout']).stderr).toMatch(/No Playwright test found/);
    expect(run(bin('referenced-automation-api', 'curlToTests.js'), ['recordings/profile-and-dashboard.spec.ts', '--stdout']).stderr).toMatch(/No curl commands found/);
  });
});
