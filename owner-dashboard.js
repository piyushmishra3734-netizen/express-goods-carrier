/* ============================================================
   OWNER-DASHBOARD.JS — Express Goods Carrier — Phase 3

   FIXED:
   - Approve button is ONLY shown for pending_review OR customer_accepted
     (NOT for revised_by_owner — owner must wait for customer response)
   - All owner actions now create Firestore notifications + activity log
     entries so the customer dashboard updates in real time.
   - Uses EGC.quoteStatusLabelOwner() for owner-side labels.
   ============================================================ */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------------------------------------------------
     TABS
  --------------------------------------------------------- */
  function openTab(name) {
    $all('.dash-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === name); });
    $all('.dash-panel').forEach(function (p) { p.classList.toggle('on', p.id === 'panel-' + name); });
  }
  $all('.dash-tab').forEach(function (t) {
    t.addEventListener('click', function () { openTab(t.dataset.tab); history.replaceState(null, '', '#' + t.dataset.tab); });
  });
  var initialTab = (location.hash || '').replace('#', '');
  if (['pending', 'orders', 'allquotes', 'invoices', 'audit'].indexOf(initialTab) !== -1) openTab(initialTab);

  /* ---------------------------------------------------------
     TOAST
  --------------------------------------------------------- */
  function toast(ok, text) {
    var host = $('#toastHost');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (ok ? 'ok' : 'bad');
    el.textContent = text;
    host.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 320);
    }, 3200);
  }

  /* ---------------------------------------------------------
     OWNER ACCESS GUARD
  --------------------------------------------------------- */
  TOS.onReady(function (user) {
    var guard  = $('#guard');
    var denied = $('#denied');
    var main   = $('#dashMain');

    if (!user || !EGC.isOwnerEmail(user.email)) {
      if (guard)  guard.style.display = 'none';
      if (denied) denied.style.display = 'flex';
      return;
    }

    if (guard) guard.classList.add('fade-out');
    if (main)  { main.style.display = 'block'; requestAnimationFrame(function () { main.classList.add('visible'); }); }
    setTimeout(function () { if (guard) guard.style.display = 'none'; }, 380);

    loadPendingQuotes();
    loadRevisedQuotes();
    loadOwnerOrders();
    loadAllQuotes();
    loadAuditLogs();
    loadInvoices();
  });

  /* ===========================================================
     PENDING QUOTES — action-required cards
  =========================================================== */
  var pendingUnsub    = null;
  var revisedUnsub    = null;
  var pendingCache    = {};
  var pendingQuotesData = [];
  var revisedQuotesData = [];

  /* ---------------------------------------------------------
     Build card HTML.
     KEY RULE: Approve button shown ONLY for:
       - status === 'pending_review'
       - status === 'customer_accepted'
     Revise button shown ONLY for status === 'pending_review'
     For 'revised_by_owner' cards: no approve, no revise, only reject
  --------------------------------------------------------- */
  function pendingCardHTML(q) {
    var when = EGC.fmtWhen(q.createdAt);
    var isPending          = q.status === EGC.QUOTE_STATUS.PENDING;
    var isCustomerAccepted = q.status === EGC.QUOTE_STATUS.CUSTOMER_ACCEPTED;
    var isRevised          = q.status === EGC.QUOTE_STATUS.REVISED;

    /* banner at the top of the card */
    var topBanner = '';
    if (isCustomerAccepted) {
      topBanner = (
        '<div class="revision-banner revision-accepted">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>' +
          ' Customer accepted the revised quote — approve now to create the order' +
        '</div>'
      );
    }

    var statusBadge = isPending
      ? '<span class="st-badge st-pending"><span class="st-dot"></span>Pending Review</span>'
      : isCustomerAccepted
        ? '<span class="st-badge st-ok"><span class="st-dot"></span>Customer Accepted</span>'
        : '<span class="st-badge st-revised"><span class="st-dot"></span>Awaiting Customer</span>';

    /* Action buttons — only owner actions that make sense at this stage */
    var approveBtn = (isPending || isCustomerAccepted)
      ? '<button class="btn-ok" type="button" onclick="OWN.approve(\'' + q.quoteId + '\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Approve' +
        '</button>'
      : '';

    var reviseBtn = isPending
      ? '<button class="btn-modify" type="button" onclick="OWN.toggleModify(\'' + q.quoteId + '\')">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Send Revised Quote' +
        '</button>'
      : '';

    /* Awaiting cards get an info note instead of revise btn */
    var awaitingNote = isRevised
      ? '<div class="ocard-notes" style="margin-bottom:0;color:var(--muted2);font-size:12.5px;">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:5px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          'Waiting for the customer to accept or reject the revision.' +
        '</div>'
      : '';

    return (
      '<div class="ocard" data-qid="' + q.quoteId + '">' +
        topBanner +
        '<div class="ocard-top">' +
          '<div><div class="ocard-id">' + EGC.esc(q.quoteId) + '</div><div class="ocard-when">' + when + '</div></div>' +
          statusBadge +
        '</div>' +
        '<div class="ocard-route">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
          '<span>' + EGC.esc(q.pickup) + ' &rarr; ' + EGC.esc(q.delivery) + '</span>' +
        '</div>' +
        '<div class="ocard-grid">' +
          '<div class="ocard-field"><span>Customer</span><strong>' + EGC.esc(q.customerName) + '</strong></div>' +
          '<div class="ocard-field"><span>Company</span><strong>' + EGC.esc(q.companyName || '—') + '</strong></div>' +
          '<div class="ocard-field"><span>Weight</span><strong>' + EGC.esc(q.weight) + ' kg</strong></div>' +
          '<div class="ocard-field"><span>Packages</span><strong>' + EGC.esc(q.packages) + '</strong></div>' +
          '<div class="ocard-field"><span>Material</span><strong>' + EGC.esc(q.materialType) + '</strong></div>' +
          '<div class="ocard-field"><span>Pickup Date</span><strong>' + EGC.fmtDate(q.pickupDate) + '</strong></div>' +
          '<div class="ocard-field"><span>Phone</span><strong>' + EGC.esc(q.customerPhone || '—') + '</strong></div>' +
          '<div class="ocard-field"><span>Email</span><strong>' + EGC.esc(q.customerEmail || '—') + '</strong></div>' +
          (q.revisedPrice ? '<div class="ocard-field"><span>Revised Price</span><strong style="color:var(--amber);">&#8377;' + EGC.esc(q.revisedPrice) + '</strong></div>' : '') +
        '</div>' +
        (q.notes ? '<div class="ocard-notes"><strong>Notes:</strong> ' + EGC.esc(q.notes) + '</div>' : '') +
        (q.ownerComment ? '<div class="ocard-notes revision-comment"><strong>Your revision note:</strong> ' + EGC.esc(q.ownerComment) + '</div>' : '') +
        awaitingNote +
        '<div class="ocard-actions">' +
          approveBtn +
          reviseBtn +
          '<button class="btn-danger" type="button" onclick="OWN.toggleReject(\'' + q.quoteId + '\')">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reject' +
          '</button>' +
        '</div>' +

        /* MODIFY PANEL — only shown for pending_review quotes */
        '<div class="modify-panel" id="modify-' + q.quoteId + '">' +
          '<div class="modify-panel-header">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
            'Send Revised Quote to Customer' +
          '</div>' +
          '<div class="modify-grid">' +
            '<input type="text" id="mPickup-' + q.quoteId + '" value="' + EGC.esc(q.pickup) + '" placeholder="Pickup location">' +
            '<input type="text" id="mDelivery-' + q.quoteId + '" value="' + EGC.esc(q.delivery) + '" placeholder="Delivery location">' +
            '<input type="text" id="mWeight-' + q.quoteId + '" value="' + EGC.esc(q.weight) + '" placeholder="Weight (kg)">' +
            '<input type="text" id="mPackages-' + q.quoteId + '" value="' + EGC.esc(q.packages) + '" placeholder="Number of packages">' +
            '<input type="text" id="mPickupDate-' + q.quoteId + '" value="' + EGC.esc(q.pickupDate || '') + '" placeholder="Pickup date">' +
            '<input type="text" id="mPrice-' + q.quoteId + '" value="' + EGC.esc(q.revisedPrice || '') + '" placeholder="Revised price (\u20B9) \u2014 optional">' +
          '</div>' +
          '<div class="sf-fd" style="margin-top:12px;">' +
            '<label style="font-family:\'IBM Plex Mono\';font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Note / explanation to customer</label>' +
            '<textarea id="mComment-' + q.quoteId + '" placeholder="e.g. Route adjusted for weight limit. Revised price reflects fuel surcharge.">' + EGC.esc(q.ownerComment || '') + '</textarea>' +
          '</div>' +
          '<div class="modify-notes"><textarea id="mNotes-' + q.quoteId + '" placeholder="Shipment notes (optional)">' + EGC.esc(q.notes || '') + '</textarea></div>' +
          '<div class="ocard-actions">' +
            '<button class="btn-ok btn-sm" type="button" onclick="OWN.sendRevision(\'' + q.quoteId + '\')">Send to Customer</button>' +
            '<button class="btn-ghost btn-sm" type="button" onclick="OWN.toggleModify(\'' + q.quoteId + '\')">Cancel</button>' +
          '</div>' +
        '</div>' +

        /* REJECT PANEL */
        '<div class="modify-panel" id="reject-' + q.quoteId + '">' +
          '<div class="modify-panel-header" style="color:#ff7070;">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            'Reject Quote' +
          '</div>' +
          '<div class="sf-fd"><label style="font-family:\'IBM Plex Mono\';font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:6px;">Note to customer (optional)</label>' +
            '<textarea id="rNote-' + q.quoteId + '" placeholder="e.g. Route currently unavailable, please call us to discuss alternatives."></textarea>' +
          '</div>' +
          '<div class="ocard-actions">' +
            '<button class="btn-danger btn-sm" type="button" onclick="OWN.confirmReject(\'' + q.quoteId + '\')">Confirm Rejection</button>' +
            '<button class="btn-ghost btn-sm" type="button" onclick="OWN.toggleReject(\'' + q.quoteId + '\')">Cancel</button>' +
          '</div>' +
        '</div>' +

        '<div class="fst" id="qmsg-' + q.quoteId + '"></div>' +
      '</div>'
    );
  }

  /* ---------------------------------------------------------
     Merge + render pending sections
  --------------------------------------------------------- */
  function mergePendingAndRevised() {
    var all = pendingQuotesData.concat(revisedQuotesData);
    all.sort(function (a, b) {
      var at = (a.createdAt && a.createdAt.toDate) ? a.createdAt.toDate().getTime() : 0;
      var bt = (b.createdAt && b.createdAt.toDate) ? b.createdAt.toDate().getTime() : 0;
      return bt - at;
    });

    var actionRequired = all.filter(function (q) {
      return q.status === EGC.QUOTE_STATUS.PENDING || q.status === EGC.QUOTE_STATUS.CUSTOMER_ACCEPTED;
    });
    var awaitingCustomer = all.filter(function (q) {
      return q.status === EGC.QUOTE_STATUS.REVISED;
    });

    var pendingCount  = actionRequired.length;
    var revisedCount  = awaitingCustomer.length;
    var totalCount    = pendingCount + revisedCount;

    var pendingEl    = $('#statPending');
    var tabCountEl   = $('#pendingTabCount');
    var awaitingBadge = $('#awaitingCount');
    if (pendingEl)    pendingEl.textContent    = String(pendingCount);
    if (tabCountEl)   tabCountEl.textContent   = String(totalCount);
    if (awaitingBadge) awaitingBadge.textContent = String(revisedCount);

    renderPendingSection(actionRequired, 'actionList',   pendingCount);
    renderPendingSection(awaitingCustomer, 'awaitingList', revisedCount);

    var awaitingHeader = $('#awaitingCustomerSection');
    if (awaitingHeader) awaitingHeader.style.display = revisedCount ? 'block' : 'none';
  }

  function renderPendingSection(quotes, listId, count) {
    var list = $('#' + listId);
    if (!list) return;
    if (!count) {
      if (listId === 'actionList') {
        list.innerHTML = (
          '<div class="empty">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
            '<p>No pending quotes. New customer requests will appear here instantly.</p>' +
          '</div>'
        );
      } else {
        list.innerHTML = '';
      }
      return;
    }
    list.innerHTML = quotes.map(pendingCardHTML).join('');
  }

  function loadPendingQuotes() {
    if (pendingUnsub) { pendingUnsub(); pendingUnsub = null; }
    pendingUnsub = fbDB.collection('quotes')
      .where('status', '==', 'pending_review')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        pendingQuotesData = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          pendingCache[d.quoteId] = d;
          pendingQuotesData.push(d);
        });
        mergePendingAndRevised();
      }, function (err) {
        console.error('[OWN] pending listener:', err.code, err.message);
        var list = $('#actionList');
        if (list) list.innerHTML = (
          '<div class="empty"><p style="color:#ff7070;">Could not load pending quotes.<br><small>' + err.message + '</small></p>' +
          '<p style="margin-top:12px;font-size:13px;">Check Firestore indexes.</p></div>'
        );
      });
  }

  function loadRevisedQuotes() {
    if (revisedUnsub) { revisedUnsub(); revisedUnsub = null; }
    revisedUnsub = fbDB.collection('quotes')
      .where('status', 'in', ['revised_by_owner', 'customer_accepted'])
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        revisedQuotesData = [];
        snap.forEach(function (doc) {
          var d = doc.data();
          pendingCache[d.quoteId] = d;
          revisedQuotesData.push(d);
        });
        mergePendingAndRevised();
      }, function (err) {
        console.error('[OWN] revised listener:', err.code, err.message);
      });
  }

  /* ---------------------------------------------------------
     TOGGLE PANELS
  --------------------------------------------------------- */
  window.OWN = window.OWN || {};

  window.OWN.toggleModify = function (qid) {
    var panel = $('#modify-' + qid);
    var rejectPanel = $('#reject-' + qid);
    if (rejectPanel) rejectPanel.classList.remove('open');
    if (panel) panel.classList.toggle('open');
  };

  window.OWN.toggleReject = function (qid) {
    var panel = $('#reject-' + qid);
    var modifyPanel = $('#modify-' + qid);
    if (modifyPanel) modifyPanel.classList.remove('open');
    if (panel) panel.classList.toggle('open');
  };

  /* ---------------------------------------------------------
     APPROVE — creates order + notifications + activity log
     Guard: only allowed if pending_review OR customer_accepted
  --------------------------------------------------------- */
  window.OWN.approve = function (qid) {
    var msg = $('#qmsg-' + qid);
    var q = pendingCache[qid];
    if (!q) { return; }

    /* Safety guard: block approve if status is revised_by_owner */
    if (q.status === EGC.QUOTE_STATUS.REVISED) {
      if (msg) { msg.className = 'fst er'; msg.textContent = 'Cannot approve yet — waiting for customer to accept the revision first.'; }
      return;
    }

    Promise.all([EGC.nextOrderId(), EGC.nextInvoiceId(), INV.nextLrNumber()]).then(function (ids) {
      var orderId   = ids[0];
      var invoiceId = ids[1];
      var lrNumber  = ids[2];

      var orderData = {
        orderId:       orderId,
        quoteId:       q.quoteId,
        customerUid:   q.customerUid,
        customerName:  q.customerName,
        customerEmail: q.customerEmail,
        customerPhone: q.customerPhone,
        companyName:   q.companyName,
        pickup:        q.pickup,
        delivery:      q.delivery,
        materialType:  q.materialType,
        weight:        q.weight,
        packages:      q.packages,
        pickupDate:    q.pickupDate,
        notes:         q.notes,
        revisedPrice:  q.revisedPrice || null,
        status:        EGC.ORDER_STATUS.APPROVED,
        invoiceGenerated: true,
        invoiceId:        invoiceId,
        lrNumber:         lrNumber,
        createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
      };

      /* Auto-build the invoice record from quote + the order we are creating */
      var invoiceRecord = INV.buildRecord({
        invoiceId: invoiceId,
        lrNumber:  lrNumber,
        order:     orderData,
        quote:     q
      });

      var batch = fbDB.batch();
      batch.set(fbDB.collection('orders').doc(orderId), orderData);
      batch.set(fbDB.collection('invoices').doc(invoiceId), invoiceRecord);
      batch.update(fbDB.collection('quotes').doc(qid), {
        status:    EGC.QUOTE_STATUS.APPROVED,
        orderId:   orderId,
        invoiceId: invoiceId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      return batch.commit().then(function () {
        /* Notification to customer */
        var notifMsg = 'Your quote ' + q.quoteId + ' has been approved. Order ' + orderId + ' created and invoice ' + invoiceId + ' generated.';
        var p1 = EGC.createNotification(q.customerUid, 'order_created', notifMsg, { quoteId: q.quoteId, orderId: orderId, invoiceId: invoiceId });
        /* Activity log entry */
        var p2 = EGC.logActivity(q.customerUid, 'order_created',
          'Order ' + orderId + ' created for ' + q.pickup + ' \u2192 ' + q.delivery,
          { quoteId: q.quoteId, orderId: orderId });
        /* Audit trail — quote approved + order created + invoice generated */
        var p3 = EGC.logAudit('quote_accepted', 'Quote ' + q.quoteId + ' approved by owner.', {
          targetType: 'quote', targetId: q.quoteId, quoteId: q.quoteId,
          previousValue: q.status, newValue: 'approved'
        });
        var p4 = EGC.logAudit('order_created', 'Order ' + orderId + ' created from quote ' + q.quoteId + '.', {
          targetType: 'order', targetId: orderId, orderId: orderId, quoteId: q.quoteId,
          previousValue: null, newValue: orderId
        });
        var p5 = EGC.logAudit('invoice_generated', 'Invoice ' + invoiceId + ' (' + lrNumber + ') generated for order ' + orderId + '.', {
          targetType: 'invoice', targetId: invoiceId, orderId: orderId, quoteId: q.quoteId,
          previousValue: null, newValue: { invoiceId: invoiceId, lrNumber: lrNumber, amount: invoiceRecord.invoiceAmount }
        });
        return Promise.all([p1, p2, p3, p4, p5]).then(function () { return orderId; });
      });
    }).then(function (orderId) {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '\u2713 Approved \u2014 Order ' + orderId + ' created with invoice.'; }
      toast(true, q.quoteId + ' approved \u2192 ' + orderId);
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not approve quote.'; }
      toast(false, 'Approval failed for ' + qid);
    });
  };

  /* ---------------------------------------------------------
     SEND REVISED QUOTE → status: revised_by_owner
     Only for pending_review quotes
  --------------------------------------------------------- */
  window.OWN.sendRevision = function (qid) {
    var msg       = $('#qmsg-' + qid);
    var pickup    = $('#mPickup-'    + qid) ? $('#mPickup-'    + qid).value.trim() : '';
    var delivery  = $('#mDelivery-'  + qid) ? $('#mDelivery-'  + qid).value.trim() : '';
    var weight    = $('#mWeight-'    + qid) ? $('#mWeight-'    + qid).value.trim() : '';
    var packages  = $('#mPackages-'  + qid) ? $('#mPackages-'  + qid).value.trim() : '';
    var pickupDate= $('#mPickupDate-'+ qid) ? $('#mPickupDate-'+ qid).value.trim() : '';
    var price     = $('#mPrice-'     + qid) ? $('#mPrice-'     + qid).value.trim() : '';
    var comment   = $('#mComment-'   + qid) ? $('#mComment-'   + qid).value.trim() : '';
    var notes     = $('#mNotes-'     + qid) ? $('#mNotes-'     + qid).value.trim() : '';

    if (!pickup || !delivery) {
      if (msg) { msg.className = 'fst er'; msg.textContent = 'Pickup and delivery are required.'; }
      return;
    }

    var q = pendingCache[qid];
    if (!q) { return; }

    /* Only allow revision if status is pending_review */
    if (q.status !== EGC.QUOTE_STATUS.PENDING) {
      if (msg) { msg.className = 'fst er'; msg.textContent = 'Revision can only be sent for pending quotes.'; }
      return;
    }

    var updates = {
      status:       EGC.QUOTE_STATUS.REVISED,
      pickup:       pickup,
      delivery:     delivery,
      weight:       weight,
      packages:     packages,
      pickupDate:   pickupDate || null,
      revisedPrice: price || null,
      ownerComment: comment || null,
      notes:        notes || null,
      revisedAt:    firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:    firebase.firestore.FieldValue.serverTimestamp(),

      /* Preserve the customer's original request so the dashboard can
         show an Original → Revised comparison. Additive only — does
         not change any existing field or behavior. */
      originalPickup:     q.pickup,
      originalDelivery:   q.delivery,
      originalWeight:     q.weight,
      originalPackages:   q.packages,
      originalPickupDate: q.pickupDate || null
    };

    fbDB.collection('quotes').doc(qid).update(updates)
      .then(function () {
        var panel = $('#modify-' + qid);
        if (panel) panel.classList.remove('open');
        if (msg) { msg.className = 'fst ok'; msg.textContent = '\u2713 Revised quote sent to customer. Waiting for their response.'; }
        toast(true, qid + ' \u2014 revision sent to customer');

        /* Notification to customer */
        var notifMsg = 'Your quote ' + qid + ' has been revised by the team. Please review and accept or reject the revision.';
        EGC.createNotification(q.customerUid, 'quote_revised', notifMsg, { quoteId: qid });
        EGC.logActivity(q.customerUid, 'quote_revised',
          'Quote ' + qid + ' was revised: ' + pickup + ' \u2192 ' + delivery,
          { quoteId: qid });

        /* Audit trail */
        EGC.logAudit('quote_revised',
          'Quote ' + qid + ' revised: ' + q.pickup + ' \u2192 ' + q.delivery + ' became ' + pickup + ' \u2192 ' + delivery + '.',
          {
            targetType: 'quote', targetId: qid, quoteId: qid,
            previousValue: { pickup: q.pickup, delivery: q.delivery, weight: q.weight, packages: q.packages, price: q.revisedPrice || null },
            newValue:      { pickup: pickup, delivery: delivery, weight: weight, packages: packages, price: price || null }
          });
      })
      .catch(function (err) {
        if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not send revision.'; }
      });
  };

  /* ---------------------------------------------------------
     REJECT QUOTE
  --------------------------------------------------------- */
  window.OWN.confirmReject = function (qid) {
    var msg  = $('#qmsg-' + qid);
    var note = $('#rNote-' + qid) ? ($('#rNote-' + qid).value.trim() || null) : null;
    var q    = pendingCache[qid];

    fbDB.collection('quotes').doc(qid).update({
      status:    EGC.QUOTE_STATUS.REJECTED,
      ownerNote: note,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '\u2713 Quote rejected.'; }
      toast(true, qid + ' rejected.');

      if (q) {
        var notifMsg = 'Your quote ' + qid + ' has been rejected.' + (note ? ' Note: ' + note : '');
        EGC.createNotification(q.customerUid, 'quote_rejected', notifMsg, { quoteId: qid, ownerNote: note });
        EGC.logActivity(q.customerUid, 'quote_rejected',
          'Quote ' + qid + ' was rejected' + (note ? ': ' + note : ''),
          { quoteId: qid });
        EGC.logAudit('quote_rejected', 'Quote ' + qid + ' rejected by owner.' + (note ? ' Note: ' + note : ''), {
          targetType: 'quote', targetId: qid, quoteId: qid,
          previousValue: q.status, newValue: 'rejected'
        });
      }
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not reject quote.'; }
    });
  };

  /* ===========================================================
     ORDERS PANEL
  =========================================================== */
  var ordersUnsub       = null;
  var ownerOrdersCache  = [];
  var orderFilter       = 'all';

  function statusOptionsHTML(current) {
    return EGC.ORDER_STATUS_SEQUENCE.map(function (s) {
      return '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + EGC.orderStatusLabel(s) + '</option>';
    }).join('');
  }

  function ownerOrderCardHTML(o) {
    var badge    = '<span class="st-badge ' + EGC.orderStatusClass(o.status) + '"><span class="st-dot"></span>' + EGC.orderStatusLabel(o.status) + '</span>';
    var priceRow = o.revisedPrice
      ? '<div class="ocard-field"><span>Revised Price</span><strong style="color:var(--amber);">&#8377;' + EGC.esc(o.revisedPrice) + '</strong></div>'
      : '';
    return (
      '<div class="ocard">' +
        '<div class="ocard-top">' +
          '<div><div class="ocard-id">' + EGC.esc(o.orderId) + '</div><div class="ocard-when">' + EGC.fmtWhen(o.createdAt) + ' &middot; from ' + EGC.esc(o.quoteId || '') + '</div></div>' +
          badge +
        '</div>' +
        '<div class="ocard-route">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
          '<span>' + EGC.esc(o.pickup) + ' &rarr; ' + EGC.esc(o.delivery) + '</span>' +
        '</div>' +
        '<div class="ocard-grid">' +
          '<div class="ocard-field"><span>Customer</span><strong>' + EGC.esc(o.customerName) + '</strong></div>' +
          '<div class="ocard-field"><span>Company</span><strong>' + EGC.esc(o.companyName || '—') + '</strong></div>' +
          '<div class="ocard-field"><span>Weight</span><strong>' + EGC.esc(o.weight) + ' kg</strong></div>' +
          '<div class="ocard-field"><span>Packages</span><strong>' + EGC.esc(o.packages) + '</strong></div>' +
          priceRow +
        '</div>' +
        '<div class="ocard-actions" style="align-items:center;">' +
          '<select class="ostatus-select" id="ostat-' + o.orderId + '" onchange="OWN.updateOrderStatus(\'' + o.orderId + '\')">' +
            statusOptionsHTML(o.status) +
          '</select>' +
          '<button class="btn-timeline btn-sm" type="button" onclick="OWN.openOrderTimeline(\'' + o.orderId + '\')" title="View full order timeline">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Timeline</button>' +
          (o.invoiceGenerated
            ? '<span class="st-badge st-ok" style="margin-left:auto;"><span class="st-dot"></span>Invoice Generated</span>'
            : '<button class="btn-ghost btn-sm" type="button" style="margin-left:auto;" onclick="OWN.generateInvoice(\'' + o.orderId + '\')">Generate Invoice</button>') +
        '</div>' +
        '<div class="fst" id="omsg-' + o.orderId + '"></div>' +
      '</div>'
    );
  }

  function renderOwnerOrders() {
    var list = $('#ownerOrderList');
    if (!list) return;
    var filtered = orderFilter === 'all'
      ? ownerOrdersCache
      : ownerOrdersCache.filter(function (o) { return o.status === orderFilter; });

    if (!filtered.length) {
      list.innerHTML = (
        '<div class="empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="6" width="14" height="10"/><path d="M15 9h4l3 3v4h-7"/></svg>' +
          '<p>No orders ' + (orderFilter === 'all' ? 'yet' : 'with this status') + '.</p>' +
        '</div>'
      );
      return;
    }
    list.innerHTML = filtered.map(ownerOrderCardHTML).join('');
  }

  $all('#orderFilterChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $all('#orderFilterChips .chip').forEach(function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      orderFilter = chip.dataset.filter;
      renderOwnerOrders();
    });
  });

  function loadOwnerOrders() {
    if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
    ordersUnsub = fbDB.collection('orders')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var orders = [];
        snap.forEach(function (doc) { orders.push(doc.data()); });
        ownerOrdersCache = orders;

        var delivered = orders.filter(function (o) { return o.status === 'delivered'; }).length;
        var active    = orders.length - delivered;
        $('#statApproved').textContent  = String(orders.length);
        $('#statOrders').textContent    = String(active);
        $('#statDelivered').textContent = String(delivered);

        renderOwnerOrders();
      }, function (err) {
        console.error('[OWN] orders listener:', err.message);
      });
  }

  window.OWN.updateOrderStatus = function (orderId) {
    var sel = $('#ostat-' + orderId);
    var msg = $('#omsg-' + orderId);
    if (!sel) return;

    /* Find the order to get customerUid */
    var order = ownerOrdersCache.filter(function (o) { return o.orderId === orderId; })[0];
    var previousStatus = order ? order.status : null;

    fbDB.collection('orders').doc(orderId).update({
      status:    sel.value,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '\u2713 Status updated to ' + EGC.orderStatusLabel(sel.value) + '.'; }
      toast(true, orderId + ' \u2192 ' + EGC.orderStatusLabel(sel.value));

      /* Notify customer of order status change */
      if (order) {
        var notifMsg = 'Order ' + orderId + ' status updated to: ' + EGC.orderStatusLabel(sel.value) + '.';
        EGC.createNotification(order.customerUid, 'order_status_update', notifMsg, { orderId: orderId, status: sel.value });
        EGC.logActivity(order.customerUid, 'order_status_update',
          'Order ' + orderId + ' is now ' + EGC.orderStatusLabel(sel.value),
          { orderId: orderId, status: sel.value });
      }

      /* Audit trail — use specific action key for status so timeline icons work */
      var statusActionMap = {
        truck_assigned: 'truck_assigned',
        loading:        'loading_started',
        in_transit:     'in_transit',
        delivered:      'delivered'
      };
      var specificAction = statusActionMap[sel.value] || 'status_changed';
      EGC.logAudit(specificAction,
        'Order ' + orderId + ' status changed from ' + EGC.orderStatusLabel(previousStatus) + ' to ' + EGC.orderStatusLabel(sel.value) + '.',
        { targetType: 'order', targetId: orderId, orderId: orderId, previousValue: previousStatus, newValue: sel.value });

    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not update status.'; }
    });
  };

  /* ---------------------------------------------------------
     GENERATE INVOICE (lightweight — creates an invoice record,
     notifies the customer, and logs the audit trail).
  --------------------------------------------------------- */
  window.OWN.generateInvoice = function (orderId) {
    var msg   = $('#omsg-' + orderId);
    var order = ownerOrdersCache.filter(function (o) { return o.orderId === orderId; })[0];
    if (!order) return;

    Promise.all([EGC.nextInvoiceId(), INV.nextLrNumber()]).then(function (ids) {
      var invoiceId = ids[0];
      var lrNumber  = ids[1];
      var invoiceRecord = INV.buildRecord({
        invoiceId: invoiceId,
        lrNumber:  lrNumber,
        order:     order,
        quote:     order   /* order already carries the quote-sourced fields */
      });

      var batch = fbDB.batch();
      batch.set(fbDB.collection('invoices').doc(invoiceId), invoiceRecord);
      batch.update(fbDB.collection('orders').doc(orderId), {
        invoiceGenerated: true,
        invoiceId:        invoiceId,
        lrNumber:         lrNumber,
        updatedAt:        firebase.firestore.FieldValue.serverTimestamp()
      });
      return batch.commit().then(function () { return invoiceId; });
    }).then(function (invoiceId) {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '\u2713 Invoice ' + invoiceId + ' generated.'; }
      toast(true, 'Invoice ' + invoiceId + ' generated for ' + orderId);

      var notifMsg = 'Invoice ' + invoiceId + ' has been generated for order ' + orderId + '.';
      EGC.createNotification(order.customerUid, 'invoice_generated', notifMsg, { orderId: orderId, invoiceId: invoiceId });
      EGC.logActivity(order.customerUid, 'invoice_generated',
        'Invoice ' + invoiceId + ' generated for order ' + orderId, { orderId: orderId, invoiceId: invoiceId });
      EGC.logAudit('invoice_generated', 'Invoice ' + invoiceId + ' generated for order ' + orderId + '.', {
        targetType: 'invoice', targetId: invoiceId, orderId: orderId, quoteId: order.quoteId || null,
        previousValue: null, newValue: { invoiceId: invoiceId }
      });
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not generate invoice.'; }
    });
  };

  /* ===========================================================
     ALL QUOTES — full history
  =========================================================== */
  var allQuotesUnsub = null;

  function allQuoteRowHTML(q) {
    var badge = '<span class="st-badge ' + EGC.quoteStatusClass(q.status) + '"><span class="st-dot"></span>' + EGC.quoteStatusLabelOwner(q.status) + '</span>';
    var revisionRow = q.revisedPrice
      ? '<div class="qrow-meta" style="margin-top:4px;"><span style="color:var(--amber);">&#8377;' + EGC.esc(q.revisedPrice) + ' revised</span></div>'
      : '';
    return (
      '<div class="qrow" style="grid-template-columns:1fr;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;">' +
          '<div>' +
            '<div class="qrow-id qrow-id-link" onclick="OWN.openQuoteTimeline(\'' + EGC.esc(q.quoteId) + '\')" title="View quote timeline">' + EGC.esc(q.quoteId) +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-left:5px;vertical-align:-1px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
            '<div class="qrow-route">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
              '<span>' + EGC.esc(q.pickup) + ' &rarr; ' + EGC.esc(q.delivery) + '</span>' +
            '</div>' +
            '<div class="qrow-meta"><span>' + EGC.esc(q.customerName) + '</span><span>' + EGC.esc(q.companyName || '') + '</span></div>' +
            revisionRow +
          '</div>' +
          '<div class="qrow-right">' + badge + '<div class="qrow-date">' + EGC.fmtWhen(q.createdAt) + '</div></div>' +
        '</div>' +
      '</div>'
    );
  }

  function loadAllQuotes() {
    var list = $('#allQuotesList');
    if (allQuotesUnsub) { allQuotesUnsub(); allQuotesUnsub = null; }
    allQuotesUnsub = fbDB.collection('quotes')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var quotes = [];
        snap.forEach(function (doc) { quotes.push(doc.data()); });
        if (!quotes.length) {
          if (list) list.innerHTML = '<div class="empty"><p>No quotes submitted yet.</p></div>';
          return;
        }
        if (list) list.innerHTML = quotes.map(allQuoteRowHTML).join('');
      }, function (err) {
        console.error('[OWN] all-quotes listener:', err.message);
      });
  }

  /* ===========================================================
     AUDIT LOGS — Phase 4 Upgraded
     - Entity-linked entries
     - Order & Quote specific timeline drawers
     - Checkbox multi-select + bulk export
     - Date range filter
     - PDF & Excel export (client-side, no deps)
  =========================================================== */
  var AUDIT_PAGE_SIZE   = 50;
  var auditLimitCount   = AUDIT_PAGE_SIZE;
  var auditUnsub        = null;
  var auditLogsCache    = [];
  var auditCategory     = 'all';
  var auditSearchTerm   = '';
  var auditDateFrom     = '';
  var auditDateTo       = '';
  var selectedAuditIds  = {};   /* { docId: entryObject } for export */

  var AUDIT_CATEGORY_MAP = {
    quote_submitted:   'quote',
    quote_revised:     'quote',
    quote_accepted:    'quote',
    quote_rejected:    'quote',
    order_created:     'order',
    status_changed:    'order',
    truck_assigned:    'order',
    loading_started:   'order',
    in_transit:        'order',
    delivered:         'order',
    notification_sent: 'notification',
    invoice_generated: 'invoice',
    payment_recorded:  'invoice'
  };

  var AUDIT_PILL_CLASS = {
    quote:        'apill-quote',
    order:        'apill-order',
    notification: 'apill-notif',
    invoice:      'apill-invoice'
  };

  function subscribeAuditLogs(limitCount) {
    if (auditUnsub) { auditUnsub(); auditUnsub = null; }
    auditUnsub = fbDB.collection('auditLogs')
      .orderBy('createdAt', 'desc')
      .limit(limitCount)
      .onSnapshot(function (snap) {
        var logs = [];
        snap.forEach(function (doc) { var d = doc.data(); d._docId = doc.id; logs.push(d); });
        auditLogsCache = logs;
        renderAuditLogs(snap.size >= limitCount);
      }, function (err) {
        console.error('[OWN] audit log listener:', err.code, err.message);
        var tbody = $('#auditLogBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><p style="color:#ff7070;">Could not load audit logs.<br><small>' + err.message + '</small></p></div></td></tr>';
      });
  }

  function loadAuditLogs() {
    auditLimitCount = AUDIT_PAGE_SIZE;
    subscribeAuditLogs(auditLimitCount);
  }

  window.OWN.loadMoreAudit = function () {
    var btn = $('#auditLoadMoreBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    auditLimitCount += AUDIT_PAGE_SIZE;
    subscribeAuditLogs(auditLimitCount);
  };

  $all('#auditFilterChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $all('#auditFilterChips .chip').forEach(function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      auditCategory = chip.dataset.filter;
      selectedAuditIds = {};
      renderAuditLogs();
    });
  });

  var auditSearchInput = $('#auditSearch');
  if (auditSearchInput) {
    auditSearchInput.addEventListener('input', function () {
      auditSearchTerm = auditSearchInput.value.trim().toLowerCase();
      selectedAuditIds = {};
      renderAuditLogs();
    });
  }

  var auditDateFromEl = $('#auditDateFrom');
  var auditDateToEl   = $('#auditDateTo');
  if (auditDateFromEl) auditDateFromEl.addEventListener('change', function () { auditDateFrom = auditDateFromEl.value; selectedAuditIds = {}; renderAuditLogs(); });
  if (auditDateToEl)   auditDateToEl.addEventListener('change',   function () { auditDateTo   = auditDateToEl.value;   selectedAuditIds = {}; renderAuditLogs(); });

  window.OWN.clearAuditDates = function () {
    auditDateFrom = ''; auditDateTo = '';
    if (auditDateFromEl) auditDateFromEl.value = '';
    if (auditDateToEl)   auditDateToEl.value   = '';
    renderAuditLogs();
  };

  function fmtAuditTs(ts) {
    if (!ts || !ts.toDate) return '\u2014';
    var d = ts.toDate();
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function fmtAuditValue(v) {
    if (v == null) return '\u2014';
    if (typeof v === 'object') {
      try { return Object.keys(v).map(function (k) { return k + ': ' + v[k]; }).join(', '); }
      catch (e) { return JSON.stringify(v); }
    }
    return String(v);
  }

  function auditMatchesFilters(entry) {
    if (auditCategory !== 'all' && AUDIT_CATEGORY_MAP[entry.action] !== auditCategory) return false;
    if ((auditDateFrom || auditDateTo) && entry.createdAt && entry.createdAt.toDate) {
      var dStr = entry.createdAt.toDate().toISOString().slice(0, 10);
      if (auditDateFrom && dStr < auditDateFrom) return false;
      if (auditDateTo   && dStr > auditDateTo)   return false;
    }
    if (!auditSearchTerm) return true;
    var haystack = [
      entry.actionLabel, entry.action, entry.summary,
      entry.actorEmail, entry.actorRole,
      entry.targetId, entry.orderId, entry.quoteId,
      fmtAuditValue(entry.previousValue), fmtAuditValue(entry.newValue)
    ].join(' ').toLowerCase();
    return haystack.indexOf(auditSearchTerm) !== -1;
  }

  function auditEntityLink(entry) {
    if (entry.orderId) {
      return '<span class="audit-entity-link" onclick="OWN.openOrderTimeline(\'' + EGC.esc(entry.orderId) + '\')" title="View order timeline">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
        EGC.esc(entry.orderId) + '</span>';
    }
    if (entry.quoteId) {
      return '<span class="audit-entity-link aql" onclick="OWN.openQuoteTimeline(\'' + EGC.esc(entry.quoteId) + '\')" title="View quote timeline">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
        EGC.esc(entry.quoteId) + '</span>';
    }
    if (entry.targetId) return '<span class="audit-entity-plain"><span class="aep-type">' + EGC.esc(entry.targetType || '') + '</span>' + EGC.esc(entry.targetId) + '</span>';
    return '\u2014';
  }

  function auditRowHTML(entry) {
    var cat     = AUDIT_CATEGORY_MAP[entry.action] || 'order';
    var pillCls = AUDIT_PILL_CLASS[cat] || 'apill-order';
    var sel     = !!selectedAuditIds[entry._docId];
    var userHTML = '<div class="audit-user">' + EGC.esc(entry.actorRole || 'system') +
        '<span class="au-email">' + EGC.esc(entry.actorEmail || 'system') + '</span></div>';
    var diffHTML = (entry.previousValue != null || entry.newValue != null)
      ? '<span class="audit-diff">' + EGC.esc(fmtAuditValue(entry.previousValue)) + ' \u2192 ' + EGC.esc(fmtAuditValue(entry.newValue)) + '</span>'
      : '\u2014';
    return (
      '<tr class="audit-row' + (sel ? ' row-selected' : '') + '">' +
        '<td class="audit-check-cell"><input type="checkbox" class="audit-cb" data-id="' + EGC.esc(entry._docId) + '"' + (sel ? ' checked' : '') + ' onchange="OWN.toggleAuditSelect(this)"></td>' +
        '<td class="audit-when">' + fmtAuditTs(entry.createdAt) + '</td>' +
        '<td>' + userHTML + '</td>' +
        '<td><span class="audit-action-pill ' + pillCls + '">' + EGC.esc(entry.actionLabel || entry.action) + '</span></td>' +
        '<td>' + auditEntityLink(entry) + '</td>' +
        '<td>' + diffHTML + '</td>' +
        '<td class="audit-summary">' + EGC.esc(entry.summary || '\u2014') + '</td>' +
      '</tr>'
    );
  }

  function renderAuditLogs(hasMore) {
    var tbody    = $('#auditLogBody');
    var empty    = $('#auditEmpty');
    var moreWrap = $('#auditLoadMoreWrap');
    var moreBtn  = $('#auditLoadMoreBtn');
    if (!tbody) return;

    var filtered = auditLogsCache.filter(auditMatchesFilters);

    if (!filtered.length) {
      tbody.innerHTML = '';
      if (empty) empty.style.display = 'block';
    } else {
      if (empty) empty.style.display = 'none';
      tbody.innerHTML = filtered.map(auditRowHTML).join('');
    }

    updateSelectionToolbar(filtered);

    var showMore = !!hasMore && auditCategory === 'all' && !auditSearchTerm && !auditDateFrom && !auditDateTo;
    if (moreWrap) moreWrap.style.display = showMore ? 'block' : 'none';
    if (moreBtn)  { moreBtn.disabled = false; moreBtn.textContent = 'Load More Logs'; }
  }

  function updateSelectionToolbar(filtered) {
    var bar     = $('#auditSelBar');
    var countEl = $('#auditSelCount');
    var count   = Object.keys(selectedAuditIds).length;
    if (bar)     bar.style.display = count > 0 ? 'flex' : 'none';
    if (countEl) countEl.textContent = count + ' record' + (count === 1 ? '' : 's') + ' selected';

    var saBox = $('#auditSelectAll');
    if (saBox) {
      var allSelected = filtered.length > 0 && filtered.every(function (e) { return selectedAuditIds[e._docId]; });
      saBox.checked       = allSelected;
      saBox.indeterminate = count > 0 && !allSelected;
    }
  }

  window.OWN.toggleAuditSelect = function (cb) {
    var id = cb.dataset.id;
    var entry = auditLogsCache.filter(function (e) { return e._docId === id; })[0];
    if (cb.checked && entry) selectedAuditIds[id] = entry;
    else                     delete selectedAuditIds[id];
    var row = cb.closest('tr');
    if (row) row.classList.toggle('row-selected', cb.checked);
    updateSelectionToolbar(auditLogsCache.filter(auditMatchesFilters));
  };

  window.OWN.toggleSelectAllAudit = function (cb) {
    var filtered = auditLogsCache.filter(auditMatchesFilters);
    filtered.forEach(function (e) {
      if (cb.checked) selectedAuditIds[e._docId] = e;
      else            delete selectedAuditIds[e._docId];
    });
    renderAuditLogs();
  };

  window.OWN.clearAuditSelection = function () {
    selectedAuditIds = {};
    renderAuditLogs();
  };

  /* ── Export helpers ── */
  var AUDIT_CSV_HEADERS = ['Timestamp','Actor Role','Actor Email','Action','Target Type','Target ID','Order ID','Quote ID','Previous Value','New Value','Summary'];

  function auditToRows(entries) {
    return entries.map(function (e) {
      return [
        (e.createdAt && e.createdAt.toDate) ? e.createdAt.toDate().toLocaleString('en-IN') : '',
        e.actorRole  || '',
        e.actorEmail || '',
        e.actionLabel || e.action || '',
        e.targetType  || '',
        e.targetId    || '',
        e.orderId     || '',
        e.quoteId     || '',
        fmtAuditValue(e.previousValue),
        fmtAuditValue(e.newValue),
        e.summary     || ''
      ];
    });
  }

  function downloadExcel(rows, filename) {
    var esc = function (v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var headerHtml = AUDIT_CSV_HEADERS.map(function (h) { return '<th style="background:#1a2235;color:#f5930a;font-weight:bold;border:1px solid #333;padding:6px;">' + esc(h) + '</th>'; }).join('');
    var rowsHtml   = rows.map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td style="border:1px solid #ccc;padding:5px;mso-number-format:\'\\@\';">' + esc(c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
      '<head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
      '<x:Name>Audit Log</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>' +
      '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>' +
      '<table>' + '<thead><tr>' + headerHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></body></html>';
    var blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function downloadPDF(rows, title, subtitle, timelineMode) {
    var esc = function (v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    var body;
    if (timelineMode) {
      /* Vertical timeline layout for a single order/quote */
      body = '<div class="tl">' + rows.map(function (r) {
        return '<div class="tle">' +
          '<div class="tlt">' + esc(r[0]) + '</div>' +
          '<div class="tlbox"><div class="tll">' + esc(r[3]) + '</div>' +
          '<div class="tlw">' + esc(r[1]) + ' \u00B7 ' + esc(r[2]) + '</div>' +
          (r[10] ? '<div class="tls">' + esc(r[10]) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    } else {
      var headerHtml = AUDIT_CSV_HEADERS.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('');
      var rowsHtml   = rows.map(function (r, i) {
        return '<tr' + (i % 2 ? ' class="alt"' : '') + '>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('');
      body = '<table><thead><tr>' + headerHtml + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    }
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(title) + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#111;margin:24px;}' +
      '.head{border-bottom:3px solid #f5930a;padding-bottom:10px;margin-bottom:16px;}' +
      '.brand{font-size:11px;color:#f5930a;font-weight:bold;letter-spacing:1px;text-transform:uppercase;}' +
      'h1{font-size:17px;margin:4px 0 2px;}' +
      '.sub{font-size:11px;color:#555;}' +
      'table{width:100%;border-collapse:collapse;}' +
      'th{background:#1a2235;color:#f5930a;text-align:left;padding:6px 8px;font-size:8.5px;text-transform:uppercase;letter-spacing:.4px;}' +
      'td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top;word-break:break-word;max-width:130px;}' +
      'tr.alt td{background:#f7f8fa;}' +
      '.tl{margin-top:8px;}' +
      '.tle{display:flex;gap:14px;margin-bottom:2px;}' +
      '.tlt{width:130px;flex:none;font-size:10px;color:#666;padding-top:10px;}' +
      '.tlbox{border-left:2px solid #f5930a;padding:8px 0 12px 16px;position:relative;flex:1;}' +
      '.tlbox:before{content:"";position:absolute;left:-6px;top:11px;width:10px;height:10px;border-radius:50%;background:#f5930a;}' +
      '.tll{font-size:12px;font-weight:bold;color:#1a2235;}' +
      '.tlw{font-size:9.5px;color:#888;margin-top:2px;}' +
      '.tls{font-size:10px;color:#444;margin-top:4px;}' +
      '.foot{margin-top:22px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:8px;}' +
      '@media print{@page{margin:12mm;' + (timelineMode ? 'size:A4 portrait;' : 'size:A4 landscape;') + '}}' +
      '</style></head><body>' +
      '<div class="head"><div class="brand">Express Goods Carrier</div><h1>' + esc(title) + '</h1><div class="sub">' + esc(subtitle) + '</div></div>' +
      body +
      '<div class="foot">This is a permanent, append-only business audit record generated by Express Goods Carrier. Audit entries cannot be edited or deleted.</div>' +
      '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast(false, 'Pop-up blocked — allow pop-ups to export PDF.'); return; }
    w.document.write(html); w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 450);
  }

  /* ── Master log export actions ── */
  window.OWN.exportSelectedPDF = function () {
    var sel = Object.keys(selectedAuditIds).map(function (k) { return selectedAuditIds[k]; });
    if (!sel.length) { toast(false, 'Select at least one audit entry first.'); return; }
    sel.sort(function (a, b) {
      var ta = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
      var tb = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
      return ta - tb;
    });
    downloadPDF(auditToRows(sel), 'Selected Audit Records (' + sel.length + ')',
      'Exported ' + new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }));
    toast(true, 'PDF ready — ' + sel.length + ' records.');
  };

  window.OWN.exportSelectedExcel = function () {
    var sel = Object.keys(selectedAuditIds).map(function (k) { return selectedAuditIds[k]; });
    if (!sel.length) { toast(false, 'Select at least one audit entry first.'); return; }
    downloadExcel(auditToRows(sel), 'egc-audit-selected-' + new Date().toISOString().slice(0,10) + '.xls');
    toast(true, 'Excel downloaded — ' + sel.length + ' records.');
  };

  window.OWN.exportFilteredExcel = function () {
    var filtered = auditLogsCache.filter(auditMatchesFilters);
    if (!filtered.length) { toast(false, 'No audit log rows to export.'); return; }
    downloadExcel(auditToRows(filtered), 'egc-audit-log-' + new Date().toISOString().slice(0,10) + '.xls');
    toast(true, 'Exported ' + filtered.length + ' records to Excel.');
  };

  window.OWN.exportFilteredPDF = function () {
    var filtered = auditLogsCache.filter(auditMatchesFilters);
    if (!filtered.length) { toast(false, 'No audit log rows to export.'); return; }
    downloadPDF(auditToRows(filtered), 'Master Audit Log',
      new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) + ' \u00B7 ' + filtered.length + ' records');
    toast(true, 'PDF ready — ' + filtered.length + ' records.');
  };

  /* ── Timeline drawer (shared render for order & quote) ── */
  function renderTimeline(events, kind, entityId) {
    if (!events.length) return '<div class="tl-empty">No timeline events recorded yet.</div>';
    var exportRow = '<div class="tl-export-row">' +
      '<button class="btn-ghost btn-sm" onclick="OWN.export' + kind + 'TimelinePDF(\'' + EGC.esc(entityId) + '\')">Export Full Timeline (PDF)</button>' +
      '<button class="btn-ghost btn-sm" onclick="OWN.export' + kind + 'TimelineExcel(\'' + EGC.esc(entityId) + '\')">Export (Excel)</button>' +
      '</div>';
    var items = events.map(function (e, i) {
      var iconCls = EGC.AUDIT_TIMELINE_ICONS[e.action] || 'tl-default';
      var ts = (e.createdAt && e.createdAt.toDate) ? e.createdAt.toDate() : null;
      var timeStr = ts ? ts.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true }) : '\u2014';
      var dateStr = ts ? ts.toLocaleDateString('en-IN', { day:'2-digit', month:'short' }) : '';
      var isLast  = i === events.length - 1;
      return (
        '<div class="tl-event' + (isLast ? ' tl-last' : '') + '">' +
          '<div class="tl-spine"><div class="tl-dot ' + iconCls + '"></div>' + (isLast ? '' : '<div class="tl-line"></div>') + '</div>' +
          '<div class="tl-content">' +
            '<div class="tl-time">' + EGC.esc(timeStr) + (dateStr ? ' <span class="tl-date">\u00B7 ' + EGC.esc(dateStr) + '</span>' : '') + '</div>' +
            '<div class="tl-label">' + EGC.esc(e.actionLabel || e.action) + '</div>' +
            '<div class="tl-who">' + EGC.esc(e.actorRole || 'system') + (e.actorEmail ? ' \u00B7 ' + EGC.esc(e.actorEmail) : '') + '</div>' +
            (e.summary ? '<div class="tl-summary">' + EGC.esc(e.summary) + '</div>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');
    return exportRow + '<div class="timeline">' + items + '</div>';
  }

  function openTimelineDrawer(collection, kind, entityId, heading, subhead) {
    var drawer  = $('#timelineDrawer');
    var hEl     = $('#tlDrawerHeading');
    var subEl   = $('#tlDrawerSubhead');
    var body    = $('#tlDrawerBody');
    if (!drawer) return;
    hEl.textContent   = heading;
    subEl.textContent = subhead;
    body.innerHTML    = '<div class="tl-loading">Loading timeline\u2026</div>';
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';

    fbDB.collection(collection).doc(entityId).collection('events')
      .orderBy('createdAt', 'asc').get()
      .then(function (snap) {
        var events = [];
        snap.forEach(function (doc) { events.push(doc.data()); });
        body.innerHTML = renderTimeline(events, kind, entityId);
      })
      .catch(function (err) {
        body.innerHTML = '<div class="tl-empty" style="color:#ff7070;">Could not load timeline: ' + EGC.esc(err.message) + '</div>';
      });
  }

  window.OWN.openOrderTimeline = function (orderId) {
    openTimelineDrawer('orderTimelines', 'Order', orderId, 'Order ' + orderId, 'Complete order lifecycle');
  };
  window.OWN.openQuoteTimeline = function (quoteId) {
    openTimelineDrawer('quoteTimelines', 'Quote', quoteId, 'Quote ' + quoteId, 'Complete quote history');
  };
  window.OWN.closeTimeline = function () {
    var drawer = $('#timelineDrawer');
    if (drawer) { drawer.classList.remove('open'); document.body.style.overflow = ''; }
  };

  function fetchTimelineRows(collection, docId, cb) {
    fbDB.collection(collection).doc(docId).collection('events')
      .orderBy('createdAt', 'asc').get()
      .then(function (snap) {
        var events = []; snap.forEach(function (doc) { events.push(doc.data()); });
        cb(null, events);
      })
      .catch(function (err) { cb(err, []); });
  }

  window.OWN.exportOrderTimelinePDF = function (orderId) {
    fetchTimelineRows('orderTimelines', orderId, function (err, events) {
      if (err || !events.length) { toast(false, 'No timeline data to export.'); return; }
      downloadPDF(auditToRows(events), 'Order ' + orderId + ' — Audit Timeline',
        'Complete lifecycle \u00B7 ' + events.length + ' events \u00B7 ' + new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }), true);
      toast(true, 'Order timeline PDF ready.');
    });
  };
  window.OWN.exportOrderTimelineExcel = function (orderId) {
    fetchTimelineRows('orderTimelines', orderId, function (err, events) {
      if (err || !events.length) { toast(false, 'No timeline data to export.'); return; }
      downloadExcel(auditToRows(events), 'egc-order-' + orderId + '-timeline.xls');
      toast(true, 'Order timeline Excel downloaded.');
    });
  };
  window.OWN.exportQuoteTimelinePDF = function (quoteId) {
    fetchTimelineRows('quoteTimelines', quoteId, function (err, events) {
      if (err || !events.length) { toast(false, 'No timeline data to export.'); return; }
      downloadPDF(auditToRows(events), 'Quote ' + quoteId + ' — History Timeline',
        'Complete history \u00B7 ' + events.length + ' events \u00B7 ' + new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }), true);
      toast(true, 'Quote timeline PDF ready.');
    });
  };
  window.OWN.exportQuoteTimelineExcel = function (quoteId) {
    fetchTimelineRows('quoteTimelines', quoteId, function (err, events) {
      if (err || !events.length) { toast(false, 'No timeline data to export.'); return; }
      downloadExcel(auditToRows(events), 'egc-quote-' + quoteId + '-timeline.xls');
      toast(true, 'Quote timeline Excel downloaded.');
    });
  };

  /* ===========================================================
     INVOICES PANEL (Owner) — Phase 5
     Real-time list, search, view/print/PDF, payment status update.
  =========================================================== */
  var invUnsub        = null;
  var ownerInvCache   = [];
  var invSearchTerm   = '';
  var invStatusFilter = 'all';

  function loadInvoices() {
    if (invUnsub) { invUnsub(); invUnsub = null; }
    invUnsub = fbDB.collection('invoices')
      .orderBy('createdAt', 'desc')
      .onSnapshot(function (snap) {
        var rows = [];
        snap.forEach(function (doc) { var d = doc.data(); d._docId = doc.id; rows.push(d); });
        ownerInvCache = rows;
        renderInvoices();
        updateInvStats();
      }, function (err) {
        console.error('[OWN] invoices listener:', err.code, err.message);
        var list = $('#ownerInvoiceList');
        if (list) list.innerHTML = '<div class="empty"><p style="color:#ff7070;">Could not load invoices.<br><small>' + err.message + '</small></p></div>';
      });
  }

  function updateInvStats() {
    var out = 0, paid = 0, pend = 0;
    ownerInvCache.forEach(function (inv) {
      var t = INV.computeTotals(inv);
      out += t.outstanding;
      if (INV.effectiveStatus(inv) === 'paid') paid++; else pend++;
    });
    var o = $('#invStatOutstanding'); if (o) o.textContent = '\u20B9' + INV.fmtMoney(out);
    var p = $('#invStatPaid');        if (p) p.textContent = paid;
    var n = $('#invStatPending');     if (n) n.textContent = pend;
  }

  $all('#invFilterChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $all('#invFilterChips .chip').forEach(function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      invStatusFilter = chip.dataset.filter;
      renderInvoices();
    });
  });

  var invSearchInput = $('#invSearch');
  if (invSearchInput) {
    invSearchInput.addEventListener('input', function () {
      invSearchTerm = invSearchInput.value.trim().toLowerCase();
      renderInvoices();
    });
  }

  function invMatches(inv) {
    if (invStatusFilter !== 'all' && INV.effectiveStatus(inv) !== invStatusFilter) return false;
    if (!invSearchTerm) return true;
    var hay = [inv.invoiceNumber, inv.lrNumber, inv.orderId, inv.quoteId,
      inv.customerName, inv.customerCompany, inv.customerGst].join(' ').toLowerCase();
    return hay.indexOf(invSearchTerm) !== -1;
  }

  function invStatusPill(inv) {
    var s = INV.effectiveStatus(inv);
    return '<span class="pay-pill ' + INV.paymentClass(s) + '">' + INV.paymentLabel(s) + '</span>';
  }

  function ownerInvoiceCardHTML(inv) {
    var t = INV.computeTotals(inv);
    var statusSel = ['pending', 'partial', 'paid', 'overdue'].map(function (s) {
      return '<option value="' + s + '"' + (inv.paymentStatus === s ? ' selected' : '') + '>' + INV.paymentLabel(s) + '</option>';
    }).join('');
    return (
      '<div class="inv-card">' +
        '<div class="inv-card-top">' +
          '<div><div class="inv-id">' + EGC.esc(inv.invoiceNumber) + '</div>' +
            '<div class="inv-sub">' + EGC.esc(inv.lrNumber || '') + ' \u00B7 ' + EGC.esc(inv.orderId || '') + ' \u00B7 ' + EGC.fmtWhen(inv.createdAt) + '</div></div>' +
          invStatusPill(inv) +
        '</div>' +
        '<div class="inv-card-grid">' +
          '<div class="inv-field"><span>Customer</span><strong>' + EGC.esc(inv.customerName || '\u2014') + '</strong></div>' +
          '<div class="inv-field"><span>Company</span><strong>' + EGC.esc(inv.customerCompany || '\u2014') + '</strong></div>' +
          '<div class="inv-field"><span>Route</span><strong>' + EGC.esc(inv.fromLocation || '') + ' \u2192 ' + EGC.esc(inv.toLocation || '') + '</strong></div>' +
          '<div class="inv-field"><span>Invoice Value</span><strong style="color:var(--amber);">\u20B9' + INV.fmtMoney(t.invoiceValue) + '</strong></div>' +
          '<div class="inv-field"><span>Received</span><strong>\u20B9' + INV.fmtMoney(inv.receivedAmount) + '</strong></div>' +
          '<div class="inv-field"><span>Outstanding</span><strong style="color:' + (t.outstanding > 0 ? '#ff9f43' : 'var(--green)') + ';">\u20B9' + INV.fmtMoney(t.outstanding) + '</strong></div>' +
        '</div>' +
        '<div class="inv-card-actions">' +
          '<button class="btn-ghost btn-sm" onclick="OWN.viewInvoice(\'' + EGC.esc(inv._docId) + '\')">View</button>' +
          '<button class="btn-ghost btn-sm" onclick="OWN.printInvoice(\'' + EGC.esc(inv._docId) + '\')">Print / PDF</button>' +
          '<div class="inv-pay-update">' +
            '<select class="inv-status-select" id="invstat-' + EGC.esc(inv._docId) + '">' + statusSel + '</select>' +
            '<input type="number" class="inv-recv-input" id="invrecv-' + EGC.esc(inv._docId) + '" placeholder="Received \u20B9" value="' + (inv.receivedAmount || '') + '" min="0">' +
            '<button class="btn-a btn-sm" onclick="OWN.updatePayment(\'' + EGC.esc(inv._docId) + '\')">Update</button>' +
          '</div>' +
        '</div>' +
        '<div class="fst" id="invmsg-' + EGC.esc(inv._docId) + '"></div>' +
      '</div>'
    );
  }

  function renderInvoices() {
    var list  = $('#ownerInvoiceList');
    var empty = $('#ownerInvoiceEmpty');
    if (!list) return;
    var filtered = ownerInvCache.filter(invMatches);
    if (!filtered.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = filtered.map(ownerInvoiceCardHTML).join('');
  }

  function findInv(docId) { return ownerInvCache.filter(function (i) { return i._docId === docId; })[0]; }

  window.OWN.viewInvoice = function (docId) {
    var inv = findInv(docId);
    if (inv) INV.openInvoiceWindow(inv, false).then(function (ok) { if (!ok) toast(false, 'Allow pop-ups to view the invoice.'); });
  };
  window.OWN.printInvoice = function (docId) {
    var inv = findInv(docId);
    if (inv) INV.openInvoiceWindow(inv, true).then(function (ok) { if (!ok) toast(false, 'Allow pop-ups to print the invoice.'); });
  };

  window.OWN.updatePayment = function (docId) {
    var inv = findInv(docId);
    if (!inv) return;
    var sel  = $('#invstat-' + docId);
    var recv = $('#invrecv-' + docId);
    var msg  = $('#invmsg-' + docId);
    var newStatus = sel ? sel.value : inv.paymentStatus;
    var received  = recv ? INV.toNum(recv.value) : INV.toNum(inv.receivedAmount);

    var t = INV.computeTotals(Object.assign({}, inv, { receivedAmount: received }));
    /* keep status coherent with amounts when owner doesn't override */
    if (received >= t.invoiceValue && t.invoiceValue > 0) newStatus = 'paid';

    var update = {
      paymentStatus:     newStatus,
      receivedAmount:    received,
      outstandingAmount: t.outstanding,
      paymentDate:       (newStatus === 'paid' || received > 0) ? firebase.firestore.FieldValue.serverTimestamp() : null,
      updatedAt:         firebase.firestore.FieldValue.serverTimestamp()
    };

    fbDB.collection('invoices').doc(inv.invoiceId).update(update).then(function () {
      if (msg) { msg.className = 'fst ok'; msg.textContent = '\u2713 Payment updated \u2014 ' + INV.paymentLabel(newStatus) + '.'; }
      toast(true, inv.invoiceNumber + ' \u2192 ' + INV.paymentLabel(newStatus));

      EGC.createNotification(inv.customerUid, 'payment_update',
        'Payment status for invoice ' + inv.invoiceNumber + ' is now: ' + INV.paymentLabel(newStatus) + '.',
        { invoiceId: inv.invoiceId, orderId: inv.orderId });
      EGC.logActivity(inv.customerUid, 'payment_update',
        'Invoice ' + inv.invoiceNumber + ' marked ' + INV.paymentLabel(newStatus),
        { invoiceId: inv.invoiceId });
      EGC.logAudit('payment_recorded',
        'Invoice ' + inv.invoiceNumber + ' payment status set to ' + INV.paymentLabel(newStatus) + ' (received \u20B9' + INV.fmtMoney(received) + ').',
        { targetType: 'invoice', targetId: inv.invoiceId, orderId: inv.orderId, quoteId: inv.quoteId,
          previousValue: INV.paymentLabel(inv.paymentStatus), newValue: INV.paymentLabel(newStatus) });
    }).catch(function (err) {
      if (msg) { msg.className = 'fst er'; msg.textContent = err.message || 'Could not update payment.'; }
    });
  };

})();
