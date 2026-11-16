import { execSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * UI + cloud sync end-to-end against the local Supabase stand-in.
 * Runs only from tests/integration/run.sh with RUN_E2E=1 (needs the gateway on :54321).
 */
test.skip(!process.env.YSM_CLOUD_E2E, 'needs local backend (tests/integration/run.sh)');

const sql = (q: string) => execSync(`su postgres -c "psql -d ${process.env.YSM_DB} -Atc \\"${q}\\""`).toString().trim();

test('configure cloud, sign in, capture offline, auto-sync when back online', async ({ page, context }) => {
  await page.goto('./#/settings');
  await page.getByLabel('Project URL').fill('http://127.0.0.1:54321');
  await page.getByLabel('Anon / publishable key').fill('local-anon-key-not-a-secret-0000000000');
  await page.getByRole('button', { name: 'Test & save' }).click();
  await page.getByLabel('Email').fill('milad@example.com');
  await page.getByLabel('Password').fill('pass-milad-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'synced', { timeout: 15000 });

  // go offline and capture a supplier with a photo
  await context.setOffline(true);
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-card_front-input').setInputFiles(path.resolve('tests/fixtures/card.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await page.locator('[name="companyName"]').fill('Cloud Test Supplier');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toBeVisible();
  await expect(page.getByText('Saved on phone · upload pending')).toBeVisible();
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'offline');
  await page.screenshot({ path: 'test-results/screens/10-offline-pending.png' });
  expect(sql("select count(*) from expo_suppliers where company_name='Cloud Test Supplier'")).toBe('0');

  // back online -> uploads automatically (no button press)
  await context.setOffline(false);
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'synced', { timeout: 20000 });
  expect(sql("select code from expo_suppliers where company_name='Cloud Test Supplier'")).toMatch(/^BE-\d{3}$/);
  expect(sql("select count(*) from expo_photos p join expo_suppliers s on s.id=p.supplier_id where s.company_name='Cloud Test Supplier'")).toBe('1');
  await page.goto('./#/');
  await expect(page.getByTestId('sync-card')).toContainText('All changes are backed up');
  // the daily cloud snapshot was created after the successful sync
  await expect(page.getByText(/Last just now · older ones kept/)).toBeVisible({ timeout: 10000 });
  await page.goto('./#/settings');
  await expect(page.getByRole('button', { name: 'Restore' }).first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'test-results/screens/11-synced-dashboard.png', fullPage: true });
});

