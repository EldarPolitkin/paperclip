import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { declareSelectedInvitationEvidence, INVITATION_PRIVATE_EXECUTION } from "../invitation-private-capability.js";
const mocked = vi.hoisted(() => ({ people: 0, observe: vi.fn(), guard: vi.fn(), requests: [] as Array<{ person: string; route: string; method: string }>, joined: false, disposed: [] as string[] }));
vi.mock("./identity-auth.js", () => ({
  createAuthenticatedPerson: async () => {
    const id = mocked.people++ === 0 ? "alex" : "other";
    return { id, dispose: async () => { mocked.disposed.push(id); }, request: async (route: string, method: string) => {
      mocked.requests.push({ person: id, route, method });
      if (id === "alex") mocked.joined = true;
      return { ok: id === "alex", status: id === "alex" ? 200 : 409, body: { cancel: async () => {} } };
    } };
  }, enrollAuthenticatedPerson: vi.fn(),
}));
vi.mock("./identity-invite-grant-setup.js", () => ({ prepareInvitationAgentAuthority: async () => ({ agentPermissionStatus: 200 }) }));
vi.mock("./identity-invite-prerequisite.js", () => ({ requireSafeInvitationEnrollment: mocked.guard }));
vi.mock("./identity-support.js", async original => ({ ...await original<typeof import("./identity-support.js")>(), observeIdentity: mocked.observe }));
import { accessGrantIdentityCases } from "./identity-access-grants.js";
const implementation = accessGrantIdentityCases.find(row => row.scenarioId === "access.invite-teammate")!;
beforeEach(() => { mocked.people = 0; mocked.joined = false; mocked.requests.length = 0; mocked.disposed.length = 0; vi.clearAllMocks(); });
async function fixture(roleQuestion = false, selected = true) {
  const origin = "http://127.0.0.1:3100", token = `pcp_invite_${"c".repeat(43)}`, href = `${origin}/invite/${token}`;
  const roots = ["synthetic-real-account-root-1234567890"], gets: string[] = [];
  const invite = { id: "invite", companyId: "company", state: "active", humanRole: "viewer", tokenHash: createHash("sha256").update(token).digest("hex") };
  const run = { id: "run", companyId: "company", agentId: "ceo", status: "succeeded", runtimeMode: "native", startedAt: "2026-10-29T00:00:01Z", contextSnapshot: { issueId: "chat" } };
  const human = { id: "human-query", companyId: "company", issueId: "chat", authorUserId: "person", body: "Invite Alex", createdAt: "2026-10-29T00:00:00Z" };
  const reply = { id: "reply", companyId: "company", issueId: "chat", authorAgentId: "ceo", createdByRunId: "run", body: `Alex: [Join](${href})` };
  const activity = { id: "audit", companyId: "company", action: "invite.created", entityType: "invite", entityId: "invite", actorType: "agent", actorId: "ceo", createdAt: "2026-10-29T00:00:02Z" };
  let queried = false;
  const api = { baseURL: origin, get: async (route: string) => {
    gets.push(route);
    if (route === "/api/companies/company/invites") return { invites: queried && !roleQuestion ? [invite] : [] };
    if (route === "/api/companies/company/members") return { members: mocked.joined ? [{ principalId: "alex", status: "active" }] : [] };
    if (route === "/api/companies/company/join-requests") return [{ id: "join", requestingUserId: "alex", inviteId: "invite", status: "approved" }];
    if (route === "/api/issues/chat/comments?order=asc") return [human, reply];
    if (route === "/api/companies/company/activity?limit=1000") return [activity];
    throw new Error("Unexpected owned act GET");
  } };
  const ctx = { scenario: { id: "access.invite-teammate", query: human.body }, input: { api, execution: { id: selected ? INVITATION_PRIVATE_EXECUTION : "chat-features.runner-codex-subscription.local.access.invite-teammate" },
    page: { context: () => ({ browser: () => ({}) }) }, fixtures: { company: { id: "company" }, agent: { id: "ceo" } },
    invitationScope: selected ? declareSelectedInvitationEvidence(INVITATION_PRIVATE_EXECUTION, 1, "a".repeat(40)) : undefined, invitationHumanId: selected ? "person" : undefined, privateSecrets: roots,
    evidence: async () => {},
  }, issue: () => ({ id: "chat" }), refreshIssue: async () => {}, allRuns: async () => queried ? [run] : [] } as unknown as ChatCatalogContext;
  const state = await implementation.setup(ctx); queried = true;
  mocked.observe.mockImplementation(async () => ({ scenarioId: "access.invite-teammate", origin, companyId: "company", leadId: "ceo", state,
    reply: roleQuestion ? "" : reply.body, runs: [run], links: roleQuestion ? [] : [href], activity: roleQuestion ? [] : [activity],
    renderedLinkEvidence: roleQuestion ? [] : [{ threadTestId: "task-chat-thread", href, source: "reply", conversationId: "chat", commentId: "reply", anchorCommentId: "reply" }],
    interactions: roleQuestion ? [{ kind: "ask_user_questions", status: "pending", companyId: "company", createdByAgentId: "ceo", sourceRunId: "run", payload: { questionSet: { questions: [{ prompt: "What role should Alex have: viewer or operator?" }] } } }] : [],
  }));
  return { ctx, state, roots, token, invite, activity, reply, gets };
}
it("actual act keeps genuine Alex acceptance/reuse after public capability proof without credential conflation", async () => {
  const f = await fixture(); await implementation.act!(f.ctx, f.state);
  expect(mocked.guard).toHaveBeenCalledOnce();
  expect(mocked.requests).toEqual([{ person: "alex", route: `/api/invites/${f.token}/accept`, method: "POST" }, { person: "other", route: `/api/invites/${f.token}/accept`, method: "POST" }]);
  expect(f.state).toMatchObject({ actualJoinLinkBound: true, realAlexJoinedOnce: true, reusedLinkDifferentIdentityDenied: true });
  expect(f.roots).toEqual(["synthetic-real-account-root-1234567890"]);
  await implementation.cleanup!(f.ctx, f.state); expect(mocked.disposed).toEqual(["alex", "other"]);
});
it("actual consequential role question performs zero token-path acceptance with zero registration", async () => {
  const f = await fixture(true); await implementation.act!(f.ctx, f.state);
  expect(f.state.invitations).toEqual([]); expect(mocked.guard).not.toHaveBeenCalled(); expect(mocked.requests).toEqual([]);
  await implementation.cleanup!(f.ctx, f.state); expect(mocked.disposed).toEqual(["alex"]);
});
it("wrong actual creation actor fails before guard or acceptance, while cleanup still disposes the owned person", async () => {
  const f = await fixture(); f.activity.actorId = "foreign";
  await expect(implementation.act!(f.ctx, f.state)).rejects.toThrow(/custody/);
  expect(mocked.guard).not.toHaveBeenCalled(); expect(mocked.requests).toEqual([]);
  await implementation.cleanup!(f.ctx, f.state); expect(mocked.disposed).toEqual(["alex"]);
});
it("missing fixed scope stops actual setup before creating any person or authority", async () => {
  await expect(implementation.setup({ input: { execution: { id: INVITATION_PRIVATE_EXECUTION } }, scenario: { id: "access.invite-teammate" } } as ChatCatalogContext)).rejects.toThrow(/before setup/);
  expect(mocked.people).toBe(0); expect(mocked.requests).toEqual([]);
});

it("keeps nonselected invitation credential handling conservative", async () => {
  const f = await fixture(false, false); await implementation.act!(f.ctx, f.state);
  expect(f.roots).toContain(f.token); expect(mocked.requests).toHaveLength(2);
  await implementation.cleanup!(f.ctx, f.state);
});

it("actual public reply credential shape fails before enrollment or acceptance", async () => {
  const f = await fixture(); f.reply.body += " sk-proj-syntheticUnknownCredential123456789";
  await expect(implementation.act!(f.ctx, f.state)).rejects.toThrow(/Secret leak/);
  expect(mocked.guard).not.toHaveBeenCalled(); expect(mocked.requests).toEqual([]);
  await implementation.cleanup!(f.ctx, f.state);
});
