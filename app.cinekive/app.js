/**
 * Cinekive Archive — static public read-only inspiration gallery.
 * Lists live in IndexedDB on this device only. No uploads, no accounts, no sync.
 */
(function () {
  "use strict";

  var DB_NAME = "cinekive-public-archive";
  var DB_VERSION = 2;
  var STORE_LISTS = "lists";
  var STORE_SAVED_LEGACY = "saved";
  var FAVORITES_ID = "favorites";

  var frames = [];
  var lists = [];
  var ratioFilter = "all";
  var listFilter = "all"; // all | list id
  var query = "";
  var deferredInstall = null;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function uid() {
    return "list-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove("show");
    }, 3600);
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE_LISTS)) {
          db.createObjectStore(STORE_LISTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_SAVED_LEGACY)) {
          // keep legacy store name available for one-time migrate reads if it already exists
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function migrateLegacySaved(db) {
    if (!db.objectStoreNames.contains(STORE_SAVED_LEGACY)) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction([STORE_SAVED_LEGACY, STORE_LISTS], "readwrite");
        var legacy = tx.objectStore(STORE_SAVED_LEGACY);
        var listsStore = tx.objectStore(STORE_LISTS);
        var getFav = listsStore.get(FAVORITES_ID);
        getFav.onsuccess = function () {
          var fav = getFav.result;
          var getAll = legacy.getAll();
          getAll.onsuccess = function () {
            var ids = (getAll.result || []).map(function (r) {
              return String(r.id);
            });
            if (!ids.length) return;
            if (!fav) {
              listsStore.put({
                id: FAVORITES_ID,
                name: "Favorites",
                frameIds: ids,
                updatedAt: Date.now(),
              });
            } else if (!fav.frameIds || !fav.frameIds.length) {
              fav.frameIds = ids;
              fav.updatedAt = Date.now();
              listsStore.put(fav);
            }
            // clear legacy after merge
            legacy.clear();
          };
        };
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          resolve();
        };
      } catch (err) {
        console.warn("[Cinekive Archive] legacy migrate skipped:", err);
        resolve();
      }
    });
  }

  function ensureFavorites(db) {
    return migrateLegacySaved(db).then(function () {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_LISTS, "readwrite");
        var store = tx.objectStore(STORE_LISTS);
        var get = store.get(FAVORITES_ID);
        get.onsuccess = function () {
          if (!get.result) {
            store.put({
              id: FAVORITES_ID,
              name: "Favorites",
              frameIds: [],
              updatedAt: Date.now(),
            });
          }
        };
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function loadLists() {
    return openDb().then(function (db) {
      return ensureFavorites(db).then(function () {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE_LISTS, "readonly");
          var req = tx.objectStore(STORE_LISTS).getAll();
          req.onsuccess = function () {
            lists = (req.result || []).map(normalizeList);
            lists.sort(function (a, b) {
              if (a.id === FAVORITES_ID) return -1;
              if (b.id === FAVORITES_ID) return 1;
              return a.name.localeCompare(b.name);
            });
            resolve(lists);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      });
    });
  }

  function normalizeList(raw) {
    return {
      id: String(raw.id),
      name: String(raw.name || "Untitled"),
      frameIds: Array.isArray(raw.frameIds)
        ? raw.frameIds.map(function (id) {
            return String(id);
          })
        : [],
      updatedAt: raw.updatedAt || Date.now(),
    };
  }

  function putList(list) {
    list = normalizeList(list);
    list.updatedAt = Date.now();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_LISTS, "readwrite");
        tx.objectStore(STORE_LISTS).put(list);
        tx.oncomplete = function () {
          var idx = lists.findIndex(function (l) {
            return l.id === list.id;
          });
          if (idx >= 0) lists[idx] = list;
          else lists.push(list);
          lists.sort(function (a, b) {
            if (a.id === FAVORITES_ID) return -1;
            if (b.id === FAVORITES_ID) return 1;
            return a.name.localeCompare(b.name);
          });
          resolve(list);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function deleteList(id) {
    if (id === FAVORITES_ID) {
      return Promise.reject(new Error("Favorites cannot be deleted."));
    }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_LISTS, "readwrite");
        tx.objectStore(STORE_LISTS).delete(id);
        tx.oncomplete = function () {
          lists = lists.filter(function (l) {
            return l.id !== id;
          });
          if (listFilter === id) listFilter = "all";
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function getList(id) {
    return lists.find(function (l) {
      return l.id === id;
    });
  }

  function activeListIdForToggle() {
    if (listFilter !== "all") return listFilter;
    return FAVORITES_ID;
  }

  function listHasFrame(listId, frameId) {
    var list = getList(listId);
    return Boolean(list && list.frameIds.indexOf(frameId) >= 0);
  }

  function toggleFrameInList(listId, frameId) {
    var list = getList(listId);
    if (!list) return Promise.reject(new Error("List not found."));
    var next = list.frameIds.slice();
    var i = next.indexOf(frameId);
    var added;
    if (i >= 0) {
      next.splice(i, 1);
      added = false;
    } else {
      next.push(frameId);
      added = true;
    }
    return putList({
      id: list.id,
      name: list.name,
      frameIds: next,
    }).then(function () {
      return added;
    });
  }

  function validateFrames(raw) {
    var list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.frames) ? raw.frames : [];
    var ok = [];
    list.forEach(function (entry) {
      var id = entry && entry.id != null ? String(entry.id) : "(missing id)";
      var source = entry && typeof entry.source === "string" ? entry.source.trim() : "";
      var license = entry && typeof entry.license === "string" ? entry.license.trim() : "";
      if (!source || !license) {
        console.warn(
          "[Cinekive Archive] Skipping frame missing source/license:",
          id,
          !source ? "(no source)" : "",
          !license ? "(no license)" : ""
        );
        return;
      }
      var tags = Array.isArray(entry.tags)
        ? entry.tags.map(function (t) {
            return String(t);
          })
        : [];
      ok.push({
        id: String(entry.id),
        src: String(entry.src || ""),
        ratio: String(entry.ratio || "16:9"),
        title: String(entry.title || ""),
        tags: tags,
        source: source,
        license: license,
      });
    });
    return ok;
  }

  function loadFrames() {
    return fetch("./frames.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not load frames.json (" + r.status + ")");
        return r.json();
      })
      .then(function (data) {
        frames = validateFrames(data);
        return frames;
      });
  }

  function matches(frame) {
    if (listFilter !== "all") {
      if (!listHasFrame(listFilter, frame.id)) return false;
    }
    if (ratioFilter !== "all" && frame.ratio !== ratioFilter) return false;
    var q = query.trim().toLowerCase();
    if (!q) return true;
    var hay = frame.tags.join(" ").toLowerCase();
    if (frame.title) hay += " " + frame.title.toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderListFilters() {
    var root = $("#list-filters");
    if (!root) return;
    root.textContent = "";

    function addChip(id, label) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (listFilter === id ? " active" : "");
      btn.setAttribute("data-list", id);
      btn.setAttribute("aria-pressed", listFilter === id ? "true" : "false");
      btn.textContent = label;
      root.appendChild(btn);
    }

    addChip("all", "All frames");
    lists.forEach(function (l) {
      addChip(l.id, l.name + " (" + l.frameIds.length + ")");
    });
  }

  function renderManageSelect() {
    var sel = $("#list-manage");
    if (!sel) return;
    var current = sel.value;
    sel.textContent = "";
    lists.forEach(function (l) {
      var opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.name + (l.id === FAVORITES_ID ? " (default)" : "");
      sel.appendChild(opt);
    });
    if (current && getList(current)) sel.value = current;
  }

  function render() {
    var grid = $("#grid");
    var countEl = $("#count");
    if (!grid) return;
    grid.textContent = "";
    renderListFilters();
    renderManageSelect();

    var visible = frames.filter(matches);
    if (countEl) {
      countEl.textContent =
        visible.length +
        " still" +
        (visible.length === 1 ? "" : "s") +
        (frames.length !== visible.length ? " · " + frames.length + " in catalog" : "");
    }

    if (!visible.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent =
        listFilter !== "all"
          ? "This list is empty. Open a card and tap Add."
          : "No stills match your filters.";
      grid.appendChild(empty);
      return;
    }

    var toggleListId = activeListIdForToggle();
    var toggleList = getList(toggleListId);

    visible.forEach(function (frame) {
      var article = document.createElement("article");
      article.className = "card";
      article.setAttribute("data-ratio", frame.ratio);
      article.tabIndex = 0;

      var ratioTag = document.createElement("span");
      ratioTag.className = "card-tag";
      ratioTag.textContent = frame.ratio;

      var sourceTag = document.createElement("span");
      sourceTag.className = "card-source";
      sourceTag.title = frame.source;
      sourceTag.textContent = frame.source;

      var reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "card-reveal";
      reveal.textContent = "Tags";
      reveal.setAttribute("aria-expanded", "false");
      reveal.addEventListener("click", function (e) {
        e.stopPropagation();
        var on = article.classList.toggle("revealed");
        reveal.setAttribute("aria-expanded", on ? "true" : "false");
      });

      var inList = listHasFrame(toggleListId, frame.id);
      var saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "card-save" + (inList ? " saved" : "");
      saveBtn.textContent = inList ? "In list" : "Add";
      saveBtn.setAttribute(
        "aria-label",
        (inList ? "Remove from " : "Add to ") + (toggleList ? toggleList.name : "list")
      );
      saveBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleFrameInList(toggleListId, frame.id)
          .then(function (added) {
            toast(
              added
                ? "Added to " + (toggleList ? toggleList.name : "list") + " (this browser only)."
                : "Removed from " + (toggleList ? toggleList.name : "list") + "."
            );
            render();
          })
          .catch(function (err) {
            toast(err.message || "Could not update list.");
          });
      });

      var img = document.createElement("img");
      img.src = frame.src;
      img.alt = (frame.title || "Still") + " — archive reference, AI-tagged";
      img.loading = "lazy";
      img.width = 900;
      img.height = 500;

      var overlay = document.createElement("div");
      overlay.className = "card-overlay";

      if (frame.title) {
        var title = document.createElement("h3");
        title.textContent = frame.title;
        overlay.appendChild(title);
      }

      var sourceLine = document.createElement("p");
      sourceLine.className = "source-line";
      sourceLine.textContent = "Source: " + frame.source;
      overlay.appendChild(sourceLine);

      var licenseLine = document.createElement("p");
      licenseLine.className = "license-line";
      licenseLine.textContent = frame.license;
      overlay.appendChild(licenseLine);

      var tagList = document.createElement("div");
      tagList.className = "tag-list";
      if (frame.tags.length) {
        frame.tags.forEach(function (t) {
          var chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = t;
          tagList.appendChild(chip);
        });
      } else {
        var none = document.createElement("span");
        none.className = "tag-chip";
        none.textContent = "Untagged";
        tagList.appendChild(none);
      }
      overlay.appendChild(tagList);

      article.appendChild(ratioTag);
      article.appendChild(sourceTag);
      article.appendChild(reveal);
      article.appendChild(saveBtn);
      article.appendChild(img);
      article.appendChild(overlay);
      grid.appendChild(article);
    });
  }

  function exportLists() {
    var payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: "cinekive-archive",
      lists: lists.map(function (l) {
        return {
          id: l.id,
          name: l.name,
          frameIds: l.frameIds.slice(),
        };
      }),
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "cinekive-archive-lists.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Lists exported. Import on another device to restore.");
  }

  function importLists(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result || ""));
          var incoming = Array.isArray(data) ? data : data && data.lists;
          if (!Array.isArray(incoming)) throw new Error("Invalid lists file.");
          var chain = Promise.resolve();
          incoming.forEach(function (raw) {
            if (!raw || !raw.name) return;
            var id = raw.id === FAVORITES_ID ? FAVORITES_ID : String(raw.id || uid());
            var existing = getList(id);
            var frameIds = Array.isArray(raw.frameIds)
              ? raw.frameIds.map(String)
              : [];
            if (existing && id !== FAVORITES_ID) {
              // merge by renaming collision ids
              id = uid();
            }
            if (id === FAVORITES_ID && existing) {
              var merged = Array.from(new Set(existing.frameIds.concat(frameIds)));
              chain = chain.then(function () {
                return putList({ id: FAVORITES_ID, name: "Favorites", frameIds: merged });
              });
            } else {
              chain = chain.then(function () {
                return putList({
                  id: id,
                  name: String(raw.name),
                  frameIds: frameIds,
                });
              });
            }
          });
          chain.then(resolve).catch(reject);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  }

  function bindUI() {
    var search = $("#search");
    if (search) {
      search.addEventListener("input", function () {
        query = search.value || "";
        render();
      });
    }

    var ratios = $("#ratio-filters");
    if (ratios) {
      ratios.addEventListener("click", function (e) {
        var t = e.target.closest("[data-filter]");
        if (!t) return;
        ratioFilter = t.getAttribute("data-filter");
        ratios.querySelectorAll(".chip").forEach(function (c) {
          var on = c.getAttribute("data-filter") === ratioFilter;
          c.classList.toggle("active", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        render();
      });
    }

    var listFilters = $("#list-filters");
    if (listFilters) {
      listFilters.addEventListener("click", function (e) {
        var t = e.target.closest("[data-list]");
        if (!t) return;
        listFilter = t.getAttribute("data-list");
        render();
      });
    }

    var panel = $("#lists-panel");
    var toggle = $("#btn-lists");
    if (toggle && panel) {
      toggle.addEventListener("click", function () {
        var open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    var createBtn = $("#btn-create-list");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        var nameEl = $("#list-name");
        var name = ((nameEl && nameEl.value) || "").trim();
        if (!name) {
          toast("Enter a list name.");
          return;
        }
        putList({ id: uid(), name: name, frameIds: [] })
          .then(function (list) {
            if (nameEl) nameEl.value = "";
            listFilter = list.id;
            toast("Created “" + list.name + "” on this device.");
            render();
          })
          .catch(function () {
            toast("Could not create list.");
          });
      });
    }

    var renameBtn = $("#btn-rename-list");
    if (renameBtn) {
      renameBtn.addEventListener("click", function () {
        var sel = $("#list-manage");
        var list = sel && getList(sel.value);
        if (!list) return;
        var next = window.prompt("Rename list", list.name);
        if (next == null) return;
        next = String(next).trim();
        if (!next) {
          toast("Name cannot be empty.");
          return;
        }
        putList({ id: list.id, name: next, frameIds: list.frameIds })
          .then(function () {
            toast("Renamed.");
            render();
          })
          .catch(function () {
            toast("Could not rename.");
          });
      });
    }

    var deleteBtn = $("#btn-delete-list");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function () {
        var sel = $("#list-manage");
        var id = sel && sel.value;
        if (!id) return;
        if (id === FAVORITES_ID) {
          toast("Favorites is the default list and cannot be deleted.");
          return;
        }
        var list = getList(id);
        if (!list) return;
        if (!window.confirm('Delete list “' + list.name + '”? Frames stay in the catalog.')) return;
        deleteList(id)
          .then(function () {
            toast("List deleted (local only).");
            render();
          })
          .catch(function (err) {
            toast(err.message || "Could not delete.");
          });
      });
    }

    var exportBtn = $("#btn-export");
    if (exportBtn) exportBtn.addEventListener("click", exportLists);

    var importInput = $("#import-file");
    if (importInput) {
      importInput.addEventListener("change", function () {
        var file = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!file) return;
        importLists(file)
          .then(function () {
            toast("Lists imported into this browser.");
            return loadLists();
          })
          .then(function () {
            render();
          })
          .catch(function (err) {
            toast(err.message || "Import failed.");
          });
      });
    }

    var installBtn = $("#btn-install");
    if (installBtn) {
      window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferredInstall = e;
        installBtn.hidden = false;
      });
      installBtn.addEventListener("click", function () {
        if (!deferredInstall) {
          toast("Use your browser Install / Add to Home Screen menu.");
          return;
        }
        deferredInstall.prompt();
        deferredInstall.userChoice.finally(function () {
          deferredInstall = null;
          installBtn.hidden = true;
        });
      });
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch(function (err) {
      console.warn("[Cinekive Archive] SW register failed:", err);
    });
  }

  function boot() {
    bindUI();
    registerServiceWorker();
    Promise.all([
      loadFrames(),
      loadLists().catch(function () {
        lists = [{ id: FAVORITES_ID, name: "Favorites", frameIds: [], updatedAt: Date.now() }];
        return lists;
      }),
    ])
      .then(function () {
        render();
      })
      .catch(function (err) {
        console.error(err);
        toast(err.message || "Failed to load archive.");
        var grid = $("#grid");
        if (grid) {
          grid.textContent = "";
          var p = document.createElement("p");
          p.className = "empty";
          p.textContent = "Could not load the archive. Serve this folder over http(s).";
          grid.appendChild(p);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
