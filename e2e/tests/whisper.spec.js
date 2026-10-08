import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { LESION_IMAGE, URDU_AUDIO, signIn, startOnDeviceScreening } from './helpers.js';

// Our Urdu Whisper running in the browser, fed through the app's real recorder: Chromium plays a WAV file as the
// microphone. Slow (downloads the 330 MB model on a cold cache), so it is tagged @slow and excluded from `npm test`.
test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${URDU_AUDIO}`],
  },
});

test('a voice note is transcribed on the device @slow', async ({ page }) => {
  test.skip(!LESION_IMAGE || !fs.existsSync(URDU_AUDIO), 'needs a local lesion photo and E2E_AUDIO (Urdu WAV)');
  test.setTimeout(600_000);
  await signIn(page);
  await startOnDeviceScreening(page, LESION_IMAGE);
  await expect(page.getByText('Describe Your Symptoms')).toBeVisible();

  await page.getByRole('button', { name: /Start Recording/ }).click();
  await page.waitForTimeout(6000);
  await page.getByRole('button', { name: /Stop Recording/ }).click();
  await expect(page.getByText(/Recording captured/)).toBeVisible();
  await page.getByRole('button', { name: /Run Analysis/ }).click();

  await page.waitForURL(/\/results\/\d+$/, { timeout: 540_000 });
  const transcript = page.locator('section', { hasText: 'Extracted Symptoms' }).locator('p.inset');
  await expect(transcript).toBeVisible();
  await expect(transcript).toHaveText(/[؀-ۿ]{3,}/); // Urdu script came back from the on-device model
});
