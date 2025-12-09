// app.js
// Main app wiring: auth, crafting lists, rendering, and item search.

import { signInWithGoogle, signOutUser, watchAuthState } from "./Auth.js";
import { getMetaStatus } from "./metastatus.js";
import {
  addItemToList,
  createList,
  deleteListAndItems,
  removeListItem,
  renameList,
  updateHaveQty,
  updateNeededQty,
  watchListItemsWithCanonical,
  watchUserLists,
} from "./craftingLists.js";
import { loadAllCanonicalItems } from "./mfItems.js";

/* DOM references */
const signInButton = document.getElementById("sign-in-button");
const signOutButton = document.getElementById("sign-out-button");
const userInfo = document.getElementById("user-info");
const userNameEl = document.getElementById("user-name");

const syncStatusValue = document.getElementById("sync-status-value");

const listsContainer = document.getElementById("lists-container");
const newListButton = document.getElementById("new-list-button");

const activeListTitle = document.getElementById("active-list-title");
const activeListMeta = document.getElementById("active-list-meta");
const activeListTbody = document.getElementById("active-list-tbody");

const addItemButton = document.getElementById("add-item-button");
const renameListButton = document.getElementById("rename-list-button");
const deleteListButton = document.getElementById("delete-list-button");

const addItemInline = document.getElementById("add-item-inline");
const itemSearchInput = document.getElementById("itemSearchInput");
const itemSearchResults = document.getElementById("itemSearchResults");

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
const intelToggleButton = document.getElementById("intel-toggle-button");

let currentUser = null;
let currentLists = [];
let currentListId = null;
let currentListItems = [];
let unsubscribeLists = null;
let unsubscribeItems = null;
let searchDebounce = null;
let allCanonicalItems = [];
let canonicalItemsLoaded = false;
let canonicalItemsLoading = null;

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
    const wrapper = document.createElement("div");
    wrapper.classList.add("list-row-entry");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("list-item");
    btn.dataset.listId = list.id;

    if (list.id === currentListId) {
      btn.classList.add("is-active");
    }

    const title = document.createElement("span");
    title.classList.add("list-title");
    title.textContent = list.name || "(Untitled List)";

    btn.appendChild(title);

    btn.addEventListener("click", () => {
      if (currentListId === list.id) return;
      loadList(list.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.classList.add("list-delete-btn");
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Delete list";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await handleDeleteList(list.id);
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(deleteBtn);
    listsContainer.appendChild(wrapper);
  });
}

function renderActiveListHeader(list, items) {
  if (!list) {
    activeListTitle.textContent = "";
    activeListMeta.textContent = "";
    return;
  }

  activeListTitle.textContent = list.name || "(Untitled List)";

  const totalItems = items.length;
  const remaining = items.filter((i) => (i.neededQty || 0) - (i.haveQty || 0) > 0)
    .length;
  activeListMeta.textContent = `${totalItems} items • ${remaining} remaining`;

  const totalNeeded = items.reduce((acc, i) => acc + (i.neededQty || 0), 0);
  const totalHave = items.reduce((acc, i) => acc + (i.haveQty || 0), 0);
  statusSummary.textContent = `${totalHave}/${totalNeeded} ITEMS ON HAND`;
}

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

  itemDetailName.textContent = mf.name || "(Unknown Item)";
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
    const remaining = (item.neededQty || 0) - (item.haveQty || 0);
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

  const sortEntries = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

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

  powerConfidenceText.textContent = `${label}: ${mapsSorted[0][0]} covers ${Math.round(
    confidence * 100
  )}% of remaining needs.`;
}

