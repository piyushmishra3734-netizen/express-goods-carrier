/* ============================================================
   AUTH.JS — Express Goods Carrier / TOS Phase 2
   Authentication + Customer Portal Foundation

   Responsibilities:
   - Render Sign In / My Account in the navbar (desktop + mobile)
   - Auth modal: Google, Email sign up/in, Forgot password
   - Onboarding modal (first login only) — prefilled from Google
   - Gate "place an order" actions behind login (requireAuth)
   - Firestore: users/{uid}, customerProfiles/{uid}, saved routes

   Exposes window.TOS = { requireAuth, openSignIn, logout, getProfile }
   so future phases (quotation/tracking/invoicing/loyalty/AI) can
   hook in without touching this file.
   ============================================================ */

(function () {
  'use strict';

  var currentUser = null;     // firebase auth user object
  var currentProfile = null;  // customerProfiles/{uid} doc data
  var pendingAction = null;   // fn to run after login completes
  var authReady = false;
  var onReadyQueue = [];

  /* ---------------------------------------------------------
     SVG ICONS (inline, no external deps)
  --------------------------------------------------------- */
  var ICO = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3 3 0 003-3v-2a3 3 0 00-3-3H9a3 3 0 01-3-3V6.5"/></svg>',
    support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4.5 8-12V5l-8-3-8 3v5c0 7.5 8 12 8 12z"/><path d="M9 12l2 2 4-4"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    google: '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.9 0-12.5-5.6-12.5-12.5S17.1 11 24 11c3.2 0 6.1 1.2 8.3 3.2l5.7-5.7C34.8 5.1 29.7 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3.2 0 6.1 1.2 8.3 3.2l5.7-5.7C34.8 7.1 29.7 5 24 5c-7.7 0-14.4 4.3-17.7 9.7z"/><path fill="#4CAF50" d="M24 43c5.6 0 10.6-1.9 14.5-5.1l-6.7-5.5C29.7 33.7 27 35 24 35c-5.2 0-9.6-3.3-11.3-8H6v5.1C9.2 38.9 16 43 24 43z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.7 5.5C41.8 35.9 45 30.4 45 24c0-1.2-.1-2.4-.4-3.5z"/></svg>'
  };

  /* ---------------------------------------------------------
     SMALL HELPERS
  --------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function firstName(n) { return (n || '').trim().split(' ')[0] || 'Account'; }
  function initials(n) {
    var p = (n || '').trim().split(' ').filter(Boolean);
    if (!p.length) return 'U';
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }

  /* ---------------------------------------------------------
     NAV RENDERING (desktop #authNav + mobile #authNavMobile)
  --------------------------------------------------------- */
  function navSignedOutHTML(mobile) {
    return (
      '<button class="signin-btn" type="button" onclick="TOS.openSignIn()" style="' + (mobile ? 'width:100%;justify-content:center;' : '') + '">' +
        ICO.user + '<span data-i18n="auth.signin">Sign In</span>' +
      '</button>'
    );
  }

  function navSignedInHTML(mobile) {
    var name = currentProfile && currentProfile.contactPerson ? currentProfile.contactPerson : firstName(currentUser.displayName);
    var photo = currentUser.photoURL;
    var avatar = photo ? '<img src="' + photo + '" alt="">' : initials(name);
    var menuId = mobile ? 'acctMenuM' : 'acctMenu';
    return (
      '<div class="acct-wrap">' +
        '<button class="acct-btn" type="button" onclick="TOS._toggleAcctMenu(\'' + menuId + '\')" style="' + (mobile ? 'width:100%;' : '') + '">' +
          '<span class="acct-avatar">' + avatar + '</span>' +
          '<span class="acct-name">' + name + '</span>' +
        '</button>' +
        '<div class="acct-menu" id="' + menuId + '">' +
          '<a href="dashboard.html">' + ICO.dash + ' <span data-i18n="auth.dashboard">Dashboard</span></a>' +
          '<a href="dashboard.html#profile">' + ICO.user + ' <span data-i18n="auth.profile">Profile</span></a>' +
          '<a href="dashboard.html#routes">' + ICO.route + ' <span data-i18n="auth.routes">Favorite Routes</span></a>' +
          '<hr>' +
          '<a href="#" class="lo" onclick="TOS.logout();return false;">' + ICO.logout + ' <span data-i18n="auth.logout">Logout</span></a>' +
        '</div>' +
      '</div>'
    );
  }

  function renderNav() {
    var desktop = $('#authNav');
    var mobile = $('#authNavMobile');
    var html = currentUser ? navSignedInHTML(false) : navSignedOutHTML(false);
    var htmlM = currentUser ? navSignedInHTML(true) : navSignedOutHTML(true);
    if (desktop) desktop.innerHTML = html;
    if (mobile) mobile.innerHTML = htmlM;
    // re-apply current language to freshly injected nodes
    if (window.T && window.curLang && typeof applyLang === 'function') {
      try { applyLang(window.curLang); } catch (e) {}
    }
  }

  window.TOS = window.TOS || {};
  window.TOS._toggleAcctMenu = function (id) {
    var menu = document.getElementById(id);
    if (!menu) return;
    var willOpen = !menu.classList.contains('open');
    $all('.acct-menu').forEach(function (m) { m.classList.remove('open'); });
    if (willOpen) menu.classList.add('open');
  };
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.acct-wrap')) $all('.acct-menu').forEach(function (m) { m.classList.remove('open'); });
  });

  /* ---------------------------------------------------------
     MODAL SHELL — built once, reused for signin/signup/forgot/onboarding
  --------------------------------------------------------- */
  function buildModals() {
    if ($('#auOverlay')) return;

    var auth = el(
      '<div class="au-overlay" id="auOverlay">' +
        '<div class="au-modal" id="auModal">' +
          '<button class="au-close" onclick="TOS._closeAuth()">' + ICO.close + '</button>' +
          '<div id="auBody"></div>' +
        '</div>' +
      '</div>'
    );
    var onboard = el(
      '<div class="au-overlay" id="obOverlay">' +
        '<div class="au-modal" id="obModal">' +
          '<div id="obBody"></div>' +
        '</div>' +
      '</div>'
    );
    document.body.appendChild(auth);
    document.body.appendChild(onboard);

    $('#auOverlay').addEventListener('click', function (e) { if (e.target.id === 'auOverlay') TOS._closeAuth(); });
  }

  window.TOS._closeAuth = function () {
    var o = $('#auOverlay'); if (o) o.classList.remove('open');
  };

  /* ---------------------------------------------------------
     AUTH MODAL VIEWS: signin / signup / forgot
  --------------------------------------------------------- */
  function authHeader() {
    return (
      '<div class="au-eyebrow">Express Goods Carrier</div>' +
      '<h2 class="au-h2">Create your account</h2>' +
      '<p class="au-sub">Save shipment history, track future orders, and skip re-typing your details every time.</p>' +
      '<ul class="au-perks">' +
        '<li>' + ICO.check + ' Save shipment history</li>' +
        '<li>' + ICO.check + ' Track future shipments</li>' +
        '<li>' + ICO.check + ' Access invoices</li>' +
        '<li>' + ICO.check + ' Faster future bookings &mdash; no retyping</li>' +
      '</ul>'
    );
  }

  function renderSignIn() {
    $('#auBody').innerHTML = (
      authHeader() +
      '<button class="au-google" type="button" onclick="TOS._googleSignIn()">' + ICO.google + ' Continue with Google</button>' +
      '<div class="au-divider">or</div>' +
      '<form class="au-form" id="auForm" onsubmit="return TOS._emailSignIn(event)">' +
        '<div><label>Email</label><input type="email" id="auEmail" placeholder="you@company.com" required></div>' +
        '<div><label>Password</label><input type="password" id="auPass" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" required></div>' +
        '<button class="au-submit" type="submit">Continue with Email</button>' +
      '</form>' +
      '<div class="au-msg" id="auMsg"></div>' +
      '<div class="au-switch">New here? <a onclick="TOS._view(\'signup\')">Create an account</a></div>' +
      '<div class="au-switch" style="margin-top:6px;"><a class="au-link" onclick="TOS._view(\'forgot\')">Forgot password?</a></div>' +
      '<div class="au-foot">By continuing you agree this site may store your shipment &amp; contact details to serve you faster.</div>'
    );
  }

  function renderSignUp() {
    $('#auBody').innerHTML = (
      authHeader() +
      '<button class="au-google" type="button" onclick="TOS._googleSignIn()">' + ICO.google + ' Continue with Google</button>' +
      '<div class="au-divider">or</div>' +
      '<form class="au-form" id="auForm" onsubmit="return TOS._emailSignUp(event)">' +
        '<div><label>Email</label><input type="email" id="auEmail" placeholder="you@company.com" required></div>' +
        '<div><label>Password</label><input type="password" id="auPass" placeholder="At least 6 characters" minlength="6" required></div>' +
        '<button class="au-submit" type="submit">Create Account</button>' +
      '</form>' +
      '<div class="au-msg" id="auMsg"></div>' +
      '<div class="au-switch">Already have an account? <a onclick="TOS._view(\'signin\')">Sign in</a></div>'
    );
  }

  function renderForgot() {
    $('#auBody').innerHTML = (
      '<div class="au-eyebrow">Reset Password</div>' +
      '<h2 class="au-h2">Forgot your password?</h2>' +
      '<p class="au-sub">Enter your email and we&rsquo;ll send a reset link.</p>' +
      '<form class="au-form" id="auForm" onsubmit="return TOS._sendReset(event)">' +
        '<div><label>Email</label><input type="email" id="auEmail" placeholder="you@company.com" required></div>' +
        '<button class="au-submit" type="submit">Send Reset Link</button>' +
      '</form>' +
      '<div class="au-msg" id="auMsg"></div>' +
      '<div class="au-switch"><a onclick="TOS._view(\'signin\')">&larr; Back to sign in</a></div>'
    );
  }

  window.TOS._view = function (name) {
    if (name === 'signin') renderSignIn();
    else if (name === 'signup') renderSignUp();
    else if (name === 'forgot') renderForgot();
  };

  function openAuth(view) {
    buildModals();
    TOS._view(view || 'signin');
    $('#auOverlay').classList.add('open');
  }
  window.TOS.openSignIn = function () { openAuth('signin'); };

  function showMsg(ok, text) {
    var m = $('#auMsg');
    if (!m) return;
    m.className = 'au-msg ' + (ok ? 'ok' : 'er');
    m.textContent = text;
  }

  /* ---------------------------------------------------------
     GOOGLE SIGN-IN
  --------------------------------------------------------- */
  window.TOS._googleSignIn = function () {
    var provider = new firebase.auth.GoogleAuthProvider();
    fbAuth.signInWithPopup(provider).then(function () {
      TOS._closeAuth();
    }).catch(function (err) {
      showMsg(false, humanizeAuthError(err));
    });
  };

  /* ---------------------------------------------------------
     EMAIL SIGN-IN / SIGN-UP / RESET
  --------------------------------------------------------- */
  window.TOS._emailSignIn = function (e) {
    e.preventDefault();
    var email = $('#auEmail').value.trim();
    var pass = $('#auPass').value;
    fbAuth.signInWithEmailAndPassword(email, pass).then(function () {
      TOS._closeAuth();
    }).catch(function (err) { showMsg(false, humanizeAuthError(err)); });
    return false;
  };

  window.TOS._emailSignUp = function (e) {
    e.preventDefault();
    var email = $('#auEmail').value.trim();
    var pass = $('#auPass').value;
    fbAuth.createUserWithEmailAndPassword(email, pass).then(function () {
      TOS._closeAuth();
    }).catch(function (err) { showMsg(false, humanizeAuthError(err)); });
    return false;
  };

  window.TOS._sendReset = function (e) {
    e.preventDefault();
    var email = $('#auEmail').value.trim();
    fbAuth.sendPasswordResetEmail(email).then(function () {
      showMsg(true, 'Reset link sent. Check your inbox.');
    }).catch(function (err) { showMsg(false, humanizeAuthError(err)); });
    return false;
  };

  window.TOS.logout = function () {
    fbAuth.signOut();
    $all('.acct-menu').forEach(function (m) { m.classList.remove('open'); });
  };

  function humanizeAuthError(err) {
    var map = {
      'auth/wrong-password': 'Incorrect password. Try again.',
      'auth/user-not-found': 'No account found with this email.',
      'auth/email-already-in-use': 'An account already exists with this email. Try signing in.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/weak-password': 'Password should be at least 6 characters.',
      'auth/popup-closed-by-user': 'Sign-in was cancelled.',
      'auth/network-request-failed': 'Network error. Check your connection and try again.'
    };
    return map[err.code] || (err.message || 'Something went wrong. Please try again.');
  }

  /* ---------------------------------------------------------
     ONBOARDING (first login only)
     Pre-fills Name + Email from Google, asks only:
     Company Name, Contact Person, Mobile Number, GST (optional)
  --------------------------------------------------------- */
  function renderOnboarding(user) {
    var hasPhoto = !!user.photoURL;
    $('#obBody').innerHTML = (
      '<div class="au-eyebrow">Almost there</div>' +
      '<h2 class="au-h2">Set up your account</h2>' +
      '<p class="au-sub">Just a few details &mdash; we&rsquo;ll reuse this for every future booking so you never type it again.</p>' +
      (user.displayName || user.email ?
        '<div class="ob-prefill">' +
          (hasPhoto ? '<img src="' + user.photoURL + '" alt="">' : '') +
          '<div><strong>' + (user.displayName || 'Welcome') + '</strong><span>' + (user.email || '') + '</span></div>' +
        '</div>' : '') +
      '<form class="au-form" id="obForm" onsubmit="return TOS._saveOnboarding(event)">' +
        '<div><label>Company Name *</label><input type="text" id="obCompany" placeholder="Your company name" required></div>' +
        '<div class="ob-row">' +
          '<div><label>Contact Person *</label><input type="text" id="obContact" placeholder="Full name" value="' + (user.displayName || '') + '" required></div>' +
          '<div><label>Mobile Number *</label><input type="tel" id="obMobile" placeholder="+91 XXXXX XXXXX" value="' + (user.phoneNumber || '') + '" required></div>' +
        '</div>' +
        '<div><label>GST Number (Optional)</label><input type="text" id="obGst" placeholder="22AAAAA0000A1Z5"></div>' +
        '<button class="au-submit" type="submit">Save &amp; Continue</button>' +
      '</form>' +
      '<div class="au-msg" id="obMsg"></div>'
    );
  }

  window.TOS._saveOnboarding = function (e) {
    e.preventDefault();
    var btn = $('#obForm button[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving...';
    var data = {
      companyName: $('#obCompany').value.trim(),
      contactPerson: $('#obContact').value.trim(),
      mobile: $('#obMobile').value.trim(),
      gstNumber: $('#obGst').value.trim() || null,
      email: currentUser.email || null,
      uid: currentUser.uid,
      onboardingComplete: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    fbDB.collection('customerProfiles').doc(currentUser.uid).set(data, { merge: true })
      .then(function () {
        currentProfile = data;
        var o = $('#obOverlay'); if (o) o.classList.remove('open');
        renderNav();
        runPendingAction();
      })
      .catch(function (err) {
        var m = $('#obMsg'); m.className = 'au-msg er'; m.textContent = err.message || 'Could not save. Try again.';
        btn.disabled = false; btn.textContent = 'Save & Continue';
      });
    return false;
  };

  function openOnboarding(user) {
    buildModals();
    renderOnboarding(user);
    $('#obOverlay').classList.add('open');
  }

  /* ---------------------------------------------------------
     AUTH-GATED ACTIONS (used by Get A Quote, future booking CTAs)
  --------------------------------------------------------- */
  window.TOS.requireAuth = function (actionFn) {
    if (currentUser && currentProfile && currentProfile.onboardingComplete) {
      actionFn();
      return true;
    }
    pendingAction = actionFn;
    if (currentUser && (!currentProfile || !currentProfile.onboardingComplete)) {
      openOnboarding(currentUser);
    } else {
      openAuth('signup');
    }
    return false;
  };

  function runPendingAction() {
    if (pendingAction) {
      var fn = pendingAction;
      pendingAction = null;
      fn();
    }
  }

  window.TOS.getProfile = function () { return currentProfile; };
  window.TOS.getUser = function () { return currentUser; };
  window.TOS.onReady = function (fn) {
    if (authReady) fn(currentUser, currentProfile);
    else onReadyQueue.push(fn);
  };

  /* ---------------------------------------------------------
     PRE-FILL the existing quote form (reduces typing further)
     Only runs if #qn/#qp exist on this page (homepage).
  --------------------------------------------------------- */
  function prefillQuoteForm() {
    if (!currentProfile) return;
    var qn = $('#qn'), qp = $('#qp');
    if (qn && !qn.value) qn.value = currentProfile.contactPerson || '';
    if (qp && !qp.value) qp.value = currentProfile.mobile || '';
  }

  /* ---------------------------------------------------------
     AUTH STATE LISTENER — single source of truth
  --------------------------------------------------------- */
  fbAuth.onAuthStateChanged(function (user) {
    currentUser = user;
    if (!user) {
      currentProfile = null;
      renderNav();
      authReady = true;
      onReadyQueue.splice(0).forEach(function (fn) { fn(null, null); });
      return;
    }

    // ensure a lightweight users/{uid} record exists (separate from customerProfiles)
    fbDB.collection('users').doc(user.uid).set({
      uid: user.uid,
      name: user.displayName || null,
      email: user.email || null,
      phone: user.phoneNumber || null,
      authProvider: (user.providerData[0] && user.providerData[0].providerId) || 'password',
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    fbDB.collection('customerProfiles').doc(user.uid).get().then(function (doc) {
      if (doc.exists) {
        currentProfile = doc.data();
        renderNav();
        prefillQuoteForm();
        runPendingAction();
      } else {
        currentProfile = null;
        renderNav();
        openOnboarding(user);
      }
      authReady = true;
      onReadyQueue.splice(0).forEach(function (fn) { fn(currentUser, currentProfile); });
    });
  });

  /* ---------------------------------------------------------
     INIT — runs on every page that includes this script
  --------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    buildModals();
    renderNav();
  });
})();
