// app.js
// Crafting list UI: create/manage lists, add canonical items, track quantities.

import { signInWithGoogle, signOutUser, watchAuthState } from "./Auth.js";
import { getMetaStatus } from "./metastatus.js";
import {
  createList,
  listenToUserLists,
  listenToListItems,
  addCanonicalItemToList,
  updateListItemQuantities,
  removeListItem,
  deleteListWithItems,
  renameList,
  enrichItemsWithCanonical,
} from "./craftingLists.js";
import { searchItemsByNamePrefix, getItemById } from "./mfItems.js";

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
const emptyActiveList = document.getElementById("empty-active-list");

const renameListButton = document.getElementById("rename-list-button");
const deleteListButton = document.getElementById("delete-list-button");
const addItemButton = document.getElementById("add-item-button");

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

const modalBackdrop = document.getElementById("modal-backdrop");
const addItemModal = document.getElementById("add-item-modal");
const closeAddModal = document.getElementById("close-add-modal");
const addItemSearchInput = document.getElementById("add-item-search-input");
const addItemSearchResults = document.getElementById("add-item-search-results");

const detailModal = document.getElementById("item-detail-modal");
const closeDetailModal = document.getElementById("close-detail-modal");
const detailModalTitle = document.getElementById("detail-modal-title");
const detailModalBody = document.getElementById("detail-modal-body");

/* State */
let currentUser = null;
let currentLists = [];
let currentListId = null;
let currentListItems = [];
let listsUnsub = null;
let itemsUnsub = null;
const mfItemCache = {};
let searchDebounce = null;

/* Helpers */
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
  syncStatusValue.dataset.syncStatus = "ok";
}

