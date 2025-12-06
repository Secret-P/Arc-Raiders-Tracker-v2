// mfQuests.js
// Quest helpers + enrichment with item data.

import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getItemById } from "./mfItems.js";

export async function getQuestById(questId) {
  const ref = doc(db, "mfQuests", questId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getQuestWithItems(questId) {
  const quest = await getQuestById(questId);
  if (!quest) return null;

  const required = quest.requiredItems || [];
  const enriched = await Promise.all(
    required.map(async (req) => {
      const item = await getItemById(req.itemId);
      return {
        itemId: req.itemId,
        quantity: req.quantity,
        item,
      };
    })
  );

  return {
    ...quest,
    requiredItems: enriched,
  };
}
