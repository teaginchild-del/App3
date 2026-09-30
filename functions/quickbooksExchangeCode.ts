// Exchanges the OAuth code from Intuit's redirect for tokens, looks up the
// company name, and stores the connection. Tokens go in QuickBooksToken, which
// only the service role touches; the browser never receives them.
//
// Secrets: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENVIRONMENT (sandbox | production)
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function apiBase(env: string) {
  return env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Only admins can connect QuickBooks' }, { status: 403 });

    const { code, realmId } = await req.json();
    if (!code || !realmId) return Response.json({ error: 'code and realmId are required' }, { status: 400 });

    const clientId = Deno.env.get('QBO_CLIENT_ID')!;
    const clientSecret = Deno.env.get('QBO_CLIENT_SECRET')!;
    const redirectUri = Deno.env.get('QBO_REDIRECT_URI')!;
    const environment = Deno.env.get('QBO_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      return Response.json({ error: tokens.error_description || tokens.error || 'Token exchange failed' }, { status: 400 });
    }

    let companyName = realmId;
    const infoRes = await fetch(`${apiBase(environment)}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    });
    if (infoRes.ok) companyName = (await infoRes.json())?.CompanyInfo?.CompanyName || realmId;

    const now = Date.now();
    const svc = base44.asServiceRole.entities;
    const existing = await svc.QuickBooksConnection.filter({ realm_id: realmId });
    const connectionData = {
      realm_id: realmId,
      company_name: companyName,
      environment,
      status: 'connected',
      connected_at: new Date(now).toISOString(),
    };
    const connection = existing[0]
      ? await svc.QuickBooksConnection.update(existing[0].id, connectionData)
      : await svc.QuickBooksConnection.create(connectionData);

    const tokenData = {
      connection_id: connection.id,
      realm_id: realmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: new Date(now + tokens.expires_in * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    };
    const oldTokens = await svc.QuickBooksToken.filter({ connection_id: connection.id });
    if (oldTokens[0]) await svc.QuickBooksToken.update(oldTokens[0].id, tokenData);
    else await svc.QuickBooksToken.create(tokenData);

    return Response.json({ connection });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