function renderListItems(items) {
  activeListTbody.innerHTML = "";
  if (!items.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "No items yet.";
    tr.appendChild(td);
    activeListTbody.appendChild(tr);
    return;
  }

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

    const tdName = document.createElement("td");
    tdName.classList.add("col-item-name");
    const nameText = item.mfItem?.name || "(Unknown Item)";
    tdName.textContent = nameText;
    if (item.mfItem?.rarity || item.mfItem?.type) {
      const meta = document.createElement("div");
      meta.classList.add("item-meta");
      meta.textContent = [item.mfItem?.rarity, item.mfItem?.type]
        .filter(Boolean)
        .join(" • ");
      tdName.appendChild(meta);
    }

    const tdNeeded = document.createElement("td");
    tdNeeded.classList.add("col-qty");
    const neededInput = document.createElement("input");
    neededInput.type = "number";
    neededInput.min = "0";
    neededInput.value = item.neededQty ?? 0;
    neededInput.classList.add("quantity-input");
    neededInput.addEventListener("change", async (e) => {
      const value = Math.max(0, Number(e.target.value) || 0);
      await updateNeededQty(currentListId, item.id, currentUser.uid, value);
    });
    tdNeeded.appendChild(neededInput);

    const tdOwned = document.createElement("td");
    tdOwned.classList.add("col-owned");
    const decBtn = document.createElement("button");
    decBtn.type = "button";
    decBtn.textContent = "-";
    decBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = Math.max(0, (item.haveQty || 0) - 1);
      await updateHaveQty(currentListId, item.id, currentUser.uid, next);
    });
    const ownedInput = document.createElement("input");
    ownedInput.type = "number";
    ownedInput.min = "0";
    ownedInput.value = item.haveQty ?? 0;
    ownedInput.classList.add("quantity-input", "owned-value");
    ownedInput.addEventListener("change", async (e) => {
      e.stopPropagation();
      const value = Math.max(0, Number(e.target.value) || 0);
      await updateHaveQty(currentListId, item.id, currentUser.uid, value);
    });
    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.textContent = "+";
    incBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = Math.max(0, (item.haveQty || 0) + 1);
      await updateHaveQty(currentListId, item.id, currentUser.uid, next);
    });
    tdOwned.appendChild(decBtn);
    tdOwned.appendChild(ownedInput);
    tdOwned.appendChild(incBtn);

    const tdActions = document.createElement("td");
    tdActions.classList.add("col-actions");
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeListItem(currentListId, item.id, currentUser.uid);
    });
    tdActions.appendChild(removeBtn);

    tr.appendChild(tdName);
    tr.appendChild(tdNeeded);
    tr.appendChild(tdOwned);
    tr.appendChild(tdActions);

    activeListTbody.appendChild(tr);
  });

  if (items[0]) showItemIntel(items[0]);
}

/* Canonical items search helpers */

async function ensureCanonicalItemsLoaded() {
  if (canonicalItemsLoaded) return allCanonicalItems;
  if (canonicalItemsLoading) return canonicalItemsLoading;

  canonicalItemsLoading = loadAllCanonicalItems()
    .then((items) => {
      allCanonicalItems = items;
      canonicalItemsLoaded = true;
      return items;
    })
    .catch((err) => {
      console.error("Error loading canonical items:", err);
      canonicalItemsLoading = null;
      throw err;
    });

  return canonicalItemsLoading;
}

function isWordBoundary(name, index) {
  if (index === 0) return true;
  const prev = name[index - 1];
  return /\s|[-_/]/.test(prev);
}

function fuzzyScore(name, query) {
  const lowerName = (name || "").toLowerCase();
  if (!lowerName) return -1;

  const substringIndex = lowerName.indexOf(query);
  if (substringIndex !== -1) {
    let score = 200 - substringIndex * 2 - (lowerName.length - query.length);
    if (isWordBoundary(lowerName, substringIndex)) {
      score += 30;
    }
    return score;
  }

  let lastIndex = -1;
  let gapPenalty = 0;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    const idx = lowerName.indexOf(ch, lastIndex + 1);
    if (idx === -1) return -1;
    if (lastIndex !== -1) {
      gapPenalty += idx - lastIndex - 1;
    }
    lastIndex = idx;
  }

  const firstIndex = lowerName.indexOf(query[0]);
  let score = 140 - gapPenalty - (lastIndex - firstIndex);
  if (isWordBoundary(lowerName, firstIndex)) {
    score += 10;
  }
  return score;
}