function setStatus(message) {
  statusSummary.textContent = message || "";
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

function showIntelFromItem(item) {
  if (!item || !item.mfItem) {
    intelEmptyState.hidden = false;
    itemDetailSection.hidden = true;
    return;
  }

  const mf = item.mfItem;
  intelEmptyState.hidden = true;
  itemDetailSection.hidden = false;

  itemDetailName.textContent = mf.name || "(Unknown Item)";
  itemDetailRarity.textContent = mf.rarity || "";
  itemDetailType.textContent = mf.type || mf.itemType || "";

  renderSimpleList(itemMapsList, mf.sources?.maps || []);
  renderSimpleList(itemBiomesList, mf.sources?.biomes || []);
  renderSimpleList(itemEnemiesList, mf.sources?.enemies || []);
  renderSimpleList(itemVendorsList, mf.sources?.traders || []);

  const related = [];
  if (mf.sources?.quests?.length) {
    related.push(`Used in ${mf.sources.quests.length} quests`);
  }
  renderSimpleList(itemRelatedList, related);
}

function renderLists(lists) {
  listsContainer.innerHTML = "";
  if (!lists.length) {
    const p = document.createElement("p");
    p.textContent = "No lists yet.";
    listsContainer.appendChild(p);
    emptyActiveList.hidden = false;
    return;
  }

  lists.forEach((list) => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("list-item");
    wrapper.dataset.listId = list.id;
    if (list.id === currentListId) wrapper.classList.add("is-active");

    const titleRow = document.createElement("div");
    titleRow.style.display = "flex";
    titleRow.style.justifyContent = "space-between";
    titleRow.style.width = "100%";
    titleRow.style.gap = "8px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.classList.add("list-title");
    btn.textContent = list.name || "(Untitled List)";
    btn.addEventListener("click", () => {
      if (currentListId === list.id) return;
      loadList(list.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "🗑";
    deleteBtn.title = "Delete list";
    deleteBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      confirmDeleteList(list.id);
    });

    titleRow.appendChild(btn);
    titleRow.appendChild(deleteBtn);

    const meta = document.createElement("span");
    meta.classList.add("list-meta");
    const updatedAtDate = list.updatedAt?.toDate?.();
    meta.textContent = updatedAtDate
      ? `Updated ${updatedAtDate.toLocaleString()}`
      : "";

    wrapper.appendChild(titleRow);
    wrapper.appendChild(meta);
    listsContainer.appendChild(wrapper);
  });
}

function renderActiveListHeader(items) {
  const list = currentLists.find((l) => l.id === currentListId);
  if (!list) {
    activeListTitle.textContent = "";
    activeListMeta.textContent = "";
    return;
  }

  const totalItems = items.length;
  const remaining = items.filter((i) => (i.neededQty || 0) - (i.haveQty || 0) > 0)
    .length;

  activeListTitle.textContent = list.name || "(Untitled List)";
  activeListMeta.textContent = `${totalItems} items • ${remaining} remaining`;
  statusSummary.textContent = `${totalItems - remaining} ITEMS COMPLETE • ${remaining} REMAINING`;
}

function renderProgressCell(item) {
  const needed = Number(item.neededQty || 0);
  const have = Number(item.haveQty || 0);
  const wrapper = document.createElement("div");

  const label = document.createElement("div");
  label.textContent = `${have}/${needed || 0}`;

  const bar = document.createElement("div");
  bar.classList.add("progress-bar");
  const span = document.createElement("span");
  const ratio = needed > 0 ? Math.min(have / needed, 1) : 0;
  span.style.width = `${ratio * 100}%`;
  bar.appendChild(span);

  wrapper.appendChild(label);
  wrapper.appendChild(bar);
  return wrapper;
}

function renderListItems(items) {
  activeListTbody.innerHTML = "";
  if (!items.length) {
    emptyActiveList.hidden = false;
    return;
  }
  emptyActiveList.hidden = true;

  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.classList.add("list-row");
    tr.dataset.listItemId = item.id;

    if ((item.neededQty || 0) - (item.haveQty || 0) <= 0) {
      tr.classList.add("complete");
    }

    // ITEM NAME
    const tdName = document.createElement("td");
    tdName.classList.add("col-item-name");
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.textContent = item.mfItem?.name || "(Unknown Item)";
    nameBtn.addEventListener("click", () => openItemDetail(item.canonicalItemId));
    tdName.appendChild(nameBtn);

    // META
    const tdMeta = document.createElement("td");
    tdMeta.classList.add("col-meta");
    const badges = document.createElement("div");
    badges.classList.add("item-badges");
    if (item.mfItem?.rarity) {
      const rarity = document.createElement("span");
      rarity.textContent = item.mfItem.rarity;
      badges.appendChild(rarity);
    }
    if (item.mfItem?.type || item.mfItem?.itemType) {
      const type = document.createElement("span");
      type.textContent = item.mfItem.type || item.mfItem.itemType;
      badges.appendChild(type);
    }
    tdMeta.appendChild(badges);

    // NEEDED
    const tdNeeded = document.createElement("td");
    tdNeeded.classList.add("col-needed");
    const neededInput = document.createElement("input");
    neededInput.type = "number";
    neededInput.min = "0";
    neededInput.classList.add("quantity-input");
    neededInput.value = item.neededQty ?? 0;
    neededInput.addEventListener("change", () => {
      const parsed = Math.max(0, Number(neededInput.value) || 0);
      updateListItemQuantities(currentListId, item.id, currentUser.uid, {
        neededQty: parsed,
      });
    });
    tdNeeded.appendChild(neededInput);

    // HAVE
    const tdHave = document.createElement("td");
    tdHave.classList.add("col-owned");
    const haveWrapper = document.createElement("div");
    haveWrapper.classList.add("have-controls");
    const decBtn = document.createElement("button");
    decBtn.textContent = "-";
    const haveValue = document.createElement("span");
    haveValue.textContent = item.haveQty ?? 0;
    const incBtn = document.createElement("button");
    incBtn.textContent = "+";

    decBtn.addEventListener("click", () => {
      const next = Math.max(0, (item.haveQty || 0) - 1);
      item.haveQty = next;
      haveValue.textContent = next;
      updateListItemQuantities(currentListId, item.id, currentUser.uid, {
        haveQty: next,
      });
    });
    incBtn.addEventListener("click", () => {
      const next = (item.haveQty || 0) + 1;
      item.haveQty = next;
      haveValue.textContent = next;
      updateListItemQuantities(currentListId, item.id, currentUser.uid, {
        haveQty: next,
      });
    });

    haveWrapper.appendChild(decBtn);
    haveWrapper.appendChild(haveValue);
    haveWrapper.appendChild(incBtn);
    tdHave.appendChild(haveWrapper);

    // PROGRESS
    const tdProgress = document.createElement("td");
    tdProgress.classList.add("col-progress");
    tdProgress.appendChild(renderProgressCell(item));

    // ACTIONS
    const tdActions = document.createElement("td");
    tdActions.classList.add("col-actions");
    const actions = document.createElement("div");
    actions.classList.add("row-actions");
    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.textContent = "DETAILS";
    detailBtn.addEventListener("click", () => openItemDetail(item.canonicalItemId));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "REMOVE";
    removeBtn.addEventListener("click", async () => {
      await removeListItem(currentListId, item.id, currentUser.uid);
    });
    actions.appendChild(detailBtn);
    actions.appendChild(removeBtn);
    tdActions.appendChild(actions);

    tr.appendChild(tdName);
    tr.appendChild(tdMeta);
    tr.appendChild(tdNeeded);
    tr.appendChild(tdHave);
    tr.appendChild(tdProgress);
    tr.appendChild(tdActions);

    tr.addEventListener("click", () => {
      document
        .querySelectorAll(".list-row.is-selected")
        .forEach((row) => row.classList.remove("is-selected"));
      tr.classList.add("is-selected");
      showIntelFromItem(item);
    });

    activeListTbody.appendChild(tr);
  });

  if (items[0]) {
    showIntelFromItem(items[0]);
    const firstRow = activeListTbody.querySelector(".list-row");
    firstRow?.classList.add("is-selected");
  }
}

