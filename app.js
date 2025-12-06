// app.js
// Main app wiring: auth, lists, simple rendering.

import { signInWithGoogle, signOutUser, watchAuthState } from "./auth.js";
import { getMetaStatus } from "./metaStatus.js";
import {
  getUserLists,
  getListItemsWithCanonical,
} from "./craftingLists.js";

/* DOM references */
const signInButton = document.getElementById("sign-in-button");
const signOutButton = document.getElementById("sign-out-button");
const userInfo = document.getElementById("user-info");
const userNameEl = document.getElementById("user-name");

const syncStatusValue = document.getElementById("sync-status-value");

const listsContainer = document.getElementById("lists-container");
const activeListTitle = document.getElementById("active-list-title");
const activeListMeta = document.getElementById("active-list-meta");
const activeListTbody = document.getElementById("active-list-tbody");

const statusSummary = document.getElementById("status-summary");

const intelEmptyState = document.getElementById("intel-empty-state");
const itemDetailSection = document.getElementById("item-detail-section");
const itemDetailName = document.getElementById("item-detail-name");
const itemDetailRarity = document.getElementById("item-detail-rarity");
const itemDetailType = document.getElementById("item-detail-type");
const itemMapsList = document.getElementById("item-maps-list");
const itemBiomesList = document.getElementById("item-biomes-list");
const itemEnemiesList = document.getElementById("item-enemies-list");
const itemVendorsList = document.getElementById("item-vendors-list");
const itemRelatedList = document.getElementById("item-related-list");

const powerMapsList = document.getElementById("power-maps-list");
const powerBiomesList = document.getElementById("power-biomes-list");
const powerVendorsList = document.getElementById("power-vendors-list");
const powerEnemiesList = document.getElementById("power-enemies-list");
const powerConfidenceText = document.getElementById("power-confidence-text");

let currentUser = null;
let currentLists = [];
let currentListId = null;
let currentListItems = [];

/* Auth UI handlers */
signInButton?.addEventListener("click", async () => {
  try {
    await signInWithGoogle();
  } catch (err) {
    console.error("Sign-in error:", err);
    alert("Error signing in. Check console for details.");
  }
});

signOutButton?.addEventListener("click", async () => {
  try {
    await signOutUser();
  } catch (err) {
    console.error("Sign-out error:", err);
  }
});

/* Rendering helpers */

function setSyncStatus(metaStatus) {
  if (!metaStatus) {
    syncStatusValue.textContent = "--";
    syncStatusValue.dataset.syncStatus = "unknown";
    return;
  }

  const ts = metaStatus.lastFullSync || metaStatus.lastItemsSync;
  if (!ts) {
    syncStatusValue.textContent = "NEVER";
    syncStatusValue.dataset.syncStatus = "stale";
    return;
  }

  const date = ts.toDate();
  syncStatusValue.textContent = date.toLocaleString();
  syncStatusValue.dataset.syncStatus = "ok"; // later: compute freshness
}

function renderLists(lists) {
  listsContainer.innerHTML = "";
  if (!lists.length) {
    const p = document.createElement("p");
    p.textContent = "No lists yet.";
    listsContainer.appendChild(p);
    return;
  }

  lists.forEach((list) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("list-item");
    btn.dataset.listId = list.id;

    if (list.id === currentListId) {
      btn.classList.add("is-active");
    }

    const title = document.createElement("span");
    title.classList.add("list-title");
    title.textContent = list.title || "(Untitled List)";

    const meta = document.createElement("span");
    meta.classList.add("list-meta");
    meta.textContent = "items count will load…";

    btn.appendChild(title);
    btn.appendChild(meta);

    btn.addEventListener("click", () => {
      if (currentListId === list.id) return;
      loadList(list.id);
    });

    listsContainer.appendChild(btn);
  });
}

function renderActiveListHeader(list, items) {
  if (!list) {
    activeListTitle.textContent = "";
    activeListMeta.textContent = "";
    return;
  }

  activeListTitle.textContent = list.title || "(Untitled List)";

  const totalItems = items.length;
  const remaining = items.filter(
    (i) => (i.quantityRequired || 0) - (i.quantityOwned || 0) > 0
  ).length;

  activeListMeta.textContent = `${totalItems} items • ${remaining} remaining`;

  statusSummary.textContent = `${totalItems - remaining} ITEMS COMPLETE • ${remaining} REMAINING`;
}