async function signIn(page: import('@playwright/test').Page, email: string, pw: string) {
  await page.goto('./#/settings');
  await page.getByLabel('Project URL').fill('http://127.0.0.1:54321');
  await page.getByLabel('Anon / publishable key').fill('local-anon-key-not-a-secret-0000000000');
  await page.getByRole('button', { name: 'Test & save' }).click();
  await page.getByLabel('Email').first().fill(email);
  await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('view-only access: viewer sees allowed fields only, watermarked photos, cannot change or copy anything', async ({ page, browser }) => {
  // ---- owner prepares data and shares it ----
  await signIn(page, 'milad@example.com', 'pass-milad-123');
  await expect(page.getByText('Signed in as')).toBeVisible();
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-booth-input').setInputFiles(path.resolve('tests/fixtures/shop.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await page.getByTestId('chip-Spherical').click();
  await page.getByRole('button', { name: '5 star' }).click();
  await page.locator('[name="notes"]').fill('Shared note: very good quality');
  await page.locator('[name="companyName"]').fill('Viewer Test Bearing Co');
  await page.locator('[name="wechatId"]').fill('vt_wechat');
  await page.locator('[name="hall"]').fill('N5');
  await page.locator('[name="booth"]').fill('C22');
  await page.locator('[name="factoryAddress"]').fill('TOP SECRET FACTORY ADDRESS');
  await page.getByRole('button', { name: '+ Product', exact: true }).click();
  await page.locator('[name="productName"]').fill('22210 CA');
  await page.locator('[name="price"]').fill('77.77');
  await page.getByTestId('product-save').click();
  await expect(page.getByTestId('detail-code')).toBeVisible();
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('sync-dot')).toHaveAttribute('data-state', 'synced', { timeout: 20000 });
  expect(sql("select count(*) from expo_photos p join expo_suppliers s on s.id=p.supplier_id where s.company_name='Viewer Test Bearing Co'")).toBe('1');

  await page.goto('./#/settings');
  await page.locator('[name="viewerEmail"]').fill('viewer@example.com');
  await page.locator('[name="viewerWatermark"]').fill('Mehrdad 09122381686');
  await page.getByTestId('add-viewer').click();
  await expect(page.getByTestId('viewer-entry')).toContainText('viewer@example.com');
  await expect(page.getByTestId('viewer-watermark')).toHaveText('Mehrdad 09122381686');

  // ---- viewer on another phone ----
  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await signIn(v, 'viewer@example.com', 'pass-viewer-123');
  await expect(v.getByTestId('viewer-badge')).toBeVisible({ timeout: 15000 });
  await expect(v.getByTestId('nav-add')).toHaveCount(0);
  const row = v.getByTestId('viewer-row').filter({ hasText: 'Viewer Test Bearing Co' });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(v.getByTestId('viewer-types')).toHaveText('Spherical');
  await expect(v.getByTestId('viewer-location')).toHaveText('Hall N5 · Booth C22');
  await expect(v.getByTestId('viewer-notes')).toHaveText('Shared note: very good quality');
  await expect(v.getByText('vt_wechat')).toBeVisible();
  const text = await v.evaluate(() => document.body.innerText);
  expect(text).not.toContain('TOP SECRET FACTORY ADDRESS');
  expect(text).not.toContain('77.77');
  expect(text).not.toContain('22210');
  // photo drawn on a canvas (no <img> to long-press-save), watermark painted
  await expect(v.locator('.v-photo.ok canvas')).toHaveCount(1, { timeout: 15000 });
  await expect(v.locator('.v-photo.ok canvas')).toHaveAttribute('data-mark', 'Mehrdad 09122381686');
  expect(await v.locator('img').count()).toBe(0);
  // no copy / select / export
  expect(await v.evaluate(() => getComputedStyle(document.body).userSelect || getComputedStyle(document.body).webkitUserSelect)).toBe('none');
  for (const label of ['Save now', 'Excel', 'Save to Photos', 'Download .zip', 'Restore']) await expect(v.getByRole('button', { name: label })).toHaveCount(0);
  // nothing stored on the viewer's phone
  const localRows = await v.evaluate(
    () =>
      new Promise<number>((res) => {
        const rq = indexedDB.open('bearing-expo-manager');
        rq.onsuccess = () => {
          const tx = rq.result.transaction(['suppliers', 'photoBlobs']);
          let n = 0;
          let done = 0;
          for (const t of ['suppliers', 'photoBlobs']) {
            const c = tx.objectStore(t).count();
            c.onsuccess = () => {
              n += c.result;
              if (++done === 2) res(n);
            };
          }
        };
      }),
  );
  expect(localRows).toBe(0);
  await v.screenshot({ path: 'test-results/screens/20-viewer-detail.png', fullPage: true });

  // the server refuses writes from the viewer account even if someone tries directly
  const write = await v.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('bem-sb-auth'))!;
    const token = JSON.parse(localStorage.getItem(key)!).access_token;
    const r = await fetch('http://127.0.0.1:54321/rest/v1/expo_suppliers', {
      method: 'POST',
      headers: { apikey: 'x', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), code: 'HACK', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    return r.status;
  });
  expect(write).toBeGreaterThanOrEqual(400);

  // ---- same email + password on ANOTHER phone: refused (account is locked to the first phone) ----
  await page.goto('./#/suppliers');
  await page.goto('./#/settings');
  await expect(page.getByTestId('viewer-lock')).toContainText('Locked to their phone');
  const ctx2 = await browser.newContext();
  const v2 = await ctx2.newPage();
  await signIn(v2, 'viewer@example.com', 'pass-viewer-123');
  await expect(v2.getByTestId('viewer-locked')).toBeVisible({ timeout: 15000 });
  await expect(v2.getByTestId('viewer-row')).toHaveCount(0);
  expect(await v2.evaluate(() => document.body.innerText)).not.toContain('Viewer Test Bearing Co');
  await v2.screenshot({ path: 'test-results/screens/21-viewer-locked.png', fullPage: true });
  // first phone: no Sign out button (signing out would lose the lock)
  await expect(v.getByTestId('viewer-signout')).toHaveCount(0);
  // owner unlocks -> the new phone takes over, the old one is locked out
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('viewer-unlock').click();
  await expect(page.getByTestId('viewer-lock')).toContainText('Not used yet');
  await v2.getByRole('button', { name: 'Try again' }).click();
  await expect(v2.getByTestId('viewer-row').filter({ hasText: 'Viewer Test Bearing Co' })).toHaveCount(1, { timeout: 15000 });
  await v.reload();
  await expect(v.getByTestId('viewer-locked')).toBeVisible({ timeout: 15000 });
  await ctx2.close();
  // hand the lock back to the first phone for the rest of the test
  await page.goto('./#/suppliers');
  await page.goto('./#/settings');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('viewer-unlock').click();
  await expect(page.getByTestId('viewer-lock')).toContainText('Not used yet');
  await v.reload();
  await expect(v.getByTestId('viewer-row').filter({ hasText: 'Viewer Test Bearing Co' })).toHaveCount(1, { timeout: 15000 });

  // online only: offline launch shows the notice, no data
  await v.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await v.reload();
  await ctx.setOffline(true);
  await v.reload();
  await expect(v.getByTestId('viewer-offline')).toBeVisible();
  await expect(v.getByTestId('viewer-row')).toHaveCount(0);
  await ctx.setOffline(false);

  // ---- owner removes access -> viewer sees nothing ----
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('viewer-entry').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('viewer-entry')).toHaveCount(0);
  await v.reload();
  await expect(v.getByTestId('viewer-row')).toHaveCount(0, { timeout: 15000 });
  await ctx.close();
});
