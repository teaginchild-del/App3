import { createClient } from '@base44/sdk';

// When VITE_BASE44_APP_ID is set the app talks to Base44 (entities, auth,
// backend functions). Without it, everything runs against localStorage so the
// app can be developed and demoed before the repo is connected to Base44.
const appId = import.meta.env.VITE_BASE44_APP_ID;

export const isBase44 = Boolean(appId);
export const base44 = isBase44 ? createClient({ appId, requiresAuth: true }) : null;
