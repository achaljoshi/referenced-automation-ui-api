import type { Page } from '@playwright/test';
import { actions, locators } from '@automation/referenced-automation-ui';

export interface DashboardPage {
  goto(url: string): Promise<void>;
  isWelcomeShown(): Promise<boolean>;
  isAnonymousShown(): Promise<boolean>;
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

    async isWelcomeShown() {
      return actions.isVisible(welcome);
    },

    async isAnonymousShown() {
      return actions.isVisible(anonymous);
    },
  };
}
