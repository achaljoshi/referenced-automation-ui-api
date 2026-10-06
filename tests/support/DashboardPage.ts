import type { Page } from '@playwright/test';
import { actions, locators } from '@automation/referenced-automation-ui';

export interface DashboardPage {
  goto(url: string): Promise<void>;
  /** Waits (up to the expect timeout) for the welcome banner; pass `{ timeout: 0 }` to read the current state instantly - for asserting it is NOT shown. */
  isWelcomeShown(options?: { timeout?: number }): Promise<boolean>;
  isAnonymousShown(options?: { timeout?: number }): Promise<boolean>;
}

export function createDashboardPage(page: Page): DashboardPage {
  // Plain <div>s with no ARIA role of their own - byText (not a role
  // locator) is the right tool, same principle as referenced-automation-ui's
  // own sample page objects: match by role/label where real ARIA semantics
  // exist, by text/CSS where they don't.
  const welcome = locators.byText(page, 'Welcome back!');
  const anonymous = locators.byText(page, 'Please log in');

  return {
    async goto(url) {
      await actions.goto(page, url);
    },

    async isWelcomeShown(options) {
      return actions.isVisible(welcome, options);
    },

    async isAnonymousShown(options) {
      return actions.isVisible(anonymous, options);
    },
  };
}
