import { base44, isBase44 } from './base44Client';

export class BackendUnavailableError extends Error {
  constructor() {
    super('QuickBooks sync runs in Base44 backend functions. Set VITE_BASE44_APP_ID to enable it.');
  }
}

async function invoke(name, payload) {
  if (!isBase44) throw new BackendUnavailableError();
  let res;
  try {
    res = await base44.functions.invoke(name, payload);
  } catch (err) {
    // Non-2xx responses surface as errors; prefer the function's own message.
    throw new Error(err?.response?.data?.error || err?.data?.error || err.message);
  }
  const data = res?.data ?? res;
  if (data?.error) throw new Error(data.error);
  return data;
}

export const quickbooksAuthUrl = (payload) => invoke('quickbooksAuthUrl', payload);
export const quickbooksExchangeCode = (payload) => invoke('quickbooksExchangeCode', payload);
export const quickbooksImport = (payload) => invoke('quickbooksImport', payload);
export const quickbooksDisconnect = (payload) => invoke('quickbooksDisconnect', payload);
