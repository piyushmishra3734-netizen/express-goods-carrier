# Orbit Logistics

A production transport ERP for **Express Goods Carrier (EGC)**, a road‑freight company based in Pithampur, Madhya Pradesh. Orbit runs the full freight workflow — customer quotes, owner approvals, manual phone bookings, invoicing, Lorry Receipts (LR/Bilty), double‑entry accounting, and reporting — on a single source of truth.

## Architecture

Orbit is built on a strict **Single Source of Truth (SSoT)** model: the **Order** document is the master record, and every other module (Invoice, LR, Accounting, Reports, Excel) is a *projection* of it. Editing an order through **Manage Shipment** propagates everywhere automatically; no module stores duplicated business data.

```
Customer Quote ─┐
                ├─►  Order Engine  ─►  Order ─►  Invoice
Owner Manual ───┘                          └─►  LR
Order                                      └─►  Accounting ─► Ledger / Reports / Excel
```

Both the customer‑quote approval path and the owner manual‑order path converge on **one shared pipeline** (`OWN.runOrderPipeline`), so an order created from a phone call is indistinguishable from one created through the customer quote flow.

## Tech stack

- **Vanilla JavaScript** with window‑namespaced globals: `EGC`, `INV`, `LR`, `SHIP`, `OWN`, `CUST`, `DASH`, `CO`, `ACC`, `TOS`
- **Firebase / Firestore** with real‑time `onSnapshot` listeners
- **Firebase Auth** (Google + email/password)
- `window.print` for print‑ready PDF generation (Invoice, LR, Combined)
- Dark dashboard UI driven by CSS variables

No build step. The app is static files served directly.

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Public landing + auth entry |
| `dashboard.html` / `dashboard.js` | Customer dashboard (quotes, orders, invoices, **shipment tracking**) |
| `owner-dashboard.html` / `owner-dashboard.js` | Owner dashboard (approvals, **manual orders**, Manage Shipment, audit) |
| `accounting.html` + `acc-*.js` | Double‑entry accounting (chart of accounts, posting engine, vouchers, derived reports) |
| `shipment.js` | SSoT engine — `buildOrder`, `computeCharges`, `toInvoiceView`, `toLrView`, `toAccountingRow` |
| `invoice.js` | Invoice rendering + numbering + money helpers |
| `lr.js` | Lorry Receipt (Bilty) rendering + docket numbering |
| `phase3-core.js` | Shared IDs, statuses, reliable audit/notification queue |
| `auth.js` / `auth.css` | Auth, onboarding, navigation |
| `companies.js` | Commercial company directory (autocomplete + GST autofill) |
| `phase3.css` | Shared dashboard styling |
| `firebase-config.js` | Firebase project configuration |
| `firestore.rules` | Firestore security rules |
| `firestore.indexes.json` | Firestore composite indexes |

## Running locally

Because the app uses Firebase Auth (which requires an `http(s)` origin), serve the folder rather than opening files directly:

```bash
# any static server works, e.g.
npx serve .
# or
python3 -m http.server 8000
```

Then open the served URL (e.g. `http://localhost:8000`).

## Firebase setup

1. Create a Firebase project and enable **Authentication** (Google + Email/Password) and **Cloud Firestore**.
2. Put your project credentials in `firebase-config.js`.
3. Deploy the security rules and indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

> **Note:** The Firebase web config in `firebase-config.js` is safe to expose client‑side (standard for Firebase web apps) — access is controlled by Firestore/Auth security rules, not by hiding the config.

## Key domain concepts

SSoT · LR / Bilty · consignor / consignee · docket number · FOV (freight on value) · halting charges · forward charge vs RCM (GST) · Munim‑style double‑entry accounting.

## Pre‑launch checklist

- [ ] Replace the UDYAM registration placeholder in `invoice.js` with EGC's actual number.
- [ ] Populate real Firebase credentials in `firebase-config.js`.
- [ ] Deploy Firestore rules and indexes.
