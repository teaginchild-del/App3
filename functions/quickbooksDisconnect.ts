// Revokes the refresh token at Intuit and forgets it locally. Imported
// records are kept.
//
// Secrets: QBO_CLIENT_ID, QBO_CLIENT_SECRET
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Only admins can disconnect QuickBooks' }, { status: 403 });

    const { connection_id } = await req.json();
    const svc = base44.asServiceRole.entities;
    const tokens = await svc.QuickBooksToken.filter({ connection_id });
    for (const t of tokens) {
      await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${Deno.env.get('QBO_CLIENT_ID')}:${Deno.env.get('QBO_CLIENT_SECRET')}`)}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token: t.refresh_token }),
      }).catch(() => {});
      await svc.QuickBooksToken.delete(t.id);
    }
    await svc.QuickBooksConnection.update(connection_id, { status: 'disconnected' });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
});
