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

// Returns only the active lists owned by the current user.
// Likely composite index: craftingLists ownerId ==, isArchived ==, orderBy createdAt desc.
export async function getUserLists(uid) {
  const colRef = collection(db, "craftingLists");
  const baseConstraints = [
    where("ownerId", "==", uid),
    where("isArchived", "==", false),
  ];

  let snap;
  try {
    const orderedQuery = query(
      colRef,
      ...baseConstraints,
      orderBy("createdAt", "desc")
    );
    snap = await getDocs(orderedQuery);
  } catch (err) {
    // Fall back if index/orderBy not available or createdAt missing types.
    console.warn(
      "getUserLists: orderBy(createdAt) failed, falling back to unordered query",
      err
    );
    const fallbackQuery = query(colRef, ...baseConstraints);
    snap = await getDocs(fallbackQuery);
  }

  const lists = snap.docs
    .map((docSnap) => normalizeListDoc(docSnap))
    .sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });

  console.log("DEBUG: Filtered lists from Firestore:", lists);
  return lists;
}

export async function getListItems(listId, uid) {
  const colRef = collection(db, "craftingLists", listId, "items");
  const baseConstraints = [where("ownerId", "==", uid)];

  let snap;
  try {
    // Likely composite index per subcollection: ownerId ==, orderBy createdAt asc.
    const orderedQuery = query(
      colRef,
      ...baseConstraints,
      orderBy("createdAt", "asc")
    );
    snap = await getDocs(orderedQuery);
  } catch (err) {
    // Fall back if createdAt is missing or index not ready.
    console.warn(
      "getListItems: orderBy(createdAt) failed, falling back to unordered query",
      err
    );
    const fallbackQuery = query(colRef, ...baseConstraints);
    snap = await getDocs(fallbackQuery);
  }

  const items = snap.docs
    .map((docSnap) => normalizeItemDoc(docSnap))
    .sort((a, b) => {
      const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
      return aTime - bTime;
    });

  console.log("DEBUG: Filtered items for list", listId, items);
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
