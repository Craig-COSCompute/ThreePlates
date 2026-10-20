/* Cosmos DB access.
 *
 * Containers (all in one database with shared, capped throughput):
 *   households  partition /householdId  one "meta" item per household plus every synced document
 *   users       partition /id           which household each signed-in user belongs to
 *   invites     partition /id           invite codes; the container's TTL expires them after 7 days
 */
const { CosmosClient } = require("@azure/cosmos");
const { HttpError } = require("./http");

let cached = null;

function db() {
  if (cached) return cached;
  const conn = process.env.COSMOS_CONNECTION_STRING;
  if (!conn) throw new HttpError(503, "not_configured", "Family sync isn't set up on this site.");
  const database = new CosmosClient(conn).database(process.env.COSMOS_DATABASE || "threeplates");
  cached = {
    households: database.container("households"),
    users: database.container("users"),
    invites: database.container("invites"),
  };
  return cached;
}

/* Point read (1 RU). Returns null when the item doesn't exist. */
async function readItem(container, id, partitionKey) {
  try {
    const { resource } = await container.item(id, partitionKey).read();
    return resource || null;
  } catch (e) {
    if (e && e.code === 404) return null;
    throw e;
  }
}

/* Run up to 100 operations in one partition as a transactional batch: all succeed or none do. */
async function batch(container, partitionKey, operations) {
  const res = await container.items.batch(operations, partitionKey);
  const results = res.result || [];
  const status = Math.max(res.code || 200, ...results.map((r) => r.statusCode || 200));
  if (status === 429 || results.some((r) => r.statusCode === 429)) throw Object.assign(new Error("throttled"), { code: 429 });
  if (status >= 300) throw new Error("Batch failed: " + results.map((r) => r.statusCode).join(","));
  return results;
}

module.exports = { db, readItem, batch };
