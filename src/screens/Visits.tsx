import { useMemo, useState } from 'react';
import { todayYmd } from '../db';
import { bearingTypesLine, fmtDate, mapsLink } from '../logic';
import { updateSupplier } from '../repo';
import { copyText, Empty, Header, Stars } from '../ui/components';
import { useSuppliers } from '../ui/hooks';

type Tab = 'todo' | 'done' | 'all';

/** Factories you ticked "Add to my factory visit list", grouped by city. */
export function Visits() {
  const suppliers = useSuppliers();
  const [tab, setTab] = useState<Tab>('todo');
  const all = useMemo(() => (suppliers ?? []).filter((s) => !!s.toVisit), [suppliers]);
  const groups = useMemo(() => {
    const list = all.filter((s) => (tab === 'all' ? true : tab === 'done' ? !!s.visited : !s.visited));
    const m = new Map<string, typeof list>();
    for (const s of list) {
      const c = s.factoryCity.trim() || 'City not set';
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(s);
    }
    return [...m.entries()]
      .sort(([a], [b]) => (a === 'City not set' ? 1 : b === 'City not set' ? -1 : a.localeCompare(b)))
      .map(([city, items]) => ({
        city,
        items: items.sort((a, b) => (a.visitDate ?? '9999').localeCompare(b.visitDate ?? '9999') || (b.rating ?? 0) - (a.rating ?? 0)),
      }));
  }, [all, tab]);
  const todo = all.filter((s) => !s.visited).length;
  const done = all.length - todo;

  return (
    <div className="screen">
      <Header title="Factory visits" sub={`${todo} to visit · ${done} visited`} backTo="/more" />
      <div className="chips pad">
        {(
          [
            ['todo', `To visit (${todo})`],
            ['done', `Visited (${done})`],
            ['all', 'All'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`chip ${tab === k ? 'chip-on' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {suppliers && !all.length && <Empty>No factories on your list yet. Open a company and tick “Add to my factory visit list”.</Empty>}
      {groups.map(({ city, items }) => (
        <section key={city} className="card">
          <div className="card-hd">
            <h2>📍 {city}</h2>
            <span className="small muted">{items.length}</span>
          </div>
          {items.map((s) => (
            <div key={s.id} className="visit-item" data-testid="visit-row">
              <a href={`#/s/${s.id}`} className="visit-main">
                <div className="li-title">
                  <span className="code-chip">{s.code}</span> {s.companyName || 'Unnamed'}
                </div>
                {bearingTypesLine(s) && <div className="small types-line">{bearingTypesLine(s)}</div>}
                {s.factoryAddress && <div className="small">{s.factoryAddress}</div>}
                <div className="li-meta">
                  {s.rating ? <Stars value={s.rating} /> : null}
                  {s.visitDate && <span className={`small ${!s.visited && s.visitDate < todayYmd() ? 'warn' : 'muted'}`}>📅 {fmtDate(s.visitDate)}</span>}
                  {s.contactPerson && <span className="small muted">{s.contactPerson}</span>}
                </div>
              </a>
              <div className="row">
                {(s.factoryAddress || s.factoryCity) && (
                  <a className="btn btn-sm" href={mapsLink(s.factoryAddress, s.factoryCity)} target="_blank" rel="noreferrer">
                    Maps
                  </a>
                )}
                {s.factoryAddress && (
                  <button className="btn btn-sm" onClick={() => copyText([s.factoryAddress, s.factoryCity].filter(Boolean).join(', '), 'Address copied')}>
                    Copy address
                  </button>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!s.visited}
                    onChange={(e) => updateSupplier(s.id, { visited: e.target.checked ? 1 : 0, visitDate: e.target.checked ? s.visitDate || todayYmd() : s.visitDate })}
                  />{' '}
                  Visited
                </label>
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
