import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bindActualInvitationCapability } from "./identity-invite-capability-binding.js";
import { declareSelectedInvitationEvidence, INVITATION_PRIVATE_EXECUTION } from "../invitation-private-capability.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import type { IdentityObservation } from "./identity-support.js";
function fixture() {
  const token = `pcp_invite_${"a".repeat(43)}`, origin = "http://127.0.0.1:3100", href = `${origin}/invite/${token}`;
  const scope = declareSelectedInvitationEvidence(INVITATION_PRIVATE_EXECUTION, 1, "a".repeat(40))!;
  const human = { id: "human-comment", companyId: "company", issueId: "chat", authorUserId: "person", body: "Invite Alex", createdAt: "2026-10-29T00:00:00Z" };
  const reply = { id: "reply", companyId: "company", issueId: "chat", authorAgentId: "ceo", createdByRunId: "run", body: `Alex: [Join](${href})` };
  const run = { id: "run", companyId: "company", agentId: "ceo", status: "succeeded", runtimeMode: "native", startedAt: "2026-10-29T00:00:01Z", contextSnapshot: { issueId: "chat" } };
  const activity = { id: "audit", companyId: "company", entityId: "invite", entityType: "invite", action: "invite.created", actorType: "agent", actorId: "ceo", createdAt: "2026-10-29T00:00:02Z" };
  const link = { threadTestId: "task-chat-thread", href, source: "reply", conversationId: "chat", commentId: "reply", anchorCommentId: "reply" };
  const invite = { id: "invite", companyId: "company", state: "active", tokenHash: createHash("sha256").update(token).digest("hex") };
  const calls: string[] = [], roots = ["synthetic-real-credential-root-1234567890"];
  const ctx = { scenario: { query: human.body }, issue: () => ({ id: "chat" }), allRuns: async () => [run],
    input: { invitationScope: scope, invitationHumanId: "person", privateSecrets: roots,
      fixtures: { company: { id: "company" }, agent: { id: "ceo" } }, api: { baseURL: origin, get: async (route: string) => {
        calls.push(route);
        if (route === "/api/issues/chat/comments?order=asc") return [human, reply];
        if (route === "/api/companies/company/activity?limit=1000") return [activity];
        throw new Error("Unexpected public proof read");
      } } } } as unknown as ChatCatalogContext;
  return { token, ctx, human, reply, run, activity, link, invite, calls, roots,
    observation: { renderedLinkEvidence: [link] } as unknown as IdentityObservation };
}
it("binds actual visible/public custody without registering the invitation as a real credential or performing acceptance", async () => {
  const f = fixture(); expect(await bindActualInvitationCapability(f.ctx, f.observation, f.invite, [])).toBe(f.token);
  expect(f.roots).toEqual(["synthetic-real-credential-root-1234567890"]);
  expect(f.calls).toEqual(["/api/issues/chat/comments?order=asc", "/api/companies/company/activity?limit=1000"]);
  await expect(bindActualInvitationCapability(f.ctx, f.observation, f.invite, [])).rejects.toThrow(/limited to one/);
});
it.each(["person", "query", "company", "hash", "actor", "comment-run", "source", "anchor", "foreign-link", "setup-run", "credential-collision"])("rejects %s before token-path acceptance", async kind => {
  const f = fixture();
  if (kind === "person") f.human.authorUserId = "foreign";
  if (kind === "query") f.human.body = "Other request";
  if (kind === "company") f.invite.companyId = "foreign";
  if (kind === "hash") f.invite.tokenHash = "b".repeat(64);
  if (kind === "actor") f.activity.actorId = "other";
  if (kind === "comment-run") f.reply.createdByRunId = "foreign";
  if (kind === "source") f.run.contextSnapshot.issueId = "foreign";
  if (kind === "anchor") f.link.anchorCommentId = "foreign";
  if (kind === "foreign-link") f.link.href = f.link.href.replace("127.0.0.1", "foreign.invalid");
  if (kind === "credential-collision") f.roots.push(f.token);
  await expect(bindActualInvitationCapability(f.ctx, f.observation, f.invite, kind === "setup-run" ? ["run"] : [])).rejects.toThrow();
});
it("requires the actual authenticated person and a typed case scope", async () => {
  const f = fixture(); delete f.ctx.input.invitationHumanId;
  await expect(bindActualInvitationCapability(f.ctx, f.observation, f.invite, [])).rejects.toThrow(/authenticated source/);
  expect(f.calls).toEqual([]);
});
