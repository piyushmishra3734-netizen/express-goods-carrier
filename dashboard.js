/* ============================================================
   DASHBOARD.JS — Customer Dashboard Foundation (Phase 2)
   Guards the page, wires tabs, and handles the two functional
   sections (Profile, Favorite Routes). New Shipment / Order
   History / Support are placeholders for future phases.
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
  // deep-link support: dashboard.html#routes, #profile etc.
  var initialTab = (location.hash || '').replace('#', '');
  if (['shipment', 'history', 'routes', 'profile', 'support'].indexOf(initialTab) !== -1) {
    openTab(initialTab);
  }

  /* ---------------------------------------------------------
     AUTH GUARD — wait for TOS to resolve auth state
  --------------------------------------------------------- */
  TOS.onReady(function (user, profile) {
    if (!user) {
      // not signed in — send back to homepage and open sign-in there
      window.location.href = 'egc-phase1-refined-2.html';
      return;
    }
    $('#guard').style.display = 'none';
    $('#dashMain').style.display = 'block';
    $('#dashName').textContent = (profile && profile.contactPerson) ? profile.contactPerson.split(' ')[0] : (user.displayName || 'there').split(' ')[0];

    fillProfileForm(user, profile);
    loadRoutes();
  });

  /* ---------------------------------------------------------
     PROFILE
  --------------------------------------------------------- */
  function fillProfileForm(user, profile) {
    $('#pEmail').value = user.email || '';
    if (profile) {
      $('#pCompany').value = profile.companyName || '';
      $('#pContact').value = profile.contactPerson || '';
      $('#pMobile').value = profile.mobile || '';
      $('#pGst').value = profile.gstNumber || '';
    }
  }

  window.DASH = window.DASH || {};
  window.DASH.saveProfile = function (e) {
    e.preventDefault();
    var msg = $('#profileMsg');
    var data = {
      companyName: $('#pCompany').value.trim(),
      contactPerson: $('#pContact').value.trim(),
      mobile: $('#pMobile').value.trim(),
      gstNumber: $('#pGst').value.trim() || null,
      onboardingComplete: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    fbDB.collection('customerProfiles').doc(TOS.getUser().uid).set(data, { merge: true })
      .then(function () {
        msg.className = 'fst ok'; msg.textContent = '✓ Profile updated.';
        $('#dashName').textContent = data.contactPerson.split(' ')[0];
      })
      .catch(function (err) {
        msg.className = 'fst er'; msg.textContent = err.message || 'Could not save. Try again.';
      });
    return false;
  };

  /* ---------------------------------------------------------
     FAVORITE ROUTES
     Stored at customerProfiles/{uid}/savedRoutes/{routeId}
  --------------------------------------------------------- */
  function routesRef() {
    return fbDB.collection('customerProfiles').doc(TOS.getUser().uid).collection('savedRoutes');
  }

  function routeRowHTML(id, pickup, delivery) {
    return (
      '<div class="route-row" data-id="' + id + '">' +
        '<div class="route-info">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>' +
          '<span>' + pickup + ' &rarr; ' + delivery + '</span>' +
        '</div>' +
        '<button class="route-del" type="button" onclick="DASH.deleteRoute(\'' + id + '\')">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
        '</button>' +
      '</div>'
    );
  }

  function loadRoutes() {
    var list = $('#routeList');
    routesRef().orderBy('createdAt', 'desc').get().then(function (snap) {
      if (snap.empty) {
        list.innerHTML = '<div class="empty" style="padding:24px 0;"><p>No saved routes yet — add the ones you book most.</p></div>';
        return;
      }
      var html = '';
      snap.forEach(function (doc) {
        var d = doc.data();
        html += routeRowHTML(doc.id, d.pickup, d.delivery);
      });
      list.innerHTML = html;
    });
  }

  window.DASH.addRoute = function () {
    var pickup = $('#rPickup').value.trim();
    var delivery = $('#rDelivery').value.trim();
    var msg = $('#routeMsg');
    if (!pickup || !delivery) {
      msg.className = 'fst er'; msg.textContent = 'Enter both pickup and delivery locations.';
      return;
    }
    routesRef().add({
      pickup: pickup,
      delivery: delivery,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      $('#rPickup').value = ''; $('#rDelivery').value = '';
      msg.className = 'fst ok'; msg.textContent = '✓ Route saved.';
      loadRoutes();
    }).catch(function (err) {
      msg.className = 'fst er'; msg.textContent = err.message || 'Could not save route.';
    });
  };

  window.DASH.deleteRoute = function (id) {
    routesRef().doc(id).delete().then(loadRoutes);
  };
})();
