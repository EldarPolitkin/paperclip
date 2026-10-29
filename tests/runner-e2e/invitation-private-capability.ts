import { createHash } from "node:crypto";
import { diagnosticSecrets } from "./private-diagnostics.js";
import { assertSecretFree, findSecretLeakInJsonValues, sanitizeJson } from "./redaction.js";
import type { RunnerE2EResult } from "./types.js";

/** Owned invitation case/writer stage. Parent launcher/fallback/private-retention
 * integration remains a separate reviewed prerequisite; this module alone does
 * not admit an invitation execution or widen the trusted eight-case policy. */
export const INVITATION_PRIVATE_EXECUTION = "chat-features.runner-opencode.local.access.invite-teammate";
const PRIVATE_LINK = "[private one-time invitation capability]";
interface Declaration { executionId: typeof INVITATION_PRIVATE_EXECUTION; attempt: number; sourceSha: string }
export interface InvitationEvidenceScope { readonly kind: "invitation-private-capability-scope" }
interface Bound {
  token: string; url: string; origin: string; companyId: string; agentId: string; issueId: string; runId: string;
  commentId: string; inviteId: string; tokenHash: string;
}
interface State { declaration: Declaration; bound?: Bound }
const states = new WeakMap<InvitationEvidenceScope, State>();
const writerScopes = new WeakMap<readonly string[], InvitationEvidenceScope>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function state(scope: InvitationEvidenceScope) {
  const current = states.get(scope);
  if (!current) throw new Error("Invitation evidence scope lacks fixed declaration provenance");
  return current;
}
export function declareInvitationPrivateEvidence(input: Declaration): InvitationEvidenceScope {
  if (input.executionId !== INVITATION_PRIVATE_EXECUTION || !Number.isSafeInteger(input.attempt) || input.attempt < 1
    || !/^[a-f0-9]{40}$/.test(input.sourceSha)) throw new Error("Invalid invitation evidence predeclaration");
  const scope: InvitationEvidenceScope = Object.freeze({ kind: "invitation-private-capability-scope" });
  states.set(scope, { declaration: Object.freeze({ ...input }) });
  return scope;
}
/** Fixed test-host scope, declared before this selected case starts setup. */
export function declareSelectedInvitationEvidence(executionId: string, attempt: number, sourceSha: string): InvitationEvidenceScope | undefined {
  return executionId === INVITATION_PRIVATE_EXECUTION
    ? declareInvitationPrivateEvidence({ executionId, attempt, sourceSha }) : undefined;
}
export function bindInvitationEvidenceWriter(scope: InvitationEvidenceScope, roots: readonly string[]): void {
  state(scope);
  if (writerScopes.has(roots)) throw new Error("Invitation writer scope already bound");
  writerScopes.set(roots, scope);
}
/** Raw genuine roots/encodings and unknown provider shapes must fail before the
 * ordinary captured-JSON sanitizer. This does not project or erase originals. */
export function assertInvitationRawEvidence(scope: InvitationEvidenceScope, name: string, value: unknown, roots: readonly string[]): void {
  state(scope);
  const leak = findSecretLeakInJsonValues(value, diagnosticSecrets(roots).values);
  if (leak) throw new Error(`Secret leak in ${name}: ${leak}`);
}
export function assertBoundInvitationWriterEvidence(name: string, value: unknown, roots: readonly string[]): void {
  const scope = writerScopes.get(roots);
  if (scope) assertInvitationRawEvidence(scope, name, value, roots);
}
interface PublicRow { id: string; companyId: string }
export interface InvitationCapabilityProof {
  origin: string;
  expected: { companyId: string; agentId: string; issueId: string; humanId: string; query: string; setupRunIds: readonly string[] };
  invite: PublicRow & { state: string; tokenHash: string };
  run: PublicRow & { agentId: string; status: string; runtimeMode: string; startedAt: string; contextSnapshot: { issueId: string } };
  human: PublicRow & { issueId: string; authorUserId: string; authorAgentId?: string | null; body: string; createdAt: string };
  comment: PublicRow & { issueId: string; authorAgentId: string; createdByRunId: string; body: string };
  activity: PublicRow & { action: string; entityType: string; entityId: string; actorType: string; actorId: string; createdAt: string; runId?: string | null };
  renderedLink: { href: string; source: string; conversationId: string; commentId: string; anchorCommentId: string };
}
/** Register only independently observed public facts. invite.created currently
 * has no runId in the route producer; a present contradictory runId is rejected,
 * while source-run custody comes from the exact persisted comment and run. */
