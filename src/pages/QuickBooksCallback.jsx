import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { quickbooksExchangeCode } from '@/api/functions';
import { Alert } from '@/components/ui';

// Intuit redirects here (QBO_REDIRECT_URI) with ?code=&realmId=&state=
export default function QuickBooksCallback() {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const expected = sessionStorage.getItem('qbo_oauth_state');
    sessionStorage.removeItem('qbo_oauth_state');
    if (params.get('error')) return setState({ status: 'error', text: params.get('error_description') || params.get('error') });
    if (!expected || expected !== params.get('state')) {
      return setState({ status: 'error', text: 'OAuth state mismatch. Start the connection again from the QuickBooks page.' });
    }
    quickbooksExchangeCode({ code: params.get('code'), realmId: params.get('realmId') })
      .then(({ connection }) => setState({ status: 'done', text: `Connected ${connection.company_name}.` }))
      .catch((e) => setState({ status: 'error', text: e.message }));
  }, [params]);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {state.status === 'working' && <p className="text-sm text-slate-600">Finishing QuickBooks connection…</p>}
      {state.status !== 'working' && <Alert tone={state.status === 'done' ? 'success' : 'error'}>{state.text}</Alert>}
      <Link to="/quickbooks" className="text-sm text-emerald-700 underline">
        Back to QuickBooks
      </Link>
    </div>
  );
}
