import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BEARING_TYPES, BOOTH_KINDS, CARD_KINDS, HALL_SUGGESTIONS, STATUS_LABELS, type Supplier, type SupplierStatus, type SupplierType, TYPE_LABELS, db } from '../db';
import { blankSupplier, changeSupplierCode, createSupplier, lastLocation, nextSupplierCode, updateSupplier } from '../repo';
import { navigate } from '../router';
import { Chips, DataList, Field, Header, MultiChips, Section, Select, Stars, TextArea, toast } from '../ui/components';
import { useSuppliers } from '../ui/hooks';
import { PhotoStrip, QuickCapture, usePhotos } from '../ui/photos';

type Form = ReturnType<typeof blankSupplier>;

const KEY_FIELDS: (keyof Form)[] = ['companyName', 'brand', 'contactPerson', 'wechatId', 'whatsapp', 'phone', 'email', 'website', 'hall', 'booth', 'category', 'notes', 'followUpNote', 'locationNotes', 'bearingTypesOther', 'factoryAddress', 'factoryCity'];

/**
 * Fast capture + edit screen.
 * - Auto-saves to the phone ~0.5 s after typing stops (no "Save" needed, nothing is lost).
 * - A record is only created once you type something or take a photo.
 * - The hall is prefilled from the previous company (you usually walk one hall at a time).
 */
