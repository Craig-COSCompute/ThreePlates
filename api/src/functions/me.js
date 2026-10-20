const { route } = require("../lib/http");
const households = require("../lib/households");

// GET /api/me: who's signed in and which household they're in.
route("me-get", ["GET"], "me", ({ user }) => households.me(user));

// DELETE /api/me: leave the household and delete the user record. Call again until { done: true }.
route("me-delete", ["DELETE"], "me", ({ user }) => households.deleteMe(user));
