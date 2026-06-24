/* ============================================================
   INVOICE.JS — Orbit Logistics Invoice System
   Express Goods Carrier platform · shared by customer + owner

   Responsibilities:
   - LR number generation (LR-YYYY-NNNNN)
   - Invoice config (signature, bank details, brand) — single doc,
     editable without code changes
   - Auto-build invoice record from quote + order data
   - Render a print/PDF-ready A4 Orbit-branded invoice
   - Money + words formatting helpers

   Depends on: window.EGC (phase3-core.js), fbDB, firebase
   ============================================================ */

(function () {
  'use strict';

  window.INV = window.INV || {};

  /* ----------------------------------------------------------
     BRAND + DEFAULT CONFIG
     Stored in Firestore at invoiceConfig/default so the owner can
     swap the signature / bank details later without a code change.
     These constants are the fallback if that doc is missing.
  ---------------------------------------------------------- */
  var ORBIT_BRAND = {
    name:        'ORBIT LOGISTICS',
    tagline:     'Choose Orbit. Move Smarter.',
    phones:      '9826024265, 9424594681',
    email:       'theorbitlogistics@gmail.com',
    address:     'H.O.- Shop 4, Mhow Neemuch Road, Near D\u2019 Mart, Sector No. 1, Pithampur, Distt- Dhar, Madhya Pradesh - 454775',
    gst:         '23AQOPM7933Q3ZX',
    pan:         'AQOPM7933Q',
    transportReg:'9826024265'
  };
  window.INV.BRAND = ORBIT_BRAND;

  var DEFAULT_CONFIG = {
    bankName:      'YES BANK LTD',
    accountNumber: '067961900001724',
    ifsc:          'YESB0000679',
    /* Approved digital signature, shown automatically on every invoice/PDF.
       Replaceable later by setting invoiceConfig/default.signatureUrl to a
       hosted URL or PNG/SVG data-URI. Only an empty string falls back to a
       blank signature line. */
    signatureUrl:  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTMwIiB2aWV3Qm94PSIwIDAgMzIwIDEzMCI+CjxwYXRoIGQ9Ik00MCA5NSBDIDM4IDYwIDUwIDMwIDcwIDMyIEMgODYgMzQgNzggNzAgNjQgODQgQyA1NiA5MiA1MiA3MCA2MCA1OCBDIDcyIDQwIDk2IDM4IDExMCA1MiBDIDEyMCA2MiAxMDggODYgMTE4IDkwIEMgMTMyIDk2IDE1MCA2MCAxNTggNDAgQyAxNjIgMzAgMTU2IDY0IDE2OCA3MCBDIDE4MiA3NyAyMTAgNDAgMjMyIDM0IEMgMjUyIDI5IDIzNiA3MCAyMjIgODIgQyAyMTQgODkgMjMwIDY0IDI0NiA1OCBDIDI2OCA1MCAyODYgNjAgMjkwIDc0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxYTJhNGEiIHN0cm9rZS13aWR0aD0iMy4yIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPHBhdGggZD0iTTQ4IDEwNCBDIDExMCA5MiAyMDAgOTYgMjY4IDEwMCBDIDI4MCAxMDEgMjYyIDExMCAyNTAgMTA4IiBmaWxsPSJub25lIiBzdHJva2U9IiMxYTJhNGEiIHN0cm9rZS13aWR0aD0iMi40IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPC9zdmc+',
    signatoryName: 'Authorized Signatory',
    terms: [
      'All disputes subject to our DHAR, MADHYA PRADESH jurisdiction.',
      'Penalty / Interest will be charged if not paid on presentation.',
      'GST will be paid by Consignor / Consignee / Transporter.',
      'GST exempt is given on hire to GOODS TRANSPORT COMPANY.'
    ],
    gstPayableBy: 'Consignee'
  };
  window.INV.DEFAULT_CONFIG = DEFAULT_CONFIG;

  var _configCache = null;
  window.INV.loadConfig = function () {
    if (_configCache) return Promise.resolve(_configCache);
    return fbDB.collection('invoiceConfig').doc('default').get()
      .then(function (snap) {
        _configCache = snap.exists
          ? Object.assign({}, DEFAULT_CONFIG, snap.data())
          : DEFAULT_CONFIG;
        return _configCache;
      })
      .catch(function () { return DEFAULT_CONFIG; });
  };

  /* ----------------------------------------------------------
     NUMBER GENERATION — LR number, append-only via counters
     Invoice number already comes from EGC.nextInvoiceId().
  ---------------------------------------------------------- */
  window.INV.nextLrNumber = function () {
    /* EGC.nextSequentialId is private; replicate the pattern using a
       dedicated counter so LR + invoice never collide. */
    var year = new Date().getFullYear();
    var ref  = fbDB.collection('counters').doc('lr');
    return fbDB.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        var data = snap.exists ? snap.data() : null;
        var seq  = 1;
        if (data && data.year === year) seq = (data.lastSeq || 0) + 1;
        tx.set(ref, { year: year, lastSeq: seq }, { merge: true });
        var padded = ('00000' + seq).slice(-5);
        return 'LR-' + year + '-' + padded;
      });
    });
  };

  /* ----------------------------------------------------------
     MONEY HELPERS
  ---------------------------------------------------------- */
  function toNum(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  window.INV.toNum = toNum;

  window.INV.fmtMoney = function (v) {
    var n = toNum(v);
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  /* Indian-system number-to-words for the amount-in-words line */
  window.INV.amountInWords = function (amount) {
    var num = Math.round(toNum(amount));
    if (num === 0) return 'ZERO RUPEES ONLY';
    var ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
      'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
      'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    var tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
    function two(n) {
      if (n < 20) return ones[n];
      return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    }
    function three(n) {
      var h = Math.floor(n / 100), r = n % 100;
      return (h ? ones[h] + ' HUNDRED' + (r ? ' AND ' : '') : '') + (r ? two(r) : '');
    }
    var out = [];
    var crore = Math.floor(num / 10000000); num %= 10000000;
    var lakh  = Math.floor(num / 100000);   num %= 100000;
    var thou  = Math.floor(num / 1000);      num %= 1000;
    var hund  = num;
    if (crore) out.push(three(crore) + ' CRORE');
    if (lakh)  out.push(two(lakh) + ' LAKH');
    if (thou)  out.push(two(thou) + ' THOUSAND');
    if (hund)  out.push(three(hund));
    return out.join(' ').replace(/\s+/g, ' ').trim() + ' RUPEES, ZERO PAISE ONLY';
  };

  /* ----------------------------------------------------------
     TOTALS — single source of truth for invoice maths
  ---------------------------------------------------------- */
  window.INV.computeTotals = function (inv) {
    var freight   = toNum(inv.freightCharges);
    var halting   = toNum(inv.haltingCharges);
    var extra     = toNum(inv.extraCharges);
    var discount  = toNum(inv.discount);
    var tax       = toNum(inv.tax);
    var advance   = toNum(inv.advanceReceived);
    var received  = toNum(inv.receivedAmount);

    var subTotal   = freight + halting + extra;
    var tripAmount = subTotal - discount;
    var invoiceValue = tripAmount + tax;
    var netPayable = invoiceValue - advance;
    /* Outstanding reflects all money actually received (advance + later payments) */
    var outstanding = Math.max(0, invoiceValue - advance - received);

    return {
      subTotal:    subTotal,
      tripAmount:  tripAmount,
      invoiceValue: invoiceValue,
      netPayable:  netPayable,
      outstanding: outstanding
    };
  };

  /* ----------------------------------------------------------
     BUILD INVOICE RECORD from quote + order
     Auto-populates every field the platform already knows.
     Owner-supplied / future fields are nullable, never blocking.
  ---------------------------------------------------------- */
  window.INV.buildRecord = function (opts) {
    /* opts: { invoiceId, lrNumber, order, quote } */
    var order = opts.order || {};
    var quote = opts.quote || {};
    var now   = new Date();
    var due   = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); /* +15 days */

    var freight = toNum(order.revisedPrice || quote.revisedPrice || 0);

    var rec = {
      /* identity + links */
      invoiceId:      opts.invoiceId,
      invoiceNumber:  opts.invoiceId,
      lrNumber:       opts.lrNumber,
      orderId:        order.orderId || null,
      quoteId:        order.quoteId || quote.quoteId || null,
      customerUid:    order.customerUid || quote.customerUid || null,

      /* customer (auto from quote/order) */
      customerName:   order.customerName || quote.customerName || '',
      customerCompany:order.companyName  || quote.companyName  || '',
      customerGst:    quote.customerGst  || order.customerGst  || '',
      customerPhone:  quote.customerPhone|| order.customerPhone|| '',
      customerEmail:  quote.customerEmail|| order.customerEmail|| '',

      /* consignment (auto) */
      fromLocation:   order.pickup   || quote.pickup   || '',
      toLocation:     order.delivery || quote.delivery || '',
      material:       order.materialType || quote.materialType || '',
      weight:         order.weight   || quote.weight   || '',
      packages:       order.packages || quote.packages || '',
      vehicleType:    order.vehicleType   || '',
      vehicleNumber:  order.vehicleNumber || '',

      /* dates */
      invoiceDate:    firebase.firestore.Timestamp.fromDate(now),
      dueDate:        firebase.firestore.Timestamp.fromDate(due),

      /* charges (freight auto from price; rest default 0, owner-editable) */
      freightCharges: freight,
      haltingCharges: 0,
      extraCharges:   0,
      discount:       0,
      tax:            0,
      advanceReceived:0,
      remarks:        '',

      /* payment tracking (accounting-ready flat fields) */
      invoiceAmount:  freight,             /* invoice value snapshot */
      receivedAmount: 0,
      outstandingAmount: freight,
      paymentStatus:  'pending',           /* pending | partial | paid | overdue */
      paymentDate:    null,

      createdAt:      firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:      firebase.firestore.FieldValue.serverTimestamp()
    };

    /* keep amount fields coherent with computeTotals */
    var t = window.INV.computeTotals(rec);
    rec.invoiceAmount     = t.invoiceValue;
    rec.outstandingAmount = t.outstanding;
    return rec;
  };

  /* ----------------------------------------------------------
     PAYMENT STATUS helpers
  ---------------------------------------------------------- */
  var PAYMENT_LABELS = {
    pending: 'Pending',
    partial: 'Partially Paid',
    paid:    'Paid',
    overdue: 'Overdue'
  };
  window.INV.PAYMENT_LABELS = PAYMENT_LABELS;
  window.INV.paymentLabel = function (s) { return PAYMENT_LABELS[s] || s; };
  window.INV.paymentClass = function (s) {
    if (s === 'paid')    return 'pay-paid';
    if (s === 'partial') return 'pay-partial';
    if (s === 'overdue') return 'pay-overdue';
    return 'pay-pending';
  };

  /* Auto-flag overdue when past due date and not fully paid */
  window.INV.effectiveStatus = function (inv) {
    if (inv.paymentStatus === 'paid') return 'paid';
    var due = inv.dueDate && inv.dueDate.toDate ? inv.dueDate.toDate() : null;
    if (due && Date.now() > due.getTime() && inv.paymentStatus !== 'paid') {
      return inv.paymentStatus === 'partial' ? 'partial' : 'overdue';
    }
    return inv.paymentStatus || 'pending';
  };

  /* ----------------------------------------------------------
     DATE FORMAT
  ---------------------------------------------------------- */
  function fmtDMY(ts) {
    var d = ts && ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return '\u2014';
    var dd = ('0' + d.getDate()).slice(-2);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    return dd + '-' + mm + '-' + d.getFullYear();
  }
  window.INV.fmtDMY = fmtDMY;

  /* ----------------------------------------------------------
     ORBIT LOGO (inline SVG so PDFs never depend on an external file)
  ---------------------------------------------------------- */
  function orbitLogoSVG(size) {
    /* Stylized "Orbit" wordmark: swoosh-O with dot + LOGISTICS underline,
       matching the approved reference's left-hand logo block. */
    size = size || 150;
    return '' +
    '<svg width="' + size + '" height="' + (size * 0.5) + '" viewBox="0 0 200 100" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      /* swoosh O */
      '<path d="M44 78 C22 78 12 62 16 44 C20 26 38 16 56 18 C72 20 80 34 76 50 C72 66 54 76 40 70" stroke="#f26522" stroke-width="9" stroke-linecap="round" fill="none"/>' +
      '<circle cx="62" cy="20" r="7" fill="#1a1a1a"/>' +
      /* rbit wordmark */
      '<text x="58" y="64" font-family="Georgia,\'Times New Roman\',serif" font-size="46" font-style="italic" font-weight="700" fill="#1a1a1a">rbit</text>' +
      /* LOGISTICS bar */
      '<rect x="16" y="80" width="158" height="14" rx="2" fill="#f26522"/>' +
      '<text x="95" y="91" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="3" fill="#fff">LOGISTICS</text>' +
    '</svg>';
  }
  window.INV.orbitLogoSVG = orbitLogoSVG;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ----------------------------------------------------------
     RENDER A4 INVOICE HTML — Orbit branded, white bg, print/PDF ready
     Returns a complete standalone HTML document string.
  ---------------------------------------------------------- */
  window.INV.renderHTML = function (inv, config) {
    config = config || DEFAULT_CONFIG;
    var t = window.INV.computeTotals(inv);
    var status = window.INV.effectiveStatus(inv);
    var b = ORBIT_BRAND;

    var sigBlock = config.signatureUrl
      ? '<img src="' + esc(config.signatureUrl) + '" alt="Signature" class="sig-img"/>'
      : '<div class="sig-line"></div>';

    var termsHTML = (config.terms || DEFAULT_CONFIG.terms).map(function (term, i) {
      return '<li><span class="tnum">' + (i + 1) + '.</span> ' + esc(term) + '</li>';
    }).join('');

    var weightStr = inv.weight ? (esc(inv.weight) + ' KGS') : '\u2014';
    var pkgStr    = inv.packages ? ('(Nos:' + esc(inv.packages) + ')') : '';

    return '' +
'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'<title>' + esc(inv.invoiceNumber) + ' — Orbit Logistics</title>' +
'<style>' +
'*{margin:0;padding:0;box-sizing:border-box;}' +
'body{font-family:Arial,Helvetica,sans-serif;background:#e9ecf1;color:#1a1a1a;padding:20px;}' +
'.page{width:794px;min-height:1123px;margin:0 auto;background:#fff;position:relative;padding:34px 38px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,.12);}' +
/* watermark — sits behind content, very light, never collides with text */
'.wm{position:absolute;top:58%;left:50%;transform:translate(-50%,-50%);width:560px;text-align:center;pointer-events:none;z-index:0;}' +
'.wm .wm-orbit{font-family:Georgia,\'Times New Roman\',serif;font-style:italic;font-weight:700;font-size:150px;line-height:.9;color:rgba(242,101,34,.08);letter-spacing:-3px;}' +
'.wm .wm-band{display:inline-block;background:rgba(120,130,145,.05);border-radius:8px;padding:4px 30px;margin-top:-6px;}' +
'.wm .wm-logistics{font-family:Arial,sans-serif;font-weight:800;font-size:58px;letter-spacing:16px;color:rgba(120,130,145,.10);}' +
'.wm .wm-tag{font-family:Georgia,serif;font-style:italic;font-size:30px;color:rgba(120,130,145,.09);margin-top:6px;}' +
'.layer{position:relative;z-index:1;}' +
/* header */
'.head{display:flex;gap:16px;align-items:flex-start;}' +
'.logo-wrap{flex:none;text-align:left;width:200px;padding-top:4px;}' +
'.logo-name{font-size:13px;font-weight:800;color:#f26522;letter-spacing:1px;margin-top:2px;}' +
'.logo-sub{font-size:7.5px;color:#444;font-style:italic;margin-top:1px;}' +
'.logo-tag{font-size:9.5px;color:#1a1a1a;font-style:italic;font-weight:600;margin-top:4px;}' +
'.brand-mid{flex:1;text-align:center;padding-top:14px;}' +
'.brand-mid h1{font-size:34px;font-weight:800;letter-spacing:1px;line-height:1;}' +
'.brand-mid h1 .lt{color:#f26522;}.brand-mid h1 .dk{color:#1a1a1a;}' +
'.brand-tag{font-size:13px;color:#1a1a1a;font-style:italic;margin-top:10px;position:relative;display:inline-block;padding:0 26px;}' +
'.brand-tag:before,.brand-tag:after{content:"";position:absolute;top:50%;width:18px;height:2px;background:#f26522;}' +
'.brand-tag:before{left:0;}.brand-tag:after{right:0;}' +
/* right column = badge stacked above contact (no overlap) */
'.head-right{flex:none;width:248px;display:flex;flex-direction:column;align-items:flex-end;}' +
'.tax-badge{display:inline-block;background:#1a1a1a;color:#fff;font-weight:800;font-size:15px;letter-spacing:1px;padding:8px 24px;border-radius:16px;margin-bottom:14px;}' +
'.contact{width:100%;font-size:10.5px;color:#333;}' +
'.contact div{display:flex;gap:7px;margin-bottom:6px;align-items:flex-start;}' +
'.contact .ico{color:#f26522;font-weight:bold;flex:none;width:14px;text-align:center;}' +
/* gst bar */
'.gstbar{display:flex;justify-content:space-between;gap:20px;border-top:2px solid #f26522;border-bottom:2px solid #f26522;margin:14px 0 16px;padding:9px 4px;font-size:11px;font-weight:600;}' +
'.gstbar .sep{color:#f26522;}' +
/* bill + meta */
'.row2{display:flex;gap:16px;margin-bottom:16px;}' +
'.bill{flex:1.4;border:1px solid #e3e3e3;border-radius:8px;padding:14px 16px;}' +
'.bill .lbl{display:flex;align-items:center;gap:7px;font-weight:800;font-size:12px;color:#f26522;margin-bottom:9px;}' +
'.bill .dot{width:16px;height:16px;border-radius:50%;background:#f26522;color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center;}' +
'.bill .cname{font-weight:800;font-size:12.5px;line-height:1.5;text-transform:uppercase;}' +
'.bill .caddr{font-size:11px;color:#333;line-height:1.6;margin-top:2px;}' +
'.bill .cgst{font-size:11px;margin-top:7px;}.bill .cgst b{font-weight:700;}' +
'.meta{flex:1;border:1px solid #e3e3e3;border-radius:8px;padding:14px 16px;}' +
'.meta .mrow{display:flex;font-size:11.5px;margin-bottom:9px;align-items:center;}' +
'.meta .mrow .mi{color:#f26522;width:16px;flex:none;}' +
'.meta .mrow .mk{flex:1;color:#444;}.meta .mrow .mc{color:#888;padding:0 8px;}.meta .mrow .mv{font-weight:700;}' +
/* table */
'table.lr{width:100%;border-collapse:collapse;margin-bottom:0;font-size:10px;}' +
'table.lr th{background:#fff;border:1px solid #d8d8d8;padding:8px 5px;font-size:8.5px;font-weight:800;text-transform:uppercase;color:#222;text-align:center;line-height:1.25;}' +
'table.lr td{border:1px solid #d8d8d8;padding:13px 6px;text-align:center;font-size:10.5px;vertical-align:middle;}' +
'.lrno{color:#f26522;font-weight:800;font-size:12px;}' +
'.lrdate{font-size:9px;color:#555;margin-top:3px;}' +
'.tripamt{color:#f26522;font-weight:800;}' +
'.cw{font-size:8.5px;color:#666;font-style:italic;margin-top:3px;}' +
/* hsn + totals */
'.row3{display:flex;gap:20px;margin-top:16px;}' +
'.left3{flex:1.25;}' +
'.hsn{font-size:11.5px;margin-bottom:26px;}.hsn .ul{display:inline-block;border-bottom:1px solid #bbb;min-width:230px;height:16px;margin-left:4px;font-weight:600;color:#222;line-height:14px;}' +
'.amtwords{font-size:11px;font-weight:700;color:#222;margin-top:30px;line-height:1.5;}' +
'.totals{flex:1;}' +
'.totals .tr{display:flex;justify-content:space-between;font-size:11.5px;padding:7px 2px;}' +
'.totals .tr.b{border-bottom:1px solid #eee;}' +
'.totals .tr .k{color:#333;font-weight:600;}' +
'.totals .tr.big .k{font-weight:800;}.totals .tr.big .v{font-weight:800;}' +
'.totals .tr.value .k{color:#f26522;font-weight:800;font-size:13px;}' +
'.totals .tr.value .v{color:#f26522;font-weight:800;font-size:15px;}' +
'.netbar{display:flex;justify-content:space-between;background:#f26522;color:#fff;padding:11px 14px;font-weight:800;font-size:14px;border-radius:5px;margin-top:6px;}' +
'.gstpay{text-align:center;font-size:11px;margin:16px 0;}.gstpay b{font-weight:800;}' +
/* footer blocks */
'.foot3{display:flex;gap:14px;border:1px solid #e3e3e3;border-radius:8px;overflow:hidden;margin-top:8px;}' +
'.fcol{flex:1;padding:14px 16px;}' +
'.fcol+.fcol{border-left:1px solid #e8e8e8;}' +
'.fhead{display:flex;align-items:center;gap:7px;font-weight:800;font-size:11px;color:#f26522;text-transform:uppercase;margin-bottom:10px;}' +
'.terms li{font-size:9px;color:#333;line-height:1.5;margin-bottom:7px;list-style:none;display:flex;gap:5px;}' +
'.terms .tnum{color:#f26522;font-weight:700;flex:none;}' +
'.bank p{font-size:10.5px;margin-bottom:7px;color:#222;}.bank p b{font-weight:700;}' +
'.sigbox{text-align:center;}' +
'.sig-for{font-size:11px;color:#333;margin-bottom:8px;}.sig-for b{font-weight:800;}' +
'.sig-img{max-width:150px;max-height:64px;margin:0 auto;display:block;}' +
'.sig-line{height:54px;border-bottom:1.5px solid #333;width:160px;margin:0 auto 6px;}' +
'.sig-name{font-size:10.5px;color:#333;border-top:1px solid #ccc;padding-top:6px;margin-top:6px;}' +
/* trust + thanks */
'.trust{display:flex;justify-content:space-around;margin:22px 0 14px;padding:0 10px;}' +
'.trust .ti{display:flex;align-items:center;gap:9px;font-size:10.5px;font-weight:700;color:#222;text-transform:uppercase;line-height:1.3;}' +
'.trust .tic{width:30px;height:30px;color:#f26522;flex:none;}' +
'.thanks{background:#1a1a1a;color:#fff;text-align:center;padding:11px;border-radius:18px;font-weight:700;font-size:13px;letter-spacing:.5px;}' +
'.statusflag{position:absolute;top:64px;left:50%;transform:translateX(-50%) rotate(-8deg);font-size:38px;font-weight:900;letter-spacing:4px;opacity:.10;z-index:0;text-transform:uppercase;}' +
'.sf-paid{color:#22a06b;}.sf-overdue{color:#d93636;}.sf-partial{color:#d98a00;}.sf-pending{color:#888;}' +
'@media print{body{background:#fff;padding:0;}.page{box-shadow:none;width:100%;min-height:auto;}@page{size:A4;margin:8mm;}}' +
'</style></head><body>' +
'<div class="page">' +
  '<div class="wm">' +
    '<div class="wm-orbit">Orbit</div>' +
    '<div class="wm-band"><span class="wm-logistics">LOGISTICS</span></div>' +
    '<div class="wm-tag">Choose Orbit. Move Smarter.</div>' +
  '</div>' +
  (status !== 'pending' ? '<div class="statusflag sf-' + status + '">' + esc(window.INV.paymentLabel(status)) + '</div>' : '') +
  '<div class="layer">' +
    /* header */
    '<div class="head">' +
      '<div class="logo-wrap">' + orbitLogoSVG(150) +
        '<div class="logo-tag">' + esc(b.tagline) + '</div>' +
      '</div>' +
      '<div class="brand-mid">' +
        '<h1><span class="lt">ORBIT</span> <span class="dk">LOGISTICS</span></h1>' +
        '<div class="brand-tag">' + esc(b.tagline) + '</div>' +
      '</div>' +
      '<div class="head-right">' +
        '<div class="tax-badge">TAX INVOICE</div>' +
        '<div class="contact">' +
          '<div><span class="ico">\u260E</span><span>' + esc(b.phones) + '</span></div>' +
          '<div><span class="ico">\u2709</span><span>' + esc(b.email) + '</span></div>' +
          '<div><span class="ico">\u25C9</span><span>' + esc(b.address) + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    /* gst bar */
    '<div class="gstbar">' +
      '<span>GST : <b>' + esc(b.gst) + '</b></span><span class="sep">|</span>' +
      '<span>PAN : <b>' + esc(b.pan) + '</b></span><span class="sep">|</span>' +
      '<span>Transport Reg : <b>' + esc(b.transportReg) + '</b></span>' +
    '</div>' +
    /* bill to + meta */
    '<div class="row2">' +
      '<div class="bill">' +
        '<div class="lbl"><span class="dot">\u25CF</span> BILL TO</div>' +
        '<div class="cname">' + esc(inv.customerCompany || inv.customerName) + '</div>' +
        '<div class="caddr">' + (inv.customerName && inv.customerCompany ? 'Attn: ' + esc(inv.customerName) + '<br>' : '') +
          (inv.customerPhone ? 'Phone: ' + esc(inv.customerPhone) + '<br>' : '') +
          (inv.customerEmail ? esc(inv.customerEmail) : '') + '</div>' +
        (inv.customerGst ? '<div class="cgst">GST No : <b>' + esc(inv.customerGst) + '</b></div>' : '<div class="cgst">GST No : <b>\u2014</b></div>') +
      '</div>' +
      '<div class="meta">' +
        '<div class="mrow"><span class="mi">\u25A4</span><span class="mk">Date</span><span class="mc">:</span><span class="mv">' + fmtDMY(inv.invoiceDate) + '</span></div>' +
        '<div class="mrow"><span class="mi">\u25A4</span><span class="mk">Invoice Number</span><span class="mc">:</span><span class="mv">' + esc(inv.invoiceNumber) + '</span></div>' +
        '<div class="mrow"><span class="mi">\u25A4</span><span class="mk">Due Date</span><span class="mc">:</span><span class="mv">' + fmtDMY(inv.dueDate) + '</span></div>' +
        '<div class="mrow"><span class="mi">\u25A4</span><span class="mk">Order ID</span><span class="mc">:</span><span class="mv">' + esc(inv.orderId || '\u2014') + '</span></div>' +
      '</div>' +
    '</div>' +
    /* LR table */
    '<table class="lr">' +
      '<thead><tr>' +
        '<th>LR/GR/BLTY<br>NUMBER</th><th>TRUCK<br>NUMBER</th><th>FROM - TO</th>' +
        '<th>MATERIAL<br>PARCEL DETAILS</th><th>TOTAL<br>WEIGHT</th><th>FREIGHT<br>AMOUNT</th>' +
        '<th>HALTING<br>CHARGE</th><th>EXTRA<br>CHARGE</th><th>ADVANCE</th><th>TRIP<br>AMOUNT</th>' +
      '</tr></thead><tbody><tr>' +
        '<td><div class="lrno">' + esc(inv.lrNumber || '\u2014') + '</div><div class="lrdate">' + fmtDMY(inv.invoiceDate) + '</div></td>' +
        '<td>' + esc(inv.vehicleNumber || '\u2014') + (inv.vehicleType ? '<div class="cw">' + esc(inv.vehicleType) + '</div>' : '') + '</td>' +
        '<td>' + esc((inv.fromLocation || '').toUpperCase()) + '<br>-<br>' + esc((inv.toLocation || '').toUpperCase()) + '</td>' +
        '<td>' + esc((inv.material || '\u2014').toUpperCase()) + (pkgStr ? '<br>' + pkgStr : '') + '</td>' +
        '<td>' + weightStr + (inv.weight ? '<div class="cw">Charged Weight ' + esc(inv.weight) + ' KGS</div>' : '') + '</td>' +
        '<td>' + window.INV.fmtMoney(inv.freightCharges) + '</td>' +
        '<td>' + window.INV.fmtMoney(inv.haltingCharges) + '</td>' +
        '<td>' + window.INV.fmtMoney(inv.extraCharges) + '</td>' +
        '<td>' + window.INV.fmtMoney(inv.advanceReceived) + '</td>' +
        '<td class="tripamt">' + window.INV.fmtMoney(t.tripAmount) + '</td>' +
      '</tr></tbody>' +
    '</table>' +
    /* hsn + totals */
    '<div class="row3">' +
      '<div class="left3">' +
        '<div class="hsn">HSN / SAC : <span class="ul"></span></div>' +
        '<div class="hsn">Remarks : <span class="ul">' + (inv.remarks ? '&nbsp;' + esc(inv.remarks) : '') + '</span></div>' +
        '<div class="amtwords">' + esc(window.INV.amountInWords(t.netPayable)) + '</div>' +
      '</div>' +
      '<div class="totals">' +
        '<div class="tr b"><span class="k">SUB TOTAL</span><span class="v">' + window.INV.fmtMoney(t.subTotal) + '</span></div>' +
        '<div class="tr b"><span class="k">DISCOUNT</span><span class="v">- ' + window.INV.fmtMoney(inv.discount) + '</span></div>' +
        '<div class="tr b big"><span class="k">TOTAL TRIP AMOUNT</span><span class="v">' + window.INV.fmtMoney(t.tripAmount) + '</span></div>' +
        (toNum(inv.tax) ? '<div class="tr b"><span class="k">TAX</span><span class="v">' + window.INV.fmtMoney(inv.tax) + '</span></div>' : '') +
        '<div class="tr value b"><span class="k">INVOICE VALUE</span><span class="v">' + window.INV.fmtMoney(t.invoiceValue) + '</span></div>' +
        '<div class="tr b"><span class="k">ADVANCE RECEIVED</span><span class="v">- ' + window.INV.fmtMoney(inv.advanceReceived) + '</span></div>' +
        '<div class="netbar"><span>NET PAYABLE</span><span>' + window.INV.fmtMoney(t.netPayable) + '</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="gstpay">GST Payable by: <b>' + esc(config.gstPayableBy || 'Consignee') + '</b></div>' +
    /* terms + bank + signature */
    '<div class="foot3">' +
      '<div class="fcol"><div class="fhead">\u25A4 TERMS &amp; CONDITIONS</div><ul class="terms">' + termsHTML + '</ul></div>' +
      '<div class="fcol bank"><div class="fhead">\u25A4 BANK DETAILS</div>' +
        '<p>Bank Name : <b>' + esc(config.bankName) + '</b></p>' +
        '<p>Account Number : <b>' + esc(config.accountNumber) + '</b></p>' +
        '<p>IFSC Code : <b>' + esc(config.ifsc) + '</b></p>' +
      '</div>' +
      '<div class="fcol sigbox"><div class="sig-for">For <b>ORBIT LOGISTICS</b></div>' + sigBlock +
        '<div class="sig-name">' + esc(config.signatoryName || 'Authorized Signatory') + '</div>' +
      '</div>' +
    '</div>' +
    /* trust row */
    '<div class="trust">' +
      '<div class="ti"><svg class="tic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg><span>SAFE &amp; SECURE<br>TRANSPORT</span></div>' +
      '<div class="ti"><svg class="tic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg><span>ON TIME<br>EVERY TIME</span></div>' +
      '<div class="ti"><svg class="tic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 11l3 3 2-3 3 3M2 12l4-4 3 3"/><path d="M14 8l4-4 4 4-4 4"/></svg><span>TRUSTED BY<br>BUSINESSES</span></div>' +
    '</div>' +
    '<div class="thanks">Thank you for your business!</div>' +
  '</div>' +
'</div>' +
'</body></html>';
  };

  /* ----------------------------------------------------------
     OPEN / PRINT / DOWNLOAD
  ---------------------------------------------------------- */
  window.INV.openInvoiceWindow = function (inv, autoPrint) {
    return window.INV.loadConfig().then(function (config) {
      var html = window.INV.renderHTML(inv, config);
      var w = window.open('', '_blank');
      if (!w) { return false; }
      w.document.write(html);
      w.document.close();
      if (autoPrint) setTimeout(function () { w.focus(); w.print(); }, 500);
      return true;
    });
  };

})();
