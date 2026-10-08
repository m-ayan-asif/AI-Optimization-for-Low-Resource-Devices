import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(REPO, 'e2e', 'fixtures');

// A dedicated test account (registration is limited to 3 per hour per IP, so it is created once and reused).
export const TEST_USER = {
  username: process.env.E2E_USERNAME || 'e2e_patient',
  password: process.env.E2E_PASSWORD || 'e2e-test-password',
  email: process.env.E2E_EMAIL || 'e2e_patient@example.com',
  age: 30,
  gender: 'male',
  region: 'Punjab',
  role: 'patient',
};

function firstFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((n) => /\.(jpe?g|png)$/i.test(n)).sort()[0];
  return f ? path.join(dir, f) : null;
}

// Real lesion photos are not in git (dataset licences). Point E2E_LESION_IMAGE at one, or keep the local
// inference/test_images/positive/ set; tests that need one are skipped otherwise.
export const LESION_IMAGE =
  process.env.E2E_LESION_IMAGE || firstFile(path.join(REPO, 'inference', 'test_images', 'positive', 'Vitiligo'));
export const NON_LESION_IMAGE = path.join(FIXTURES, 'non_lesion_photo.jpg');
export const URDU_AUDIO =
  process.env.E2E_AUDIO || path.join(REPO, 'data', 'raw', 'asr', 'symptoms_tts', 'clean', 's00.wav');

/** Logs the test account in through the API (registering it the first time) and seeds the app's session. */
export async function signIn(page) {
  await page.goto('/login');
  const result = await page.evaluate(async (user) => {
    const post = (url, body) =>
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let res = await post('/api/auth/login', { username: user.username, password: user.password });
    if (res.status === 401 || res.status === 404) res = await post('/api/auth/register', user);
    const body = await res.json();
    if (!body.token) return { error: `${res.status} ${JSON.stringify(body)}` };
    sessionStorage.setItem('ss_token', body.token);
    sessionStorage.setItem('ss_user', JSON.stringify(body.user));
    return { ok: true };
  }, TEST_USER);
  if (result.error) throw new Error(`Could not sign in the e2e account: ${result.error}`);
}

/** Opens the screening page with on-device processing selected and the photo chosen. */
export async function startOnDeviceScreening(page, imagePath) {
  await page.goto('/screening');
  await page.getByRole('button', { name: /This phone/ }).click();
  await page.locator('input[type=file]').setInputFiles(imagePath);
  await page.getByRole('button', { name: /^Next/ }).click();
}
