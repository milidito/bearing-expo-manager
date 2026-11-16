import { Compare } from './screens/Compare';
import { Dashboard } from './screens/Dashboard';
import { Help } from './screens/Help';
import { Trash } from './screens/Trash';
import { Visits } from './screens/Visits';
import { Locations } from './screens/Locations';
import { ProductDetail, ProductEditor, ProductsList, QuoteEditor } from './screens/Products';
import { More, Settings, SyncScreen } from './screens/Settings';
import { SupplierDetail } from './screens/SupplierDetail';
import { SupplierEditor } from './screens/SupplierEditor';
import { SupplierList } from './screens/SupplierList';
import { match, navigate, useRoute } from './router';
import { ToastHost } from './ui/components';
import { SaveSheetHost } from './ui/saveSheet';
import { useEffect, useState } from 'react';
import { syncRunner, VIEWER_FLAG, isViewerFlag } from './sync/runner';
import { useOnline, useSyncStatus } from './ui/hooks';
import { checkIsViewer, wipeLocalData } from './viewer/api';
import { ViewerApp } from './viewer/ViewerApp';

function Screen() {
  const r = useRoute();
  const p = r.path;
  let m: Record<string, string> | null;
  if (p === '/' || p === '') return <Dashboard />;
  if (p === '/add') return <SupplierEditor key={`add-${r.query.get('n') ?? ''}`} isNew />;
  if ((m = match('/s/:id/edit', p))) return <SupplierEditor key={`edit-${m.id}`} id={m.id} isNew={false} />;
  if ((m = match('/s/:id', p))) return <SupplierDetail key={m.id} id={m.id} />;
  if (p === '/suppliers') return <SupplierList initialQuery={r.query.get('q') ?? ''} />;
  if (p === '/products') return <ProductsList />;
  if (p === '/p/new') return <ProductEditor key={`pnew-${r.query.get('supplier')}`} supplierId={r.query.get('supplier') ?? undefined} />;
  if ((m = match('/p/:id/edit', p))) return <ProductEditor key={`pedit-${m.id}`} id={m.id} />;
  if ((m = match('/p/:id', p))) return <ProductDetail key={m.id} id={m.id} />;
  if (p === '/q/new') return <QuoteEditor key={`qnew-${r.query.get('product')}`} productId={r.query.get('product') ?? undefined} />;
  if ((m = match('/q/:id/edit', p))) return <QuoteEditor key={`qedit-${m.id}`} id={m.id} />;
  if (p === '/compare') return <Compare key={r.query.get('q') ?? ''} initialQuery={r.query.get('q') ?? ''} />;
  if (p === '/locations') return <Locations />;
  if (p === '/more') return <More />;
  if (p === '/settings') return <Settings />;
  if (p === '/sync') return <SyncScreen />;
  if (p === '/help') return <Help />;
  if (p === '/trash') return <Trash />;
  if (p === '/visits') return <Visits />;
  return <Dashboard />;
}

function Nav() {
  const { path } = useRoute();
  const active = (prefixes: string[]) => prefixes.some((x) => (x === '/' ? path === '/' : path.startsWith(x)));
  return (
    <nav className="nav">
      <a href="#/" className={active(['/']) ? 'on' : ''}>
        <span>🏠</span>Home
      </a>
      <a href="#/suppliers" className={active(['/suppliers', '/s/']) ? 'on' : ''}>
        <span>📇</span>Companies
      </a>
      <button className="nav-add" aria-label="Add company" data-testid="nav-add" onClick={() => navigate(`/add?n=${Date.now()}`)}>
        ＋
      </button>
      <a href="#/compare" className={active(['/compare']) ? 'on' : ''}>
        <span>⚖️</span>Compare
      </a>
      <a href="#/more" className={active(['/more', '/settings', '/sync', '/products', '/p/', '/q/', '/locations', '/help', '/trash', '/visits']) ? 'on' : ''}>
        <span>☰</span>More
      </a>
    </nav>
  );
}

/**
 * Decides between the normal app (owner) and the view-only app (an account the owner shared with).
 * The decision comes from the server (table expo_viewers); a local flag only remembers it so an
 * offline launch shows the view-only screen instead of the owner app.
 */
function useViewerMode(): { viewer: boolean; email: string | null } {
  const st = useSyncStatus();
  const [viewer, setViewer] = useState(isViewerFlag());
  useEffect(() => {
    const client = syncRunner.remote?.client;
    if (!client) return;
    if (!st.email) {
      if (st.state === 'signed_out' && isViewerFlag()) {
        localStorage.removeItem(VIEWER_FLAG);
        setViewer(false);
      }
      return;
    }
    if (!navigator.onLine) return;
    let cancelled = false;
    checkIsViewer(client)
      .then(async (isV) => {
        if (cancelled) return;
        if (isV) {
          localStorage.setItem(VIEWER_FLAG, '1');
          await wipeLocalData();
        } else localStorage.removeItem(VIEWER_FLAG);
        setViewer(isV);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [st.email, st.state]);
  return { viewer, email: st.email };
}

export function App() {
  const online = useOnline();
  const { viewer, email } = useViewerMode();
  if (viewer && syncRunner.remote) {
    return (
      <ViewerApp
        client={syncRunner.remote.client}
        email={email ?? ''}
        onSignOut={async () => {
          await syncRunner.remote?.client.auth.signOut();
          localStorage.removeItem(VIEWER_FLAG);
          await syncRunner.refresh();
          location.hash = '#/';
          location.reload();
        }}
      />
    );
  }
  return (
    <div className="app">
      {!online && (
        <div className="offline-bar" data-testid="offline-bar">
          Offline — everything is saved on this phone
        </div>
      )}
      <main>
        <Screen />
      </main>
      <Nav />
      <ToastHost />
      <SaveSheetHost />
    </div>
  );
}
