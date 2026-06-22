# PHASE 2 STATE — Authentication & Customer Portal Foundation
Express Goods Carrier — Transport Operating System (TOS)

Status: **Complete**
Stack: Firebase Authentication (Google + Email/Password) + Firestore

---

## 1. Files Created

| File | Purpose |
|---|---|
| `js/firebase-config.js` | Firebase project config + `initializeApp()`. The **only** file with Firebase keys. |
| `js/auth.js` | Core auth engine: nav rendering (Sign In / My Account), auth modal (Google / Email sign-up, sign-in, forgot password), onboarding modal, auth-gating (`TOS.requireAuth`), Firestore writes for `users` and `customerProfiles`. Loaded on every page. |
| `css/auth.css` | All auth/dashboard UI styling. Reuses the homepage's existing design tokens (`--amber`, `--d1`–`--d4`, `--muted`, `--line`, etc.) — no new colors or fonts introduced. |
| `dashboard.html` | Customer Dashboard Foundation. Tabs: New Shipment, Order History, Favorite Routes, Profile, Support. |
| `js/dashboard.js` | Dashboard logic: auth guard (redirects home if signed out), tab switching, Profile read/write, Favorite Routes CRUD. |
| `PHASE2_STATE.md` | This file. |

## 2. Files Modified

| File | Change |
|---|---|
| `egc-phase1-refined-2.html` | (a) `<link>` to `css/auth.css` added before `</head>`. (b) `<div id="authNav"></div>` added in the desktop nav, right after the language toggle. (c) `<div id="authNavMobile"></div>` added in the mobile menu. (d) Firebase SDK + `firebase-config.js` + `auth.js` `<script>` tags added before `</body>`. (e) `doQuote()` split: original logic renamed to `doQuoteSubmit()`; new `doQuote()` wraps it in `TOS.requireAuth(...)` so the quote form requires login only at the point of submission. |

**Nothing else changed** — hero, about, services, fleet, network, clients, why-us, gallery, footer, Hindi/English translations, and all visual styling are untouched.

---

## 3. Database Structure (Firestore)

Designed so Phase 3+ (quotation, tracking, invoicing, loyalty, AI) can attach to these collections via `uid` / `customerId` without restructuring.

```
users/{uid}                          ← lightweight auth mirror
  uid              string
  name             string | null
  email            string | null
  phone            string | null
  authProvider     string            ("google.com" | "password")
  createdAt        timestamp
  lastLoginAt      timestamp

customerProfiles/{uid}               ← business profile (1:1 with uid)
  uid                  string
  companyName          string
  contactPerson        string
  mobile               string
  email                string
  gstNumber            string | null
  onboardingComplete   boolean
  createdAt            timestamp
  updatedAt            timestamp

  customerProfiles/{uid}/savedRoutes/{routeId}   ← subcollection
    pickup       string
    delivery     string
    createdAt    timestamp
```

### Why two collections (`users` vs `customerProfiles`)?
- `users` is the thin identity record tied 1:1 to Firebase Auth (kept stable even if business details change).
- `customerProfiles` is the business-facing data the customer actually edits, and is what future phases (shipments, invoices) will join against via `uid`.

### Reserved for future phases (not built yet — documented for forward compatibility)
```
quotations/{id}        customerId(uid), routeId, cargoType, status, ratePerTon, createdAt
shipments/{id}          customerId(uid), quotationId, routeId, status, trackingEvents[], createdAt
invoices/{id}           customerId(uid), shipmentId, amount, status, dueDate
loyaltyLedger/{uid}     points, tier, history[]
aiThreads/{uid}/messages/{id}   role, content, createdAt
```
All planned future documents key off **`customerId` = the same Firebase `uid`** used today, and routes/shipments can reference `savedRoutes` doc IDs — so no migration is needed when those phases are built.

### Firestore Security Rules (to add in Firebase Console)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /customerProfiles/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      match /savedRoutes/{routeId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

---

## 4. Authentication Flow

1. **Visitor browses freely** — no login prompt anywhere on the homepage. Sign In button sits quietly in the navbar.
2. **Visitor clicks "Get A Quote" → fills form → hits submit.**
   `doQuote()` calls `TOS.requireAuth(doQuoteSubmit)`.
   - If already signed in **and** onboarded → `doQuoteSubmit()` runs immediately (no interruption).
   - If not signed in → auth modal opens (Google primary, Email secondary) with the "save shipment history / faster bookings" pitch. The quote submission is stored as a **pending action**.
3. **User signs in** (Google popup, or email sign-up/sign-in).
   `onAuthStateChanged` fires → writes/updates `users/{uid}` → checks `customerProfiles/{uid}`.
4. **First login** (`customerProfiles/{uid}` doesn't exist yet) → **onboarding modal** opens automatically, pre-filled with Google's `displayName`/`email`/photo where available. Only asks: Company Name, Contact Person (pre-filled), Mobile Number, GST (optional).
5. **Onboarding saved** → `customerProfiles/{uid}` created → nav updates to "My Account" → the **pending action runs automatically** (the quote the user originally tried to send goes through without them re-filling anything).
6. **Returning visits**: nav shows "My Account" with avatar; quote form's Name/Phone fields auto-fill from the saved profile.
7. **Logout**: available from the My Account dropdown on every page.

---

## 5. Future Integration Points

| Future Phase | Hooks already in place |
|---|---|
| Smart Quotation System | `TOS.requireAuth()` gate is reusable for any new "place order" CTA. `customerProfiles/{uid}/savedRoutes` ready to pre-fill route pickers. |
| Tracking System | `users/{uid}` + `customerProfiles/{uid}` give a stable `uid` to attach `shipments/{id}.customerId`. Dashboard's "Order History" tab is a placeholder panel ready to be wired to real data. |
| Invoice System | Same `uid` join; "Order History" panel doubles as the natural home for invoice links. |
| Loyalty System | Add `loyaltyLedger/{uid}` — no schema change needed elsewhere. |
| AI Assistant | Dashboard "Support" tab is a placeholder panel — can be swapped for a chat widget; `aiThreads/{uid}` keyed the same way as everything else. |
| Driver Portal / Owner Dashboard | Out of scope for Phase 2 — would be a separate auth context (Firebase custom claims recommended), not built. |

`window.TOS` (in `auth.js`) is the single public API future code should use:
```js
TOS.requireAuth(fn)   // gate any action behind login + onboarding
TOS.getUser()         // current Firebase user or null
TOS.getProfile()       // current customerProfiles doc or null
TOS.onReady(fn)        // fn(user, profile) once auth state resolves
TOS.logout()
TOS.openSignIn()
```

---

## 6. Explicitly NOT built (per Phase 2 scope)
Mobile OTP login, Quotation System, Tracking System, Invoice System, Accounting, Driver Portal, Loyalty System, AI Assistant, Owner Dashboard, homepage redesign.

## 7. Manual setup required (Firebase Console — not code)
1. Authentication → Sign-in method → enable **Google** and **Email/Password**.
2. Firestore Database → create database (production mode) → paste the security rules from §3.
3. Authentication → Settings → Authorized domains → add your production domain when you deploy.
