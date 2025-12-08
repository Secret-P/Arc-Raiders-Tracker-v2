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

const META_BASE_URL = process.env.META_BASE_URL || 'https://metaforge.app/api/arc-raiders';
const GAME_MAP_URL = 'https://metaforge.app/api/game-map-data';
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
function resolveMetaForgeUrl(endpoint) {
  if (!endpoint) throw new Error('MetaForge endpoint is required');

  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  if (endpoint.startsWith('/')) return `${META_BASE_URL}${endpoint}`;

  return `${META_BASE_URL}/${endpoint}`;
}

async function fetchFromMetaForge(endpoint) {
  const url = resolveMetaForgeUrl(endpoint);
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
  let loggedPagination = false;

  while (true) {
    const payload = await fetchFromMetaForge(buildEndpointWithPage(endpoint, page));
    const pagination = extractPagination(payload);
    if (pagination && !loggedPagination) {
      const totalItems =
        pagination.total ||
        pagination.totalItems ||
        pagination.totalCount ||
        pagination.count ||
        pagination.total_records ||
        null;
      const totalPages =
        pagination.totalPages ||
        pagination.pageCount ||
        pagination.total_pages ||
        pagination.pages ||
        null;
      console.log(
        `Pagination info for ${endpoint}: total=${totalItems ?? 'unknown'}, pages=${
          totalPages ?? 'unknown'
        }`
      );
      loggedPagination = true;
    }

    const pageRecords = normalizeList(payload, key).map(mapFn);
    allRecords.push(...pageRecords);
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

function mapArc(rawArc) {
  const arcId = rawArc.id || rawArc.arcId || rawArc.slug || rawArc.name;
  if (!arcId) {
    throw new Error('Missing arc identifier in MetaForge payload');
  }

  const dropsRaw = rawArc.drops || rawArc.loot || rawArc.rewards || rawArc.dropsFrom || [];

  const drops = dropsRaw
    .map((drop) => {
      const itemId = drop?.itemId || drop?.id || drop?.slug || drop?.item?.id || drop?.item?.slug;
      if (!itemId) return null;
      const noteParts = [drop?.notes, drop?.type, drop?.rarity, drop?.chance && `Chance: ${drop.chance}`].filter(
        Boolean
      );
      return {
        itemId: String(itemId),
        notes: noteParts.length ? noteParts.join(' | ') : null,
      };
    })
    .filter(Boolean);

  return {
    id: String(arcId),
    data: {
      name: rawArc.name || rawArc.title || 'Unknown Arc',
      type: rawArc.type || rawArc.arcType || rawArc.category || null,
      description: rawArc.description || rawArc.summary || null,
      maps: toStringArray(rawArc.maps || rawArc.locations || rawArc.mapSlugs || rawArc.mapNames),
      biomes: toStringArray(rawArc.biomes || rawArc.biome),
      drops,
      metaforgeId: rawArc.id ?? rawArc.arcId ?? null,
    },
  };
}

function mapTrader(rawTrader) {
  const traderId = rawTrader.id || rawTrader.traderId || rawTrader.slug || rawTrader.name;
  if (!traderId) {
    throw new Error('Missing trader identifier in MetaForge payload');
  }

  const inventoryRaw = rawTrader.inventory || rawTrader.items || rawTrader.wares || [];

  const inventory = inventoryRaw
    .map((entry) => {
      const itemId = entry?.itemId || entry?.id || entry?.slug || entry?.item?.id || entry?.item?.slug;
      if (!itemId) return null;
      return {
        itemId: String(itemId),
        price: entry.price != null ? Number(entry.price) : null,
        currency: entry.currency || entry.priceCurrency || entry.costCurrency || null,
        notes: entry.notes || entry.type || entry.rarity || null,
      };
    })
    .filter(Boolean);

  const location = rawTrader.location || rawTrader.map || rawTrader.locationMap || rawTrader.region;
  const locationMap =
    (typeof location === 'string' && location) ||
    location?.name ||
    location?.map ||
    location?.slug ||
    null;

  return {
    id: String(traderId),
    data: {
      name: rawTrader.name || rawTrader.title || 'Unknown Trader',
      description: rawTrader.description || rawTrader.bio || null,
      locationMap,
      inventory,
      metaforgeId: rawTrader.id ?? rawTrader.traderId ?? null,
    },
  };
}

function mapMap(rawMap) {
  const mapId = rawMap.id || rawMap.slug || rawMap.mapId || rawMap.name;
  if (!mapId) {
    throw new Error('Missing map identifier in MetaForge payload');
  }

  const arcs = toStringArray(rawMap.arcs || rawMap.activities || rawMap.events || rawMap.arcIds);
  const biomes = toStringArray(rawMap.biomes || rawMap.biome || rawMap.regions);

  const extra = {};
  if (rawMap.pointsOfInterest) extra.pointsOfInterest = rawMap.pointsOfInterest;
  if (rawMap.zones) extra.zones = rawMap.zones;
  if (rawMap.coordinates) extra.coordinates = rawMap.coordinates;

  return {
    id: String(mapId),
    data: {
      name: rawMap.name || rawMap.title || 'Unknown Map',
      slug: rawMap.slug || String(mapId),
      description: rawMap.description || rawMap.summary || null,
      biomes,
      arcs,
      ...extra,
      metaforgeId: rawMap.id ?? rawMap.mapId ?? null,
    },
  };
}

function normalizeList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidateKeys = [
    key,
    'data',
    'results',
    'content',
    'items',
    'quests',
    'recipes',
    'arcs',
    'traders',
    'maps',
  ];

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

  console.log('Fetching arcs from MetaForge...');
  const arcs = await fetchAllPages('/arcs', 'arcs', mapArc);
  console.log(`Fetched ${arcs.length} arcs from MetaForge`);

  console.log('Upserting items into Firestore (mfItems)...');
  const itemsWritten = await upsertBatch(db, 'mfItems', items);
  console.log(`Upserted ${itemsWritten} items into mfItems`);

  console.log('Upserting quests into Firestore (mfQuests)...');
  const questsWritten = await upsertBatch(db, 'mfQuests', quests);
  console.log(`Upserted ${questsWritten} quests into mfQuests`);

  console.log('Upserting arcs into Firestore (mfArcs)...');
  const arcsWritten = await upsertBatch(db, 'mfArcs', arcs);
  console.log(`Upserted ${arcsWritten} arcs into mfArcs`);

  try {
    console.log('Fetching traders from MetaForge...');
    const traders = await fetchAllPages('/traders', 'traders', mapTrader);
    console.log(`Fetched ${traders.length} traders from MetaForge`);

    console.log(`Fetching maps from ${GAME_MAP_URL}...`);
    const maps = await fetchAllPages(GAME_MAP_URL, 'maps', mapMap);
    console.log(`Fetched ${maps.length} maps from MetaForge`);

    console.log('Upserting traders into Firestore (mfTraders)...');
    const tradersWritten = await upsertBatch(db, 'mfTraders', traders);
    console.log(`Upserted ${tradersWritten} traders into mfTraders`);

    console.log('Upserting maps into Firestore (mfMaps)...');
    const mapsWritten = await upsertBatch(db, 'mfMaps', maps);
    console.log(`Upserted ${mapsWritten} maps into mfMaps`);
  } catch (traderOrMapError) {
    console.error('Trader/map sync encountered an error but canonical data was synced:', traderOrMapError);
  }

  console.log('MetaForge sync completed successfully.');
}

syncMetaForge().catch((error) => {
  console.error('MetaForge sync failed:', error);
  process.exitCode = 1;
});

