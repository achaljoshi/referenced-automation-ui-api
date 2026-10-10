import { test, expect } from '@playwright/test';
import { createPlaywrightConfig, getCorrelationId, loadEnv, logger, placeholders, withCorrelationId } from '@automation/referenced-automation-utils';

/**
 * A thin import check, not a re-test of utils: utils has its own suite (crypto, dates, random data, JSON/YAML/CSV/Excel,
 * schema validation, SMTP/SFTP/SQLite ...). All this repo needs to know is that the pieces IT builds on - the shared
 * Playwright config, the logger, the correlation id, `{{placeholders}}` - resolve from the installed package and still
 * work, so a mismatched install fails here with a clear name. Deliberately not tagged @smoke: it says nothing about
 * how the frameworks work together.
 */
test.describe('utils: what this repo builds on', () => {
  test('the config factory, logger, config reader, placeholders and correlation id resolve and work', async () => {
    expect(typeof createPlaywrightConfig).toBe('function');
    expect(typeof loadEnv).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(new placeholders.ScenarioVariables().interpolate('id-{{uuid}}')).toMatch(/^id-[0-9a-f-]{36}$/);
    expect(await withCorrelationId('abc-123', () => getCorrelationId())).toBe('abc-123');
  });
});
