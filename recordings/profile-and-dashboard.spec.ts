import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/profile.html');
  await expect(page.locator('#profile-name')).toHaveText('Ada Lovelace');
  await page.goto('http://127.0.0.1:3000/dashboard.html');
  await expect(page.getByText('Please log in')).toBeVisible();
  await expect(page.getByText('Welcome back!')).toBeHidden();
  await page.waitForTimeout(1000);
});
