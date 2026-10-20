/* Document sync between devices in a household.
 *
 * Each app document (path like "plan/abc") is one Cosmos item in the household's partition.
 * Deletes are kept as tombstones for 45 days so other devices hear about them, then Cosmos TTL
 * removes them. Devices pull changes since a cursor (Cosmos's _ts, in seconds); a device whose
 * cursor is older than the tombstones gets a full reset instead.
 * Conflicts resolve last-write-wins per document.
 */
const { HttpError } = require("./http");
const { db, batch } = require("./db");
const { membership, updateMeta, usageOf, summary } = require("./households");

const SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;        // same rule as the app's store.js
const MAX_CHANGES = 100;
const MAX_DOC_BYTES = 100 * 1024;
const DAILY_WRITES = 5000;                      // per household, resets at midnight UTC
const TOMBSTONE_TTL = 45 * 86400;
const RESET_AFTER = 40 * 86400;
const OVERLAP = 2;                              // re-read the last 2 seconds so no same-second write is missed

const itemId = (path) => "d|" + path.split("/").join("|");

function validPath(p) {
  if (typeof p !== "string" || p.length > 200) return false;
  const segs = p.split("/");
  return segs.length % 2 === 0 && segs.length <= 6 && segs.every((s) => SEG_RE.test(s) && s !== "." && s !== "..");
}

async function pull(user, since) {
  const { meta } = await membership(user);
  const now = Math.floor(Date.now() / 1000);
  const reset = !(since > 0) || since < now - RESET_AFTER;
  const query = reset
    ? { query: "SELECT c.path, c.data, c._ts FROM c WHERE c.type = 'doc' AND c.deleted = false" }
    : {
        query: "SELECT c.path, c.data, c.deleted, c._ts FROM c WHERE c.type = 'doc' AND c._ts >= @since",
        parameters: [{ name: "@since", value: since - OVERLAP }],
      };
  const { resources } = await db().households.items.query(query, { partitionKey: meta.householdId }).fetchAll();
  let cursor = reset ? now : since;
  for (const r of resources) cursor = Math.max(cursor, r._ts);
  return {
    reset,
    cursor,
    changes: resources.map((r) => ({ path: r.path, data: r.deleted ? null : r.data })),
    household: summary(meta, user.id),
  };
}

async function push(user, body) {
  const list = body.changes;
  if (!Array.isArray(list) || list.length > MAX_CHANGES) throw new HttpError(400, "bad_changes", "Send up to " + MAX_CHANGES + " changes at a time.");

  const byPath = new Map();
  for (const ch of list) {
    if (!ch || !validPath(ch.path)) throw new HttpError(400, "bad_path", "One of the changes has an invalid path.");
    const data = ch.data;
    if (data !== null && (typeof data !== "object" || Array.isArray(data))) throw new HttpError(400, "bad_data", "Documents must be objects.");
    if (data && Buffer.byteLength(JSON.stringify(data)) > MAX_DOC_BYTES) throw new HttpError(413, "too_large", "One of the documents is too large to sync.");
    byPath.set(ch.path, data);
  }
  if (!byPath.size) return { written: 0 };

  const { meta } = await membership(user);
  const householdId = meta.householdId;
  await updateMeta(householdId, (m) => {
    const usage = usageOf(m);
    if (usage.writes + byPath.size > DAILY_WRITES) {
      throw new HttpError(429, "quota", "Your household reached today's sync limit. Changes stay on this device and sync tomorrow.");
    }
    usage.writes += byPath.size;
    m.usage = usage;
    return m;
  });

  const at = Date.now();
  const ops = [...byPath].map(([path, data]) => ({
    operationType: "Upsert",
    resourceBody: data
      ? { id: itemId(path), householdId, type: "doc", path, data, deleted: false, by: user.id, at }
      : { id: itemId(path), householdId, type: "doc", path, data: null, deleted: true, by: user.id, at, ttl: TOMBSTONE_TTL },
  }));
  await batch(db().households, householdId, ops);
  return { written: ops.length };
}

module.exports = { pull, push, validPath };
