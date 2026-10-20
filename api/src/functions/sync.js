const { route, readBody } = require("../lib/http");
const sync = require("../lib/sync");

// GET /api/sync?since=<cursor>: changes since the cursor, or everything when reset is true.
route("sync-pull", ["GET"], "sync", ({ request, user }) => sync.pull(user, Number(request.query.get("since")) || 0));

// POST /api/sync { changes: [{ path, data | null }] }: data null deletes.
route("sync-push", ["POST"], "sync", async ({ request, user }) => sync.push(user, await readBody(request, 1100 * 1024)));
