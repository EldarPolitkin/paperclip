import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { declareInvitationPrivateEvidence, registerInvitationCapability, projectInvitationJsonForWriter,
  invitationPrivateResultEnvelope, invitationDiagnosticDisposition, INVITATION_PRIVATE_EXECUTION,
  type InvitationCapabilityProof } from "./invitation-private-capability.js";
import { createPrivateDiagnosticStream } from "./private-diagnostics.js";
import type { RunnerE2EResult } from "./types.js";

const token = `pcp_invite_${"a".repeat(43)}`;
const url = `http://127.0.0.1:3100/invite/${token}`;
function scope() { return declareInvitationPrivateEvidence({ executionId: INVITATION_PRIVATE_EXECUTION, attempt: 1, sourceSha: "a".repeat(40) }); }
function proof(): InvitationCapabilityProof { return {
  origin: "http://127.0.0.1:3100", expected: { companyId: "company", agentId: "ceo", issueId: "chat", humanId: "human", query: "Invite Alex", setupRunIds: ["hello"] },
  invite: { id: "invite", companyId: "company", state: "active", tokenHash: createHash("sha256").update(token).digest("hex") },
  run: { id: "canonical", companyId: "company", agentId: "ceo", status: "succeeded", runtimeMode: "native", startedAt: "2026-10-29T00:00:01.000Z", contextSnapshot: { issueId: "chat" } },
  human: { id: "query", companyId: "company", issueId: "chat", authorUserId: "human", body: "Invite Alex", createdAt: "2026-10-29T00:00:00.000Z" },
  comment: { id: "answer", companyId: "company", issueId: "chat", authorAgentId: "ceo", createdByRunId: "canonical", body: `Alex: [Join](${url})` },
  activity: { id: "creation", companyId: "company", action: "invite.created", entityType: "invite", entityId: "invite", actorType: "agent", actorId: "ceo", createdAt: "2026-10-29T00:00:02.000Z", runId: null },
  renderedLink: { href: url, source: "reply", conversationId: "chat", commentId: "answer", anchorCommentId: "answer" },
}; }
function result(): RunnerE2EResult { return { schema: "paperclip.runner-e2e.result/v2", executionId: INVITATION_PRIVATE_EXECUTION,
  suiteId: "chat-features", suiteDefinitionHash: "synthetic", caseId: "access.invite-teammate", profileId: "runner-opencode", environmentId: "local",
  provider: "openrouter", model: "openrouter/deepseek/deepseek-v4.1-flash-1017", runtimeMode: "native", attempt: 1, status: "failed", cleanup: "passed",
  startedAt: "2026-10-29T00:00:00.000Z", finishedAt: "2026-10-29T00:00:03.000Z", durationMs: 3000,
  matcherResults: [{ matcher: { kind: "json_path", path: "exact-actor", expected: true }, passed: true, detail: "real actor" },
    { matcher: { kind: "json_path", path: "accepted-once", expected: true }, passed: false, detail: "not reached" }],
  screenshots: [{ id: "before", label: "before registration", file: "before.png", publication: "public-runner-fixture" }] }; }

