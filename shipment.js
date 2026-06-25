/* ============================================================
   SHIPMENT.JS — Single Source of Truth (SSoT)
   Orbit Logistics platform

   PRINCIPLE
   ---------
   The ORDER is the master record for every shared shipment fact:
   parties, route, cargo, weights, vehicle, driver, the full charge
   breakdown and payment status.

   Invoice and Lorry Receipt records keep ONLY their own document
   identity (numbers, dates, doc-specific flags). At render / download
   time the document is "projected" from the order:

       view = SHIP.toInvoiceView(order, invoiceDoc)
       view = SHIP.toLrView(order, lrDoc)

   so Invoice, LR, Accounting, Excel, Reports, Audit and both
   dashboards all read the SAME shared data. Edit the order once →
   every connected module reflects it. No duplicate editable copies.

   BACKWARD COMPATIBILITY
   ----------------------
   Existing invoice/LR documents already carry their own field copies.
   The projection helpers FALL BACK to those copies when an order field
   is missing, so legacy documents keep rendering correctly while new
   edits flow exclusively through the order. This lets us adopt SSoT
   without a destructive migration.

   Depends on: window.INV (invoice.js), window.LR (lr.js), firebase
   ============================================================ */

(function () {
  'use strict';

  window.SHIP = window.SHIP || {};

  var toNum = window.INV ? window.INV.toNum : function (v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  /* ----------------------------------------------------------
     CANONICAL CHARGE MODEL  (one shared breakdown for everything)
     The LR's richer transport breakdown is the canonical schema.
     The invoice's older freight/halting/extra map onto it as named
     lines so both documents total identically and accounting reads
     a single set of fields.
  ---------------------------------------------------------- */
  window.SHIP.CHARGE_KEYS = [
    'freight', 'fov', 'labour', 'localCollection',
    'doorDelivery', 'docketCharges', 'haltingCharges', 'extraCharges'
  ];

  window.SHIP.computeCharges = function (o) {
    var lines = {
      freight:         toNum(o.freight != null ? o.freight : o.freightCharges),
      fov:             toNum(o.fov),
      labour:          toNum(o.labour),
      localCollection: toNum(o.localCollection),
      doorDelivery:    toNum(o.doorDelivery),
      docketCharges:   toNum(o.docketCharges),
      haltingCharges:  toNum(o.haltingCharges),
      extraCharges:    toNum(o.extraCharges)
    };
    var subTotal = 0;
    window.SHIP.CHARGE_KEYS.forEach(function (k) { subTotal += toNum(lines[k]); });

    var discount = toNum(o.discount);
    var sgstRate = toNum(o.sgstRate);
    var cgstRate = toNum(o.cgstRate);
    var taxable  = subTotal - discount;
    var sgst = taxable * sgstRate / 100;
    var cgst = taxable * cgstRate / 100;
    var grandTotal = taxable + sgst + cgst;

    var advance  = toNum(o.advanceReceived);
    var received = toNum(o.receivedAmount);
    var outstanding = Math.max(0, grandTotal - advance - received);

    return {
      lines:       lines,
      subTotal:    subTotal,
      discount:    discount,
      sgst:        sgst,
      cgst:        cgst,
      grandTotal:  grandTotal,
      advance:     advance,
      received:    received,
      outstanding: outstanding
    };
  };

  /* ----------------------------------------------------------
     MASTER ORDER RECORD
     Builds the canonical order at approval time from the quote.
     Everything shared lives here; documents will project from it.
  ---------------------------------------------------------- */
  window.SHIP.buildOrder = function (opts) {
    /* opts: { orderId, quoteId, invoiceId, lrNumber, quote, pricing } */
    var q = opts.quote || {};
    var pricing = opts.pricing || {};
    var shipmentType = q.shipmentType || 'commercial';
    var isPersonal = shipmentType === 'personal';

    var freight = toNum(pricing.freight != null ? pricing.freight
                        : (q.revisedPrice != null ? q.revisedPrice : pricing.price));

    return {
      /* identity + document links (doc-specific numbers stay on the docs;
         the order keeps references so modules can resolve each other) */
      orderId:    opts.orderId,
      quoteId:    opts.quoteId || q.quoteId || null,
      invoiceId:  opts.invoiceId || null,
      lrNumber:   opts.lrNumber || null,
      customerUid: q.customerUid || null,

      /* classification */
      shipmentType: shipmentType,

      /* customer / parties — SINGLE definition of who is involved */
      customerName:  q.customerName || '',
      customerEmail: q.customerEmail || '',
      customerPhone: q.customerPhone || '',
      companyName:   isPersonal ? '' : (q.companyName || ''),
      customerGst:   isPersonal ? '' : (q.customerGst || ''),

      consignorName:    isPersonal ? (q.senderName || q.customerName || '')
                                   : (q.companyName || q.customerName || ''),
      consignorAddress: isPersonal ? (q.pickupAddress || q.pickup || '')
                                   : (q.registeredAddress || q.pickupAddress || q.pickup || ''),
      consignorContact: isPersonal ? (q.senderMobile || q.customerPhone || '')
                                   : (q.companyMobile || q.customerPhone || ''),
      consignorContactPerson: isPersonal ? '' : (q.contactPerson || ''),
      consignorEmail:   isPersonal ? (q.senderEmail || q.customerEmail || '')
                                   : (q.companyEmail || q.customerEmail || ''),
      consignorGstin:   isPersonal ? '' : (q.customerGst || ''),

      consigneeName:    isPersonal ? (q.receiverName || '') : (q.consigneeName || ''),
      consigneeAddress: isPersonal ? (q.deliveryAddress || q.delivery || '')
                                   : (q.consigneeAddress || q.deliveryAddress || q.delivery || ''),
      consigneeContact: isPersonal ? (q.receiverMobile || '') : (q.consigneeContact || ''),
      consigneeContactPerson: isPersonal ? '' : (q.consigneeContactPerson || ''),
      consigneeEmail:   isPersonal ? (q.receiverEmail || '') : (q.consigneeEmail || ''),
      consigneeGstin:   isPersonal ? '' : (q.consigneeGstin || ''),

      /* route */
      pickup:   q.pickup || '',
      delivery: q.delivery || '',

      /* cargo (entered once on the quote) */
      materialType:  q.materialType || q.material || '',
      packages:      q.packages || '',
      actualWeight:  q.weight || q.approxWeight || '',
      chargedWeight: q.weight || q.approxWeight || '',   /* defaults to actual; drives billing */
      packingMethod: q.packingMethod || 'BUNDLES',

      /* vehicle / driver — entered once, shown on invoice + LR */
      vehicleType:   q.vehicleType || '',                /* preserved for future pricing */
      vehicleNumber: '',
      driverName:    '',
      driverMobile:  '',
      transportMode: 'Road',
      dispatchMode:  'Door',

      /* canonical charge breakdown (freight auto; rest 0, owner-editable) */
      freight:         freight,
      fov:             0,
      labour:          0,
      localCollection: 0,
      doorDelivery:    0,
      docketCharges:   0,
      haltingCharges:  0,
      extraCharges:    0,
      discount:        0,
      sgstRate:        0,
      cgstRate:        0,

      /* payment — single status shared by invoice + LR + accounting */
      advanceReceived: 0,
      receivedAmount:  0,
      paymentStatus:   'pending',
      paymentDate:     null,

      /* extras */
      specialInstructions: q.specialInstructions || q.notes || '',
      insuranceDetails:    '',
      remarks:             '',
      ewayBill:            '',
      gstPayableBy:        isPersonal ? 'Consignor' : 'Consignee',

      /* free-form pricing slot kept open for future tiered pricing */
      pricingModel: pricing.model || null,

      status:     'approved',
      notes:      q.notes || '',
      pickupDate: q.pickupDate || '',

      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  };

  /* ----------------------------------------------------------
     PROJECTIONS — merge shared order data with document identity.
     `doc` is the stored invoice/LR record (provides its number/dates
     and legacy fallbacks). `order` always wins for shared fields.
  ---------------------------------------------------------- */
  function pick(order, doc, key, legacyKey) {
    if (order && order[key] != null && order[key] !== '') return order[key];
    if (doc) {
      if (doc[key] != null && doc[key] !== '') return doc[key];
      if (legacyKey && doc[legacyKey] != null && doc[legacyKey] !== '') return doc[legacyKey];
    }
    return (order && order[key] != null) ? order[key] : '';
  }

  window.SHIP.toInvoiceView = function (order, invoiceDoc) {
    order = order || {};
    var d = invoiceDoc || {};
    var c = window.SHIP.computeCharges(order.orderId ? order : d);

    return Object.assign({}, d, {
      /* document identity stays from the invoice doc */
      invoiceNumber: d.invoiceNumber || d.invoiceId,
      invoiceId:     d.invoiceId,
      invoiceDate:   d.invoiceDate,
      dueDate:       d.dueDate,
      lrNumber:      pick(order, d, 'lrNumber'),
      orderId:       d.orderId || order.orderId,

      /* shared — from order */
      customerName:    pick(order, d, 'customerName'),
      customerCompany: order.companyName || d.customerCompany || '',
      customerGst:     pick(order, d, 'customerGst'),
      customerPhone:   pick(order, d, 'customerPhone'),
      customerEmail:   pick(order, d, 'customerEmail'),
      fromLocation:    order.pickup   || d.fromLocation || '',
      toLocation:      order.delivery || d.toLocation   || '',
      material:        order.materialType || d.material || '',
      weight:          order.chargedWeight || d.weight || '',
      packages:        pick(order, d, 'packages'),
      vehicleType:     pick(order, d, 'vehicleType'),
      vehicleNumber:   pick(order, d, 'vehicleNumber'),
      remarks:         pick(order, d, 'remarks'),
      ewayBill:        pick(order, d, 'ewayBill'),

      /* charges mapped onto the invoice's expected keys */
      freightCharges:  c.lines.freight,
      haltingCharges:  c.lines.haltingCharges,
      /* fold the extra transport lines into the invoice's "extra" bucket
         so the invoice total always equals the LR grand total */
      extraCharges:    c.lines.extraCharges + c.lines.fov + c.lines.labour +
                       c.lines.localCollection + c.lines.doorDelivery + c.lines.docketCharges,
      discount:        c.discount,
      tax:             c.sgst + c.cgst,
      advanceReceived: c.advance,
      receivedAmount:  c.received,
      invoiceAmount:     c.grandTotal,
      outstandingAmount: c.outstanding,
      /* PAYMENT STATUS IS ORDER-ONLY (SSoT). When an order exists it is the
         sole authority; the document-level value is ignored. Only a true
         legacy invoice with no order falls back to its own stored value. */
      paymentStatus:   order.orderId ? (order.paymentStatus || 'pending') : (d.paymentStatus || 'pending'),
      paymentDate:     order.orderId ? (order.paymentDate || null) : (d.paymentDate || null)
    });
  };

  window.SHIP.toLrView = function (order, lrDoc) {
    order = order || {};
    var d = lrDoc || {};
    var src = order.orderId ? order : d;
    var c = window.SHIP.computeCharges(src);

    return Object.assign({}, d, {
      /* document identity from the LR doc */
      lrNumber:     d.lrNumber,
      docketNumber: d.docketNumber,
      lrDate:       d.lrDate,
      orderId:      d.orderId || order.orderId,
      invoiceId:    d.invoiceId || order.invoiceId,
      customerUid:  d.customerUid || order.customerUid,
      shipmentType: order.shipmentType || d.shipmentType || 'commercial',

      /* shared — from order */
      consignorName:    pick(order, d, 'consignorName'),
      consignorAddress: pick(order, d, 'consignorAddress'),
      consignorContact: pick(order, d, 'consignorContact'),
      consignorContactPerson: pick(order, d, 'consignorContactPerson'),
      consignorEmail:   pick(order, d, 'consignorEmail'),
      consignorGstin:   pick(order, d, 'consignorGstin'),
      consigneeName:    pick(order, d, 'consigneeName'),
      consigneeAddress: pick(order, d, 'consigneeAddress'),
      consigneeContact: pick(order, d, 'consigneeContact'),
      consigneeContactPerson: pick(order, d, 'consigneeContactPerson'),
      consigneeEmail:   pick(order, d, 'consigneeEmail'),
      consigneeGstin:   pick(order, d, 'consigneeGstin'),
      ewayBill:         pick(order, d, 'ewayBill'),
      fromLocation:     order.pickup   || d.fromLocation || '',
      toLocation:       order.delivery || d.toLocation   || '',
      materialDescription: order.materialType || d.materialDescription || '',
      packageCount:     pick(order, d, 'packageCount') || order.packages || d.packageCount || '',
      packingMethod:    pick(order, d, 'packingMethod'),
      actualWeight:     order.actualWeight  || d.actualWeight  || '',
      chargedWeight:    order.chargedWeight || d.chargedWeight || '',
      vehicleNumber:    pick(order, d, 'vehicleNumber'),
      driverName:       pick(order, d, 'driverName'),
      driverMobile:     pick(order, d, 'driverMobile'),
      transportMode:    pick(order, d, 'transportMode') || 'Road',
      dispatchMode:     pick(order, d, 'dispatchMode') || 'Door',
      specialInstructions: pick(order, d, 'specialInstructions'),
      insuranceDetails:    pick(order, d, 'insuranceDetails'),
      remarks:             pick(order, d, 'remarks'),
      gstPayableBy:        pick(order, d, 'gstPayableBy') || 'Consignee',

      /* charges */
      freight:         c.lines.freight,
      fov:             c.lines.fov,
      labour:          c.lines.labour,
      localCollection: c.lines.localCollection,
      doorDelivery:    c.lines.doorDelivery,
      docketCharges:   c.lines.docketCharges,
      sgstRate:        toNum(src.sgstRate),
      cgstRate:        toNum(src.cgstRate),
      grandTotalAmount: c.grandTotal,
      /* Payment status is order-only (SSoT); doc fallback only for legacy LRs. */
      paymentStatus:   order.orderId ? (order.paymentStatus || 'pending') : (d.paymentStatus || 'pending')
    });
  };

  /* ----------------------------------------------------------
     ACCOUNTING / EXCEL / REPORTS PROJECTION
     One flat, denormalized row per order — the canonical shape any
     future Accounting / Excel / Reports module reads. Derived purely
     from the order so it never drifts from the documents.
  ---------------------------------------------------------- */
  window.SHIP.toAccountingRow = function (order) {
    var o = order || {};
    var c = window.SHIP.computeCharges(o);
    return {
      orderId:       o.orderId || '',
      invoiceNumber: o.invoiceId || '',
      lrNumber:      o.lrNumber || '',
      date:          o.pickupDate || '',
      shipmentType:  o.shipmentType || '',
      customerName:  o.customerName || '',
      companyName:   o.companyName || '',
      customerGst:   o.customerGst || '',
      consignor:     o.consignorName || '',
      consignorGst:  o.consignorGstin || '',
      consignee:     o.consigneeName || '',
      consigneeGst:  o.consigneeGstin || '',
      from:          o.pickup || '',
      to:            o.delivery || '',
      material:      o.materialType || '',
      chargedWeight: o.chargedWeight || '',
      vehicleNumber: o.vehicleNumber || '',
      ewayBill:      o.ewayBill || '',
      freight:         c.lines.freight,
      fov:             c.lines.fov,
      labour:          c.lines.labour,
      localCollection: c.lines.localCollection,
      doorDelivery:    c.lines.doorDelivery,
      docketCharges:   c.lines.docketCharges,
      haltingCharges:  c.lines.haltingCharges,
      extraCharges:    c.lines.extraCharges,
      discount:        c.discount,
      sgst:            c.sgst,
      cgst:            c.cgst,
      grandTotal:      c.grandTotal,
      advanceReceived: c.advance,
      received:        c.received,
      outstanding:     c.outstanding,
      paymentStatus:   o.paymentStatus || 'pending'
    };
  };

  /* Canonical list of editable shared fields — used by the unified
     "Manage Shipment" screen so the editor and the schema never drift. */
  window.SHIP.EDITABLE_FIELDS = [
    'consignorName', 'consignorAddress', 'consignorContact', 'consignorContactPerson',
    'consignorEmail', 'consignorGstin',
    'consigneeName', 'consigneeAddress', 'consigneeContact', 'consigneeContactPerson',
    'consigneeEmail', 'consigneeGstin',
    'vehicleType', 'vehicleNumber', 'driverName', 'driverMobile',
    'transportMode', 'dispatchMode', 'ewayBill',
    'materialType', 'packages', 'packingMethod', 'actualWeight', 'chargedWeight',
    'freight', 'fov', 'labour', 'localCollection', 'doorDelivery', 'docketCharges',
    'haltingCharges', 'extraCharges', 'discount', 'sgstRate', 'cgstRate',
    'advanceReceived', 'receivedAmount', 'paymentStatus',
    'specialInstructions', 'insuranceDetails', 'remarks', 'gstPayableBy'
  ];

  /* ----------------------------------------------------------
     ORDER RESOLUTION + DOCUMENT OPENING
     These resolve the master order for a document, project the doc
     from it, and hand off to the existing INV/LR renderers. A tiny
     cache avoids refetching the same order repeatedly.
  ---------------------------------------------------------- */
  var _orderCache = {};

  window.SHIP.primeOrder = function (order) {
    if (order && order.orderId) _orderCache[order.orderId] = order;
  };

  /* Synchronous cache read for render paths (returns null if not primed). */
  window.SHIP.getOrderSync = function (orderId) {
    return (orderId && _orderCache[orderId]) ? _orderCache[orderId] : null;
  };

  window.SHIP.getOrder = function (orderId) {
    if (!orderId) return Promise.resolve(null);
    if (_orderCache[orderId]) return Promise.resolve(_orderCache[orderId]);
    return fbDB.collection('orders').doc(orderId).get().then(function (snap) {
      if (!snap.exists) return null;
      var o = snap.data(); o.orderId = o.orderId || orderId;
      _orderCache[orderId] = o;
      return o;
    }).catch(function () { return null; });
  };

  window.SHIP.openInvoice = function (invoiceDoc, autoPrint) {
    return window.SHIP.getOrder(invoiceDoc.orderId).then(function (order) {
      var view = window.SHIP.toInvoiceView(order, invoiceDoc);
      return window.INV.openInvoiceWindow(view, !!autoPrint);
    });
  };

  window.SHIP.openLr = function (lrDoc, autoPrint) {
    return window.SHIP.getOrder(lrDoc.orderId).then(function (order) {
      var view = window.SHIP.toLrView(order, lrDoc);
      return window.LR.openLrWindow(view, !!autoPrint);
    });
  };

  window.SHIP.openCombined = function (invoiceDoc, lrDoc, autoPrint) {
    var orderId = (invoiceDoc && invoiceDoc.orderId) || (lrDoc && lrDoc.orderId);
    return window.SHIP.getOrder(orderId).then(function (order) {
      var invView = window.SHIP.toInvoiceView(order, invoiceDoc);
      var lrView  = window.SHIP.toLrView(order, lrDoc);
      return window.LR.openCombinedWindow(invView, lrView, !!autoPrint);
    });
  };

})();
