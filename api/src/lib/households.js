/* Households: who shares a plan.
 *
 * A household's "meta" item lives in its own partition next to its synced documents, and holds the
 * member list, the owner and today's usage counters. Changes to it use optimistic concurrency (etags),
 * so two people joining at once can't overwrite each other.
 */
const crypto = require("node:crypto");
const { HttpError } = require("./http");
const { db, readItem, batch } = require("./db");

const META = "meta";
const MAX_MEMBERS = 12;
const INVITE_USES = 10;
const INVITE_DAYS = 7;          // matches the invites container's default TTL
const INVITES_PER_DAY = 30;
const PURGE_BUDGET_MS = 20000;  // stay well inside the managed-functions request timeout
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L

const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const today = () => new Date().toISOString().slice(0, 10);
const defaultName = (user) => clean(user.details.split("@")[0], 30) || "Me";

/* Today's usage counters, reset at midnight UTC. */
function usageOf(meta) {
  const day = today();
  return meta.usage && meta.usage.day === day ? meta.usage : { day, writes: 0, invites: 0 };
}

function summary(meta, userId) {
  return {
    id: meta.householdId,
    name: meta.name,
    role: meta.ownerId === userId ? "owner" : "member",
    members: meta.members.map((m) => ({ id: m.id, name: m.name, role: m.role, you: m.id === userId })),
  };
}

const getUser = (user) => readItem(db().users, user.id, user.id);
const getMeta = (householdId) => readItem(db().households, META, householdId);

/* Read-modify-write on a household's meta item. `change` edits the item and returns it,
 * returns null to leave it alone, or throws an HttpError. Retries when someone else wrote first. */
async function updateMeta(householdId, change) {
  const c = db().households;
  for (let i = 0; i < 5; i++) {
    const meta = await getMeta(householdId);
    if (!meta) throw new HttpError(404, "no_household", "That household no longer exists.");
    const next = change(meta);
    if (!next) return meta;
    try {
      const { resource } = await c.item(META, householdId).replace(next, { accessCondition: { type: "IfMatch", condition: meta._etag } });
      return resource;
    } catch (e) {
      if (!e || e.code !== 412) throw e;
    }
  }
  throw new HttpError(409, "busy", "Someone else changed the household at the same time. Try again.");
}

/* The caller's user record and household, or a 403 when they aren't in one. */
async function membership(user) {
  const u = await getUser(user);
  const meta = u && u.householdId ? await getMeta(u.householdId) : null;
  if (!meta || !meta.members.some((m) => m.id === user.id)) {
    throw new HttpError(403, "no_household", "You're not in a household.");
  }
  return { u, meta };
}

async function saveUser(user, u, patch) {
  const now = Date.now();
  const body = Object.assign({ id: user.id, name: defaultName(user), provider: user.provider, createdAt: now }, u || {}, patch, { updatedAt: now });
  delete body._rid; delete body._self; delete body._etag; delete body._attachments; delete body._ts;
  await db().users.items.upsert(body);
  return body;
}

/* Delete a household's synced documents, then its meta item. Works in bounded slices so a big
 * household can't time out the request; returns false when there's more to do. */
async function purge(householdId) {
  const c = db().households;
  const deadline = Date.now() + PURGE_BUDGET_MS;
  while (Date.now() < deadline) {
    const { resources } = await c.items
      .query({ query: "SELECT TOP 100 c.id FROM c WHERE c.id != @meta", parameters: [{ name: "@meta", value: META }] }, { partitionKey: householdId })
      .fetchNext();
    if (!resources || !resources.length) {
      try { await c.item(META, householdId).delete(); } catch (e) { if (!e || e.code !== 404) throw e; }
      return true;
    }
    await batch(c, householdId, resources.map((r) => ({ operationType: "Delete", id: r.id })));
  }
  return false;
}

/* Finish a purge left over from an earlier request, if any. */
async function continuePurge(user, u) {
  if (!u || !u.purging) return true;
  const done = await purge(u.purging);
  if (done) await saveUser(user, u, { purging: null });
  return done;
}

/* ---------- endpoints ---------- */

async function me(user) {
  let u = await getUser(user);
  await continuePurge(user, u);
  let household = null;
  if (u && u.householdId) {
    const meta = await getMeta(u.householdId);
    if (meta && meta.members.some((m) => m.id === user.id)) household = summary(meta, user.id);
    else u = await saveUser(user, u, { householdId: null }); // removed by the owner, or the household is gone
  }
  return { user: { name: (u && u.name) || defaultName(user), provider: user.provider }, household };
}

