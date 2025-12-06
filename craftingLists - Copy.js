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
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getItemById } from "./mfItems.js";

// SUPER SIMPLE: return ALL craftingLists docs, ignore ownerId, isArchived, etc.
export async function getUserLists(uid) {
  const colRef = collection(db, "craftingLists");

  // No filters, no orderBy – just get everything we are allowed to see.
  const snap = await getDocs(colRef);
  const lists = [];
  snap.forEach((docSnap) => {
    lists.push({ id: docSnap.id, ...docSnap.data() });
  });

  console.log("DEBUG: All lists from Firestore:", lists);
  return lists;
}

export async function getListById(listId) {
  const ref = doc(db, "craftingLists", listId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getListItems(listId, uid) {
  const colRef = collection(db, "craftingLists", listId, "items");

  // This query is fine: ownerId + createdAt
  const q = query(
    colRef,
    where("ownerId", "==", uid),
    orderBy("createdAt", "asc")
  );

  const snap = await getDocs(q);
  const items = [];
  snap.forEach((docSnap) => {
    items.push({ id: docSnap.id, ...docSnap.data() });
  });
  return items;
}

export async function getListItemsWithCanonical(listId, uid) {
  const baseItems = await getListItems(listId, uid);

  const enriched = await Promise.all(
    baseItems.map(async (listItem) => {
      let mfItem = null;
      if (listItem.itemId) {
        mfItem = await getItemById(listItem.itemId);
      }
      return {
        ...listItem,
        mfItem,
      };
    })
  );

  return enriched;
}
