import { test, expect } from '@playwright/test';

test.describe('End-to-End Patient Screening Lifecycle', () => {
  test('Complete registration, photo upload, and results display', async ({ page }) => {
    // 1. Visit Login and Navigate to Register
    await page.goto('/login');
    await page.click('text=/Register here/i');

    const testUser = `pat_${Date.now()}`;
    await page.fill('#reg-username', testUser);
    await page.fill('#reg-email', `${testUser}@gmail.com`);
    await page.fill('#reg-password', 'securePass123');
    await page.fill('#reg-confirm-password', 'securePass123');
    await page.fill('#reg-age', '28');
    await page.selectOption('#reg-gender', 'Male');
    await page.selectOption('#reg-region', 'Islamabad');
    await page.click('button[type="submit"]');

    // 2. Land on Dashboard
    await expect(page).toHaveURL(/.*dashboard/);

    // 3. Start Screening
    await page.click('button:has-text("Start New Screening")');
    await expect(page).toHaveURL(/.*screening/);

    // 4. Upload valid synthetic test image (Buffer)
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAUAAAAFACAYAAADC/FlJAAABhGlDQ1BJQ0MgcHJvZmlsZQAAKJF9kT1Iw0AcxV9TpUUVBzsUpIihOtkiiuIoVahCEWqFVh1MLv2CJg1JicvgOGgcLHYWVx1cXHV1cBUEwQcQEyc3RRcp8X9JoUWMB8f9eHfvcfcOEBoVplpd44CqWUY6mRCz2VWx/4oAQhBDACMzy5iTpFQUv+vrHgG+38V4lv/cv6evWLAZERGYSZphm8QbxjObts55nzjKypJCfE48YdAFiR+5Lrv8xrngsM8zI0YqPU8cJRYLbaS3MSsZKvE0cVRRNcr3Zl1WuLcytSo11vonf2GwoK2scZ3mCFJYwBJkSJCBBVWUYCFKq0aKiTTtxzz8I44/SS6ZXBUwcsyjChWS4wf/g9+zNfPTE25SMAJ0vjjOxwgQ2AUaNcf5PnKcxgkQeAautJZ/pQHMfpLda2nRI6B/G7i4bmnKHnC5Aww+6ZIhOZIvTSCXg/fT+iaL4L8F6F5z59b6OH0AMjSr5A1wcAgMFyj7vse7u9r79m9Pvf8A/a5yqL3k8bIAAAAJcEhZcwAAFiUAABYlAUlSJPAAAAB0ZldYSWZkYXRlOmNyZWF0ZQAyMDI2LTEwLTAxVDE4OjEwOjAwKzAwOjAwT+K7cwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMC0wMVQxODoxMDowMCswMDowMOu/xN8AAAAASUVORK5CYII=',
      'base64'
    );
    await page.setInputFiles('input[type="file"]', {
      name: 'test_skin.png',
      mimeType: 'image/png',
      buffer,
    });

    await page.click('button:has-text("Next")');

    // 5. Voice Step: Skip
    await page.click('button:has-text("Skip this step")');

    // 6. Verification on Results Page
    await expect(page).toHaveURL(/.*results/);
    await expect(page.locator('text=/Screening Results/i')).toBeVisible();
    await expect(page.locator('text=/Most Likely Condition/i')).toBeVisible();
  });
});
