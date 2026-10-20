const { route, readBody } = require("../lib/http");
const households = require("../lib/households");

// POST /api/household { name, displayName }: start a household and become its owner.
route("household-create", ["POST"], "household", async ({ request, user }) => households.create(user, await readBody(request, 4096)));

// POST /api/household/invites: a code that lets up to 10 people join for 7 days.
route("household-invite", ["POST"], "household/invites", async ({ request, user }) => {
  await readBody(request, 1024);
  return households.invite(user);
});

// POST /api/household/join { code, displayName }
route("household-join", ["POST"], "household/join", async ({ request, user }) => households.join(user, await readBody(request, 4096)));

// POST /api/household/leave: the last member out deletes the household. Call again until { done: true }.
route("household-leave", ["POST"], "household/leave", async ({ request, user }) => {
  await readBody(request, 1024);
  return households.leave(user);
});

// DELETE /api/household/members/{memberId}: the owner removes someone.
route("household-remove", ["DELETE"], "household/members/{memberId}", ({ request, user }) => households.removeMember(user, request.params.memberId));
