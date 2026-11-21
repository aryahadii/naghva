import { expect, test } from '@playwright/test';

test('following a release and switching languages preserve the map view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/en/star-map/?artist=Qn8jqk8');
  await page.getByRole('button', { name: 'Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Next stars' }).click();
  const address = page.url();
  const firstTitle = await page.locator('a.satellite').first().innerText();

  await page.locator('a.satellite').first().click();
  await expect(page.getByRole('dialog', { name: /.+/ }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(page.locator('a.satellite').first()).toHaveText(firstTitle);
  await page.locator('a.language').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveURL(address.replace('/en/', '/fa/'));
  await expect(page.locator('.atlas-modes [aria-pressed=true]')).toHaveText('آثار');
});