/* Modals */
function openModal(modal) {
  modal.hidden = false;
  modalBackdrop.hidden = false;
}

function closeModal(modal) {
  modal.hidden = true;
  modalBackdrop.hidden = true;
}

function openAddItemModal() {
  if (!currentListId) {
    alert("Create or select a list first.");
    return;
  }
  addItemSearchInput.value = "";
  addItemSearchResults.innerHTML = "Type to search MetaForge items.";
  openModal(addItemModal);
  addItemSearchInput.focus();
}

function openItemDetail(canonicalItemId) {
  if (!canonicalItemId) return;
  const cached = mfItemCache[canonicalItemId];
  if (cached) {
    renderDetailModal(cached);
    return;
  }

  getItemById(canonicalItemId).then((mfItem) => {
    if (mfItem) mfItemCache[canonicalItemId] = mfItem;
    renderDetailModal(mfItem);
  });
}

function renderDetailModal(mfItem) {
  if (!mfItem) return;
  detailModalTitle.textContent = mfItem.name || "Item Detail";
  detailModalBody.innerHTML = "";

  const summary = document.createElement("div");
  summary.innerHTML = `
    <p><strong>Rarity:</strong> ${mfItem.rarity || ""}</p>
    <p><strong>Type:</strong> ${mfItem.type || mfItem.itemType || ""}</p>
    <p><strong>Description:</strong> ${mfItem.description || "No description."}</p>
  `;
  detailModalBody.appendChild(summary);

  const listBlock = (title, values) => {
    const wrapper = document.createElement("div");
    const h = document.createElement("h4");
    h.textContent = title;
    wrapper.appendChild(h);
    const ul = document.createElement("ul");
    (values || ["—"]).forEach((v) => {
      const li = document.createElement("li");
      li.textContent = v;
      ul.appendChild(li);
    });
    wrapper.appendChild(ul);
    return wrapper;
  };

  detailModalBody.appendChild(listBlock("Maps", mfItem.sources?.maps));
  detailModalBody.appendChild(listBlock("Biomes", mfItem.sources?.biomes));
  detailModalBody.appendChild(listBlock("Vendors", mfItem.sources?.traders));
  detailModalBody.appendChild(listBlock("Enemies", mfItem.sources?.enemies));

  openModal(detailModal);
}

/* Data loading */
async function loadForUser(user) {
  currentUser = user;
  signInButton.hidden = true;
  userInfo.hidden = false;
  userNameEl.textContent = user.displayName || user.email || "User";

  try {
    const meta = await getMetaStatus();
    setSyncStatus(meta);
  } catch (err) {
    console.error("Error loading metaStatus:", err);
  }

  subscribeToLists();
}