function progressBars(required, owned) {
  const total = Math.max(required, 1);
  const filled = Math.min(owned, required);
  const segments = 5;
  const ratio = filled / total;
  const filledSegments = Math.round(ratio * segments);

  let s = "";
  for (let i = 0; i < segments; i++) {
    s += i < filledSegments ? "■" : "□";
  }
  return s;
}

function renderListItems(items) {
  activeListTbody.innerHTML = "";
  if (!items.length) return;

  items.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.classList.add("list-row");
    tr.dataset.listItemId = item.id;
    if (index === 0) tr.classList.add("is-selected");

    tr.addEventListener("click", () => {
      document
        .querySelectorAll(".list-row.is-selected")
        .forEach((row) => row.classList.remove("is-selected"));
      tr.classList.add("is-selected");
      showItemIntel(item);
    });

    const remaining =
      (item.quantityRequired || 0) - (item.quantityOwned || 0);

    const tdQty = document.createElement("td");
    tdQty.classList.add("col-qty");
    tdQty.textContent = item.quantityRequired ?? "-";

    const tdName = document.createElement("td");
    tdName.classList.add("col-item-name");
    tdName.textContent = item.itemName || item?.mfItem?.name || "(Unknown)";

    const tdOwned = document.createElement("td");
    tdOwned.classList.add("col-owned");
    const ownedSpan = document.createElement("span");
    ownedSpan.classList.add("owned-value");
    ownedSpan.textContent = item.quantityOwned ?? 0;
    tdOwned.appendChild(ownedSpan);

    const tdSrc = document.createElement("td");
    tdSrc.classList.add("col-source");
    tdSrc.textContent = (item.sourceType || "manual").toUpperCase();

    const tdStatus = document.createElement("td");
    tdStatus.classList.add("col-status");
    tdStatus.textContent = progressBars(
      item.quantityRequired || 0,
      item.quantityOwned || 0
    );

    if (remaining <= 0) {
      tr.classList.add("complete");
    }

    tr.appendChild(tdQty);
    tr.appendChild(tdName);
    tr.appendChild(tdOwned);
    tr.appendChild(tdSrc);
    tr.appendChild(tdStatus);

    activeListTbody.appendChild(tr);
  });

  if (items[0]) showItemIntel(items[0]);
}

/* Intel / Power rendering */

function clearList(el) {
  if (!el) return;
  el.innerHTML = "";
}

function renderSimpleList(el, values) {
  clearList(el);
  if (!values || !values.length) {
    const li = document.createElement("li");
    li.textContent = "—";
    el.appendChild(li);
    return;
  }
  values.forEach((v) => {
    const li = document.createElement("li");
    li.textContent = v;
    el.appendChild(li);
  });
}

function showItemIntel(item) {
  if (!item || !item.mfItem) {
    intelEmptyState.hidden = false;
    itemDetailSection.hidden = true;
    return;
  }

  intelEmptyState.hidden = true;
  itemDetailSection.hidden = false;

  const mf = item.mfItem;

  itemDetailName.textContent = mf.name || item.itemName || "(Unknown Item)";
  itemDetailRarity.textContent = mf.rarity || "";
  itemDetailType.textContent = mf.type || "";

  renderSimpleList(itemMapsList, mf.sources?.maps || []);
  renderSimpleList(itemBiomesList, mf.sources?.biomes || []);
  renderSimpleList(itemEnemiesList, mf.sources?.enemies || []);
  renderSimpleList(itemVendorsList, mf.sources?.traders || []);

  const related = [];
  if (mf.sources?.quests?.length) {
    related.push(`Used in ${mf.sources.quests.length} quests`);
  }
  itemRelatedList.innerHTML = "";
  related.forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    itemRelatedList.appendChild(li);
  });

  // also recompute power intel for the whole list
  renderPowerIntel(currentListItems);
}

