import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Agent } from "../../../packages/shared/src/types/agent.js";
import type { AiConnectionList } from "../../../packages/shared/src/ai-connections.js";
import { waitForReply, probeAgentPermission } from "./identity-support.js";
import { checks } from "./internal-support.js";
import { runtimeDefinition, runtimeObservation, observeRuntime } from "./runtime-support.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const validationOperation = "POST /api/companies/{companyId}/adapters/{type}/test-environment";
const model = "openrouter/deepseek/deepseek-v4.1-flash-1017";
const authCodes = new Set(["opencode_hello_probe_auth_required", "ai_connection_api_key_rejected"]);
export function actualAuthenticationFailure(codes: readonly string[]) { return codes.some(code => authCodes.has(code)); }
// Same canonical request identity as the existing native authority producer.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") { const r = record(v); return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`; }
  return JSON.stringify(v) ?? "null";
}
export const validationDigest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
type Target = Pick<Agent, "id" | "adapterType" | "adapterConfig" | "defaultEnvironmentId" | "runtimeConfig">;
/** Finite saved-config spellings, not a timestamp or raw-argument reconstruction.
 * Explicit adapter config is required; omitted account/environment use the saved selection. */
export function savedValidationDigests(companyId: string, worker: Target) {
  const values = new Set<string>();
  for (const account of [false, true]) for (const environment of [false, true]) for (const runner of [false, true])
    for (const company of [false, true]) for (const contentType of [undefined, "application/json"]) for (const query of [undefined, {}]) {
      const input = { operationId: validationOperation, pathParams: { type: worker.adapterType, ...(company ? { companyId } : {}) },
        body: { agentId: worker.id, adapterConfig: worker.adapterConfig, ...(account ? { aiConnection: worker.runtimeConfig.aiConnection } : {}),
          ...(environment ? { environmentId: worker.defaultEnvironmentId } : {}), ...(runner ? { runner: "paperclip" } : {}) },
        ...(contentType ? { contentType } : {}), ...(query ? { query } : {}) };
      values.add(validationDigest(input));
    }
  return values;
}
export interface ValidationReceipt { sameConfiguration: boolean; authenticatedFailure: boolean; checkCodes: string[] }
/** Only existing durable public mutation receipts and actor-bound activity.
 * Never reads PRP events, provider logs, encrypted results or artifact fallbacks. */
