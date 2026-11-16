import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { AppDB } from '../../src/db';
import { exportExcel } from '../../src/excel';
import * as repo from '../../src/repo';

const jpg = (n: string) => new Blob([readFileSync(`tests/fixtures/${n}.jpg`)], { type: 'image/jpeg' });
const img = (n: string) => ({ full: jpg(n), thumb: jpg(n), width: 3000, height: 2000, mime: 'image/jpeg' });

describe('Excel export', () => {
  it('one row per supplier, all fields as columns, photos embedded in that row', async () => {
    const d = new AppDB(`xl-${Math.random()}`);
    const a = await repo.createSupplier({ companyName: '瓦房店 Huayi Bearing', wechatId: 'huayi88', whatsapp: '+86 138', hall: 'N3', booth: 'A101', bearingTypes: ['Tapered Roller', 'Other'], bearingTypesOther: 'slewing', factoryAddress: 'No. 1 Road', factoryCity: 'Dalian', toVisit: 1, notes: 'good, "fast"\nline2', rating: 4 }, d);
    const b = await repo.createSupplier({ companyName: 'No photos Ltd' }, d);
    const c = await repo.createSupplier({ companyName: 'Third' }, d);
    const p = await repo.createProduct({ supplierId: a.id, name: 'Silicone case' }, d);
    await repo.createQuotation({ supplierId: a.id, productId: p.id, price: 6.5, currency: 'CNY', unit: 'piece', moq: 500 }, d);
    await repo.addPhoto({ supplierId: a.id, kind: 'product', productId: p.id, file: jpg('product') }, d, img('product'));
    await repo.addPhoto({ supplierId: a.id, kind: 'card_front', file: jpg('card') }, d, img('card'));
    await repo.addPhoto({ supplierId: a.id, kind: 'booth', file: jpg('shop') }, d, img('shop'));
    await repo.addPhoto({ supplierId: c.id, kind: 'booth', file: jpg('shop') }, d, img('shop'));
    await repo.deleteSupplier(b.id, d); // deleted suppliers are not exported

    const res = await exportExcel(d);
    expect(res.counts.images).toBe(5); // 4 in Suppliers + 1 product photo in Products & prices
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.blob.arrayBuffer());
    const ws = wb.getWorksheet('Companies')!;
    const headers = (ws.getRow(1).values as string[]).slice(1);
    expect(headers.slice(0, 6)).toEqual(['Supplier ID', 'Company', 'Brand', 'Bearing types', 'My rating (1-5)', 'Contact person']);
    expect(headers).toEqual(expect.arrayContaining(['WeChat ID', 'WhatsApp', 'Hall', 'Booth', 'Factory address', 'Factory city', 'Visit factory?', 'Visited']));
    expect(headers).toContain('Products & latest prices');
    expect(headers.filter((h) => h.startsWith('Photo '))).toEqual(['Photo 1', 'Photo 2', 'Photo 3']);
    expect(ws.actualRowCount).toBe(3); // header + 2 suppliers
    const r2 = ws.getRow(2);
    const col = (h: string) => headers.indexOf(h) + 1;
    expect(r2.getCell(1).value).toBe('BE-001');
    expect(r2.getCell(2).value).toBe('瓦房店 Huayi Bearing');
    expect(r2.getCell(col('Bearing types')).value).toBe('Tapered Roller, Other: slewing');
    expect(r2.getCell(col('My rating (1-5)')).value).toBe(4);
    expect(r2.getCell(col('Booth')).value).toBe('A101');
    expect(r2.getCell(col('Factory city')).value).toBe('Dalian');
    expect(r2.getCell(col('Visit factory?')).value).toBe('yes');
    expect(String(r2.getCell(col('Notes')).value)).toContain('"fast"');
    expect(String(r2.getCell(col('Products & latest prices')).value)).toContain('Silicone case: 6.5 CNY/piece, MOQ 500');
    expect(ws.getRow(3).getCell(1).value).toBe('BE-003');
    const firstPhotoCol = headers.indexOf('Photo 1') + 1;
    // photos ordered card -> booth -> product, labels in the cells
    expect(r2.getCell(firstPhotoCol).value).toBe('Card front');
    expect(r2.getCell(firstPhotoCol + 1).value).toBe('Booth');
    expect(r2.getCell(firstPhotoCol + 2).value).toBe('Product · Silicone case');
    // images anchored in the right rows (0-based) and photo columns
    const imgs = ws.getImages().map((i) => ({ row: Math.floor(i.range.tl.nativeRow), col: Math.floor(i.range.tl.nativeCol) }));
    expect(imgs.filter((i) => i.row === 1)).toHaveLength(3);
    expect(imgs.filter((i) => i.row === 2)).toHaveLength(1);
    expect(imgs.every((i) => i.col >= firstPhotoCol - 1)).toBe(true);

    const wq = wb.getWorksheet('Products & prices')!;
    expect(wq.getRow(2).getCell(6).value).toBe(6.5);
    expect(wq.getImages()).toHaveLength(1);
    expect(wb.getWorksheet('About')).toBeTruthy();
  });
});