function getFuzzyMatches(query, items, maxResults = 10) {
  const normalized = (query || "").trim().toLowerCase();
  if (!normalized) return [];

  return items
    .map((item) => ({
      item,
      score: fuzzyScore(item.name || "", normalized),
    }))
    .filter((entry) => entry.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score || (a.item.name || "").localeCompare(b.item.name || "")
    )
    .slice(0, maxResults)
    .map((entry) => entry.item);
}

function renderItemSearchResults(matches) {
  itemSearchResults.innerHTML = "";

  if (!matches.length) {
    const li = document.createElement("li");
    li.textContent = "No matches found.";
    itemSearchResults.appendChild(li);
    return;
  }

  matches.forEach((item) => {
    const li = document.createElement("li");
    li.classList.add("search-result");

    const name = document.createElement("div");
    name.textContent = item.name;

    const meta = document.createElement("div");
    meta.classList.add("search-result-meta");
    meta.textContent = [item.rarity, item.type].filter(Boolean).join(" • ");

    li.appendChild(name);
    li.appendChild(meta);

    li.addEventListener("click", () => handleCanonicalItemSelected(item));

    itemSearchResults.appendChild(li);
  });
}

async function handleCanonicalItemSelected(item) {
  if (!currentListId || !currentUser) return;
  try {
    const res = await addItemToList(currentListId, currentUser.uid, item.id);
    if (res.success) {
      itemSearchInput.value = "";
      itemSearchResults.innerHTML = "";
      addItemInline.hidden = true;
    } else if (res.reason === "duplicate") {
      alert("Item already in this list.");
    } else {
      alert("Could not add item. Check console for details.");
    }
  } catch (err) {
    console.error("Error adding item:", err);
    alert("Could not add item. Check console for details.");
  }
}

function setupItemSearchTypeahead() {
  if (!itemSearchInput || !itemSearchResults) return;

  itemSearchInput.addEventListener("input", () => {
    if (!currentListId) return;
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(handleItemSearchInput, 120);
  });
}

function showSearchLoadingState(message) {
  itemSearchResults.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = message;
  itemSearchResults.appendChild(li);
}

function handleItemSearchInput() {
  const query = itemSearchInput.value.trim();
  if (!query) {
    itemSearchResults.innerHTML = "";
    return;
  }

  if (!canonicalItemsLoaded) {
    showSearchLoadingState("Loading canonical items...");
    ensureCanonicalItemsLoaded()
      .then(() => handleItemSearchInput())
      .catch(() => {
        showSearchLoadingState("Error loading canonical items.");
      });
    return;
  }

  const matches = getFuzzyMatches(query, allCanonicalItems, 10);
  renderItemSearchResults(matches);
}

/* Data loading */

async function loadForUser(user) {
  currentUser = user;
  signInButton.hidden = true;
  userInfo.hidden = false;
  userNameEl.textContent = user.displayName || user.email || "User";

  if (unsubscribeLists) unsubscribeLists();
  if (unsubscribeItems) unsubscribeItems();

  // sync status
  try {
    const meta = await getMetaStatus();
    setSyncStatus(meta);
  } catch (err) {
    console.error("Error loading metaStatus:", err);
  }

  ensureCanonicalItemsLoaded().catch(() => {
    // handled in search UI when needed
  });

  unsubscribeLists = watchUserLists(user.uid, (lists) => {
    currentLists = lists;
    renderLists(currentLists);
    const stillExists = currentLists.some((l) => l.id === currentListId);
    if (!stillExists) {
      currentListId = currentLists[0]?.id || null;
      if (currentListId) {
        subscribeToList(currentListId);
      } else {
        activeListTitle.textContent = "";
        activeListMeta.textContent = "";
        activeListTbody.innerHTML = "";
        addItemInline.hidden = true;
      }
    }
  });

  if (currentLists.length) {
    loadList(currentLists[0].id);
  }
}

