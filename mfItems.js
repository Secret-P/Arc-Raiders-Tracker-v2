// mfItems.js
// Canonical item helpers (read-only).

import { db } from "./firebase.js";
import {
  collection,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export async function getItemById(itemId) {
  const ref = doc(db, "mfItems", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Type-ahead search with graceful fallback when indexes/fields are missing.
export async function searchItemsByNamePrefix(term, maxResults = 10) {
  if (!term) return [];
  const colRef = collection(db, "mfItems");
  const lower = term.toLowerCase();

  // Preferred: use nameLowercase field for range query
  try {
    const q = query(
      colRef,
      orderBy("nameLowercase"),
      startAt(lower),
      endAt(`${lower}\uf8ff`),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (err) {
    console.warn("searchItemsByNamePrefix: falling back to client filter", err);
  }

  // Fallback: fetch a slice and filter client-side
  const fallbackQuery = query(colRef, limit(50));
  const snap = await getDocs(fallbackQuery);
  const results = snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((item) =>
      (item.name || "").toLowerCase().includes(lower)
    )
    .slice(0, maxResults);
  return results;
}