function renderPowerIntel(items) {
  // basic v1 scoring: sum remaining quantities per map/biome/vendor/enemy
  const mapScore = {};
  const biomeScore = {};
  const vendorScore = {};
  const enemyScore = {};

  let totalRemaining = 0;

  items.forEach((item) => {
    const mf = item.mfItem;
    if (!mf) return;
    const remaining =
      (item.quantityRequired || 0) - (item.quantityOwned || 0);
    if (remaining <= 0) return;
    totalRemaining += remaining;

    (mf.sources?.maps || []).forEach((m) => {
      mapScore[m] = (mapScore[m] || 0) + remaining;
    });

    (mf.sources?.biomes || []).forEach((b) => {
      biomeScore[b] = (biomeScore[b] || 0) + remaining;
    });

    (mf.sources?.traders || []).forEach((t) => {
      vendorScore[t] = (vendorScore[t] || 0) + remaining;
    });

    (mf.sources?.enemies || []).forEach((e) => {
      enemyScore[e] = (enemyScore[e] || 0) + remaining;
    });
  });

  const sortEntries = (obj) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]);

  const mapsSorted = sortEntries(mapScore);
  const biomesSorted = sortEntries(biomeScore);
  const vendorsSorted = sortEntries(vendorScore);
  const enemiesSorted = sortEntries(enemyScore);

  const formatEntries = (entries) =>
    entries.slice(0, 5).map(([name, score]) => `${name} — ${score} pts`);

  renderSimpleList(powerMapsList, formatEntries(mapsSorted));
  renderSimpleList(powerBiomesList, formatEntries(biomesSorted));
  renderSimpleList(powerVendorsList, formatEntries(vendorsSorted));
  renderSimpleList(powerEnemiesList, formatEntries(enemiesSorted));

  if (!totalRemaining || !mapsSorted.length) {
    powerConfidenceText.textContent = "No remaining requirements found.";
    return;
  }

  const topMapScore = mapsSorted[0][1];
  const confidence = topMapScore / totalRemaining;
  let label = "Mixed strategy";
  if (confidence > 0.6) label = "High confidence";
  else if (confidence < 0.3) label = "Scattered";

  powerConfidenceText.textContent = `${label}: ${
    mapsSorted[0][0]
  } covers ${Math.round(confidence * 100)}% of remaining needs.`;
}

/* Data loading */

async function loadForUser(user) {
  currentUser = user;
  signInButton.hidden = true;
  userInfo.hidden = false;
  userNameEl.textContent = user.displayName || user.email || "User";

  // sync status
  try {
    const meta = await getMetaStatus();
    setSyncStatus(meta);
  } catch (err) {
    console.error("Error loading metaStatus:", err);
  }

  // lists
  try {
    console.log("UID used for query:", user.uid);
    currentLists = await getUserLists(user.uid);
    console.log("Lists returned from Firestore:", currentLists);
    renderLists(currentLists);

    if (currentLists.length) {
      await loadList(currentLists[0].id);
    } else {
      activeListTitle.textContent = "";
      activeListMeta.textContent = "";
      activeListTbody.innerHTML = "";
      statusSummary.textContent = "No lists yet.";
    }
  } catch (err) {
    console.error("Error loading lists:", err);
  }
}

async function loadList(listId) {
  if (!currentUser) return;
  currentListId = listId;

  // toggle active state in left panel
  document.querySelectorAll(".list-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.listId === listId);
  });

  try {
    currentListItems = await getListItemsWithCanonical(
      listId,
      currentUser.uid
    );
    const list = currentLists.find((l) => l.id === listId) || null;
    renderActiveListHeader(list, currentListItems);
    renderListItems(currentListItems);
  } catch (err) {
    console.error("Error loading list items:", err);
  }
}

/* Signed-out UI */

function showSignedOutUI() {
  currentUser = null;
  signInButton.hidden = false;
  userInfo.hidden = true;
  userNameEl.textContent = "";

  syncStatusValue.textContent = "--";
  syncStatusValue.dataset.syncStatus = "unknown";

  listsContainer.innerHTML = "";
  activeListTitle.textContent = "";
  activeListMeta.textContent = "";
  activeListTbody.innerHTML = "";
  statusSummary.textContent = "";

  intelEmptyState.hidden = false;
  itemDetailSection.hidden = true;

  // clear power intel
  powerMapsList.innerHTML = "";
  powerBiomesList.innerHTML = "";
  powerVendorsList.innerHTML = "";
  powerEnemiesList.innerHTML = "";
  powerConfidenceText.textContent = "";
}

/* Auth state watcher */

watchAuthState(
  (user) => {
    loadForUser(user);
  },
  () => {
    showSignedOutUI();
  }
);