async function create(user, body) {
  const u = await getUser(user);
  if (u && u.householdId) throw new HttpError(409, "already_member", "Leave your current household first.");
  const name = clean(body.displayName, 30) || (u && u.name) || defaultName(user);
  const householdId = crypto.randomUUID();
  const now = Date.now();
  const meta = {
    id: META,
    householdId,
    type: "household",
    name: clean(body.name, 40) || "Our kitchen",
    ownerId: user.id,
    members: [{ id: user.id, name, role: "owner", joinedAt: now }],
    usage: { day: today(), writes: 0, invites: 0 },
    createdAt: now,
  };
  await db().households.items.create(meta);
  await saveUser(user, u, { householdId, name });
  return summary(meta, user.id);
}

async function invite(user) {
  const { meta } = await membership(user);
  await updateMeta(meta.householdId, (m) => {
    const usage = usageOf(m);
    if (usage.invites >= INVITES_PER_DAY) throw new HttpError(429, "quota", "That's a lot of invites for one day. Try again tomorrow.");
    usage.invites++;
    m.usage = usage;
    return m;
  });
  const code = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
  await db().invites.items.create({ id: code, householdId: meta.householdId, createdBy: user.id, uses: 0, maxUses: INVITE_USES, createdAt: Date.now() });
  return { code, expiresAt: Date.now() + INVITE_DAYS * 864e5, maxUses: INVITE_USES };
}

async function join(user, body) {
  const code = clean(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const inv = code.length === 8 ? await readItem(db().invites, code, code) : null;
  if (!inv) throw new HttpError(404, "bad_code", "That invite code isn't valid or has expired.");

  const u = await getUser(user);
  if (u && u.householdId && u.householdId !== inv.householdId) throw new HttpError(409, "already_member", "Leave your current household first.");
  if (!(u && u.householdId === inv.householdId) && inv.uses >= inv.maxUses) throw new HttpError(410, "code_used", "That invite code has been used up. Ask for a new one.");

  const name = clean(body.displayName, 30) || (u && u.name) || defaultName(user);
  let added = false;
  const meta = await updateMeta(inv.householdId, (m) => {
    if (m.purging) throw new HttpError(404, "no_household", "That household no longer exists.");
    if (m.members.some((x) => x.id === user.id)) return null;
    if (m.members.length >= MAX_MEMBERS) throw new HttpError(409, "full", "That household is full.");
    m.members.push({ id: user.id, name, role: "member", joinedAt: Date.now() });
    added = true;
    return m;
  });
  if (added) {
    try { await db().invites.item(code, code).patch([{ op: "incr", path: "/uses", value: 1 }]); } catch { /* best effort */ }
  }
  await saveUser(user, u, { householdId: inv.householdId, name });
  return summary(meta, user.id);
}

/* Leave the household. The last one out deletes it. Safe to call again until it returns done. */
async function leave(user) {
  const u = await getUser(user);
  if (!(await continuePurge(user, u))) return { done: false };
  if (!u || !u.householdId) return { done: true };

  const householdId = u.householdId;
  let empty = false;
  try {
    await updateMeta(householdId, (m) => {
      if (!m.members.some((x) => x.id === user.id)) return null;
      m.members = m.members.filter((x) => x.id !== user.id);
      if (m.ownerId === user.id && m.members.length) {
        // Hand the household to whoever has been in it longest.
        m.members.sort((a, b) => a.joinedAt - b.joinedAt);
        m.members[0].role = "owner";
        m.ownerId = m.members[0].id;
      }
      if (!m.members.length) m.purging = true;
      empty = !m.members.length;
      return m;
    });
  } catch (e) {
    if (!(e instanceof HttpError && e.code === "no_household")) throw e;
  }
  const after = await saveUser(user, u, { householdId: null, purging: empty ? householdId : null });
  return { done: await continuePurge(user, after) };
}

async function removeMember(user, memberId) {
  const { meta } = await membership(user);
  if (meta.ownerId !== user.id) throw new HttpError(403, "not_owner", "Only the household's owner can remove people.");
  if (memberId === user.id) throw new HttpError(400, "self", "Use Leave household to remove yourself.");
  const next = await updateMeta(meta.householdId, (m) => {
    if (!m.members.some((x) => x.id === memberId)) return null;
    m.members = m.members.filter((x) => x.id !== memberId);
    return m;
  });
  const other = await readItem(db().users, memberId, memberId);
  if (other && other.householdId === meta.householdId) {
    await saveUser({ id: memberId, provider: other.provider, details: "" }, other, { householdId: null });
  }
  return summary(next, user.id);
}

/* Leave (deleting the household if last), then delete the user record. Repeat until done. */
async function deleteMe(user) {
  const r = await leave(user);
  if (!r.done) return r;
  try { await db().users.item(user.id, user.id).delete(); } catch (e) { if (!e || e.code !== 404) throw e; }
  return { done: true };
}

module.exports = { me, create, invite, join, leave, removeMember, deleteMe, membership, updateMeta, usageOf, summary };
