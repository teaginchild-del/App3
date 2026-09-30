// Returns the Intuit consent URL. The browser keeps `state` in sessionStorage
// and checks it again on /quickbooks/callback before exchanging the code.
//
// Secrets: QBO_CLIENT_ID, QBO_REDIRECT_URI
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Only admins can connect QuickBooks' }, { status: 403 });

    const { state } = await req.json();
    if (!state || typeof state !== 'string' || state.length < 16) {
      return Response.json({ error: 'A random state value is required' }, { status: 400 });
    }
    const clientId = Deno.env.get('QBO_CLIENT_ID');
    const redirectUri = Deno.env.get('QBO_REDIRECT_URI');
    if (!clientId || !redirectUri) {
      return Response.json({ error: 'QBO_CLIENT_ID and QBO_REDIRECT_URI secrets are not set' }, { status: 500 });
    }
    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return Response.json({ url: url.toString() });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
