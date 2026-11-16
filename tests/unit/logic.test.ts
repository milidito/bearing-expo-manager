import { describe, expect, it } from 'vitest';
import type { Product, Quotation, Supplier } from '../../src/db';
import { bearingTypesLine, fmtDate, groupForComparison, locationLine, mapsLink, isIncomplete, latestQuotes, matchesQuery, supplierHaystack, toCny } from '../../src/logic';
import { blankSupplier } from '../../src/repo';
import { toCsv } from '../../src/backup';

const base = { createdAt: '', updatedAt: '', deleted: 0 as const, dirty: 0 as const };
const sup = (o: Partial<Supplier>): Supplier => ({ ...blankSupplier(), ...base, id: 's' + Math.random(), code: 'BE-001', ...o });
const quote = (o: Partial<Quotation>): Quotation => ({ ...base, id: 'q' + Math.random(), productId: 'p1', supplierId: 's1', price: 1, currency: 'CNY', unit: 'piece', moq: null, tierQty: null, quoteDate: '2026-12-01', notes: '', ...o });

describe('search', () => {
  const s = sup({ code: 'BE-014', companyName: 'Liaocheng Huayi Bearing', brand: 'HYB', wechatId: 'huayi_88', whatsapp: '+86 138-0579-1234', hall: 'N3', booth: 'A101', bearingTypes: ['Tapered Roller', 'Spherical'], factoryCity: 'Liaocheng, Shandong' });
  const h = supplierHaystack(s, '30205 taper');
  it.each([
    ['huayi', true],
    ['HUAYI_88', true],
    ['13805791234', true],
    ['be-014', true],
    ['be014', true],
    ['tapered', true],
    ['spherical', true],
    ['forklift', false],
    ['n3', true],
    ['a101', true],
    ['liaocheng', true],
    ['hyb', true],
    ['30205', true],
    ['huayi forklift', false],
  ])('"%s" -> %s', (q, ok) => expect(matchesQuery(h, q)).toBe(ok));

  it('flags incomplete records', () => {
    expect(isIncomplete(sup({}))).toBe(true);
    expect(isIncomplete(sup({ companyName: 'A', wechatId: 'w' }))).toBe(true); // no bearing type yet
    expect(isIncomplete(sup({ companyName: 'A', whatsapp: '+86 1', bearingTypes: ['6000'] }))).toBe(false);
  });

  it('formats bearing types, location and maps link', () => {
    expect(bearingTypesLine(sup({ bearingTypes: ['6000', 'Other'], bearingTypesOther: 'slewing' }))).toBe('6000, Other: slewing');
    expect(locationLine(sup({ hall: 'N3', booth: 'A101' }))).toBe('Hall N3 · Booth A101');
    expect(locationLine(sup({ hall: 'Hall 2', booth: '' }))).toBe('Hall 2');
    expect(mapsLink('瓦房店 1号', 'Dalian')).toBe('https://maps.apple.com/?q=%E7%93%A6%E6%88%BF%E5%BA%97%201%E5%8F%B7%2C%20Dalian');
  });
});

describe('comparison', () => {
  it('never ranks different currencies or units together', () => {
    const p = { ...base, id: 'p1', supplierId: 's1', name: 'x', category: '', notes: '' } as Product;
    const s = sup({});
    const rows = [
      quote({ price: 5, currency: 'CNY', unit: 'piece' }),
      quote({ price: 4, currency: 'CNY', unit: 'piece' }),
      quote({ price: 0.8, currency: 'USD', unit: 'piece' }),
      quote({ price: 200, currency: 'CNY', unit: 'carton' }),
    ].map((q) => ({ quote: q, product: p, supplier: s }));
    const g = groupForComparison(rows);
    expect(g.map((x) => x.key)).toEqual(['CNY|piece', 'USD|piece', 'CNY|carton']);
    expect(g[0].rows.map((r) => r.quote.price)).toEqual([4, 5]);
  });
  it('keeps all tiers of the latest quote date', () => {
    const qs = [quote({ quoteDate: '2026-12-01', price: 5 }), quote({ quoteDate: '2026-12-03', price: 4.5, tierQty: 500 }), quote({ quoteDate: '2026-12-03', price: 4, tierQty: 1000 })];
    expect(latestQuotes(qs).map((q) => q.price)).toEqual([4.5, 4]);
  });
  it('converts with user rates only', () => {
    expect(toCny(2, 'USD', { USD: 7.1 })).toBeCloseTo(14.2);
    expect(toCny(2, 'USD', { USD: null })).toBeNull();
    expect(toCny(2, 'CNY', {})).toBe(2);
  });
});

describe('csv', () => {
  it('escapes and adds BOM', () => {
    const c = toCsv(['a', 'b'], [['x,y', 'say "hi"'], [null, 3]]);
    expect(c).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n,3\r\n');
  });
});

describe('dates', () => {
  it('shows calendar dates without timezone shift', () => {
    process.env.TZ = 'America/Toronto';
    expect(fmtDate('2026-11-12')).toContain('12');
  });
});
