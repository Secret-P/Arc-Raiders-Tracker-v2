// mfItems.js
// Canonical item helpers (read-only).

import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export async function getItemById(itemId) {
  const ref = doc(db, "mfItems", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Simple prefix search by name
export async function searchItemsByNamePrefix(prefix, limit = 10) {
  if (!prefix) return [];

  const colRef = collection(db, "mfItems");
  const q = query(
    colRef,
    where("name", ">=", prefix),
    where("name", "<=", prefix + "\uf8ff")
  );

  const snap = await getDocs(q);
  const results = [];
  snap.forEach((docSnap) => {
    results.push({ id: docSnap.id, ...docSnap.data() });
  });

  return results.slice(0, limit);
}
