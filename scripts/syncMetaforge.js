#!/usr/bin/env node
/*
 * Synchronizes canonical Arc Raiders data from MetaForge into Firestore.
 *
 * The frontend only reads canonical items/quests from Firestore, so this
 * script pulls MetaForge data server-side and upserts it into the
 * mfItems and mfQuests collections. User-generated collections (e.g.,
 * craftingLists) are never touched here.
 */

const admin = require('firebase-admin');

const META_BASE_URL = process.env.META_BASE_URL || 'https://metaforge.app/arc-raiders/api';
const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Initialize firebase-admin using the default application credentials.
 * GOOGLE_APPLICATION_CREDENTIALS must be set by the caller to point to a
 * service account JSON file or a compatible credential source. We keep the
 * initialization here so the script can be run locally without additional
 * configuration beyond the env var.
 */
function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  return admin.firestore();
}

/**
 * Fetch JSON from the MetaForge API.
 * We rely on the Node 18+ global fetch implementation to avoid extra
 * dependencies.
 */
async function fetchFromMetaForge(endpoint) {
  const url = `${META_BASE_URL}${endpoint}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`MetaForge request failed (${response.status}): ${url}`);
  }

  return response.json();
}

function extractPagination(payload = {}) {
  const pagination =
    payload.pagination ||
    payload.meta?.pagination ||
    payload.meta?.page ||
    payload.pageInfo ||
    payload.page ||
    null;

  if (pagination && typeof pagination === 'object') {
    return pagination;
  }

  return null;
}

function getNextPage(currentPage, pagination) {
  if (!pagination) return null;

  if (pagination.next) return pagination.next;
  if (pagination.nextPage) return pagination.nextPage;
  if (pagination.hasNextPage === true) return currentPage + 1;

  const totalPages =
    pagination.totalPages ||
    pagination.pageCount ||
    pagination.total_pages ||
    pagination.pages ||
    null;
  const pageField = pagination.page || pagination.currentPage || pagination.current_page || currentPage;

  if (totalPages && pageField < totalPages) {
    return pageField + 1;
  }

  return null;
}

function buildEndpointWithPage(endpoint, page) {
  const hasQuery = endpoint.includes('?');
  const separator = hasQuery ? '&' : '?';
  return `${endpoint}${separator}page=${page}`;
}

async function fetchAllPages(endpoint, key, mapFn) {
  const allRecords = [];
  let page = 1;

  while (true) {
    const payload = await fetchFromMetaForge(buildEndpointWithPage(endpoint, page));
    const pageRecords = normalizeList(payload, key).map(mapFn);
    allRecords.push(...pageRecords);

    const pagination = extractPagination(payload);
    const nextPage = getNextPage(page, pagination);

    if (!nextPage || nextPage === page) break;

    page = nextPage;
  }

  return allRecords;
}

/**
 * Normalizes arrays that might come back as undefined/null/singletons.
 */
function toStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return [String(value)];
}

/**
 * Maps a MetaForge item payload into the canonical Firestore schema.
 * The MetaForge API shape may evolve, so we defensively map known field
 * names while retaining useful identifiers for future debugging.
 */
function mapItem(rawItem) {
  const itemId = rawItem.id || rawItem.itemId || rawItem.slug;
  if (!itemId) {
    throw new Error('Missing item identifier in MetaForge payload');
  }

  const sources = rawItem.sources || {};

  return {
    id: String(itemId),
    data: {
      name: rawItem.name || rawItem.title || 'Unknown Item',
      rarity: rawItem.rarity || rawItem.tier || 'Unknown',
      type: rawItem.type || rawItem.category || rawItem.itemType || 'Unknown',
      sources: {
        maps: toStringArray(sources.maps || rawItem.maps),
        biomes: toStringArray(sources.biomes || rawItem.biomes),
        enemies: toStringArray(sources.enemies || rawItem.enemies || rawItem.dropsFrom),
        traders: toStringArray(sources.traders || rawItem.traders || rawItem.vendors),
        quests: toStringArray(sources.quests || rawItem.quests || rawItem.requiredBy),
      },
      metaforgeId: rawItem.id ?? rawItem.itemId ?? null,
      categorySlug: rawItem.slug || null,
    },
  };
}

/**
 * Maps MetaForge quest/recipe payloads into the mfQuests schema.
 */
function mapQuest(rawQuest) {
  const questId = rawQuest.id || rawQuest.questId || rawQuest.slug;
  if (!questId) {
    throw new Error('Missing quest identifier in MetaForge payload');
  }

  const requiredItemsRaw =
    rawQuest.requiredItems || rawQuest.inputs || rawQuest.requires || rawQuest.ingredients || [];

  const requiredItems = requiredItemsRaw
    .map((item) => {
      const itemId = item.itemId || item.id || item.slug;
      if (!itemId) return null;
      return {
        itemId: String(itemId),
        quantity: Number(item.quantity || item.count || 1),
      };
    })
    .filter(Boolean);

  return {
    id: String(questId),
    data: {
      name: rawQuest.name || rawQuest.title || 'Unknown Quest',
      category: rawQuest.category || rawQuest.type || rawQuest.questline || 'Unknown',
      description: rawQuest.description || rawQuest.summary || '',
      requiredItems,
      metaforgeId: rawQuest.id ?? rawQuest.questId ?? null,
      rewards: rawQuest.rewards || rawQuest.outputs || [],
    },
  };
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidateKeys = [key, 'data', 'results', 'content', 'items', 'quests', 'recipes'];

  for (const candidate of candidateKeys) {
    if (Array.isArray(payload[candidate])) return payload[candidate];
  }

  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data;
    for (const candidate of candidateKeys) {
      if (Array.isArray(nested[candidate])) return nested[candidate];
    }
    if (Array.isArray(nested)) return nested;
  }

  console.warn(`Unexpected MetaForge response shape; available response keys: ${Object.keys(payload)}`);
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    console.warn(`Available data keys: ${Object.keys(payload.data)}`);
  }

  return [];
}

/**
 * Upsert a set of documents into the provided Firestore collection using batched
 * writes for efficiency and atomicity.
 */
async function upsertBatch(db, collectionName, documents) {
  let written = 0;
  for (let i = 0; i < documents.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = db.batch();
    const slice = documents.slice(i, i + FIRESTORE_BATCH_LIMIT);

    slice.forEach(({ id, data }) => {
      const ref = db.collection(collectionName).doc(id);
      batch.set(ref, data, { merge: true });
    });

    await batch.commit();
    written += slice.length;
  }
  return written;
}

async function syncMetaForge() {
  console.log('Starting MetaForge sync...');
  const db = initFirebase();

  console.log(`Fetching items from ${META_BASE_URL}...`);
  const items = await fetchAllPages('/items', 'items', mapItem);
  console.log(`Fetched ${items.length} items from MetaForge`);

  console.log('Fetching quests/recipes from MetaForge...');
  const quests = await fetchAllPages('/quests', 'quests', mapQuest);
  console.log(`Fetched ${quests.length} quests from MetaForge`);

  console.log('Upserting items into Firestore (mfItems)...');
  const itemsWritten = await upsertBatch(db, 'mfItems', items);
  console.log(`Upserted ${itemsWritten} items into mfItems`);

  console.log('Upserting quests into Firestore (mfQuests)...');
  const questsWritten = await upsertBatch(db, 'mfQuests', quests);
  console.log(`Upserted ${questsWritten} quests into mfQuests`);

  console.log('MetaForge sync completed successfully.');
}

syncMetaForge().catch((error) => {
  console.error('MetaForge sync failed:', error);
  process.exitCode = 1;
});

