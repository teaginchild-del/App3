import { Link } from 'react-router-dom';
import { ImportBatch, LedgerRecord, Match, QuickBooksConnection, listAll } from '@/api/entities';
import { Alert, Badge, Button, Card, Empty, Table, fmtMoney } from '@/components/ui';
import { useAsync, useRecordTypes } from '@/lib/hooks';
import { loadSampleData } from '@/lib/sampleData';
import { typeLabel } from '@/lib/recordTypes';

export default function Dashboard() {
  const { types } = useRecordTypes();
  const { data, loading, error, reload } = useAsync(async () => {
    const [records, matches, batches, connections] = await Promise.all([
      listAll(LedgerRecord, {}, '-created_date'),
      listAll(Match),
      ImportBatch.list('-started_at', 10),
      QuickBooksConnection.list('-connected_at', 20),
    ]);
    return { records, matches, batches, connections };
  }, []);

  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (loading || !data) return <p className="text-sm text-slate-500">Loading…</p>;

  const byType = new Map();
  for (const r of data.records) {
    const t = byType.get(r.record_type) || { type: r.record_type, total: 0, matched: 0, suggested: 0, unmatchedAmount: 0 };
    t.total++;
    if (r.match_status === 'matched') t.matched++;
    else if (r.match_status === 'suggested') t.suggested++;
    else t.unmatchedAmount += r.amount || 0;
    byType.set(r.record_type, t);
  }
  const rows = [...byType.values()].sort((a, b) => b.total - a.total);
  const openSuggestions = data.matches.filter((m) => m.status === 'suggested').length;
  const connected = data.connections.filter((c) => c.status === 'connected');

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Records" value={data.records.length} />
        <Stat label="Confirmed matches" value={data.matches.filter((m) => m.status === 'confirmed').length} />
        <Stat label="Suggestions to review" value={openSuggestions} link={openSuggestions ? '/matching' : null} />
      </div>

      {!connected.length && (
        <Alert tone="info">
          No QuickBooks company connected. <Link className="font-medium underline" to="/quickbooks">Connect QuickBooks</Link> or start by{' '}
          <Link className="font-medium underline" to="/import">importing a CSV</Link>.
        </Alert>
      )}

      <Card
        title="Records by type"
        actions={
          !data.records.length && (
            <Button variant="secondary" onClick={() => loadSampleData().then(reload)}>
              Load sample data
            </Button>
          )
        }
      >
        {rows.length ? (
          <Table
            rowKey={(r) => r.type}
            columns={[
              { key: 'type', label: 'Type', render: (r) => <Link className="text-emerald-700 hover:underline" to={`/records?type=${r.type}`}>{typeLabel(r.type, types)}</Link> },
              { key: 'total', label: 'Records', align: 'right' },
              { key: 'matched', label: 'Matched', align: 'right' },
              { key: 'suggested', label: 'Suggested', align: 'right' },
              { key: 'pct', label: '% matched', align: 'right', render: (r) => `${Math.round((r.matched / r.total) * 100)}%` },
              { key: 'unmatchedAmount', label: 'Unmatched amount', align: 'right', render: (r) => fmtMoney(r.unmatchedAmount) },
            ]}
            rows={rows}
          />
        ) : (
          <Empty>No records yet.</Empty>
        )}
      </Card>

      <Card title="Recent imports">
        {data.batches.length ? (
          <Table
            columns={[
              { key: 'started_at', label: 'Started', render: (b) => new Date(b.started_at).toLocaleString() },
              { key: 'source', label: 'Source' },
              { key: 'record_type', label: 'Type', render: (b) => typeLabel(b.record_type, types) },
              { key: 'file_name', label: 'File' },
              { key: 'status', label: 'Status', render: (b) => <Badge tone={b.status === 'completed' ? 'green' : b.status === 'failed' ? 'red' : 'amber'}>{b.status}</Badge> },
              { key: 'created_count', label: 'New', align: 'right' },
              { key: 'updated_count', label: 'Updated', align: 'right' },
              { key: 'error', label: 'Error', render: (b) => <span className="text-red-600">{b.error}</span> },
            ]}
            rows={data.batches}
          />
        ) : (
          <Empty>No imports yet.</Empty>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, link }) {
  const body = (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
  return link ? <Link to={link}>{body}</Link> : body;
}
