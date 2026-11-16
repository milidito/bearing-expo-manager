# Bearing Expo Manager

Offline-first iPhone app (PWA) for the **China International Bearing Exhibition, Shanghai (9–12 Dec 2026)**: capture each exhibitor in about a minute — business card, booth and product photos, the bearing types they supply, your star rating and notes, contacts (WeChat, WhatsApp, phone, email, website), hall/booth, and the factory address — and build a **factory visit list** for after the show.

**Live app:** https://milidito.github.io/bearing-expo-manager/ (auto-deployed from `main` by GitHub Actions)

Built from the same codebase as [Yiwu Supplier Manager](https://github.com/milidito/yiwu-supplier-manager); it is a separate app with its own icon, its own on-phone database and its own backups, and it uses the **same Supabase project and account** (separate `expo_*` tables and a separate private `expo-photos` bucket).

## Features
- Company ID `BE-001…` (never reused), auto-save, partial records, hall prefilled from the previous booth, **Save & next**.
- 🪪 **Business card** section (front/back) and 🏪 **Booth & products** section (booth, product, catalogue) — one-tap camera buttons + gallery import.
- **Bearing types** (multi-select): Tapered Roller, Spherical, NU/NJ, 6000, Forklift, 5000, Other (+ free text).
- ⭐ 1–5 rating and notes on the main form.
- 🏭 **Factory**: address, city/province, Open in Apple Maps (works in mainland China), copy address, **Add to my factory visit list**, planned visit date, **Visited** tick.
- **Factory visits** screen grouped by city (To visit / Visited / All). **Halls** screen (by hall, sorted by booth).
- Search across company, brand, contacts, bearing types, hall/booth, factory city, notes, products; filters for bearing type, hall, status, type, “factory to visit”.
- Products & quotes, price comparison (same currency + unit only).
- Same safety net as the Yiwu app: cloud sync, daily cloud snapshots, Trash, backup .zip (iCloud Drive), Excel with photos in each company's row, Save to Photos with burned-in ID labels, new-phone restore by Sign in.

## View-only sharing
Settings → **View-only access**: give another account read-only access. The server only returns company, brand, bearing types, hall/booth, photos, contacts, rating and notes (never prices/products, main-products text, factory address/visit list, status or backups) through `expo_shared_companies()` / `expo_shared_photos()`; viewer accounts cannot write anywhere (all write policies exclude them, including the Yiwu tables). The viewer's app switches to a view-only mode: online only (nothing stored on the phone), no add/edit/delete/backup/export/Save to Photos, no text selection/copy, photos drawn on canvas with the viewer's email as watermark. Screenshots cannot be blocked on iPhone; the watermark makes leaks traceable. Remove access any time (instant).

To add someone: Supabase → Authentication → Users → Add user (Auto Confirm) → then enter the email in the app.

## Cloud setup (once)
Run `supabase/schema-expo.sql` in the existing Supabase project (SQL Editor → New query → Run; choose “Run and enable RLS” if asked). It adds the `expo_*` tables, the view-only sharing table/functions, RLS policies and the `expo-photos` bucket. Yiwu data is not touched (its write policies get an extra rule that blocks view-only accounts). If you ever re-run the Yiwu `schema.sql`, run `schema-expo.sql` again afterwards. Sign in in the app with the same account as the Yiwu app.

## Develop / test
```bash
npm install
npm run dev
npm test                         # unit
CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
POSTGREST_BIN=/path/to/postgrest RUN_E2E=1 npm run test:integration   # real Postgres + PostgREST + RLS
```
See `docs/` for the shared architecture notes (cloud setup, deploy, testing) inherited from the Yiwu app.
