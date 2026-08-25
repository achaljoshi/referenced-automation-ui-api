import type { Page } from '@playwright/test';
import { actions } from '@automation/referenced-automation-ui';

export interface DashboardPage {
  goto(url: string): Promise<void>;
  isWelcomeShown(): Promise<boolean>;
  isAnonymousShown(): Promise<boolean>;
}

export function createDashboardPage(page: Page): DashboardPage {
  const welcome = page.locator('#welcome');
  const anonymous = page.locator('#anonymous');

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
