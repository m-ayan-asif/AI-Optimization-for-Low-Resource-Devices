import { test, expect } from '@playwright/test';
import { LESION_IMAGE, NON_LESION_IMAGE, signIn, startOnDeviceScreening } from './helpers.js';

// The phone path of the PWA: the skin model runs in the browser (ONNX Runtime Web) and results reach the server.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('the service worker is active and the page is cross-origin isolated', async ({ page }) => {
  await page.goto('/dashboard');
  const state = await page.evaluate(async () => ({
    sw: (await navigator.serviceWorker.ready).active?.scriptURL || null,
    isolated: self.crossOriginIsolated,
  }));
  expect(state.sw).toMatch(/\/sw\.js$/);
  expect(state.isolated).toBe(true);
});

test('a photo that is not a skin lesion is rejected on the device', async ({ page }) => {
  // Golden Gate at sunset: 93 % of its pixels pass the skin-colour check, so only the not-a-lesion output stops it.
  await startOnDeviceScreening(page, NON_LESION_IMAGE);
  await expect(page.getByRole('alert')).toContainText('does not look like a skin condition');
  await expect(page.getByText('Describe Your Symptoms')).toHaveCount(0);
});

test('a lesion photo is screened on the device and saved to the account', async ({ page }) => {
  test.skip(!LESION_IMAGE, 'no local lesion photo (set E2E_LESION_IMAGE)');
  await startOnDeviceScreening(page, LESION_IMAGE);
  await expect(page.getByText('Describe Your Symptoms')).toBeVisible();
  await page.locator('textarea').fill('mujhe khujli ho rahi hai');
  await page.getByRole('button', { name: /Run Analysis/ }).click();

  await page.waitForURL(/\/results\/\d+$/);
  await expect(page.getByText('Most Likely Condition')).toBeVisible();
  await expect(page.getByText('Analysed on this device')).toBeVisible();
  const heatmap = page.locator('img[alt="Grad-CAM Heatmap"]');
  await expect(heatmap).toBeVisible();
  expect(await heatmap.evaluate((img) => img.naturalWidth)).toBe(320);
});

test('screening works offline and uploads when the connection returns', async ({ page, context }) => {
  test.skip(!LESION_IMAGE, 'no local lesion photo (set E2E_LESION_IMAGE)');
  // A phone that screens offline has been online once: the service worker cached the app shell and ONNX Runtime,
  // and the first screening cached the skin model. Each Playwright test starts with an empty browser, so do that here.
  await page.goto('/dashboard');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const cache = await caches.open('skinsense-models-v1');
    const dir = '/models/skin-v5';
    await cache.addAll([`${dir}/meta.json`, `${dir}/student.onnx`]);
  });

  await context.setOffline(true);
  await startOnDeviceScreening(page, LESION_IMAGE);
  await expect(page.getByText('Describe Your Symptoms')).toBeVisible();
  await page.getByRole('button', { name: /Skip this step/ }).click();

  await page.waitForURL(/\/results\/local\/[0-9a-f-]+$/);
  const localUrl = page.url();
  await expect(page.getByText('Saved on this phone')).toBeVisible();
  await expect(page.getByText(/waiting to upload/)).toBeVisible();
  await expect(page.locator('img[alt="Grad-CAM Heatmap"]')).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/waiting to upload/)).toHaveCount(0, { timeout: 60_000 });

  // The local link now leads to the server copy of the same screening
  await page.goto(localUrl);
  await page.waitForURL(/\/results\/\d+$/);
  await expect(page.getByText('Analysed on this device')).toBeVisible();
});
