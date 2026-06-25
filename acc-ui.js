/* ============================================================================
   ORBIT ACCOUNTING — WORKSPACE UI  (acc-ui.js)
   ----------------------------------------------------------------------------
   Owner-only workspace controller. Hydrates realtime data into ACC.setData,
   renders the sidebar + every page. All pages READ from the derived-report
   layer (ACC.report*), which folds over journalEntries — so nothing here is a
   second source of truth.
   ============================================================================ */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var fbDB = firebase.firestore();
  var esc = (window.EGC && EGC.esc) ? EGC.esc : function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  function money(v) { return '\u20B9' + Number(ACC.round2(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(v) { return '\u20B9' + Number(Math.round(v) || 0).toLocaleString('en-IN'); }
  function dmy(d) { if (!d) return '\u2014'; var p = String(d).split('-'); return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : d; }

  /* ---- realtime state ---- */
  var ready = { entries: false, accounts: false, parties: false };
  var current = 'dashboard';
  var loaded = false;

  /* ============================================================ NAVIGATION */
  var NAV = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
      { id: 'ledger',    label: 'Customer Ledger', icon: 'book' },
      { id: 'outstanding', label: 'Outstanding', icon: 'alert' },
      { id: 'sales',     label: 'Sales Register', icon: 'trending' }
    ]},
    { group: 'Books & Registers', items: [
      { id: 'purchase', label: 'Purchase Register', icon: 'cart' },
      { id: 'cashbook', label: 'Cash Book', icon: 'cash' },
      { id: 'bankbook', label: 'Bank Book', icon: 'bank' },
      { id: 'journal',  label: 'Journal', icon: 'list' }
    ]},
    { group: 'Vouchers', items: [
      { id: 'receipt', label: 'Receipt', icon: 'in' },
      { id: 'payment', label: 'Payment', icon: 'out' },
      { id: 'contra',  label: 'Contra', icon: 'swap' }
    ]},
    { group: 'Statements', items: [
      { id: 'trial',   label: 'Trial Balance', icon: 'scale' },
      { id: 'pl',      label: 'Profit & Loss', icon: 'chart' },
      { id: 'balance', label: 'Balance Sheet', icon: 'layers' }
    ]},
    { group: 'Masters', items: [
      { id: 'coa',      label: 'Chart of Accounts', icon: 'tree' },
      { id: 'parties',  label: 'Parties', icon: 'users' },
      { id: 'settings', label: 'Settings', icon: 'cog' }
    ]}
  ];
  var TITLES = {};
  NAV.forEach(function (g) { g.items.forEach(function (i) { TITLES[i.id] = i.label; }); });

  function icon(name) {
    var p = {
      grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
      book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
      alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
      trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
      cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
      cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>',
      bank: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
      list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
      in: '<path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/>',
      out: '<path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/>',
      swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
      scale: '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-3 6h6z"/><path d="M19 7l3 6h-6z"/>',
      chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
      layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
      tree: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v6a2 2 0 0 0 2 2h7"/>',
      users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>',
      cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (p[name] || '') + '</svg>';
  }

  function renderSidebar() {
    var html = '';
    NAV.forEach(function (g) {
      html += '<div class="side-group"><div class="side-glabel">' + esc(g.group) + '</div>';
      g.items.forEach(function (it) {
        html += '<div class="side-link' + (it.id === current ? ' active' : '') + '" data-page="' + it.id + '">' +
                  icon(it.icon) + '<span>' + esc(it.label) + '</span></div>';
      });
      html += '</div>';
    });
    $('#sideNav').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('.side-link'), function (el) {
      el.addEventListener('click', function () { go(el.dataset.page); });
    });
  }

  function go(pageId) {
    current = pageId;
    $('#pageTitle').textContent = TITLES[pageId] || 'Accounting';
    renderSidebar();
    render();
  }

  /* ============================================================ DATA (realtime) */
  function startListeners() {
    /* Journal entries — bounded to the most recent 1000 (Phase-4 scalable;
       date filters narrow further). Realtime so every report stays live. */
    fbDB.collection('journalEntries').orderBy('date', 'desc').limit(1000)
      .onSnapshot(function (snap) {
        var arr = []; snap.forEach(function (d) { arr.push(Object.assign({ _id: d.id }, d.data())); });
        ACC.setData(arr, null, null); ready.entries = true; maybeRender();
      }, function (e) { console.error('entries listener', e); });

    fbDB.collection('accounts').onSnapshot(function (snap) {
      var arr = []; snap.forEach(function (d) { arr.push(Object.assign({ _id: d.id }, d.data())); });
      ACC.setData(null, arr, null); ready.accounts = true; maybeRender();
    });

    fbDB.collection('parties').onSnapshot(function (snap) {
      var arr = []; snap.forEach(function (d) { arr.push(Object.assign({ _id: d.id }, d.data())); });
      ACC.setData(null, null, arr); ready.parties = true; maybeRender();
    });
  }

  function maybeRender() {
    if (ready.entries && ready.accounts && ready.parties) {
      if (!loaded) { loaded = true; var l = $('#accLoading'); if (l) l.remove(); }
      render();
    }
  }

  /* ============================================================ RENDER ROUTER */
  function render() {
    var host = $('#accContent');
    if (!loaded) return;
    var fn = PAGES[current] || PAGES.dashboard;
    host.innerHTML = '<div class="acc-page on">' + fn() + '</div>';
    if (AFTER[current]) AFTER[current]();
  }

  var AFTER = {};

  /* ============================================================ PAGES */
  var PAGES = {};

  /* ---- DASHBOARD ---- */
  PAGES.dashboard = function () {
    var d = ACC.reportDashboard({});
    var kpis =
      kpi('Revenue', money0(d.revenue), 'this period', 'green') +
      kpi('Outstanding', money0(d.outstanding), d.topDebtors.length + ' parties', 'amber') +
      kpi('Cash + Bank', money0(d.cashBank), 'Cash ' + money0(d.cash) + ' · Bank ' + money0(d.bank), 'blue') +
      kpi('Net Profit', money0(d.netProfit), 'Income − Expense', d.netProfit >= 0 ? 'green' : 'red') +
      kpi('Sales Entries', d.salesCount, money0(d.salesTotal) + ' total', '');
    var top = d.topDebtors.length
      ? d.topDebtors.map(function (p) {
          return '<tr><td>' + esc(p.name) + '</td><td class="num cr">' + money(p.balance) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="2" class="empty">No outstanding balances.</td></tr>';
    return '<div class="kpi-grid">' + kpis + '</div>' +
      '<div class="card"><div class="card-head"><div class="card-title">Top Outstanding Customers</div>' +
        '<button class="btn btn-sm" data-go="outstanding">View all</button></div>' +
        '<table class="tbl"><thead><tr><th>Customer</th><th class="right">Balance</th></tr></thead><tbody>' + top + '</tbody></table>' +
      '</div>';
  };
  AFTER.dashboard = function () {
    var b = document.querySelector('[data-go]'); if (b) b.addEventListener('click', function () { go(b.dataset.go); });
  };

  /* ---- CUSTOMER LEDGER ---- */
  PAGES.ledger = function () {
    var parties = Object.keys(ACC.parties()).map(function (k) { return ACC.parties()[k]; })
      .filter(function (p) { return p.kind === 'customer'; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (!parties.length) return emptyState('No customer ledgers yet. Approve an order to create one automatically.');
    var sel = $('#ledgerParty');
    var chosen = (sel && sel.value) || (parties[0] && parties[0].partyId);
    var opts = parties.map(function (p) { return '<option value="' + esc(p.partyId) + '"' + (p.partyId === chosen ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var L = ACC.reportPartyLedger(chosen, {});
    var rows = L.rows.length ? L.rows.map(function (r) {
      return '<tr><td class="mono">' + dmy(r.date) + '</td><td>' + esc(r.type) + '</td>' +
             '<td>' + esc(r.narration || '') + (r.orderId ? ' <span class="muted">· ' + esc(r.orderId) + '</span>' : '') + '</td>' +
             '<td class="num">' + (r.debit ? money(r.debit) : '') + '</td>' +
             '<td class="num">' + (r.credit ? money(r.credit) : '') + '</td>' +
             '<td class="num">' + money(Math.abs(r.balance)) + ' ' + r.balanceSide + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No transactions.</td></tr>';
    return '<div class="filter-row"><select id="ledgerParty">' + opts + '</select>' +
        '<div style="margin-left:auto;" class="muted">Closing: <b style="color:var(--amber-h);">' + money(Math.abs(L.closing)) + ' ' + L.closingSide + '</b></div></div>' +
      '<div class="card"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Particulars</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
  };
  AFTER.ledger = function () {
    var sel = $('#ledgerParty'); if (sel) sel.addEventListener('change', render);
  };

  /* ---- OUTSTANDING ---- */
  PAGES.outstanding = function () {
    var o = ACC.reportOutstanding();
    if (!o.rows.length) return emptyState('No outstanding receivables. All invoices are settled.');
    var rows = o.rows.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td>' +
             '<td class="num">' + money(p.buckets.cur) + '</td>' +
             '<td class="num">' + money(p.buckets.d30) + '</td>' +
             '<td class="num">' + money(p.buckets.d60) + '</td>' +
             '<td class="num">' + money(p.buckets.d90) + '</td>' +
             '<td class="num cr"><b>' + money(p.balance) + '</b></td></tr>';
    }).join('');
    return '<div class="card"><div class="card-head"><div class="card-title">Outstanding (Aged)</div>' +
        '<div style="margin-left:auto;" class="muted">Total: <b style="color:var(--amber-h);">' + money(o.total) + '</b></div></div>' +
      '<table class="tbl"><thead><tr><th>Customer</th><th class="right">Current</th><th class="right">31–60</th><th class="right">61–90</th><th class="right">90+</th><th class="right">Total</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
  };

  /* ---- SALES / PURCHASE REGISTER ---- */
  function registerPage(type, label) {
    var rows = ACC.reportRegister(type, {});
    if (!rows.length) return emptyState('No ' + label.toLowerCase() + ' entries yet.');
    var tD = 0, tT = 0, tG = 0;
    var body = rows.map(function (r) {
      tD = ACC.round2(tD + r.taxable); tT = ACC.round2(tT + r.tax); tG = ACC.round2(tG + r.total);
      return '<tr><td class="mono">' + dmy(r.date) + '</td><td class="mono">' + esc(r.invoiceId || r.entryId) + '</td>' +
             '<td>' + esc(r.party || '\u2014') + '</td>' +
             (r.orderId ? '<td class="mono muted">' + esc(r.orderId) + '</td>' : '<td>\u2014</td>') +
             '<td class="num">' + money(r.taxable) + '</td>' +
             '<td class="num">' + money(r.tax) + '</td>' +
             '<td class="num"><b>' + money(r.total) + '</b></td></tr>';
    }).join('');
    return '<div class="card"><div class="card-head"><div class="card-title">' + esc(label) + '</div>' +
        '<div style="margin-left:auto;" class="muted">' + rows.length + ' entries</div></div>' +
      '<table class="tbl"><thead><tr><th>Date</th><th>Invoice</th><th>Party</th><th>Order</th><th class="right">Taxable</th><th class="right">GST</th><th class="right">Total</th></tr></thead>' +
        '<tbody>' + body + '</tbody>' +
        '<tfoot class="tbl-foot"><tr><td colspan="4">Total</td><td class="num">' + money(tD) + '</td><td class="num">' + money(tT) + '</td><td class="num">' + money(tG) + '</td></tr></tfoot>' +
      '</table></div>';
  }
  PAGES.sales = function () { return registerPage('SALES', 'Sales Register'); };
  PAGES.purchase = function () { return registerPage('PURCHASE', 'Purchase Register'); };

  /* ---- CASH / BANK BOOK ---- */
  function bookPage(which, label) {
    var L = ACC.reportCashBook(which, {});
    var rows = L.rows.length ? L.rows.map(function (r) {
      return '<tr><td class="mono">' + dmy(r.date) + '</td><td>' + esc(r.type) + '</td>' +
             '<td>' + esc(r.narration || '') + '</td>' +
             '<td class="num">' + (r.debit ? money(r.debit) : '') + '</td>' +
             '<td class="num">' + (r.credit ? money(r.credit) : '') + '</td>' +
             '<td class="num">' + money(Math.abs(r.balance)) + ' ' + r.balanceSide + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No ' + label.toLowerCase() + ' movements.</td></tr>';
    return '<div class="card"><div class="card-head"><div class="card-title">' + esc(label) + '</div>' +
        '<div style="margin-left:auto;" class="muted">Closing: <b style="color:var(--amber-h);">' + money(Math.abs(L.closing)) + ' ' + L.closingSide + '</b></div></div>' +
      '<table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Particulars</th><th class="right">In</th><th class="right">Out</th><th class="right">Balance</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
  }
  PAGES.cashbook = function () { return bookPage('cash', 'Cash Book'); };
  PAGES.bankbook = function () { return bookPage('bank', 'Bank Book'); };

  /* ---- JOURNAL ---- */
  PAGES.journal = function () {
    var es = ACC.entries().slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!es.length) return emptyState('No journal entries yet.');
    var rows = es.map(function (e) {
      var lines = e.lines.map(function (l) {
        return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;' + (l.debit ? '' : 'padding-left:18px;') + '">' +
               '<span>' + esc(ACC.account(l.accountCode).name) + '</span>' +
               '<span class="mono">' + (l.debit ? money(l.debit) + ' Dr' : money(l.credit) + ' Cr') + '</span></div>';
      }).join('');
      var st = e.status === 'void' ? '<span class="pill pill-void">void</span>' : '';
      return '<tr><td class="mono">' + dmy(e.date) + '<br><span class="muted" style="font-size:10px;">' + esc(e.entryId) + '</span></td>' +
             '<td>' + esc(e.type) + ' ' + st + '<div class="muted" style="font-size:11px;margin-top:3px;">' + esc(e.narration || '') + '</div></td>' +
             '<td>' + lines + '</td>' +
             '<td class="num"><b>' + money(e.totalDebit) + '</b></td></tr>';
    }).join('');
    return '<div class="card"><table class="tbl"><thead><tr><th>Date</th><th>Type / Narration</th><th>Entries</th><th class="right">Amount</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  };

  /* ---- TRIAL BALANCE ---- */
  PAGES.trial = function () {
    var tb = ACC.reportTrialBalance({});
    if (!tb.rows.length) return emptyState('No postings yet — trial balance is empty.');
    var rows = tb.rows.map(function (r) {
      return '<tr><td class="mono muted">' + esc(r.code) + '</td><td>' + esc(r.name) + '</td>' +
             '<td class="num">' + (r.debit ? money(r.debit) : '') + '</td>' +
             '<td class="num">' + (r.credit ? money(r.credit) : '') + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="card-head"><div class="card-title">Trial Balance</div>' +
        '<span class="balanced-tag ' + (tb.balanced ? 'balanced-yes' : 'balanced-no') + '" style="margin-left:auto;">' + (tb.balanced ? 'Balanced' : 'NOT BALANCED') + '</span></div>' +
      '<table class="tbl"><thead><tr><th>Code</th><th>Account</th><th class="right">Debit</th><th class="right">Credit</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot class="tbl-foot"><tr><td colspan="2">Total</td><td class="num">' + money(tb.totalDebit) + '</td><td class="num">' + money(tb.totalCredit) + '</td></tr></tfoot>' +
      '</table></div>';
  };

  /* ---- P&L ---- */
  PAGES.pl = function () {
    var pl = ACC.reportProfitLoss({});
    function side(items, total, label) {
      var r = items.length ? items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td class="num">' + money(i.amount) + '</td></tr>'; }).join('')
                           : '<tr><td colspan="2" class="muted">None</td></tr>';
      return '<div class="card"><div class="card-head"><div class="card-title">' + label + '</div></div>' +
        '<table class="tbl"><tbody>' + r + '</tbody>' +
        '<tfoot class="tbl-foot"><tr><td>Total</td><td class="num">' + money(total) + '</td></tr></tfoot></table></div>';
    }
    return '<div class="statement-grid">' + side(pl.income, pl.incomeTotal, 'Income') + side(pl.expense, pl.expenseTotal, 'Expenses') + '</div>' +
      '<div class="card"><table class="tbl"><tfoot class="tbl-foot"><tr><td>NET ' + (pl.netProfit >= 0 ? 'PROFIT' : 'LOSS') + '</td>' +
        '<td class="num" style="color:' + (pl.netProfit >= 0 ? 'var(--green)' : 'var(--red)') + ';">' + money(Math.abs(pl.netProfit)) + '</td></tr></tfoot></table></div>';
  };

  /* ---- BALANCE SHEET ---- */
  PAGES.balance = function () {
    var bs = ACC.reportBalanceSheet({});
    function side(items, total, label) {
      var r = items.length ? items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td class="num">' + money(i.amount) + '</td></tr>'; }).join('')
                           : '<tr><td colspan="2" class="muted">None</td></tr>';
      return '<div class="card"><div class="card-head"><div class="card-title">' + label + '</div></div>' +
        '<table class="tbl"><tbody>' + r + '</tbody>' +
        '<tfoot class="tbl-foot"><tr><td>Total</td><td class="num">' + money(total) + '</td></tr></tfoot></table></div>';
    }
    return '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;"><span class="balanced-tag ' + (bs.balanced ? 'balanced-yes' : 'balanced-no') + '">' + (bs.balanced ? 'Assets = Liabilities + Equity' : 'OUT OF BALANCE') + '</span></div>' +
      '<div class="statement-grid">' + side(bs.assets, bs.assetTotal, 'Assets') +
        '<div>' + side(bs.liabilities, bs.liabilityTotal, 'Liabilities') + side(bs.equity, bs.equityTotal, 'Equity') + '</div></div>';
  };

  /* ---- CHART OF ACCOUNTS ---- */
  PAGES.coa = function () {
    var accs = Object.keys(ACC.accounts()).map(function (k) { return ACC.accounts()[k]; }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    if (!accs.length) return emptyState('Chart of Accounts is initialising…');
    var rows = accs.map(function (a) {
      return '<tr><td class="mono muted">' + esc(a.code) + '</td><td>' + esc(a.name) + '</td>' +
             '<td>' + esc(a.type) + '</td><td class="muted">' + esc(a.group || '') + '</td></tr>';
    }).join('');
    return '<div class="card"><table class="tbl"><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Group</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  };

  /* ---- PARTIES ---- */
  PAGES.parties = function () {
    var ps = Object.keys(ACC.parties()).map(function (k) { return ACC.parties()[k]; }).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (!ps.length) return emptyState('No parties yet. They are created automatically from approved orders.');
    var rows = ps.map(function (p) {
      var L = ACC.reportPartyLedger(p.partyId, {});
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.kind) + '</td><td class="mono muted">' + esc(p.gst || '\u2014') + '</td>' +
             '<td class="num">' + money(Math.abs(L.closing)) + ' ' + L.closingSide + '</td></tr>';
    }).join('');
    return '<div class="card"><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>GSTIN</th><th class="right">Balance</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  };

  /* ---- VOUCHERS (interactive) ---- */
  function partyOptions(kind, selected) {
    var ps = Object.keys(ACC.parties()).map(function (k) { return ACC.parties()[k]; });
    if (kind) ps = ps.filter(function (p) { return p.kind === kind; });
    ps.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return '<option value="">— none —</option>' + ps.map(function (p) {
      return '<option value="' + esc(p.partyId) + '"' + (p.partyId === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
  }
  function accountOptions(filterFn, selected) {
    var as = Object.keys(ACC.accounts()).map(function (k) { return ACC.accounts()[k]; })
      .filter(filterFn || function () { return true; })
      .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
    return as.map(function (a) {
      return '<option value="' + esc(a.code) + '"' + (a.code === selected ? ' selected' : '') + '>' + esc(a.code) + ' · ' + esc(a.name) + '</option>';
    }).join('');
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function voucherShell(title, desc, inner, msgId) {
    return '<div class="card" style="max-width:560px;"><div class="card-head"><div class="card-title">' + esc(title) + '</div></div>' +
      '<div style="padding:18px;">' +
        '<p class="muted" style="font-size:12.5px;margin-bottom:16px;">' + esc(desc) + '</p>' +
        inner +
        '<div class="fst" id="' + msgId + '" style="margin-top:10px;font-size:12.5px;"></div>' +
      '</div></div>';
  }
  function vField(label, control) {
    return '<div style="margin-bottom:13px;"><label style="display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:5px;font-weight:600;">' + esc(label) + '</label>' + control + '</div>';
  }
  var vInputStyle = 'width:100%;background:var(--d3);border:1px solid var(--line);border-radius:8px;padding:9px 11px;color:var(--white);font-size:13.5px;font-family:inherit;outline:none;';

  PAGES.receipt = function () {
    var inner =
      vField('Date', '<input type="date" id="vr-date" value="' + today() + '" style="' + vInputStyle + '">') +
      vField('Amount (\u20B9)', '<input type="number" id="vr-amount" min="1" step="0.01" placeholder="0.00" style="' + vInputStyle + '">') +
      vField('Received In', '<select id="vr-mode" style="' + vInputStyle + '"><option value="bank">Bank</option><option value="cash">Cash</option></select>') +
      vField('From Customer', '<select id="vr-party" style="' + vInputStyle + '">' + partyOptions('customer') + '</select>') +
      vField('Narration', '<input type="text" id="vr-note" placeholder="e.g. Part payment against INV-2026-0001" style="' + vInputStyle + '">') +
      '<button class="btn btn-amber" id="vr-save">Post Receipt</button>';
    return voucherShell('Receipt Voucher', 'Record money received. Posts Dr Bank/Cash, Cr Customer.', inner, 'vr-msg');
  };
  AFTER.receipt = function () {
    var b = $('#vr-save'); if (!b) return;
    b.addEventListener('click', function () {
      var msg = $('#vr-msg');
      ACC.voucherReceipt({
        date: $('#vr-date').value, amount: $('#vr-amount').value,
        mode: $('#vr-mode').value, partyId: $('#vr-party').value || null,
        narration: $('#vr-note').value
      }).then(function (e) {
        if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '\u2713 Receipt ' + e.entryId + ' posted.'; }
        $('#vr-amount').value = ''; $('#vr-note').value = '';
      }).catch(function (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = err.message; } });
    });
  };

  PAGES.payment = function () {
    var inner =
      vField('Date', '<input type="date" id="vp-date" value="' + today() + '" style="' + vInputStyle + '">') +
      vField('Amount (\u20B9)', '<input type="number" id="vp-amount" min="1" step="0.01" placeholder="0.00" style="' + vInputStyle + '">') +
      vField('Paid From', '<select id="vp-mode" style="' + vInputStyle + '"><option value="bank">Bank</option><option value="cash">Cash</option></select>') +
      vField('Expense / Account to Debit', '<select id="vp-acct" style="' + vInputStyle + '">' + accountOptions(function (a) { return a.type === 'EXPENSE' || a.type === 'ASSET'; }) + '</select>') +
      vField('Supplier (optional)', '<select id="vp-party" style="' + vInputStyle + '">' + partyOptions('supplier') + '</select>') +
      vField('Narration', '<input type="text" id="vp-note" placeholder="e.g. Diesel for MH12AB1234" style="' + vInputStyle + '">') +
      '<button class="btn btn-amber" id="vp-save">Post Payment</button>';
    return voucherShell('Payment Voucher', 'Record money paid out. Posts Dr Expense/Supplier, Cr Bank/Cash.', inner, 'vp-msg');
  };
  AFTER.payment = function () {
    var b = $('#vp-save'); if (!b) return;
    b.addEventListener('click', function () {
      var msg = $('#vp-msg');
      ACC.voucherPayment({
        date: $('#vp-date').value, amount: $('#vp-amount').value,
        mode: $('#vp-mode').value, expenseAccount: $('#vp-acct').value,
        partyId: $('#vp-party').value || null, narration: $('#vp-note').value
      }).then(function (e) {
        if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '\u2713 Payment ' + e.entryId + ' posted.'; }
        $('#vp-amount').value = ''; $('#vp-note').value = '';
      }).catch(function (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = err.message; } });
    });
  };

  PAGES.contra = function () {
    var inner =
      vField('Date', '<input type="date" id="vc-date" value="' + today() + '" style="' + vInputStyle + '">') +
      vField('Amount (\u20B9)', '<input type="number" id="vc-amount" min="1" step="0.01" placeholder="0.00" style="' + vInputStyle + '">') +
      vField('Direction', '<select id="vc-dir" style="' + vInputStyle + '"><option value="cash_to_bank">Cash \u2192 Bank (deposit)</option><option value="bank_to_cash">Bank \u2192 Cash (withdraw)</option></select>') +
      vField('Narration', '<input type="text" id="vc-note" placeholder="e.g. Cash deposited to bank" style="' + vInputStyle + '">') +
      '<button class="btn btn-amber" id="vc-save">Post Contra</button>';
    return voucherShell('Contra Voucher', 'Move funds between Cash and Bank. No profit impact.', inner, 'vc-msg');
  };
  AFTER.contra = function () {
    var b = $('#vc-save'); if (!b) return;
    b.addEventListener('click', function () {
      var msg = $('#vc-msg');
      ACC.voucherContra({
        date: $('#vc-date').value, amount: $('#vc-amount').value,
        direction: $('#vc-dir').value, narration: $('#vc-note').value
      }).then(function (e) {
        if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '\u2713 Contra ' + e.entryId + ' posted.'; }
        $('#vc-amount').value = ''; $('#vc-note').value = '';
      }).catch(function (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = err.message; } });
    });
  };

  PAGES.settings = function () {
    var s = ACC.settings();
    var inner =
      vField('Fiscal Year Start (MM-DD)', '<input type="text" id="st-fy" value="' + esc(s.fiscalYearStart) + '" style="' + vInputStyle + '">') +
      vField('SGST Rate (%)', '<input type="number" id="st-sgst" min="0" max="50" step="0.1" value="' + esc(s.sgstRate) + '" style="' + vInputStyle + '">') +
      vField('CGST Rate (%)', '<input type="number" id="st-cgst" min="0" max="50" step="0.1" value="' + esc(s.cgstRate) + '" style="' + vInputStyle + '">') +
      '<button class="btn btn-amber" id="st-save">Save Settings</button>';
    return '<div class="card" style="max-width:560px;"><div class="card-head"><div class="card-title">Accounting Settings</div></div>' +
      '<div style="padding:18px;">' +
        '<p class="muted" style="font-size:12.5px;margin-bottom:16px;">GST rates apply to NEW sales entries posted after saving. Existing posted entries are immutable and are not retroactively changed.</p>' +
        inner +
        '<div class="fst" id="st-msg" style="margin-top:10px;font-size:12.5px;"></div>' +
      '</div></div>';
  };
  AFTER.settings = function () {
    var b = $('#st-save'); if (!b) return;
    b.addEventListener('click', function () {
      var msg = $('#st-msg');
      var sgst = parseFloat($('#st-sgst').value) || 0, cgst = parseFloat($('#st-cgst').value) || 0;
      if (sgst < 0 || sgst > 50 || cgst < 0 || cgst > 50) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = 'GST rates must be between 0 and 50%.'; } return; }
      ACC.saveSettings({ fiscalYearStart: $('#st-fy').value.trim(), sgstRate: sgst, cgstRate: cgst })
        .then(function () { if (msg) { msg.style.color = 'var(--green)'; msg.textContent = '\u2713 Settings saved.'; } })
        .catch(function (err) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = err.message; } });
    });
  };

  /* ---- helpers ---- */
  function kpi(label, value, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value">' + esc(value) + '</div><div class="kpi-sub">' + esc(sub || '') + '</div></div>';
  }
  function emptyState(msg) {
    return '<div class="card"><div class="empty">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>' +
      '<div>' + esc(msg) + '</div></div></div>';
  }

  /* ============================================================ AUTH GUARD */
  firebase.auth().onAuthStateChanged(function (user) {
    if (!user || !EGC.isOwnerEmail(user.email)) {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;color:#8a9ab0;font-family:Inter,sans-serif;">Accounting is restricted to the owner. <a href="owner-dashboard.html" style="color:#f5930a;margin-left:6px;">Return</a></div>';
      return;
    }
    ACC.ensureSeeded().then(function () { return ACC.loadSettings(); }).then(function () {
      renderSidebar();
      startListeners();
    });
    if (EGC.flushReliableQueue) EGC.flushReliableQueue();
  });

  /* search + export hooks (basic; full search in a later pass) */
  document.addEventListener('DOMContentLoaded', function () {
    var ex = $('#exportBtn'); if (ex) ex.addEventListener('click', function () { exportCurrent(); });
    var se = $('#globalSearch'); if (se) se.addEventListener('input', function () { /* page-level filter hook */ });
  });

  function exportCurrent() {
    /* CSV export of the current page's primary table. */
    var tbl = document.querySelector('.acc-page .tbl');
    if (!tbl) { alert('Nothing to export on this page.'); return; }
    var csv = [];
    Array.prototype.forEach.call(tbl.querySelectorAll('tr'), function (tr) {
      var cells = Array.prototype.map.call(tr.querySelectorAll('th,td'), function (c) {
        return '"' + (c.textContent || '').replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
      });
      if (cells.length) csv.push(cells.join(','));
    });
    var blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orbit-' + current + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  }

  console.log('[ACC] workspace UI loaded.');
})();
