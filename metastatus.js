// metaStatus.js
// Reads metaStatus/sync for data freshness banner.

import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

export async function getMetaStatus() {
  const ref = doc(db, "metaStatus", "sync");
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