export function SupplierEditor({ id: initialId, isNew }: { id?: string; isNew: boolean }) {
  const [id, setId] = useState<string | undefined>(initialId);
  const [form, setForm] = useState<Form | null>(null);
  const [code, setCode] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [showMore, setShowMore] = useState(false);
  const formRef = useRef<Form | null>(null);
  const idRef = useRef<string | undefined>(initialId);
  const dirtyRef = useRef(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppliers = useSuppliers() ?? [];
  const photos = usePhotos(id) ?? [];

  // load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialId) {
        const s = await db.suppliers.get(initialId);
        if (!s || cancelled) return;
        const { id: _i, code: c, createdAt, updatedAt, deleted, dirty, baseUpdatedAt, syncedAt, ...rest } = s;
        const full = { ...blankSupplier(), ...rest };
        formRef.current = full;
        setForm(full);
        setCode(c);
      } else {
        const f = blankSupplier();
        const last = await lastLocation();
        if (last?.hall) {
          f.hall = last.hall;
          setPrefilled(true);
        }
        const c = await nextSupplierCode();
        if (cancelled) return;
        formRef.current = f;
        setForm(f);
        setCode(c);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const hasContent = (f: Form) =>
    KEY_FIELDS.some((k) => k !== 'hall' && String(f[k] ?? '').trim() !== '') || f.rating !== null || !!f.followUpDate || f.bearingTypes.length > 0 || !!f.toVisit;

  /** Persist pending edits. With `force`, creates the record even if it is still empty (e.g. before adding a photo). */
  const flush = useCallback((force = false): Promise<string | undefined> => {
    const run = async () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const f = formRef.current;
      if (!f) return idRef.current;
      if (!idRef.current) {
        if (!force && !hasContent(f)) return undefined;
        setSaveState('saving');
        const rec = await createSupplier(f);
        idRef.current = rec.id;
        void navigator.storage?.persist?.().catch(() => undefined);
        setId(rec.id);
        setCode(rec.code);
        // If more edits arrived while creating, save them too.
        if (formRef.current !== f) await updateSupplier(rec.id, formRef.current!);
        dirtyRef.current = false;
        setSaveState('saved');
        return rec.id;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setSaveState('saving');
        await updateSupplier(idRef.current, f);
        setSaveState('saved');
      }
      return idRef.current;
    };
    const p = chain.current.then(run, run);
    chain.current = p;
    return p;
  }, []);

  // flush on unmount / page hide
  useEffect(() => {
    const onHide = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      void flush();
    };
  }, [flush]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    if (!formRef.current) return;
    const next = { ...formRef.current, [k]: v };
    formRef.current = next;
    setForm(next);
    dirtyRef.current = true;
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  };

  const ensureId = async () => (await flush(true))!;

  const categories = suppliers.map((s) => s.category);
  const halls = [...HALL_SUGGESTIONS, ...suppliers.map((s) => s.hall)];
  const cities = suppliers.map((s) => s.factoryCity);

  if (!form) return <Header title="Loading…" backTo="/" />;

  const savedLabel = !id ? 'Not saved yet — type or take a photo' : saveState === 'saving' ? 'Saving…' : 'Saved on this phone ✓';

  return (
    <div className="screen">
      <Header title={isNew ? 'New company' : 'Edit company'} backTo={id ? `/s/${id}` : '/'} />

      <div className="code-banner" data-testid="supplier-code">
        <div>
          <div className="code-label">Company ID</div>
          <div className="code-big">{code}</div>
        </div>
        <div className={`save-state ${id ? 'ok' : ''}`} data-testid="save-state">
          {savedLabel}
        </div>
      </div>

      <Section title="🪪 Business card" right={<span className="muted small">{photos.filter((p) => CARD_KINDS.includes(p.kind)).length} photo(s)</span>}>
        <QuickCapture ensureId={ensureId} photos={photos} kinds={CARD_KINDS} galleryDefault="card_front" />
        <PhotoStrip photos={photos.filter((p) => CARD_KINDS.includes(p.kind))} showKind />
      </Section>

      <Section title="🏪 Booth & products" right={<span className="muted small">{photos.filter((p) => !CARD_KINDS.includes(p.kind)).length} photo(s)</span>}>
        <QuickCapture ensureId={ensureId} photos={photos} kinds={BOOTH_KINDS} galleryDefault="product" />
        <PhotoStrip photos={photos.filter((p) => !CARD_KINDS.includes(p.kind))} showKind />
      </Section>

      <Section title="Bearing types they supply">
        <MultiChips name="bearingTypes" values={form.bearingTypes} options={BEARING_TYPES} onChange={(v) => set('bearingTypes', v)} />
        {form.bearingTypes.includes('Other') && (
          <Field label="Other types" name="bearingTypesOther" value={form.bearingTypesOther} onChange={(v) => set('bearingTypesOther', v)} placeholder="e.g. linear, thrust, needle, slewing…" />
        )}
      </Section>

      <Section title="My rating & notes">
        <span className="field-label">My rating (your own impression)</span>
        <Stars size="lg" value={form.rating} onChange={(v) => set('rating', v)} />
        <TextArea label="Notes" name="notes" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Quality, sizes, brands they make, certifications (ISO/IATF), price level, OEM…" />
      </Section>

      <Section title="Company & contact">
        <Field label="Company name" name="companyName" value={form.companyName} onChange={(v) => set('companyName', v)} placeholder="e.g. Shandong XX Bearing Co., Ltd." />
        <div className="row">
          <Field className="grow" label="Brand" name="brand" value={form.brand} onChange={(v) => set('brand', v)} />
          <Field className="grow" label="Contact person" name="contactPerson" value={form.contactPerson} onChange={(v) => set('contactPerson', v)} />
        </div>
        <div className="row">
          <Field className="grow" label="WeChat ID" name="wechatId" value={form.wechatId} onChange={(v) => set('wechatId', v)} />
          <Field className="grow" label="WhatsApp" name="whatsapp" type="tel" inputMode="tel" value={form.whatsapp} onChange={(v) => set('whatsapp', v)} />
        </div>
        <div className="row">
          <Field className="grow" label="Phone" name="phone" type="tel" inputMode="tel" value={form.phone} onChange={(v) => set('phone', v)} />
          <Field className="grow" label="Email" name="email" type="email" inputMode="email" value={form.email} onChange={(v) => set('email', v)} />
        </div>
        <Field label="Website" name="website" inputMode="url" value={form.website} onChange={(v) => set('website', v)} />
      </Section>

      <Section title="At the exhibition">
        {prefilled && !initialId && (
          <div className="note">
            Hall prefilled from your previous company.{' '}
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                set('hall', '');
                setPrefilled(false);
              }}
            >
              Clear
            </button>
          </div>
        )}
        <div className="row">
          <Field className="grow" label="Hall" name="hall" list="dl-hall" value={form.hall} onChange={(v) => set('hall', v)} placeholder="e.g. N3" />
          <Field className="grow" label="Booth number" name="booth" value={form.booth} onChange={(v) => set('booth', v)} placeholder="e.g. A101" />
        </div>
        <DataList id="dl-hall" values={halls} />
        <Field label="Main products / specialty" name="category" list="dl-category" value={form.category} onChange={(v) => set('category', v)} placeholder="e.g. large-size tapered roller bearings" />
        <DataList id="dl-category" values={categories} />
      </Section>

      <Section title="🏭 Factory">
        <TextArea label="Factory address" name="factoryAddress" rows={2} value={form.factoryAddress} onChange={(v) => set('factoryAddress', v)} placeholder="Street, district — Chinese address is fine" />
        <Field label="City / province" name="factoryCity" list="dl-city" value={form.factoryCity} onChange={(v) => set('factoryCity', v)} placeholder="e.g. Liaocheng, Shandong" />
        <DataList id="dl-city" values={cities} />
        <label className="check check-big" data-testid="to-visit">
          <input type="checkbox" checked={!!form.toVisit} onChange={(e) => set('toVisit', e.target.checked ? 1 : 0)} /> Add to my factory visit list
        </label>
        {!!form.toVisit && <Field label="Planned visit date (optional)" type="date" name="visitDate" value={form.visitDate ?? ''} onChange={(v) => set('visitDate', v || null)} />}
      </Section>

      <Section title={<button type="button" className="linkbtn" onClick={() => setShowMore(!showMore)}>{showMore ? '▾' : '▸'} Status, follow-up & more</button>}>
        {showMore && (
          <>
            <span className="field-label">Supplier type (only if you verified it)</span>
            <Chips<SupplierType> name="supplierType" value={form.supplierType} onChange={(v) => set('supplierType', v)} options={(Object.keys(TYPE_LABELS) as SupplierType[]).map((k) => ({ value: k, label: TYPE_LABELS[k] }))} />
            <Select<SupplierStatus> label="Status" name="status" value={form.status} onChange={(v) => set('status', v)} options={(Object.keys(STATUS_LABELS) as SupplierStatus[]).map((k) => ({ value: k, label: STATUS_LABELS[k] }))} />
            <Field label="Follow-up date" type="date" name="followUpDate" value={form.followUpDate ?? ''} onChange={(v) => set('followUpDate', v || null)} />
            <Field label="Follow-up task" name="followUpNote" value={form.followUpNote} onChange={(v) => set('followUpNote', v)} placeholder="e.g. Send drawing, ask price for 30205" />
            <TextArea label="Location notes" name="locationNotes" rows={2} value={form.locationNotes} onChange={(v) => set('locationNotes', v)} placeholder="Near the entrance, corner booth…" />
            {id && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={async () => {
                  const c = prompt('Change company ID (must be unique):', code);
                  if (!c || c === code) return;
                  try {
                    await flush();
                    await changeSupplierCode(id, c);
                    setCode(c.trim());
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                Change company ID
              </button>
            )}
          </>
        )}
      </Section>

      <div className="actionbar">
        {id && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={async () => {
              await flush();
              navigate(`/p/new?supplier=${id}`);
            }}
          >
            + Product
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline"
          data-testid="save-next"
          onClick={async () => {
            const saved = await flush();
            if (saved) toast(`${code} saved`);
            navigate(`/add?n=${Date.now()}`);
          }}
        >
          Save & next
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="done"
          onClick={async () => {
            const saved = await flush();
            navigate(saved ? `/s/${saved}` : '/', true);
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function useSupplier(id: string | undefined): Supplier | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.suppliers.get(id)) ?? null) : null), [id]);
}