describe("invitation-only private capability prototype", () => {
  it("projects the exact public created branch without changing semantic checks or credential roots", () => {
    const s = scope(), p = proof(), roots = ["owned-control-credential-root"];
    registerInvitationCapability(s, p, roots);
    const evidence = { comments: [p.comment], runs: [{ ...p.run, resultJson: { summary: `Join ${url}` } }], renderedLinks: [p.renderedLink],
      observation: { scenarioId: "access.invite-teammate", companyId: "company", leadId: "ceo", reply: p.comment.body, links: [url] },
      invitation: p.invite, acceptedOnce: true };
    const projected = projectInvitationJsonForWriter(s, "api-state.json", evidence, roots) as typeof evidence;
    expect(JSON.stringify(projected)).not.toContain(token);
    expect(projected.acceptedOnce).toBe(true); expect(projected.invitation).toEqual(p.invite);
    expect(evidence.comments[0].body).toContain(token); expect(roots).toEqual(["owned-control-credential-root"]);
  });
  it("does not require an invented runId on the real invite.created producer", () => {
    const p = proof(); delete p.activity.runId; expect(() => registerInvitationCapability(scope(), p, [])).not.toThrow();
  });
  it.each([
    ["hash", (p: InvitationCapabilityProof) => { p.invite.tokenHash = "b".repeat(64); }],
    ["actor", (p: InvitationCapabilityProof) => { p.activity.actorId = "other"; }],
    ["board actor", (p: InvitationCapabilityProof) => { p.activity.actorType = "user"; }],
    ["company", (p: InvitationCapabilityProof) => { p.invite.companyId = "foreign"; }],
    ["run", (p: InvitationCapabilityProof) => { p.comment.createdByRunId = "other"; }],
    ["audit run", (p: InvitationCapabilityProof) => { p.activity.runId = "other"; }],
    ["setup run", (p: InvitationCapabilityProof) => { p.expected.setupRunIds = [...p.expected.setupRunIds, "canonical"]; }],
    ["task", (p: InvitationCapabilityProof) => { p.run.contextSnapshot.issueId = "foreign"; }],
    ["human", (p: InvitationCapabilityProof) => { p.human.authorUserId = "other"; }],
    ["query", (p: InvitationCapabilityProof) => { p.human.body = "other query"; }],
    ["foreign URL", (p: InvitationCapabilityProof) => { p.renderedLink.href = url.replace("127.0.0.1", "foreign.invalid"); }],
    ["URL query", (p: InvitationCapabilityProof) => { p.renderedLink.href += "?redirect=foreign"; }],
    ["audit before source", (p: InvitationCapabilityProof) => { p.activity.createdAt = "2026-10-28T00:00:00Z"; }],
    ["rendered anchor", (p: InvitationCapabilityProof) => { p.renderedLink.anchorCommentId = "foreign"; }],
  ])("rejects forged %s custody", (_name, mutate) => { const p = proof(); mutate(p); expect(() => registerInvitationCapability(scope(), p, [])).toThrow(); });
  it("rejects duplicate registration even for the same token", () => { const s = scope(); registerInvitationCapability(s, proof(), []); expect(() => registerInvitationCapability(s, proof(), [])).toThrow(/one/); });
  it.each([token, Buffer.from(token).toString("base64"), JSON.stringify({ apiKey: token })])("rejects campaign credential/capability collision", credential => {
    expect(() => registerInvitationCapability(scope(), proof(), [credential])).toThrow(/collides/);
  });
  it("retains real credential rejection before any otherwise valid projection", () => {
    const s = scope(); registerInvitationCapability(s, proof(), []);
    expect(() => projectInvitationJsonForWriter(s, "api-state.json", { comments: [proof().comment], credential: "owned-real-credential" }, ["owned-real-credential"])).toThrow(/Secret leak/);
  });
  it("rejects encoded real credentials rather than hiding them with capability projection", () => {
    const s = scope(); registerInvitationCapability(s, proof(), []);
    expect(() => projectInvitationJsonForWriter(s, "api-state.json", { data: Buffer.from("owned-real-credential").toString("base64") }, ["owned-real-credential"])).toThrow();
  });
  it.each([{ data: token }, { data: url }, { log: { content: url } }, { events: [{ payload: { text: url } }] }])("rejects unknown carriers", value => {
    const s = scope(); registerInvitationCapability(s, proof(), []); expect(() => projectInvitationJsonForWriter(s, "unknown.json", value, [])).toThrow(/unknown/);
  });
  it("rejects foreign-origin copies in an otherwise authorized comment carrier", () => {
    const s = scope(); registerInvitationCapability(s, proof(), []); const p = proof(); p.comment.body = url.replace("127.0.0.1", "foreign.invalid");
    expect(() => projectInvitationJsonForWriter(s, "conversation.json", { comments: [p.comment] }, [])).toThrow(/foreign/);
  });
  it("rejects capability material before typed registration", () => { expect(() => projectInvitationJsonForWriter(scope(), "early.json", { url }, [])).toThrow(/Unregistered/); });
  it("does not permit a forged scope or nonselected execution", () => {
    expect(() => projectInvitationJsonForWriter({ kind: "invitation-private-capability-scope" }, "x", {}, [])).toThrow();
    expect(() => declareInvitationPrivateEvidence({ executionId: "other" as typeof INVITATION_PRIVATE_EXECUTION, attempt: 1, sourceSha: "a".repeat(40) })).toThrow();
  });
  it("marks early failure and role clarification private before any capability registration; preserves exact check verdicts", () => {
    const r = result(), privateResult = invitationPrivateResultEnvelope(r);
    expect(privateResult.productJourney?.privacy).toBe("private"); expect(privateResult.productJourney?.checks).toEqual([{ id: "exact-actor", passed: true }, { id: "accepted-once", passed: false }]);
    expect(privateResult.productJourney?.resourceDisposition).toBe("retained"); expect(privateResult.screenshots?.[0].publication).toBeUndefined();
    expect(privateResult.status).toBe(r.status); expect(privateResult.matcherResults).toEqual(r.matcherResults);
    expect(invitationPrivateResultEnvelope({ ...r, executionId: "other" })).toEqual({ ...r, executionId: "other" });
  });
  it("separates private capability diagnostic containment from actual credential leak classification", () => {
    const emitted: string[] = [], s = scope();
    const stream = createPrivateDiagnosticStream(() => ["owned-real-credential"], safe => { emitted.push(safe); });
    stream.write(Buffer.from(`actual credential owned-real-credential; capability ${url}\n`)); stream.end();
    expect(stream.redactedSecret()).toBe(true); expect(emitted.join("")).not.toContain("owned-real-credential");
    expect(() => invitationDiagnosticDisposition(s, { failed: stream.failed(), redactedSecret: stream.redactedSecret() })).toThrow(/real credential/);
    expect(invitationDiagnosticDisposition(s, { failed: false, redactedSecret: false }).publicText).not.toContain(token);
  });
});
