import type { Page } from '@playwright/test';
import { BasePage } from '@automation/referenced-automation-ui';

export class DashboardPage extends BasePage {
  private readonly welcome = this.page.locator('#welcome');
  private readonly anonymous = this.page.locator('#anonymous');

  constructor(page: Page) {
    super(page);
  }

  async isWelcomeShown(): Promise<boolean> {
    return this.isVisible(this.welcome);
  }

  async isAnonymousShown(): Promise<boolean> {
    return this.isVisible(this.anonymous);
  }
}
