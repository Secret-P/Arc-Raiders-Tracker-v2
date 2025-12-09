// craftingLists.js
// User crafting lists and list items.

import { db } from "./firebase.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getItemById } from "./mfItems.js";

function normalizeCreatedAt(value) {
  if (value && typeof value.toMillis === "function") return value;
  return null;
}

function normalizeListDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    ...data,
    name: data.name || data.title || "Untitled List",
    isArchived: data.isArchived ?? false,
    createdAt: normalizeCreatedAt(data.createdAt),
    updatedAt: normalizeCreatedAt(data.updatedAt),
  };
}

function normalizeItemDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    ...data,
    neededQty: data.neededQty ?? data.quantityRequired ?? 0,
    haveQty: data.haveQty ?? data.quantityOwned ?? 0,
    canonicalItemId: data.canonicalItemId || data.itemId || null,
    createdAt: normalizeCreatedAt(data.createdAt),
    updatedAt: normalizeCreatedAt(data.updatedAt),
  };
}

// Subscribe to active lists owned by the current user.
// Returns an unsubscribe function.
export function watchUserLists(uid, onChange) {
  const colRef = collection(db, "craftingLists");
  const baseConstraints = [
    where("ownerId", "==", uid),
    where("isArchived", "==", false),
  ];

  let q;
  try {
    q = query(colRef, ...baseConstraints, orderBy("createdAt", "desc"));
  } catch (err) {
    console.warn(
      "watchUserLists: orderBy(createdAt) failed, using unordered query",
      err
    );
    q = query(colRef, ...baseConstraints);
  }

  return onSnapshot(q, (snap) => {
    const lists = snap.docs
      .map((docSnap) => normalizeListDoc(docSnap))
      .sort((a, b) => {
        const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
        return bTime - aTime;
      });
    onChange(lists);
  });
}

export async function createList(uid, name) {
  const colRef = collection(db, "craftingLists");
  const payload = {
    ownerId: uid,
    name: name?.trim() || "Untitled List",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isArchived: false,
  };
  const docRef = await addDoc(colRef, payload);
  return docRef.id;
}

export async function renameList(listId, uid, name) {
  const ref = doc(db, "craftingLists", listId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  if (data.ownerId !== uid) return false;
  await updateDoc(ref, {
    name: name?.trim() || "Untitled List",
    updatedAt: serverTimestamp(),
  });
  return true;
}

export async function deleteListAndItems(listId, uid) {
  const ref = doc(db, "craftingLists", listId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  if (data.ownerId !== uid) return false;

  // Delete items first
  const itemsCol = collection(db, "craftingLists", listId, "items");
  const itemsQuery = query(itemsCol, where("ownerId", "==", uid));
  const itemsSnap = await getDocs(itemsQuery);
  await Promise.all(itemsSnap.docs.map((d) => deleteDoc(d.ref)));

  await deleteDoc(ref);
  return true;
}

export function watchListItems(listId, uid, onChange) {
  const colRef = collection(db, "craftingLists", listId, "items");
  let q;
  try {
    q = query(colRef, where("ownerId", "==", uid), orderBy("createdAt", "asc"));
  } catch (err) {
    console.warn(
      "watchListItems: orderBy(createdAt) failed, using unordered query",
      err
    );
    q = query(colRef, where("ownerId", "==", uid));
  }

  return onSnapshot(q, (snap) => {
    const items = snap.docs
      .map((docSnap) => normalizeItemDoc(docSnap))
      .sort((a, b) => {
        const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
        return aTime - bTime;
      });
    onChange(items);
  });
}

const canonicalCache = new Map();

async function getCanonicalCached(itemId) {
  if (!itemId) return null;
  if (canonicalCache.has(itemId)) return canonicalCache.get(itemId);
  const item = await getItemById(itemId);
  canonicalCache.set(itemId, item);
  return item;
}

export function watchListItemsWithCanonical(listId, uid, onChange) {
  return watchListItems(listId, uid, async (items) => {
    const enriched = await Promise.all(
      items.map(async (listItem) => {
        const mfItem = await getCanonicalCached(listItem.canonicalItemId);
        return { ...listItem, mfItem };
      })
    );
    onChange(enriched);
  });
}

export async function addItemToList(listId, uid, canonicalItemId) {
  if (!canonicalItemId) return { success: false, reason: "missing-id" };
  const colRef = collection(db, "craftingLists", listId, "items");

  // prevent duplicates
  const existingQuery = query(
    colRef,
    where("ownerId", "==", uid),
    where("canonicalItemId", "==", canonicalItemId),
    limit(1)
  );
  const existingSnap = await getDocs(existingQuery);
  if (!existingSnap.empty) {
    return { success: false, reason: "duplicate" };
  }

  const payload = {
    ownerId: uid,
    canonicalItemId,
    neededQty: 1,
    haveQty: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await addDoc(colRef, payload);
  return { success: true };
}

export async function updateNeededQty(listId, itemId, uid, neededQty) {
  const ref = doc(db, "craftingLists", listId, "items", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  if (data.ownerId !== uid) return false;
  const sanitized = Math.max(0, Math.round(Number(neededQty) || 0));
  await updateDoc(ref, { neededQty: sanitized, updatedAt: serverTimestamp() });
  return true;
}

export async function updateHaveQty(listId, itemId, uid, haveQty) {
  const ref = doc(db, "craftingLists", listId, "items", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  if (data.ownerId !== uid) return false;
  const sanitized = Math.max(0, Math.round(Number(haveQty) || 0));
  await updateDoc(ref, { haveQty: sanitized, updatedAt: serverTimestamp() });
  return true;
}

export async function removeListItem(listId, itemId, uid) {
  const ref = doc(db, "craftingLists", listId, "items", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const data = snap.data();
  if (data.ownerId !== uid) return false;
  await deleteDoc(ref);
  return true;
}
