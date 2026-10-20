/* Three Plates: on-device storage.
 *
 * A small document store with the shape the app expects
 * (doc / collection, get / set / update / delete, onSnapshot),
 * backed by IndexedDB in the visitor's own browser. Nothing is sent to a server unless the
 * user turns on family sync (sync.js), which hooks in through _onLocalWrite and _applyRemote.
 *
 * - Every document lives in memory for instant reads and is written through to IndexedDB.
 * - Other open tabs of the app hear about changes over a BroadcastChannel.
 * - If IndexedDB is unavailable (some private-browsing modes), the store still works
 *   in memory and reports `persistent: false` so the app can warn the user.
 */
(function () {
  "use strict";

  const DB_NAME = "three-plates";
  const STORE = "docs";
  const CHANNEL = "three-plates-sync";
  const BACKUP_APP = "three-plates";
  const BACKUP_VERSION = 1;

  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const META = Object.freeze({ fromCache: false, hasPendingWrites: false });

  function storeError(e) {
    if (e && e.name === "QuotaExceededError") return { code: "quota_exceeded", message: "This device is out of storage space for the app." };
    return { code: "unavailable", message: (e && e.message) || "Storage is unavailable." };
  }

  /* ---------- IndexedDB helpers ---------- */
  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("IndexedDB is not supported")); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Storage is blocked by another tab"));
    });
  }

  function readAll(idb) {
    return new Promise((resolve, reject) => {
      const docs = new Map();
      const req = idb.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { docs.set(String(cur.key), cur.value); cur.continue(); } else resolve(docs);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /* Write a batch of [path, value] pairs in one transaction; value undefined deletes. */
  function writeMany(idb, pairs, clearFirst) {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      if (clearFirst) st.clear();
      for (const [p, v] of pairs) { if (v === undefined) st.delete(p); else st.put(v, p); }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(storeError(tx.error));
      tx.onabort = () => reject(storeError(tx.error));
    });
  }

  /* ---------- the store ---------- */
  function createStore(docs, persist) {
    const docSubs = new Map(), colSubs = new Map();
    let localListener = null;
    const colOf = (p) => p.split("/").slice(0, -1).join("/");

    const snapDoc = (p) => {
      const exists = docs.has(p);
      return { id: p.split("/").pop(), exists, data: () => (exists ? clone(docs.get(p)) : undefined), metadata: META };
    };
    const snapCol = (cp) => {
      const list = [...docs.keys()].filter((p) => colOf(p) === cp).sort().map(snapDoc);
      return { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: META };
    };
    const notify = (p) => {
      (docSubs.get(p) || new Set()).forEach((fn) => fn(snapDoc(p)));
      const cp = colOf(p);
      (colSubs.get(cp) || new Set()).forEach((fn) => fn(snapCol(cp)));
    };
    const subscribe = (map, key, fn, snap) => {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(fn);
      queueMicrotask(() => fn(snap()));
      return () => { const s = map.get(key); if (s) s.delete(fn); };
    };

    function checkPath(p, even) {
      const segs = String(p).split("/");
      if (segs.some((s) => !s || !/^[A-Za-z0-9_\-.~:@+]+$/.test(s) || s === "." || s === "..")) throw new TypeError("Bad path: " + p);
      if ((segs.length % 2 === 0) !== even) throw new TypeError((even ? "Document" : "Collection") + " path has the wrong number of segments: " + p);
    }

    /* remote: the change came from family sync, so don't queue it to be sent back. */
    async function commit(pairs, remote) {
      for (const [p, v] of pairs) { if (v === undefined) docs.delete(p); else docs.set(p, v); }
      queueMicrotask(() => pairs.forEach(([p]) => notify(p)));
      if (!remote && localListener) localListener(pairs.map(([p]) => p));
      if (persist) await persist(pairs);
    }

    function docRef(p) {
      checkPath(p, true);
      return {
        id: p.split("/").pop(),
        path: p,
        get: async () => snapDoc(p),
        set: async (data) => {
          if (!data || typeof data !== "object" || Array.isArray(data)) throw { code: "invalid_argument", message: "Documents must be objects." };
          await commit([[p, clone(data)]]);
        },
        update: async (data) => {
          if (!data || typeof data !== "object" || Array.isArray(data)) throw { code: "invalid_argument", message: "Updates must be objects." };
          await commit([[p, Object.assign({}, docs.get(p) || {}, clone(data))]]);
        },
        delete: async () => { if (docs.has(p)) await commit([[p, undefined]]); },
        onSnapshot: (next) => subscribe(docSubs, p, next, () => snapDoc(p)),
        collection: (sub) => colRef(p + "/" + sub),
      };
    }

    function colRef(cp) {
      checkPath(cp, false);
      const newId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return {
        path: cp,
        doc: (id) => docRef(cp + "/" + (id || newId())),
        add: async (data) => { const r = docRef(cp + "/" + newId()); await r.set(data); return r; },
        get: async () => snapCol(cp),
        onSnapshot: (next) => subscribe(colSubs, cp, next, () => snapCol(cp)),
      };
    }

    return {
      doc: docRef,
      collection: colRef,
      /* for backups and other tabs */
      _entries: () => [...docs.entries()].map(([p, v]) => [p, clone(v)]),
      _apply: (pairs) => { for (const [p, v] of pairs) { if (v === undefined) docs.delete(p); else docs.set(p, v); } pairs.forEach(([p]) => notify(p)); },
      _replaceAll: async (entries) => {
        const pairs = [...docs.keys()].filter((p) => !entries.has(p)).map((p) => [p, undefined]).concat([...entries.entries()]);
        await commit(pairs);
      },
      /* for family sync */
      _get: (p) => clone(docs.get(p)),
      _onLocalWrite: (fn) => { localListener = fn; },
      _applyRemote: (pairs) => commit(pairs.map(([p, v]) => [p, clone(v)]), true),
    };
  }

  /* ---------- public API ---------- */
  async function open() {
    try {
      const idb = await openIDB();
      const docs = await readAll(idb);
      const bc = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;
      const store = createStore(docs, async (pairs) => {
        await writeMany(idb, pairs, false);
        if (bc) bc.postMessage(pairs.map(([p, v]) => [p, v === undefined ? null : v]));
      });
      if (bc) bc.onmessage = (e) => { if (Array.isArray(e.data)) store._apply(e.data.map(([p, v]) => [p, v === null ? undefined : v])); };
      return { store, persistent: true };
    } catch (e) {
      console.warn("Three Plates: saving is unavailable in this browser", e);
      return { store: createStore(new Map(), null), persistent: false, error: e };
    }
  }

  function exportData(store) {
    return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), docs: Object.fromEntries(store._entries()) };
  }

  /* Validate a parsed backup file. Returns a Map of path -> doc, or throws a friendly message. */
  function readBackup(data) {
    if (!data || data.app !== BACKUP_APP || typeof data.docs !== "object" || !data.docs) throw new Error("That file isn't a Three Plates backup.");
    if (Number(data.version) > BACKUP_VERSION) throw new Error("That backup is from a newer version of Three Plates. Reload the app and try again.");
    const out = new Map();
    for (const [p, v] of Object.entries(data.docs)) {
      const segs = p.split("/");
      if (segs.length % 2 !== 0 || segs.some((s) => !/^[A-Za-z0-9_\-.~:@+]+$/.test(s))) continue;
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      out.set(p, v);
    }
    return out;
  }

  async function importData(store, entries) { await store._replaceAll(entries); }

  async function requestPersistence() {
    try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
  }
  async function isPersisted() {
    try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch { return false; }
  }

  window.TPStore = { open, exportData, readBackup, importData, requestPersistence, isPersisted };
})();
