/* HTTP plumbing shared by every endpoint.
 *
 * Static Web Apps signs users in and only lets requests with the "authenticated" role reach /api/*
 * (see staticwebapp.config.json). It passes the user to the function in the x-ms-client-principal
 * header, which it strips from incoming requests, so it can be trusted here.
 */
const { app } = require("@azure/functions");

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const NO_STORE = { "cache-control": "no-store" };
const json = (status, body, headers) => ({ status, jsonBody: body, headers: Object.assign({}, NO_STORE, headers) });

function readUser(request) {
  const raw = request.headers.get("x-ms-client-principal");
  if (!raw) throw new HttpError(401, "signed_out", "Sign in to use family sync.");
  let p = null;
  try { p = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch { /* bad header */ }
  if (!p || !p.userId || !Array.isArray(p.userRoles) || !p.userRoles.includes("authenticated")) {
    throw new HttpError(401, "signed_out", "Sign in to use family sync.");
  }
  return { id: String(p.userId), provider: String(p.identityProvider || ""), details: String(p.userDetails || "") };
}

/* JSON bodies only. Requiring the content type means another site can't post here with a plain form,
 * because a cross-site application/json request needs a CORS preflight that this API never approves. */
async function readBody(request, maxBytes) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "bad_type", "Send JSON.");
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, "too_large", "That request is too large.");
  if (!text) return {};
  let v;
  try { v = JSON.parse(text); } catch { v = null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "bad_json", "The request body isn't valid JSON.");
  return v;
}

/* Register an endpoint. The handler gets { request, context, user } and returns a JSON body (or undefined for 204). */
function route(name, methods, path, handler) {
  app.http(name, {
    methods,
    route: path,
    authLevel: "anonymous", // Static Web Apps enforces sign-in in front of the function
    handler: async (request, context) => {
      try {
        const user = readUser(request);
        const out = await handler({ request, context, user });
        return out === undefined ? { status: 204, headers: NO_STORE } : json(200, out);
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message });
        if (e && e.code === 429) {
          // Cosmos DB is at its free-tier throughput cap. The client backs off and retries.
          return json(503, { error: "busy", message: "Sync is busy right now. It will try again shortly." }, { "retry-after": "10" });
        }
        context.error(e);
        return json(500, { error: "server", message: "Something went wrong on the server." });
      }
    },
  });
}

module.exports = { HttpError, route, readBody };