export function savedValidationReceipts(run: unknown, activity: unknown[], expected: { companyId: string; issueId: string; leadId: string; runId: string; worker: Target }): ValidationReceipt[] {
  const r = record(run);
  if (r.id !== expected.runId || r.companyId !== expected.companyId || r.agentId !== expected.leadId || r.issueId !== expected.issueId) return [];
  const receipts = record(record(r.resultJson).apiToolReceipts), digests = savedValidationDigests(expected.companyId, expected.worker);
  if (Object.keys(receipts).length > 512) return [];
  return Object.values(receipts).flatMap(value => {
    const receipt = record(value);
    if (receipt.operationId !== validationOperation) return [];
    const digest = receipt.digest;
    const actor = activity.map(record).filter(a => {
      const d = record(a.details), params = record(d.pathParams);
      return a.companyId === expected.companyId && a.actorType === "agent" && a.actorId === expected.leadId && a.agentId === expected.leadId
        && a.runId === expected.runId && a.entityType === "issue" && a.entityId === expected.issueId && a.action === "runner.api_called"
        && d.operationId === validationOperation && d.requestFingerprint === digest && d.status === 200
        && params.type === expected.worker.adapterType && (params.companyId === undefined || params.companyId === expected.companyId);
    });
    // Pending/encrypted/unknown results remain unproved; never decrypt or traverse them.
    if (receipt.state !== "completed" || receipt.encryptedResult !== undefined) return [{ sameConfiguration: false, authenticatedFailure: false, checkCodes: [] }];
    const result = record(receipt.result), data = record(result.data);
    const codes = Array.isArray(data.checks) ? data.checks.flatMap(v => { const code = record(v).code; return typeof code === "string" && authCodes.has(code) ? [code] : []; }) : [];
    return [{ sameConfiguration: typeof digest === "string" && digests.has(digest) && actor.length === 1,
      authenticatedFailure: result.ok === true && result.status === 200 && result.apiOperationId === validationOperation && data.status === "fail" && actualAuthenticationFailure(codes), checkCodes: codes }];
  });
}
export function validationFailureReplyMatches(reply: string) {
  return /authenticat|login|sign.?in|credential|account access/i.test(reply) && /fail|could not|couldn't|unable|not (?:yet )?(?:ready|working)|blocked|needs|requires/i.test(reply)
    && /reconnect|sign.?in|reauthori[sz]|repair|refresh.*(?:account|credential)|check.*(?:account|credential)|human|operator|settings/i.test(reply)
    && !/(?:Morgan|profile|agent)\s+(?:is\s+)?(?:now\s+|fully\s+)?ready\b(?!\s+(?:once|when|after|pending|only|subject)\b)|validation (?:passed|succeeded)|(?:switched|replaced).*(?:account|harness)/i.test(reply);
}
export function gradeClaudeValidation(value: unknown) {
  const c = checks(), o = runtimeObservation(value);
  c.add("actual-authentication-failure-context", !!o, "Actual saved target and durable native validation evidence are required."); if (!o) return c.result();
  const s = o.state, worker = s.worker as Agent, saved = o.agents.find(a => a.id === worker?.id), receipts = s.canonicalValidationReceipts as ValidationReceipt[] | undefined;
  c.add("genuine-target-auth-failure-not-simulated", s.actualAccountEligible === true && s.noTargetWorkBeforeQuery === true && s.targetVisibleToController === true
    && Array.isArray(receipts) && receipts.length === 1 && receipts[0]!.sameConfiguration && receipts[0]!.authenticatedFailure && s.targetAuthTransition === true,
    "Exact canonical actor/run/issue request digest, real native authentication result and target account transition agree; no setup hello.");
  c.add("specific-failure-and-repair-no-false-ready", validationFailureReplyMatches(o.reply), "A natural actionable repair/operator explanation distinguishes saved profile from working execution.");
  c.add("no-account-harness-target-substitution-or-paid-work", !!saved && saved.adapterType === worker.adapterType && isDeepStrictEqual(saved.adapterConfig, worker.adapterConfig)
    && isDeepStrictEqual(saved.runtimeConfig?.aiConnection, worker.runtimeConfig.aiConnection) && saved.defaultEnvironmentId === worker.defaultEnvironmentId
    && s.sameAccountIdentities === true && s.controllerBindingUnchanged === true && s.noEmployeeRuns === true
    && o.tasks.length === 0 && o.runs.length === 1 && o.runs[0]?.agentId === o.leadId && o.humanQueries.length === 1,
    "Expected target reauthorization is allowed; controller, account identities, saved runtime and absence of employee work remain independent.");
  return c.result();
}
function targetHeld(agent: Agent) { return agent.status === "paused" && agent.lifecycleState === "paused" && agent.pauseReason === "setup" && Array.isArray(record(agent).lifecycleHolds) && (record(agent).lifecycleHolds as unknown[]).includes("setup"); }
export function validationTargetSetupMatches(agent: Agent, expected: { id: string; companyId: string; leadId: string; environmentId: string; binding: unknown }) {
  return agent.id === expected.id && agent.companyId === expected.companyId && agent.name === "Morgan" && agent.reportsTo === expected.leadId
    && targetHeld(agent) && agent.adapterType === "paperclip_runner" && agent.adapterConfig.provider === "opencode" && agent.adapterConfig.model === model
    && agent.adapterConfig.timeoutSec === 0 && agent.defaultEnvironmentId === expected.environmentId && isDeepStrictEqual(agent.runtimeConfig.aiConnection, expected.binding);
}
const identities = (rows: AiConnectionList["connections"]) => rows.map(a => ({ id: a.id, grantId: a.grantId, provider: a.provider })).sort((a,b) => a.id.localeCompare(b.id));
async function targetRuns(ctx: ChatCatalogContext, workerId: string) {
  const runs = await ctx.input.api.getRunObservation<Array<{ agentId: string }>>(`/api/companies/${ctx.input.fixtures.company.id}/heartbeat-runs?limit=100`);
  return runs.filter(r => r.agentId === workerId).length;
}
export const runtimeClaudeValidationCases = [runtimeDefinition("runs-adapters.validate-hire", async ctx => {
  const { api, fixtures, privateSecrets, privateInputs, execution } = ctx.input;
  const credential = privateInputs?.credentials.OPENROUTER_API_KEY;
  if (ctx.scenario.id !== "runs-adapters.validate-hire" || execution.profile.id !== "runner-opencode"
    || execution.profile.credential !== "OPENROUTER_API_KEY" || execution.profile.model !== model || execution.environment.id !== "local"
    || !credential?.trim() || !privateSecrets) throw new Error("Validation requires the exact selected native profile and declared private credential sink");
  const companyId = fixtures.company.id, environmentId = fixtures.environment.id;
  const [environment, lead] = await Promise.all([api.get<{ id: string; driver: string; status: string }>(`/api/environments/${environmentId}`), api.get<Agent>(`/api/agents/${fixtures.agent.id}`)]);
  if (environment.id !== environmentId || environment.driver !== "local" || environment.status !== "active" || lead.adapterType !== "paperclip_runner" || lead.adapterConfig.provider !== "opencode" || lead.adapterConfig.model !== model || lead.adapterConfig.timeoutSec !== 0 || lead.lifecycleState !== "ready" || lead.runtimeConfig.aiConnection?.mode !== "delegated" || lead.runtimeConfig.aiConnection.provider !== "openrouter") throw new Error("Validation requires the real native OpenCode controller and owned local environment");
  const invalid = `eval-invalid-${randomUUID()}`;
  privateSecrets.push(credential, invalid);
  // New connection, no connectionId: provider key stays unchanged; only a fresh app slot is later rotated.
  const account = await api.postSensitive<{ connectionId: string; grantId: string }>(`/api/companies/${companyId}/ai-connections`, {
    provider: "openrouter", method: "api_key", name: "Morgan validation account", ownership: "personal", apiKey: credential, allAgents: false, agentIds: [],
  });
  const binding = { provider: "openrouter", method: "api_key", mode: "delegated", connectionId: account.connectionId, grantId: account.grantId };
  const setupId = randomUUID();
  const worker = await api.post<Agent>(`/api/companies/${companyId}/agents`, { setupId, name: "Morgan", role: "engineer", title: "Frontend engineer", reportsTo: lead.id,
    adapterType: "paperclip_runner", runner: "paperclip", adapterConfig: { provider: "opencode", model, cwd: ctx.input.workspacePath, opencodePermissionMode: "allow", lifecycleMode: "per_turn", timeoutSec: lead.adapterConfig.timeoutSec },
    defaultEnvironmentId: environmentId, runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 }, aiConnection: binding } });
  const targetExpected = { id: setupId, companyId, leadId: lead.id, environmentId, binding };
  if (!validationTargetSetupMatches(worker, targetExpected)) throw new Error("Actual saved Morgan did not remain on its public setup hold");
  const before = await api.get<AiConnectionList>(`/api/companies/${companyId}/ai-connections`), target = before.connections.find(a => a.id === account.connectionId && a.grantId === account.grantId);
  if (!target || target.provider !== "openrouter" || target.status !== "connected" || target.ownership !== "personal" || lead.runtimeConfig.aiConnection?.mode === "delegated" && lead.runtimeConfig.aiConnection.connectionId === target.id) throw new Error("Fresh separate target account was not genuinely eligible");
  const rows = await api.get<Array<{ definition: { id: string; key: string; companyId: string }; secret: { id: string; scope: string; ownerUserId: string; companyId: string; userSecretDefinitionId: string; status: string } | null }>>(`/api/companies/${companyId}/me/user-secrets`);
  const slots = rows.filter(r => r.definition.companyId === companyId && r.definition.key === `ai_${account.grantId.replaceAll("-", "_")}` && r.secret?.companyId === companyId && r.secret.userSecretDefinitionId === r.definition.id && r.secret.scope === "user" && r.secret.status === "active" && r.secret.ownerUserId === target.ownerUserId);
  if (slots.length !== 1 || !slots[0]!.secret) throw new Error("Fresh target's exact owner-bound slot is unavailable");
  await api.postSensitive(`/api/companies/${companyId}/me/user-secrets/${slots[0]!.secret!.id}/rotate`, { value: invalid });
  const access = await probeAgentPermission(ctx, `/api/agents/${worker.id}`, "GET");
  const actual = await api.get<Agent>(`/api/agents/${worker.id}`), after = await api.get<AiConnectionList>(`/api/companies/${companyId}/ai-connections`);
  if (access !== 200 || !validationTargetSetupMatches(actual, targetExpected) || await targetRuns(ctx, worker.id) !== 0 || !after.connections.some(a => a.id === target.id && a.grantId === target.grantId && a.status === "connected")) throw new Error("Saved target must remain visible, selectable and unstarted until canonical validation");
  return { worker: actual, targetConnectionId: target.id, targetGrantId: target.grantId, accountIdentities: identities(after.connections), controllerBefore: lead,
    actualAccountEligible: true, noTargetWorkBeforeQuery: true, targetVisibleToController: true,
    providerProbes: [{ phase: "setup-target-account-key-verification", operation: "create-ai-connection", publicProbeCount: 1, usage: "unavailable", cost: "unavailable" }] };
}, gradeClaudeValidation, {
  requiredCredentials: ["OPENROUTER_API_KEY"], authentication: "human-session", expectedRunCount: 1, attemptTimeoutMs: 600000,
  setupPolicy: { readiness: "preserve-scenario", invariantCheckIds: ["saved-eligible-target-unstarted-on-setup-hold"] },
  async verifySetup(ctx, s) {
    const before = s.worker as Agent, actual = await ctx.input.api.get<Agent>(`/api/agents/${before.id}`), lead = await ctx.input.api.get<Agent>(`/api/agents/${ctx.input.fixtures.agent.id}`);
    const accounts = await ctx.input.api.get<AiConnectionList>(`/api/companies/${actual.companyId}/ai-connections`), c = checks();
    c.add("saved-eligible-target-unstarted-on-setup-hold", targetHeld(actual) && actual.companyId === ctx.input.fixtures.company.id && isDeepStrictEqual(actual.adapterConfig, before.adapterConfig)
      && isDeepStrictEqual(actual.runtimeConfig.aiConnection, before.runtimeConfig.aiConnection) && isDeepStrictEqual(lead.runtimeConfig.aiConnection, (s.controllerBefore as Agent).runtimeConfig.aiConnection)
      && lead.lifecycleState === "ready" && await targetRuns(ctx, actual.id) === 0 && accounts.connections.some(a => a.id === s.targetConnectionId && a.grantId === s.targetGrantId && a.status === "connected"),
      "Real saved setup draft stays paused, account selectable, controller unchanged, with no target validation or work before query."); return c.result();
  },
  sourceFiles: ["chat-catalog-domains/runtime-claude-validation.ts", "chat-catalog-domains/runtime-private.ts", "chat-catalog-domains/runtime-support.ts", "chat-catalog-domains/identity-support.ts", "../../server/src/routes/agents.ts", "../../server/src/services/ai-connections.ts", "../../server/src/services/agent-environment-test.ts", "../../server/src/services/native-runtime/paperclip-runner-tool-authority.ts", "../../server/src/services/native-runtime/runner-api-client.ts", "../../server/src/modules/agent-lifecycle/adapters/records.ts", "../../server/src/services/agent-lifecycle.ts", "chat-scenarios/runs-adapters.yaml"],
  async act(ctx, state) {
    await waitForReply(ctx); const runs = await ctx.allRuns();
    if (runs.length !== 1 || !ctx.issue()) { state.canonicalValidationReceipts = []; return; }
    const run = await ctx.input.api.getRunObservation<unknown>(`/api/heartbeat-runs/${runs[0]!.id}`);
    const activity = await ctx.input.api.get<unknown[]>(`/api/companies/${ctx.input.fixtures.company.id}/activity?limit=500`);
    state.canonicalValidationReceipts = savedValidationReceipts(run, activity, { companyId: ctx.input.fixtures.company.id, issueId: ctx.issue()!.id, leadId: ctx.input.fixtures.agent.id, runId: runs[0]!.id, worker: state.worker as Agent });
  },
  async observe(ctx, state) {
    const o = await observeRuntime(ctx, state), worker = state.worker as Agent;
    const accounts = await ctx.input.api.get<AiConnectionList>(`/api/companies/${o.companyId}/ai-connections`), target = accounts.connections.find(a => a.id === state.targetConnectionId && a.grantId === state.targetGrantId);
    const lead = o.agents.find(a => a.id === o.leadId), prior = state.controllerBefore as Agent;
    state.sameAccountIdentities = isDeepStrictEqual(identities(accounts.connections), state.accountIdentities);
    state.controllerBindingUnchanged = !!lead && isDeepStrictEqual(lead.runtimeConfig?.aiConnection, prior.runtimeConfig.aiConnection) && isDeepStrictEqual(lead.adapterConfig, prior.adapterConfig);
    state.noEmployeeRuns = await targetRuns(ctx, worker.id) === 0;
    state.targetAuthTransition = target?.status === "needs_attention" && o.activity.some(a => a.action === "ai_connection.authentication_failed" && a.actorType === "system" && a.actorId === "adapter_test"
      && a.agentId === worker.id && record(a).entityType === "tool_connection" && a.entityId === state.targetConnectionId && record(a.details).grantId === state.targetGrantId && record(a.details).provider === "openrouter");
    return o;
  },
})];
