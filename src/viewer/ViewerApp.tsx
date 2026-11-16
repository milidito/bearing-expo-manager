import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BEARING_TYPES, PHOTO_KIND_LABELS, type PhotoKind } from '../db';
import { norm } from '../logic';
import { Stars } from '../ui/components';
import { useOnline } from '../ui/hooks';
import { downloadSharedPhoto, fetchShared, type SharedCompany, type SharedPhoto } from './api';

/**
 * View-only app for accounts the owner shared the expo data with.
 *  - online only: data lives in memory while the app is open, nothing is written to the phone
 *  - no add / edit / delete / backup / export / Save to Photos
 *  - photos are drawn on a <canvas> with the viewer's email as watermark (no "Save Image" on long-press)
 *  - text selection, copy, drag and the context menu are disabled; printing shows nothing
 * Screenshots cannot be blocked by any app on iPhone — the watermark makes leaks traceable.
 */

const CARD: string[] = ['card_front', 'card_back'];

// ---------- in-memory photo cache (cleared when the app closes) ----------
const blobCache = new Map<string, Promise<Blob>>();
function getPhoto(client: SupabaseClient, p: Pick<SharedPhoto, 'id' | 'owner_id'>) {
  let pr = blobCache.get(p.id);
  if (!pr) {
    pr = downloadSharedPhoto(client, p.owner_id, p.id);
    pr.catch(() => blobCache.delete(p.id));
    blobCache.set(p.id, pr);
    if (blobCache.size > 80) blobCache.delete(blobCache.keys().next().value as string);
  }
  return pr;
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawWatermarked(canvas: HTMLCanvasElement, src: ImageBitmap | HTMLImageElement, maxW: number, maxH: number, mark: string) {
  const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(1, (maxW * dpr) / w0, (maxH * dpr) / h0);
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${Math.round(w / dpr)}px`;
  canvas.style.height = `${Math.round(h / dpr)}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(src, 0, 0, w, h);
  // tiled diagonal watermark
  const fs = Math.max(11, Math.round(Math.min(w, h) / 14));
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  const stepY = fs * 3.2;
  const stepX = ctx.measureText(mark).width + fs * 2;
  const span = Math.hypot(w, h);
  for (let y = -span; y < span; y += stepY) {
    for (let x = -span; x < span; x += stepX) {
      const off = (Math.round(y / stepY) % 2) * (stepX / 2);
      ctx.lineWidth = Math.max(1, fs / 10);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.strokeText(mark, x + off, y);
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fillText(mark, x + off, y);
    }
  }
  ctx.restore();
}

function WatermarkedPhoto(props: { client: SupabaseClient; photo: SharedPhoto; mark: string; maxW: number; maxH: number; onClick?: () => void; lazy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [visible, setVisible] = useState(!props.lazy);
  useEffect(() => {
    if (visible || !ref.current) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setState('loading');
    getPhoto(props.client, props.photo)
      .then(decode)
      .then((src) => {
        if (cancelled || !ref.current) return;
        drawWatermarked(ref.current, src, props.maxW, props.maxH, props.mark);
        setState('ok');
      })
      .catch(() => !cancelled && setState('err'));
    return () => {
      cancelled = true;
    };
  }, [visible, props.photo.id, props.maxW, props.maxH, props.mark]);
  return (
    <div className={`v-photo ${state}`} onClick={props.onClick} style={{ minWidth: props.maxW > 200 ? undefined : props.maxW, minHeight: Math.min(props.maxH, 120) }}>
      <canvas ref={ref} data-testid="viewer-canvas" aria-label="Photo" />
      {state !== 'ok' && <span className="v-photo-msg">{state === 'err' ? 'Photo not available' : '…'}</span>}
    </div>
  );
}

function typesLine(c: SharedCompany) {
  return (c.bearing_types ?? []).map((t) => (t === 'Other' && c.bearing_types_other ? `Other: ${c.bearing_types_other}` : t)).join(', ');
}
function loc(c: SharedCompany) {
  return [c.hall && (/^hall/i.test(c.hall) ? c.hall : `Hall ${c.hall}`), c.booth && `Booth ${c.booth}`].filter(Boolean).join(' · ');
}

export function ViewerApp(props: { client: SupabaseClient; email: string; onSignOut: () => void }) {
  const online = useOnline();
  const [data, setData] = useState<{ companies: SharedCompany[]; photos: SharedPhoto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<'code' | 'hall'>('code');
  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<SharedPhoto | null>(null);
  const mark = `${props.email} · view only`;

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchShared(props.client));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [props.client]);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  // copy / save protections for the whole app while in view-only mode
  useEffect(() => {
    document.body.classList.add('viewer-mode');
    const block = (e: Event) => e.preventDefault();
    const evs = ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart'] as const;
    evs.forEach((ev) => document.addEventListener(ev, block));
    return () => {
      document.body.classList.remove('viewer-mode');
      evs.forEach((ev) => document.removeEventListener(ev, block));
      blobCache.clear();
    };
  }, []);

  const photosBy = useMemo(() => {
    const m = new Map<string, SharedPhoto[]>();
    for (const p of data?.photos ?? []) m.set(p.supplier_id, [...(m.get(p.supplier_id) ?? []), p]);
    return m;
  }, [data]);

  const list = useMemo(() => {
    const qq = norm(q);
    const out = (data?.companies ?? []).filter((c) => {
      if (type && !(c.bearing_types ?? []).includes(type)) return false;
      if (!qq) return true;
      const hay = norm([c.code, c.company_name, c.brand, typesLine(c), c.hall, c.booth, c.contact_person, c.notes].join(' '));
      return qq.split(' ').every((t) => hay.includes(t));
    });
    const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    return out.sort((a, b) => (sort === 'hall' ? cmp(`${a.hall} ${a.booth}`, `${b.hall} ${b.booth}`) : cmp(a.code, b.code)));
  }, [data, q, type, sort]);

  const cover = (id: string) => {
    const ps = photosBy.get(id) ?? [];
    return ps.find((p) => p.kind === 'booth') ?? ps.find((p) => p.kind === 'card_front') ?? ps[0];
  };

  const open = openId ? data?.companies.find((c) => c.id === openId) : null;

  return (
    <div className="app viewer-app">
      <div className="v-watermark" aria-hidden="true" style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><text x='10' y='100' transform='rotate(-20 160 90)' font-family='sans-serif' font-size='14' fill='rgba(0,0,0,0.07)'>${mark.replace(/[<&>]/g, '')}</text></svg>`)}")` }} />
      <header className="hdr">
        {open ? (
          <button className="hdr-back" aria-label="Back" onClick={() => setOpenId(null)}>
            ‹
          </button>
        ) : (
          <span className="hdr-spacer" />
        )}
        <div className="hdr-title">
          <div className="hdr-main">{open ? open.code : 'Bearing Expo'}</div>
          <div className="hdr-sub">{open ? open.company_name || 'Unnamed company' : `View only · ${props.email}`}</div>
        </div>
        <div className="hdr-right">
          <span className="syncdot" data-testid="viewer-badge">
            👁 View only
          </span>
        </div>
      </header>

      <main className="screen v-main">
        {!online && (
          <div className="card note-warn" data-testid="viewer-offline">
            <b>No internet connection.</b>
            <div className="small">View-only access works online only — nothing is stored on this phone. Connect to the internet to see the companies.</div>
          </div>
        )}
        {error && online && (
          <div className="card note-warn">
            <b>Could not load the shared data.</b>
            <div className="small">{error}</div>
            <button className="btn btn-sm" onClick={load}>
              Try again
            </button>
          </div>
        )}
        {online && !data && !error && <div className="empty">Loading…</div>}

        {data && !open && (
          <>
            {!data.companies.length && <div className="empty">Nothing has been shared with this account yet, or access was removed.</div>}
            <div className="searchbar">
              <input type="search" placeholder="Search company, bearing type, booth…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="viewer-search" />
              <select value={sort} onChange={(e) => setSort(e.target.value as 'code' | 'hall')} style={{ width: 'auto' }} aria-label="Sort">
                <option value="code">By ID</option>
                <option value="hall">By hall</option>
              </select>
            </div>
            <div className="chips pad">
              <button className={`chip ${!type ? 'chip-on' : ''}`} onClick={() => setType('')}>
                All types
              </button>
              {BEARING_TYPES.map((t) => (
                <button key={t} className={`chip ${type === t ? 'chip-on' : ''}`} onClick={() => setType(type === t ? '' : t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="small muted pad">
              {list.length} of {data.companies.length} companies
            </div>
            <div className="list">
              {list.map((c) => {
                const p = cover(c.id);
                return (
                  <button key={c.id} className="list-item v-row" onClick={() => setOpenId(c.id)} data-testid="viewer-row">
                    {p ? (
                      <WatermarkedPhoto client={props.client} photo={p} mark={mark} maxW={76} maxH={76} lazy />
                    ) : (
                      <span className="thumb thumb-empty">{c.code.replace(/\D/g, '').slice(-3)}</span>
                    )}
                    <div className="grow">
                      <div className="li-title">
                        <span className="code-chip">{c.code}</span> {c.company_name || 'Unnamed'}
                      </div>
                      {typesLine(c) && <div className="small types-line">{typesLine(c)}</div>}
                      <div className="small muted">{loc(c) || 'No hall / booth'}</div>
                      {c.rating ? <Stars value={c.rating} /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {data && open && (
          <div data-testid="viewer-detail">
            <section className="card">
              <div className="code-big">{open.code}</div>
              <div className="detail-name">{open.company_name || 'Unnamed company'}</div>
              {open.brand && <div className="muted">Brand: {open.brand}</div>}
              <div className="field-label">Bearing types</div>
              <div className="types-big" data-testid="viewer-types">{typesLine(open) || '—'}</div>
              <div className="loc-big" data-testid="viewer-location">{loc(open) || 'No hall / booth'}</div>
            </section>
            {(['card', 'booth'] as const).map((group) => {
              const ps = (photosBy.get(open.id) ?? []).filter((p) => (group === 'card' ? CARD.includes(p.kind) : !CARD.includes(p.kind)));
              if (!ps.length) return null;
              return (
                <section className="card" key={group}>
                  <div className="card-hd">
                    <h2>{group === 'card' ? '🪪 Business card' : '🏪 Booth & products'}</h2>
                  </div>
                  <div className="strip">
                    {ps.map((p) => (
                      <div key={p.id} className="v-thumb">
                        <WatermarkedPhoto client={props.client} photo={p} mark={mark} maxW={150} maxH={120} onClick={() => setFull(p)} />
                        <span className="small muted">{PHOTO_KIND_LABELS[p.kind as PhotoKind] ?? p.kind}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            <section className="card">
              <div className="card-hd">
                <h2>Rating & notes</h2>
              </div>
              {open.rating ? <Stars value={open.rating} size="lg" /> : <span className="muted small">No rating</span>}
              {open.notes ? <div className="prewrap" data-testid="viewer-notes">{open.notes}</div> : <span className="muted small">No notes</span>}
            </section>
            <section className="card">
              <div className="card-hd">
                <h2>Contact</h2>
              </div>
              {[
                ['Contact person', open.contact_person],
                ['WeChat', open.wechat_id],
                ['WhatsApp', open.whatsapp],
                ['Phone', open.phone],
                ['Email', open.email],
                ['Website', open.website],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div className="kv" key={k}>
                    <span>{k}</span>
                    <b className="mono">{v}</b>
                  </div>
                ))}
              {![open.contact_person, open.wechat_id, open.whatsapp, open.phone, open.email, open.website].some(Boolean) && <span className="muted small">No contact details</span>}
            </section>
          </div>
        )}

        <section className="card">
          <div className="small muted">
            Signed in as <b>{props.email}</b> with view-only access. This screen cannot change any data. Photos are watermarked with your email.
          </div>
          <button className="btn btn-outline" onClick={props.onSignOut} data-testid="viewer-signout">
            Sign out
          </button>
        </section>
      </main>

      {full && (
        <div className="viewer" role="dialog" aria-label="Photo" onClick={() => setFull(null)}>
          <div className="viewer-top">
            <button className="btn btn-dark" onClick={() => setFull(null)}>
              ✕ Close
            </button>
            <span className="muted-light">{PHOTO_KIND_LABELS[full.kind as PhotoKind] ?? full.kind}</span>
          </div>
          <div className="viewer-img">
            <WatermarkedPhoto client={props.client} photo={full} mark={mark} maxW={Math.min(window.innerWidth, 1200)} maxH={Math.round(window.innerHeight * 0.8)} />
          </div>
        </div>
      )}
    </div>
  );
}
