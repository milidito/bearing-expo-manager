import { expect, type Page, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.resolve('tests/fixtures', n);
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function fresh(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('dash-add')).toBeVisible();
}
async function fillField(page: Page, name: string, value: string) {
  await page.locator(`[name="${name}"]`).fill(value);
}

test('expo capture: card + booth photos, bearing types, rating, factory visit list, search, halls', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('nav-add').click();
  await expect(page.getByTestId('supplier-code')).toContainText('BE-001');

  // two photo sections
  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await page.getByTestId('capture-card_back-input').setInputFiles(fx('card.jpg'));
  await page.getByTestId('capture-booth-input').setInputFiles(fx('shop.jpg'));
  await page.getByTestId('capture-product-input').setInputFiles(fx('product.jpg'));
  await expect(page.getByTestId('photo-thumb')).toHaveCount(4);

  // bearing types (multi-select) + Other text
  await page.getByTestId('chip-Tapered Roller').click();
  await page.getByTestId('chip-6000').click();
  await page.getByTestId('chip-Other').click();
  await expect(page.getByTestId('chip-Tapered Roller')).toHaveAttribute('aria-pressed', 'true');
  await fillField(page, 'bearingTypesOther', 'slewing rings');

  // rating + note
  await page.getByRole('button', { name: '4 star' }).click();
  await fillField(page, 'notes', 'Good finishing, IATF 16949, OEM for forklift makers');

  // company & contact
  await fillField(page, 'companyName', 'Liaocheng Huayi Bearing Co.');
  await fillField(page, 'brand', 'HYB');
  await fillField(page, 'contactPerson', 'Kevin Zhang');
  await fillField(page, 'wechatId', 'kevin_hyb');
  await fillField(page, 'whatsapp', '+86 138 0635 2211');
  await fillField(page, 'hall', 'N3');
  await fillField(page, 'booth', 'A101');

  // factory + visit list
  await fillField(page, 'factoryAddress', 'No. 18 Industrial Rd, Linqing');
  await fillField(page, 'factoryCity', 'Liaocheng, Shandong');
  await page.getByTestId('to-visit').locator('input').check();
  await fillField(page, 'visitDate', '2026-12-15');
  await page.waitForTimeout(700);
  await shot(page, '01-expo-capture');
  await page.getByTestId('done').click();

  await expect(page.getByTestId('detail-code')).toHaveText('BE-001');
  await expect(page.getByTestId('detail-types')).toHaveText('Tapered Roller, 6000, Other: slewing rings');
  await expect(page.getByTestId('detail-location')).toHaveText('Hall N3 · Booth A101');
  await expect(page.getByTestId('detail-factory')).toContainText('Linqing');
  await expect(page.getByTestId('detail-to-visit')).toBeChecked();
  await expect(page.getByRole('link', { name: 'Open in Maps' })).toHaveAttribute('href', /maps\.apple\.com\/\?q=/);
  await shot(page, '02-expo-detail');

  // second company: hall prefilled, not on visit list
  await page.getByTestId('nav-add').click();
  await expect(page.getByTestId('supplier-code')).toContainText('BE-002');
  await expect(page.locator('[name="hall"]')).toHaveValue('N3');
  await page.getByTestId('chip-Spherical').click();
  await fillField(page, 'companyName', 'Wafangdian Star Bearing');
  await fillField(page, 'booth', 'A120');
  await page.getByTestId('save-next').click();
  await expect(page.getByTestId('supplier-code')).toContainText('BE-003');
  await page.getByTestId('chip-Forklift').click();
  await fillField(page, 'companyName', 'Forklift Parts Ltd');
  await fillField(page, 'hall', 'E2');
  await fillField(page, 'booth', '2B05');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toHaveText('BE-003');

  // search across bearing types, hall, city, WhatsApp
  await page.goto('./#/suppliers');
  const search = page.getByTestId('supplier-search');
  for (const [q, n] of [
    ['tapered', 1],
    ['spherical', 1],
    ['forklift', 2], // type chip on BE-003 + "forklift" in BE-001 notes
    ['n3', 2],
    ['liaocheng', 1],
    ['13806352211', 1],
    ['BE-002', 1],
  ] as const) {
    await search.fill(q);
    await expect(page.getByTestId('supplier-row'), `search "${q}"`).toHaveCount(n);
  }
  await search.fill('');
  await page.getByRole('button', { name: /Filters/ }).click();
  await page.getByTestId('filter-btype').selectOption('Spherical');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await expect(page.getByTestId('supplier-row')).toContainText('Wafangdian');
  await shot(page, '03-expo-list');

  // factory visit list
  await page.goto('./#/visits');
  await expect(page.getByTestId('visit-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /Liaocheng, Shandong/ })).toBeVisible();
  await shot(page, '04-expo-visits');
  await page.getByTestId('visit-row').getByLabel('Visited').click(); // row moves to the Visited tab immediately
  await expect(page.getByTestId('visit-row')).toHaveCount(0); // moved to "Visited"
  await page.getByRole('button', { name: /Visited \(1\)/ }).click();
  await expect(page.getByTestId('visit-row')).toHaveCount(1);

  // halls
  await page.goto('./#/locations');
  await expect(page.getByRole('heading', { name: 'Hall N3' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hall E2' })).toBeVisible();

  // dashboard
  await page.goto('./#/');
  await expect(page.getByTestId('stat-total')).toHaveText('3');
  await expect(page.getByTestId('stat-visits')).toHaveText('0');
  await shot(page, '05-expo-dashboard');
  await page.reload();
  await expect(page.getByTestId('stat-total')).toHaveText('3');
});

test('works fully offline after first visit', async ({ page, context }) => {
  await fresh(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-bar')).toBeVisible();
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await expect(page.getByTestId('save-state')).toContainText('Saved on this phone');
  await page.getByTestId('chip-NU/NJ').click();
  await fillField(page, 'companyName', 'Offline Bearing Ltd');
  await page.getByTestId('done').click();
  await expect(page.getByTestId('detail-code')).toHaveText('BE-001');

  await page.goto('./#/settings');
  const [xl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-excel').click()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync((await xl.path())!) as never);
  expect(wb.getWorksheet('Companies')!.getRow(2).getCell(2).value).toBe('Offline Bearing Ltd');

  await page.goto('about:blank');
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
  await context.setOffline(false);
});

test('backup zip, restore on a new phone, trash, save to Photos, Excel with photos per row', async ({ page, browser }) => {
  await fresh(page);
  await page.getByTestId('nav-add').click();
  await page.getByTestId('capture-booth-input').setInputFiles(fx('shop.jpg'));
  await expect(page.getByTestId('toast-action')).toHaveText('Save to Photos');
  await page.getByTestId('toast-action').click();
  const [dlp] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-sheet-go').click()]);
  const pz = await JSZip.loadAsync(readFileSync((await dlp.path())!));
  expect(Object.keys(pz.files)).toEqual(['BE-001_booth_1.jpg']);

  await page.getByTestId('capture-card_front-input').setInputFiles(fx('card.jpg'));
  await page.getByTestId('chip-5000').click();
  await fillField(page, 'companyName', '人本轴承 C&U');
  await fillField(page, 'factoryCity', 'Wenzhou');
  await page.getByTestId('to-visit').locator('input').check();
  await page.getByRole('button', { name: '+ Product', exact: true }).click();
  await fillField(page, 'productName', '6204-2RS');
  await fillField(page, 'price', '1.85');
  await fillField(page, 'moq', '10000');
  await page.getByTestId('product-save').click();
  await expect(page.getByTestId('detail-code')).toHaveText('BE-001');

  // Excel: one row, all photos in that row
  await page.goto('./#/');
  const [x] = await Promise.all([page.waitForEvent('download'), page.getByTestId('safety-excel').click()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync((await x.path())!) as never);
  const ws = wb.getWorksheet('Companies')!;
  const headers = (ws.getRow(1).values as string[]).slice(1);
  expect(ws.getRow(2).getCell(headers.indexOf('Bearing types') + 1).value).toBe('5000');
  expect(ws.getRow(2).getCell(headers.indexOf('Visit factory?') + 1).value).toBe('yes');
  expect(ws.getImages().map((i) => Math.floor(i.range.tl.nativeRow))).toEqual([1, 1]);

  // zip backup + restore on a fresh browser
  await page.goto('./#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const file = (await dl.path())!;
  const zip = await JSZip.loadAsync(readFileSync(file));
  expect(Object.keys(zip.files)).toContain('photos/BE-001/BE-001_booth_1.jpg');
  const csv = await zip.file('suppliers.csv')!.async('string');
  expect(csv).toContain('人本轴承 C&U');
  expect(csv).toContain('Bearing types');

  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('./#/settings');
  const dialog = p2.waitForEvent('dialog');
  await p2.getByTestId('import-input').setInputFiles(file);
  await (await dialog).accept();
  await p2.goto('./#/visits');
  await expect(p2.getByTestId('visit-row')).toHaveCount(1);
  await expect(p2.getByTestId('visit-row')).toContainText('人本轴承');
  await ctx2.close();

  // trash + restore
  await page.goto('./#/suppliers');
  await page.getByTestId('supplier-row').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Move company to Trash' }).click();
  await expect(page).toHaveURL(/#\/suppliers$/);
  await expect(page.getByText('No companies yet')).toBeVisible();
  await page.goto('./#/trash');
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.goto('./#/suppliers');
  await expect(page.getByTestId('supplier-row')).toHaveCount(1);
});

test('rejects a Yiwu backup with a clear message', async ({ page }) => {
  await fresh(page);
  const zip = new JSZip();
  zip.file('data.json', JSON.stringify({ app: 'yiwu-supplier-manager', suppliers: [], products: [], quotations: [], photos: [] }));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  await page.goto('./#/settings');
  const dialog = page.waitForEvent('dialog');
  await page.getByTestId('import-input').setInputFiles({ name: 'yiwu.zip', mimeType: 'application/zip', buffer: buf });
  const d = await dialog;
  expect(d.message()).toContain('Yiwu Supplier Manager backup');
  await d.accept();
});
