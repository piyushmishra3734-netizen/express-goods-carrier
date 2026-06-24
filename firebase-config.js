/* ============================================================
   FIREBASE CONFIG — Express Goods Carrier / TOS Phase 2
   This is the ONLY file that should contain your Firebase keys.
   Safe to expose client-side (standard for Firebase web apps) —
   access is controlled by Firestore/Auth security rules, not by
   hiding this object.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCDipnewdxDqyi0ikKiCUxbC6RXECN0jYM",
  authDomain: "good-dac5b.firebaseapp.com",
  projectId: "good-dac5b",
  storageBucket: "good-dac5b.firebasestorage.app",
  messagingSenderId: "400026161831",
  appId: "1:400026161831:web:8b03d4e226144c1d568182",
  measurementId: "G-54JVC18E9N"
};

firebase.initializeApp(firebaseConfig);

/* Shared handles used by auth.js / dashboard.js */
const fbAuth = firebase.auth();
const fbDB   = firebase.firestore();
