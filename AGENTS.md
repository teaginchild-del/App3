# QBO Match — Base44 dev environment

## Stack
React 19 + Vite 7 + Tailwind 3 frontend. Uses `@base44/sdk`. Single web service, no backend/database in dev.

## Local mode
The app runs fully client-side in "local mode" when `VITE_BASE44_APP_ID` is empty (the default in compose). Data is stored in the browser's localStorage. QuickBooks sync is disabled in this mode. No external credentials are required to boot.

## Running
`docker compose -f docker-compose.base44.yml up -d` starts the Vite dev server on host port 3000 (container 5173). Dependencies install via `npm ci` on container startup. Live reload is active (React Refresh).

## Connecting to Base44 / QuickBooks (optional)
To enable QuickBooks integration, set `VITE_BASE44_APP_ID` and the QBO secrets (`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`) in Base44. These are optional and not needed for local mode.

## Tests
`npm test` (vitest) — matching engine + CSV parsing. Run inside the container: `docker compose -f docker-compose.base44.yml exec web npm test`.
