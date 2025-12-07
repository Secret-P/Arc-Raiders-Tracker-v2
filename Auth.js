// Auth.js
// Simple Google sign-in helpers.

import { auth, googleProvider } from "./firebase.js";
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}

export function watchAuthState(onUser, onSignedOut) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      onUser(user);
    } else {
      onSignedOut?.();
    }
  });
}
