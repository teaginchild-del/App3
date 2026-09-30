import { useCallback, useEffect, useState } from 'react';
import { base44, isBase44 } from '@/api/base44Client';
import { RecordType } from '@/api/entities';
import { allRecordTypes } from './recordTypes';

/** Run an async loader; returns { data, error, loading, reload }. */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await run(), error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [run]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}

export function useRecordTypes() {
  const { data: custom = [], reload } = useAsync(() => RecordType.list('label', 500), []);
  return { types: allRecordTypes(custom), custom, reload };
}

export function useCurrentUser() {
  const { data } = useAsync(async () => (isBase44 ? base44.auth.me() : { email: 'local@dev', role: 'admin', full_name: 'Local user' }), []);
  return data;
}
