// firebase.js
// Firebase initialization + exports.
// IMPORTANT: fill in firebaseConfig with your project values.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getFirestore,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// TODO: replace with your real config from Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyA3pGeyrYg27cqYel7_hBDCV99t1_-X750",
  authDomain: "arc-raiders-tracker-v2.firebaseapp.com",
  projectId: "arc-raiders-tracker-v2",
  storageBucket: "arc-raiders-tracker-v2.firebasestorage.app",
  messagingSenderId: "348511299788",
  appId: "1:348511299788:web:383e854b9e2052b3e77a69",
  measurementId: "G-4WFVZ3BKST"
};
const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
