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
import { searchItemsByNamePrefix } from "./mfItems.js";

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
const addItemSearchInput = document.getElementById("add-item-search-input");
const addItemSearchResults = document.getElementById("add-item-search-results");

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
let unsubscribeLists = null;
let unsubscribeItems = null;
let searchDebounce = null;

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

    const meta = document.createElement("span");
    meta.classList.add("list-meta");
    meta.textContent = list.updatedAt
      ? `Updated ${list.updatedAt.toDate().toLocaleString()}`
      : "";

    btn.appendChild(title);
    btn.appendChild(meta);

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
    const ownedSpan = document.createElement("span");
    ownedSpan.classList.add("owned-value");
    ownedSpan.textContent = item.haveQty ?? 0;
    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.textContent = "+";
    incBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = Math.max(0, (item.haveQty || 0) + 1);
      await updateHaveQty(currentListId, item.id, currentUser.uid, next);
    });
    tdOwned.appendChild(decBtn);
    tdOwned.appendChild(ownedSpan);
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
  addItemSearchInput.value = "";
  addItemSearchResults.innerHTML = "";
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
  addItemSearchInput.value = "";
  addItemSearchResults.innerHTML = "";

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
    addItemSearchInput.focus();
    runSearch(addItemSearchInput.value || "");
  }
});

addItemSearchInput?.addEventListener("input", (e) => {
  if (!currentListId) return;
  if (searchDebounce) clearTimeout(searchDebounce);
  const value = e.target.value || "";
  searchDebounce = setTimeout(() => runSearch(value), 200);
});

async function runSearch(term) {
  addItemSearchResults.innerHTML = "";
  if (!term) {
    const p = document.createElement("p");
    p.textContent = "Start typing to search canonical items.";
    addItemSearchResults.appendChild(p);
    return;
  }
  try {
    const results = await searchItemsByNamePrefix(term, 10);
    if (!results.length) {
      const p = document.createElement("p");
      p.textContent = "No matches found.";
      addItemSearchResults.appendChild(p);
      return;
    }
    results.forEach((item) => {
      const row = document.createElement("div");
      row.classList.add("search-result");

      const info = document.createElement("div");
      info.classList.add("search-result-info");
      const name = document.createElement("div");
      name.textContent = item.name;
      const meta = document.createElement("div");
      meta.classList.add("search-result-meta");
      meta.textContent = [item.rarity, item.type].filter(Boolean).join(" • ");
      info.appendChild(name);
      info.appendChild(meta);

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "Add";
      addBtn.addEventListener("click", async () => {
        const res = await addItemToList(
          currentListId,
          currentUser.uid,
          item.id
        );
        if (res.success) {
          addItemSearchInput.value = "";
          addItemInline.hidden = true;
        } else if (res.reason === "duplicate") {
          alert("Item already in this list.");
        } else {
          alert("Could not add item. Check console for details.");
        }
      });

      row.appendChild(info);
      row.appendChild(addBtn);
      addItemSearchResults.appendChild(row);
    });
  } catch (err) {
    console.error("Search error:", err);
    const p = document.createElement("p");
    p.textContent = "Error searching items.";
    addItemSearchResults.appendChild(p);
  }
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
