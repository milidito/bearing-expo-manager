import { useMemo, useState } from 'react';
import { Empty, Header } from '../ui/components';
import { useSuppliers } from '../ui/hooks';
import { SupplierCard, useCoverPhotos } from './SupplierList';

/** Browse companies by exhibition hall, sorted by booth number. */
export function Locations() {
  const suppliers = useSuppliers();
  const covers = useCoverPhotos();
  const [hall, setHall] = useState('');
  const [booth, setBooth] = useState('');
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof suppliers>>();
    for (const s of suppliers ?? []) {
      if (hall && s.hall !== hall) continue;
      if (booth && !s.booth.toLowerCase().includes(booth.toLowerCase())) continue;
      const h = s.hall || 'No hall';
      if (!m.has(h)) m.set(h, []);
      m.get(h)!.push(s);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    return [...m.entries()].sort(([a], [b]) => cmp(a, b)).map(([h, list]) => ({ h, list: list.sort((a, b) => cmp(a.booth, b.booth)) }));
  }, [suppliers, hall, booth]);
  const halls = [...new Set((suppliers ?? []).map((s) => s.hall).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="screen">
      <Header title="Halls" backTo="/more" />
      <div className="chips pad">
        <button className={`chip ${!hall ? 'chip-on' : ''}`} onClick={() => setHall('')}>
          All
        </button>
        {halls.map((h) => (
          <button key={h} className={`chip ${hall === h ? 'chip-on' : ''}`} onClick={() => setHall(h)}>
            {h}
          </button>
        ))}
      </div>
      <div className="searchbar">
        <input type="search" placeholder="Booth number…" value={booth} onChange={(e) => setBooth(e.target.value)} />
      </div>
      {suppliers && !suppliers.length && <Empty>No companies yet.</Empty>}
      {groups.map(({ h, list }) => (
        <section key={h} className="card">
          <div className="card-hd">
            <h2>{/^hall/i.test(h) || h === 'No hall' ? h : `Hall ${h}`}</h2>
            <span className="small muted">{list.length}</span>
          </div>
          {list.map((s) => (
            <SupplierCard key={s.id} s={s} photo={covers.get(s.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}