async function loadList(listId) {
  if (!currentUser || !listId) return;
  currentListId = listId;
  addItemInline.hidden = true;
  if (itemSearchInput) itemSearchInput.value = "";
  if (itemSearchResults) itemSearchResults.innerHTML = "";
  subscribeToList(listId);
  document.querySelectorAll(".list-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.listId === listId);
  });
}

function subscribeToList(listId) {
  if (unsubscribeItems) unsubscribeItems();
  unsubscribeItems = watchListItemsWithCanonical(listId, currentUser.uid, (items) => {
    currentListItems = items;
    const list = currentLists.find((l) => l.id === listId) || null;
    renderActiveListHeader(list, currentListItems);
    renderListItems(currentListItems);
  });
}

/* Signed-out UI */

function showSignedOutUI() {
  currentUser = null;
  if (unsubscribeLists) unsubscribeLists();
  if (unsubscribeItems) unsubscribeItems();
  unsubscribeLists = null;
  unsubscribeItems = null;

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
  addItemInline.hidden = true;
  if (itemSearchInput) itemSearchInput.value = "";
  if (itemSearchResults) itemSearchResults.innerHTML = "";

  intelEmptyState.hidden = false;
  itemDetailSection.hidden = true;

  powerMapsList.innerHTML = "";
  powerBiomesList.innerHTML = "";
  powerVendorsList.innerHTML = "";
  powerEnemiesList.innerHTML = "";
  powerConfidenceText.textContent = "";
}

/* List actions */

newListButton?.addEventListener("click", async () => {
  if (!currentUser) return;
  const name = prompt("Enter a name for the new list:", "New List");
  if (name === null) return;
  try {
    const id = await createList(currentUser.uid, name);
    await loadList(id);
  } catch (err) {
    console.error("Error creating list:", err);
    alert("Could not create list. Check console for details.");
  }
});

async function handleDeleteList(listId) {
  if (!currentUser) return;
  const confirmed = confirm(
    "Delete this list? This will remove the list and all of its items. Canonical MetaForge data will not be affected."
  );
  if (!confirmed) return;
  try {
    await deleteListAndItems(listId, currentUser.uid);
    if (currentListId === listId) {
      currentListId = null;
    }
  } catch (err) {
    console.error("Error deleting list:", err);
    alert("Could not delete list. Check console for details.");
  }
}

deleteListButton?.addEventListener("click", () => {
  if (!currentListId) return;
  handleDeleteList(currentListId);
});

intelToggleButton?.addEventListener("click", () => {
  const isCollapsed = document.body.classList.toggle("intel-collapsed");
  document.body.classList.toggle("intel-expanded", !isCollapsed);
  intelToggleButton.textContent = isCollapsed
    ? "Show Advanced Intel Panel"
    : "Hide Advanced Intel Panel";
});

renameListButton?.addEventListener("click", async () => {
  if (!currentUser || !currentListId) return;
  const list = currentLists.find((l) => l.id === currentListId);
  const name = prompt("Rename list:", list?.name || "");
  if (name === null) return;
  try {
    await renameList(currentListId, currentUser.uid, name);
  } catch (err) {
    console.error("Error renaming list:", err);
    alert("Could not rename list. Check console for details.");
  }
});

/* Add item flow */

addItemButton?.addEventListener("click", () => {
  if (!currentListId) return;
  const isHidden = addItemInline.hidden;
  addItemInline.hidden = !isHidden;
  if (!addItemInline.hidden) {
    ensureCanonicalItemsLoaded().catch(() => {});
    itemSearchInput.focus();
    handleItemSearchInput();
  }
});

setupItemSearchTypeahead();

/* Auth state watcher */

watchAuthState(
  (user) => {
    loadForUser(user);
  },
  () => {
    showSignedOutUI();
  }
);

// Default to collapsed intel panel on load
document.body.classList.add("intel-collapsed");
intelToggleButton.textContent = "Show Advanced Intel Panel";
