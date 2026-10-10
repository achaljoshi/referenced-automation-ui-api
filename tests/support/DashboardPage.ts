import type { Page } from '@playwright/test';
import { actions, assertions, locators } from '@automation/referenced-automation-ui';

export interface DashboardPage {
  goto(url: string): Promise<void>;
  /** Waits (up to the expect timeout) for the welcome banner. For "it is NOT shown" use `expectNoWelcome()` - a snapshot read passes before the page has rendered. */
  isWelcomeShown(options?: { timeout?: number }): Promise<boolean>;
  isAnonymousShown(options?: { timeout?: number }): Promise<boolean>;
  /** Web-first assertions: they retry until the state is reached and fail with what the page showed. */
  expectWelcome(): Promise<void>;
  expectAnonymous(): Promise<void>;
  expectNoWelcome(): Promise<void>;
  expectNoAnonymous(): Promise<void>;
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

    expectWelcome: () => assertions.toBeVisible(welcome),
    expectAnonymous: () => assertions.toBeVisible(anonymous),
    expectNoWelcome: () => assertions.not.toBeVisible(welcome),
    expectNoAnonymous: () => assertions.not.toBeVisible(anonymous),
  };
}