export function registerInvitationCapability(scope: InvitationEvidenceScope, proof: InvitationCapabilityProof, realCredentialRoots: readonly string[]): void {
  const current = state(scope);
  if (current.bound) throw new Error("Invitation capability registration is limited to one");
  const { expected: e, invite, run, human, comment, activity, renderedLink: link } = proof;
  const nonempty = [e.companyId, e.agentId, e.issueId, e.humanId, e.query, invite.id, run.id, human.id, comment.id, activity.id];
  const origin = new URL(proof.origin);
  const url = new URL(link.href, proof.origin);
  if (!nonempty.every(value => typeof value === "string" && value.length > 0) || !["https:", "http:"].includes(origin.protocol)
    || origin.origin !== proof.origin || url.origin !== origin.origin || url.username || url.password || url.search || url.hash
    || !/^\/invite\/pcp_invite_[A-Za-z0-9_-]{43}$/.test(url.pathname)) throw new Error("Invitation link origin or public token shape is invalid");
  const token = url.pathname.slice("/invite/".length);
  const credentialVariants = diagnosticSecrets(realCredentialRoots).values;
  const capabilityVariants = diagnosticSecrets([token, url.href, url.pathname]).values;
  if (credentialVariants.some(credential => capabilityVariants.some(capability => capability.includes(credential) || credential.includes(capability))))
    throw new Error("Invitation capability collides with a real credential root or encoding");
  const humanTime = Date.parse(human.createdAt), start = Date.parse(run.startedAt), created = Date.parse(activity.createdAt);
  if (![invite, run, human, comment, activity].every(row => row.companyId === e.companyId)
    || invite.state !== "active" || invite.tokenHash !== digest(token)
    || run.agentId !== e.agentId || run.status !== "succeeded" || run.runtimeMode !== "native" || run.contextSnapshot.issueId !== e.issueId || e.setupRunIds.includes(run.id)
    || human.issueId !== e.issueId || human.authorUserId !== e.humanId || human.authorAgentId || human.body !== e.query
    || ![humanTime, start, created].every(Number.isFinite) || start < humanTime || created < start
    || comment.issueId !== e.issueId || comment.authorAgentId !== e.agentId || comment.createdByRunId !== run.id
    || !comment.body.includes(link.href) || link.source !== "reply" || link.conversationId !== e.issueId || link.commentId !== comment.id || link.anchorCommentId !== comment.id
    || activity.action !== "invite.created" || activity.entityType !== "invite" || activity.entityId !== invite.id || activity.actorType !== "agent" || activity.actorId !== e.agentId
    || activity.runId != null && activity.runId !== run.id) throw new Error("Invitation capability public actor/hash/run/invite custody is invalid");
  current.bound = Object.freeze({ token, url: url.href, origin: origin.origin, companyId: e.companyId, agentId: e.agentId,
    issueId: e.issueId, runId: run.id, commentId: comment.id, inviteId: invite.id, tokenHash: invite.tokenHash });
}
function hasCapability(text: string, bound: Bound) {
  return diagnosticSecrets([bound.token, bound.url, `/invite/${bound.token}`]).values.some(value => text.includes(value));
}
function projectLinkText(value: string, bound: Bound) {
  // Only the exact public-proven absolute/relative URL is projectable. Encoded,
  // bare-token, foreign-origin and unknown carriers remain fail-closed.
  for (const match of value.matchAll(/https?:\/\/[^\s<>()\]"']+/g)) {
    if (match[0].includes(bound.token) && match[0] !== bound.url) throw new Error("Invitation capability in a foreign or modified URL");
  }
  const safe = value.replaceAll(bound.url, PRIVATE_LINK).replaceAll(`/invite/${bound.token}`, PRIVATE_LINK);
  if (hasCapability(safe, bound)) throw new Error("Invitation capability in an unsupported carrier");
  return safe;
}
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Mirrors common writer ordering: exact real credentials are rejected BEFORE
 * the typed capability projection. No arbitrary callback or credential exemption
 * is accepted. Unknown carriers are never sanitized into apparent qualification. */
export function projectInvitationJsonForWriter(scope: InvitationEvidenceScope, name: string, value: unknown, realCredentialRoots: readonly string[]): unknown {
  const { bound } = state(scope);
  const raw = JSON.stringify(value);
  assertInvitationRawEvidence(scope, name, value, realCredentialRoots);
  assertSecretFree(raw, realCredentialRoots, name, { includeShapes: false });
  assertSecretFree(raw, diagnosticSecrets(realCredentialRoots).values, name, { includeShapes: false });
  if (!bound && /(?:\/invite\/|pcp_invite_)/.test(raw)) throw new Error("Unregistered invitation capability evidence must stay private");
  function visit(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(visit);
    const row = record(node);
    if (!row) return node;
    const copy = Object.fromEntries(Object.entries(row).map(([key, child]) => [key, visit(child)]));
    if (!bound) return copy;
    const sourceComment = row.id === bound.commentId && row.companyId === bound.companyId && row.issueId === bound.issueId
      && row.authorAgentId === bound.agentId && row.createdByRunId === bound.runId;
    if (sourceComment && typeof row.body === "string") copy.body = projectLinkText(row.body, bound);
    const sourceRun = row.id === bound.runId && row.companyId === bound.companyId && row.agentId === bound.agentId
      && record(row.contextSnapshot)?.issueId === bound.issueId;
    if (sourceRun) {
      const result = record(copy.resultJson);
      if (result && typeof result.summary === "string") result.summary = projectLinkText(result.summary, bound);
    }
    const observation = row.scenarioId === "access.invite-teammate" && row.companyId === bound.companyId && row.leadId === bound.agentId;
    if (observation) {
      if (typeof row.reply === "string") copy.reply = projectLinkText(row.reply, bound);
      if (Array.isArray(row.links) && row.links.every(href => typeof href === "string")) copy.links = row.links.map(href => projectLinkText(href as string, bound));
    }
    if (row.source === "reply" && row.conversationId === bound.issueId && row.commentId === bound.commentId && row.anchorCommentId === bound.commentId && typeof row.href === "string") copy.href = projectLinkText(row.href, bound);
    return copy;
  }
  const projected = visit(value);
  if (bound && hasCapability(JSON.stringify(projected), bound)) throw new Error("Invitation capability in an unknown evidence carrier");
  const safe = sanitizeJson(projected, realCredentialRoots);
  const leak = findSecretLeakInJsonValues(safe, realCredentialRoots);
  if (leak || bound && hasCapability(JSON.stringify(safe), bound)) throw new Error("Invitation projection contains private material");
  return safe;
}
/** Entire diagnostic streams are withheld, even before registration. The
 * existing real-credential stream scanner must execute first and its leak/fail
 * verdict remains authoritative; this separate disposition is NOT secret_leak. */
export function invitationDiagnosticDisposition(scope: InvitationEvidenceScope, credentialScan: { failed: boolean; redactedSecret: boolean }) {
  state(scope);
  if (credentialScan.failed || credentialScan.redactedSecret) throw new Error("Invitation diagnostics failed the real credential boundary");
  return { disposition: "private-capability-diagnostics-withheld" as const, publicText: "[invitation diagnostics retained privately]\n" };
}
/** A predeclared fixed case always remains private, even with zero registration
 * or an early launcher failure. Preserve exact matcher IDs/verdicts: the old
 * publisher/dashboard prefers these journey checks when the envelope exists. */
export function invitationPrivateResultEnvelope(result: RunnerE2EResult): RunnerE2EResult {
  if (result.executionId !== INVITATION_PRIVATE_EXECUTION) return result;
  if (result.suiteId !== "chat-features" || result.caseId !== "access.invite-teammate") throw new Error("Invitation private result identity mismatch");
  const checks = (result.matcherResults ?? []).map(row => ({ id: row.matcher.kind === "json_path" ? row.matcher.path : row.matcher.kind, passed: row.passed }));
  return { ...result, screenshots: result.screenshots?.map(({ publication: _publication, ...privateScreenshot }) => privateScreenshot),
    productJourney: { outcome: result.status, startingState: "recipe", privacy: "private", phases: [], checks,
      // Attempt cleanup alone does not establish remote host/volume release.
      resourceDisposition: result.cleanup === "failed" ? "cleanup-failed" : "retained" } };
}
