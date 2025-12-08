// craftingLists.js
// User crafting lists and list items.

import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp,
  onSnapshot,
  deleteDoc,
  writeBatch,
  updateDoc,
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
    createdAt: normalizeCreatedAt(data.createdAt),
  };
}

export async function createList(name, ownerId) {
  const colRef = collection(db, "craftingLists");
  return addDoc(colRef, {
    ownerId,
    name: name?.trim() || "Untitled List",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isArchived: false,
  });
}

export function listenToUserLists(uid, onUpdate) {
  const colRef = collection(db, "craftingLists");
  const constraints = [
    where("ownerId", "==", uid),
    where("isArchived", "==", false),
    orderBy("createdAt", "desc"),
  ];
  const fallback = [where("ownerId", "==", uid), where("isArchived", "==", false)];

  let unsubscribe = null;
  const attach = (c) =>
    onSnapshot(query(colRef, ...c),
      (snapshot) => {
        const lists = snapshot.docs.map((docSnap) => normalizeListDoc(docSnap));
        onUpdate(lists);
      },
      (err) => {
        console.warn("listenToUserLists error, retrying without orderBy", err);
        unsubscribe?.();
        unsubscribe = attach(fallback);
      }
    );

  unsubscribe = attach(constraints);
  return () => unsubscribe?.();
}

export async function renameList(listId, ownerId, name) {
  const ref = doc(db, "craftingLists", listId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data().ownerId !== ownerId) return;

  await updateDoc(ref, {
    name: name?.trim() || "Untitled List",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteListWithItems(listId, ownerId) {
  const ref = doc(db, "craftingLists", listId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data().ownerId !== ownerId) return;

  const itemsRef = collection(db, "craftingLists", listId, "items");
  const itemsSnap = await getDocs(query(itemsRef, where("ownerId", "==", ownerId)));

  const batch = writeBatch(db);
  itemsSnap.forEach((itemDoc) => {
    batch.delete(itemDoc.ref);
  });
  batch.delete(ref);
  await batch.commit();
}

export function listenToListItems(listId, ownerId, onUpdate) {
  const itemsRef = collection(db, "craftingLists", listId, "items");
  const constraints = [where("ownerId", "==", ownerId), orderBy("createdAt", "asc")];
  const fallback = [where("ownerId", "==", ownerId)];

  let unsubscribe = null;
  const attach = (c) =>
    onSnapshot(query(itemsRef, ...c),
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => normalizeItemDoc(docSnap));
        onUpdate(items);
      },
      (err) => {
        console.warn("listenToListItems error, retrying without orderBy", err);
        unsubscribe?.();
        unsubscribe = attach(fallback);
      }
    );

  unsubscribe = attach(constraints);
  return () => unsubscribe?.();
}

export async function addCanonicalItemToList(listId, ownerId, canonicalItemId) {
  const itemsRef = collection(db, "craftingLists", listId, "items");
  return addDoc(itemsRef, {
    ownerId,
    canonicalItemId,
    neededQty: 1,
    haveQty: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateListItemQuantities(listId, itemId, ownerId, updates) {
  const ref = doc(db, "craftingLists", listId, "items", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data().ownerId !== ownerId) return;

  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function removeListItem(listId, itemId, ownerId) {
  const ref = doc(db, "craftingLists", listId, "items", itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  if (snap.data().ownerId !== ownerId) return;
  await deleteDoc(ref);
}

export async function enrichItemsWithCanonical(items) {
  const cache = {};
  const results = [];

  for (const item of items) {
    const canonicalId = item.canonicalItemId;
    let mfItem = canonicalId ? cache[canonicalId] : null;
    if (!mfItem && canonicalId) {
      mfItem = await getItemById(canonicalId);
      cache[canonicalId] = mfItem;
    }
    results.push({ ...item, mfItem: mfItem || null });
  }

  return results;
}
