/* Three Plates: optional family sync.
 *
 * Signed-in users can share one plan with their household through this site's API (/api/*),
 * which stores it in Azure Cosmos DB. The on-device store stays the source of truth for the UI,
 * so the app keeps working offline:
 *
 * - Local writes are queued in an outbox (localStorage, shared by open tabs) and pushed in batches.
 * - Remote changes are pulled with a cursor every 30 seconds while the app is visible,
 *   and when it regains focus or comes back online.
 * - Conflicts resolve last-write-wins per document. A pull never overwrites a document
 *   that still has a local change waiting to be sent.
 * - Without sign-in nothing here talks to the server, and nothing leaves the device.
 */
(function () {
  "use strict";

  const KEY = "three-plates-sync";       // { householdId, cursor, household }
  const OUTBOX = "three-plates-outbox";  // { path: seq }
  const POLL_MS = 30000;
  const PUSH_DELAY_MS = 1500;
  const BATCH_DOCS = 100, BATCH_BYTES = 400000, MAX_DOC_BYTES = 95000;
  const SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const validPath = (p) => typeof p === "string" && p.split("/").length % 2 === 0 && p.split("/").every((s) => SEG_RE.test(s) && s !== "." && s !== "..");
  const isDoc = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  let store = null, listener = () => {};
  let saved = ls.get(KEY, {}) || {};
  let pushTimer = null, running = null, again = false, seq = 0;
  const state = {
    available: null,   // false when this site has no sign-in (local dev server, or sync not deployed)
    signedIn: false,
    user: null,        // { name, provider }
    household: null,   // { id, name, role, members: [{ id, name, role, you }] }
    needsLink: false,  // in a household, but this device isn't syncing with it yet
    status: "off",     // off | syncing | ok | offline | signed_out | paused | error
    lastSync: 0,
    error: "",
  };

  function emit() { listener(Object.assign({}, state, { pending: Object.keys(ls.get(OUTBOX, {}) || {}).length })); }
  function setState(patch) { Object.assign(state, patch); emit(); }
  function save() { ls.set(KEY, saved.householdId ? saved : null); }
  const nextSeq = () => (seq = Math.max(seq + 1, Date.now()));

  /* ---------- HTTP ---------- */
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch("/api/" + path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw { code: "offline", message: "You're offline. Changes will sync when you're back." }; }
    let data = null;
    try { data = await res.json(); } catch { /* 204 or an HTML error page */ }
    if (!res.ok) {
      throw {
        code: (data && data.error) || (res.status === 401 ? "signed_out" : "http_" + res.status),
        status: res.status,
        message: (data && data.message) || "The sync server returned an error (" + res.status + ").",
      };
    }
    return data;
  }

  /* ---------- outbox ---------- */
  function markDirty(paths) {
    if (!saved.householdId) return;
    const box = ls.get(OUTBOX, {}) || {};
    for (const p of paths) box[p] = nextSeq();
    ls.set(OUTBOX, box);
    emit();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY_MS);
  }

  async function push() {
    for (;;) {
      const box = ls.get(OUTBOX, {}) || {};
      const paths = Object.keys(box);
      if (!paths.length) return;
      const changes = [], sent = {};
      let bytes = 0;
      for (const p of paths) {
        const data = store._get(p);
        const size = data ? JSON.stringify(data).length : 16;
        if (size > MAX_DOC_BYTES || !validPath(p)) { console.warn("Three Plates: not syncing " + p + " (too large or invalid)"); sent[p] = box[p]; continue; }
        if (changes.length && (changes.length >= BATCH_DOCS || bytes + size > BATCH_BYTES)) break;
        changes.push({ path: p, data: data === undefined ? null : data });
        sent[p] = box[p];
        bytes += size;
      }
      if (changes.length) await api("POST", "sync", { changes });
      // Drop what was sent, unless it changed again while the request was in flight.
      const now = ls.get(OUTBOX, {}) || {};
      for (const p in sent) if (now[p] === sent[p]) delete now[p];
      ls.set(OUTBOX, Object.keys(now).length ? now : null);
    }
  }

  async function pull() {
    const r = await api("GET", "sync?since=" + (Number(saved.cursor) || 0));
    if (!r || !r.household) return;
    if (r.household.id !== saved.householdId) { unlinkLocal(""); adopt(r.household); return; }
    const box = ls.get(OUTBOX, {}) || {};
    const incoming = new Set(), pairs = [];
    for (const ch of r.changes || []) {
      if (!validPath(ch.path) || box[ch.path]) continue; // a pending local edit wins
      incoming.add(ch.path);
      const data = isDoc(ch.data) ? ch.data : undefined;
      if (JSON.stringify(store._get(ch.path)) === JSON.stringify(data)) continue;
      pairs.push([ch.path, data]);
    }
    // A reset is the household's full state, so anything else on this device was deleted elsewhere.
    if (r.reset) for (const [p] of store._entries()) if (!incoming.has(p) && !box[p]) pairs.push([p, undefined]);
    if (pairs.length) await store._applyRemote(pairs);
    saved.cursor = r.cursor;
    saved.household = r.household;
    save();
    state.household = r.household;
  }

  const withLock = (fn) => (navigator.locks && navigator.locks.request ? navigator.locks.request("three-plates-sync", fn) : fn());

  async function syncNow() {
    clearTimeout(pushTimer);
    if (!saved.householdId || !state.signedIn) return;
    if (running) { again = true; return running; }
    running = (async () => {
      setState({ status: "syncing" });
      try {
        await withLock(async () => { await push(); await pull(); });
        setState({ status: "ok", lastSync: Date.now(), error: "" });
      } catch (e) { handleError(e); }
    })();
    try { await running; } finally {
      running = null;
      if (again) { again = false; pushTimer = setTimeout(syncNow, PUSH_DELAY_MS); }
    }
  }

  function handleError(e) {
    const code = e && e.code;
    if (code === "offline") setState({ status: "offline", error: "" });
    else if (code === "signed_out") setState({ signedIn: false, status: saved.householdId ? "signed_out" : "off", error: "" });
    else if (code === "no_household") unlinkLocal("You're no longer in that household. Your plan is still on this device.");
    else if (code === "not_configured") setState({ available: false, status: "off" });
    else if (code === "quota") setState({ status: "paused", error: e.message });
    else if (code === "busy") setState({ status: "offline", error: "" });
    else { console.warn("Three Plates sync", e); setState({ status: "error", error: (e && e.message) || "Sync didn't work. It will try again." }); }
  }

  /* ---------- linking this device to a household ---------- */
  function adopt(h) {
    state.household = h;
    if (!h) { if (saved.householdId) unlinkLocal("You're no longer in that household. Your plan is still on this device."); return; }
    if (saved.householdId === h.id) { saved.household = h; save(); state.needsLink = false; return; }
    if (saved.householdId) unlinkLocal("");
    state.household = h;
    state.needsLink = true;
  }

  function unlinkLocal(msg) {
    saved = {};
    ls.set(KEY, null);
    ls.set(OUTBOX, null);
    setState({ household: null, needsLink: false, status: "off", error: msg || "" });
  }

  /* mode "upload": send everything on this device (a new household).
   * mode "replace": take the household's plan; the first pull is a reset that replaces local data. */
  async function link(mode) {
    const h = state.household;
    if (!h) return;
    saved = { householdId: h.id, cursor: 0, household: h };
    save();
    if (mode === "upload") {
      const box = {};
      for (const [p] of store._entries()) box[p] = nextSeq();
      ls.set(OUTBOX, Object.keys(box).length ? box : null);
    } else ls.set(OUTBOX, null);
    setState({ needsLink: false, error: "" });
    await syncNow();
  }

  /* ---------- public API ---------- */
  async function refresh() {
    let me = null;
    try {
      const res = await fetch("/.auth/me", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("json")) { setState({ available: false }); return; }
      me = await res.json();
    } catch {
      setState({ status: saved.householdId ? "offline" : "off" });
      return;
    }
    if (!me || !me.clientPrincipal) {
      setState({ available: true, signedIn: false, user: null, status: saved.householdId ? "signed_out" : "off" });
      return;
    }
    state.available = true;
    state.signedIn = true;
    try {
      const r = await api("GET", "me");
      state.user = r.user;
      adopt(r.household);
      setState({ error: "", status: saved.householdId ? state.status : "off" });
      if (saved.householdId) await syncNow();
    } catch (e) { handleError(e); }
  }

  async function init(s, onChange) {
    store = s;
    if (onChange) listener = onChange;
    store._onLocalWrite(markDirty);
    if (saved.householdId) Object.assign(state, { household: saved.household || null, status: "offline" });
    const wake = () => { if (document.visibilityState === "visible") syncNow(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    setInterval(wake, POLL_MS);
    emit();
    await refresh();
  }

  async function create(name, displayName) {
    adopt(await api("POST", "household", { name, displayName }));
    await link("upload");
  }

  async function join(code, displayName) {
    adopt(await api("POST", "household/join", { code, displayName }));
    emit();
  }

  /* Repeats until the server says it's done (deleting a big household takes a few slices). */
  async function untilDone(fn) {
    for (let i = 0; i < 20; i++) { const r = await fn(); if (!r || r.done !== false) return; }
    throw { code: "server", message: "That's taking longer than expected. Try again in a minute." };
  }

  async function leave() {
    await untilDone(() => api("POST", "household/leave", {}));
    unlinkLocal("");
  }

  async function deleteAccount() {
    await untilDone(() => api("DELETE", "me"));
    unlinkLocal("");
  }

  async function invite() { return api("POST", "household/invites", {}); }

  async function removeMember(id) {
    const h = await api("DELETE", "household/members/" + encodeURIComponent(id));
    state.household = h;
    if (saved.householdId) { saved.household = h; save(); }
    emit();
  }

  function signIn(provider, returnHash) {
    location.assign("/.auth/login/" + provider + "?post_login_redirect_uri=" + encodeURIComponent("/" + (returnHash || "#settings")));
  }
  function signOut() {
    location.assign("/.auth/logout?post_logout_redirect_uri=" + encodeURIComponent("/#settings"));
  }

  window.TPSync = {
    init, refresh, syncNow, create, join, link, leave, deleteAccount, invite, removeMember, signIn, signOut,
    unlink: () => unlinkLocal(""),
  };
})();
