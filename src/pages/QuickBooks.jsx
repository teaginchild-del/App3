import { useState } from 'react';
import { isBase44 } from '@/api/base44Client';
import { QuickBooksConnection } from '@/api/entities';
import { quickbooksAuthUrl, quickbooksDisconnect, quickbooksImport } from '@/api/functions';
import { Alert, Badge, Button, Card, Empty, Field, inputClass } from '@/components/ui';
import { useAsync } from '@/lib/hooks';
import { QBO_TYPES } from '@/lib/recordTypes';
import { syncQuickBooksLinks } from '@/lib/services';

const DEFAULT_SELECTION = ['Invoice', 'Estimate', 'SalesReceipt', 'Payment', 'Deposit', 'Item', 'Customer'];

export default function QuickBooks() {
  const { data: connections = [], reload, error } = useAsync(() => QuickBooksConnection.list('-connected_at', 50), []);
  const [message, setMessage] = useState(null);

  async function connect() {
    setMessage(null);
    try {
      const state = crypto.randomUUID() + crypto.randomUUID();
      sessionStorage.setItem('qbo_oauth_state', state);
      const { url } = await quickbooksAuthUrl({ state });
      window.location.href = url;
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="QuickBooks Online companies"
        actions={<Button onClick={connect} disabled={!isBase44}>Connect QuickBooks</Button>}
      >
        {!isBase44 && (
          <div className="mb-4">
            <Alert tone="warn">
              QuickBooks OAuth and sync run as Base44 backend functions. Set <code>VITE_BASE44_APP_ID</code> and the
              QBO secrets (see README) to enable them. CSV import and matching work in local mode.
            </Alert>
          </div>
        )}
        {error && <Alert tone="error">{error.message}</Alert>}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {connections.length ? (
          <div className="space-y-4">
            {connections.map((c) => (
              <ConnectionPanel key={c.id} connection={c} onChange={reload} />
            ))}
          </div>
        ) : (
          <Empty>No companies connected.</Empty>
        )}
      </Card>
    </div>
  );
}

function ConnectionPanel({ connection, onChange }) {
  const [selected, setSelected] = useState(DEFAULT_SELECTION);
  const [since, setSince] = useState('');
  const [progress, setProgress] = useState([]);
  const [running, setRunning] = useState(false);
  const active = connection.status === 'connected';

  function toggle(entity) {
    setSelected((s) => (s.includes(entity) ? s.filter((e) => e !== entity) : [...s, entity]));
  }

  async function sync() {
    setRunning(true);
    setProgress([]);
    // One call per entity keeps each backend invocation short.
    for (const entity of selected) {
      setProgress((p) => [...p, { entity, status: 'running' }]);
      try {
        const res = await quickbooksImport({ connection_id: connection.id, entity, since: since || undefined });
        setProgress((p) => p.map((x) => (x.entity === entity ? { entity, status: 'done', ...res } : x)));
      } catch (e) {
        setProgress((p) => p.map((x) => (x.entity === entity ? { entity, status: 'error', error: e.message } : x)));
      }
    }
    try {
      const links = await syncQuickBooksLinks();
      setProgress((p) => [...p, { entity: 'QuickBooks links', status: 'done', created: links }]);
    } catch (e) {
      setProgress((p) => [...p, { entity: 'QuickBooks links', status: 'error', error: e.message }]);
    }
    setRunning(false);
    onChange();
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${connection.company_name}? Imported records are kept.`)) return;
    await quickbooksDisconnect({ connection_id: connection.id });
    onChange();
  }

  return (
    <div className="rounded-md border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-medium">{connection.company_name}</div>
        <Badge tone={active ? 'green' : connection.status === 'needs_reauth' ? 'amber' : 'slate'}>{connection.status}</Badge>
        <Badge>{connection.environment}</Badge>
        <span className="text-xs text-slate-500">Realm {connection.realm_id}</span>
        {connection.last_sync_at && (
          <span className="text-xs text-slate-500">Last sync {new Date(connection.last_sync_at).toLocaleString()}</span>
        )}
        {active && (
          <Button variant="danger" size="sm" className="ml-auto" onClick={disconnect}>
            Disconnect
          </Button>
        )}
      </div>

      {active && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">Objects to import</div>
            <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-4">
              {QBO_TYPES.map((t) => (
                <label key={t.qbo} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.includes(t.qbo)} onChange={() => toggle(t.qbo)} />
                  {t.label.replace(/^QBO /, '')}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Only changed since (optional)">
              <input type="date" className={inputClass} value={since} onChange={(e) => setSince(e.target.value)} />
            </Field>
            <Button onClick={sync} disabled={running || !selected.length}>
              {running ? 'Importing…' : 'Import from QuickBooks'}
            </Button>
          </div>
          {progress.length > 0 && (
            <ul className="space-y-1 text-sm">
              {progress.map((p) => (
                <li key={p.entity} className="flex gap-2">
                  <span className="w-40 font-medium">{p.entity}</span>
                  {p.status === 'running' && <span className="text-slate-500">importing…</span>}
                  {p.status === 'done' && (
                    <span className="text-emerald-700">
                      {p.created ?? 0} new{p.updated != null && `, ${p.updated} updated, ${p.skipped} unchanged`}
                    </span>
                  )}
                  {p.status === 'error' && <span className="text-red-600">{p.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
