# QBO Match

Connects to QuickBooks Online, imports objects QuickBooks doesn't have natively
(sales orders, customer deposits, bank statement deposits, processor payouts,
external items, or any custom type you define), and matches them to QuickBooks
objects (invoices, estimates, payments, deposits, items, …).

It's laid out as a [Base44](https://base44.com) app: entity schemas in `entities/`,
Deno backend functions in `functions/`, and a React + Vite + Tailwind frontend in
`src/` that uses `@base44/sdk`. Until the repo is connected to Base44 it runs in
**local mode**, with data kept in the browser's localStorage.

## What it does

| Area | |
|---|---|
| **QuickBooks import** | OAuth 2.0 connect; pulls Invoice, Estimate, SalesReceipt, CreditMemo, RefundReceipt, Payment, Deposit, Transfer, Purchase, PurchaseOrder, Bill, BillPayment, JournalEntry, Item, Customer and Vendor. Can import incrementally (only records changed since a date). Re-running is safe because rows are upserted and unchanged `SyncToken`s are skipped. |
| **Non-native import** | CSV upload with auto-guessed column mapping, debit/credit or signed amounts, several date formats, and "one row per line item" grouping for sales orders. Mappings can be saved for recurring files, and re-importing a file updates records instead of duplicating them. |
| **Custom record types** | Add any type (work orders, retainers, layaway…) on *Record Types*. |
| **Matching rules** | Weighted criteria: amount (±$ / ±%), date window, reference (including a reference found in the other record's memo), customer name similarity, item name, and line items (SKU + qty). Any criterion can be marked required. |
| **Grouped matches** | One-to-many rules find several records that add up to one amount, e.g. a bank deposit made up of 3 payments. |
| **QuickBooks links** | QBO's own `LinkedTxn` links (Payment→Invoice, Deposit→Payment, Invoice→Estimate) become confirmed matches automatically. |
| **Review** | Suggestions show a per-criterion score breakdown and alternative candidates. You can confirm or reject each one, bulk-confirm everything above a score, auto-confirm per rule, or match records manually. |
| **Chain view** | Click any record to see its whole chain, e.g. Sales Order → Estimate → Invoice → Payment → Deposit → Bank Deposit. |

Default rules (seeded on first visit to *Rules*, all editable): Sales Order→Invoice,
Sales Order→Estimate, Customer Deposit→Payment, Bank Deposit→QBO Deposit, Bank
Deposit→Payments (grouped), Processor Payout→QBO Deposit, External Item→QBO Item.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173 — click "Load sample data" on the dashboard
npm test         # matching engine + CSV parsing tests
```

## Connecting to Base44

1. Connect this GitHub repo to your Base44 app. Base44 picks up the `entities/*.json` schemas and the `functions/*.ts` backend functions.
2. Set `VITE_BASE44_APP_ID` to your app id. Without it the app stays in local mode.
3. Create an app at <https://developer.intuit.com>, then add these secrets in Base44:
   - `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`
   - `QBO_REDIRECT_URI`: `https://<your-app-domain>/quickbooks/callback`. Register the same URL in the Intuit app.
   - `QBO_ENVIRONMENT`: `sandbox` or `production`
4. **Security:** in Base44's data permissions, block all user read/write on the
   `QuickBooksToken` entity. Only backend functions (service role) should touch it.
   Connecting and disconnecting QuickBooks requires an admin user.

## Layout

```
entities/            Base44 entity schemas
  LedgerRecord       every imported object, normalized (QBO or external)
  Match              links between records (suggested / confirmed / rejected)
  MatchRule          matching rules
  RecordType         user-defined types
  QuickBooksConnection, QuickBooksToken, ImportBatch, ImportTemplate
functions/           Base44 Deno backend functions
  quickbooksAuthUrl, quickbooksExchangeCode, quickbooksImport, quickbooksDisconnect
src/
  api/               base44 client, entity handles (localStorage fallback), function calls
  lib/matching.js    matching engine (pure; also runnable server-side)
  lib/csvImport.js   CSV → LedgerRecord
  lib/recordTypes.js built-in types
  lib/services.js    import/match operations over entities
  pages/             Dashboard, QuickBooks, Import, Records, Matching, Rules, Record Types
```

## Notes and next steps

- Matching runs in the browser, which is fine up to tens of thousands of records.
  If you need more, move `src/lib/matching.js` into a Base44 function; it has no dependencies.
- QuickBooks sync runs as one backend call per object type so each call stays
  under function time limits. A scheduled Base44 automation can call
  `quickbooksImport` with a `since` date for nightly syncs.
- Possible next steps: write matches back to QuickBooks (e.g. create an Invoice from an
  unmatched Sales Order, or apply a Customer Deposit), and pull deposits directly from Stripe
  and banks instead of from CSV.