function subscribeToLists() {
  listsUnsub?.();
  listsUnsub = listenToUserLists(currentUser.uid, (lists) => {
    currentLists = lists;
    renderLists(currentLists);
    if (!currentListId && lists.length) {
      loadList(lists[0].id);
    } else if (currentListId && !lists.find((l) => l.id === currentListId)) {
      currentListId = null;
      activeListTbody.innerHTML = "";
      emptyActiveList.hidden = false;
    }
  });
}

function subscribeToItems(listId) {
  itemsUnsub?.();
  itemsUnsub = listenToListItems(listId, currentUser.uid, async (items) => {
    const enriched = await enrichItemsWithCanonical(items);
    enriched.forEach((i) => {
      if (i.mfItem) mfItemCache[i.canonicalItemId] = i.mfItem;
    });
    currentListItems = enriched;
    renderActiveListHeader(currentListItems);
    renderListItems(currentListItems);
  });
}

async function loadList(listId) {
  if (!currentUser) return;
  currentListId = listId;
  document.querySelectorAll(".list-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset?.listId === listId);
  });
  subscribeToItems(listId);
}

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
  emptyActiveList.hidden = true;
  statusSummary.textContent = "";
  intelEmptyState.hidden = false;
  itemDetailSection.hidden = true;
  listsUnsub?.();
  itemsUnsub?.();
  closeModal(addItemModal);
  closeModal(detailModal);
}

/* Events */
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

newListButton?.addEventListener("click", async () => {
  if (!currentUser) return;
  const name = prompt("Name your crafting list:");
  if (name === null) return;
  await createList(name, currentUser.uid);
});

renameListButton?.addEventListener("click", async () => {
  if (!currentUser || !currentListId) return;
  const current = currentLists.find((l) => l.id === currentListId);
  const name = prompt("Rename list:", current?.name || "");
  if (name === null) return;
  await renameList(currentListId, currentUser.uid, name);
});

deleteListButton?.addEventListener("click", () => {
  if (!currentListId) return;
  confirmDeleteList(currentListId);
});

function confirmDeleteList(listId) {
  if (!currentUser) return;
  const ok = confirm(
    "Delete this list? This will remove the list and all of its items from your view. Canonical MetaForge data will not be affected."
  );
  if (!ok) return;
  deleteListWithItems(listId, currentUser.uid);
  if (currentListId === listId) {
    currentListId = null;
    activeListTbody.innerHTML = "";
    activeListTitle.textContent = "";
    activeListMeta.textContent = "";
    emptyActiveList.hidden = false;
  }
}

addItemButton?.addEventListener("click", () => openAddItemModal());
closeAddModal?.addEventListener("click", () => closeModal(addItemModal));
closeDetailModal?.addEventListener("click", () => closeModal(detailModal));
modalBackdrop?.addEventListener("click", () => {
  closeModal(addItemModal);
  closeModal(detailModal);
});

addItemSearchInput?.addEventListener("input", () => {
  const term = addItemSearchInput.value.trim();
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    if (!term) {
      addItemSearchResults.textContent = "Type to search MetaForge items.";
      return;
    }
    const results = await searchItemsByNamePrefix(term, 20);
    renderSearchResults(results || []);
  }, 250);
});

function renderSearchResults(results) {
  addItemSearchResults.innerHTML = "";
  if (!results.length) {
    addItemSearchResults.textContent = "No results found.";
    return;
  }

  results.forEach((res) => {
    const div = document.createElement("div");
    div.classList.add("search-result");
    const info = document.createElement("div");
    info.innerHTML = `<strong>${res.name}</strong><div class="meta">${
      res.rarity || ""
    } • ${res.type || res.itemType || ""}</div>`;
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "ADD";
    addBtn.addEventListener("click", async () => {
      if (currentListItems.find((i) => i.canonicalItemId === res.id)) {
        setStatus("Item already in list.");
        closeModal(addItemModal);
        return;
      }
      await addCanonicalItemToList(currentListId, currentUser.uid, res.id);
      setStatus("Item added from MetaForge.");
      closeModal(addItemModal);
    });
    div.appendChild(info);
    div.appendChild(addBtn);
    addItemSearchResults.appendChild(div);
  });
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
