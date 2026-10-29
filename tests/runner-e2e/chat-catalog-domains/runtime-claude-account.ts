import { expect } from "@playwright/test";
import type { AiConnectionList } from "../../../packages/shared/src/ai-connections.js";
import type { ConnectionIntentInteraction } from "../../../packages/shared/src/types/issue.js";
import { agentHarnessType } from "../../../packages/shared/src/agent-runner.js";
import { checks } from "./internal-support.js";
import { waitForReply } from "./identity-support.js";
import { accountConfigurationDigest, readNegativeRuntimeChoices, negativeRuntimeChoicesMatch } from "./runtime-negative-prerequisites.js";
import { observeRuntime, runtimeDefinition, runtimeObservation, type RuntimeAgent } from "./runtime-support.js";
export function supportedClaudeSetupLink(href: string, origin: string, prefix: string) {
  try { const url = new URL(href, origin); return url.origin === origin && (url.pathname === `/${prefix}/company/settings/connections`
    || url.pathname === `/${prefix}/apps/connect` && ["anthropic", "claude"].includes(url.searchParams.get("source") ?? url.searchParams.get("provider") ?? "")); } catch { return false; }
}
export function pendingClaudeSetupMatches(input: { request: ConnectionIntentInteraction | undefined; sourceId: string; sourceRunId: string; companyId: string; humanId: string }) {
  const r = input.request;
  return !!input.humanId && !!r && r.kind === "connection_intent" && r.issueId === input.sourceId && r.companyId === input.companyId
    && r.sourceRunId === input.sourceRunId && r.addresseeUserId === input.humanId && r.payload.serviceSlug === "anthropic"
    && r.status === "pending" && !r.resolvedByUserId && !r.resolvedByAgentId;
}
export function gradeClaudeAccount(value: unknown) {
  const c = checks(), o = runtimeObservation(value);
  c.add("genuine-missing-account-wait-evidence", !!o, "Real account absence, supported human setup and no premature employee execution are required."); if (!o) return c.result();
  const s = o.state, setupText = `${o.reply}\n${String(o.state.visibleSetupText ?? "")}`, workers = o.agents.filter(row => row.name === "Morgan");
  const before = Array.isArray(s.beforeAgents) ? s.beforeAgents as RuntimeAgent[] : undefined;
  const newAgents = o.agents.filter(row => !before?.some(prior => prior.id === row.id));
  c.add("truthful-account-setup-with-original-hire-details", s.initialAnthropicAccounts === 0 && s.anthropicAccountsAfter === 0
    && negativeRuntimeChoicesMatch(s.availability, o.companyId, false) && s.supportedSetupVisible === true && s.pendingSetupStillBound === true && s.accountConfigurationUnchanged === true
    && /Morgan|frontend|hire|requested|continue/i.test(setupText) && /Claude|Anthropic/i.test(setupText)
    && /account|connect|sign.?in|authenticat/i.test(o.reply) && /need|wait|setup|set up|missing|before|blocked|requires|until|once|when/i.test(o.reply)
    && !/Morgan\s+(?:(?:is|now|already)\s+){1,2}(?:fully\s+)?ready\b(?!\s+(?:once|when|after|pending|only once|only after|subject to)\b)|\bI(?:['’]ve| have)?\s+(?:already\s+)?(?:connected|authorized|authenticated)\b/i.test(o.reply),
    "The canonical request waits for the person's actual Anthropic setup; it neither supplies a key nor substitutes another harness.");
  c.add("no-ready-hire-or-borrowed-account", !!before && newAgents.length <= 1 && newAgents.every(row => row.name === "Morgan") && workers.length <= 1 && workers.every(row => row.companyId === o.companyId && ["preparing", "verifying", "paused"].includes(row.lifecycleState ?? "") && ["idle", "paused"].includes(row.status ?? "")
    && agentHarnessType(row.adapterType ?? "", row.adapterConfig) === "claude_local") && s.originalBindingsUnchanged === true,
    "At most one pending Claude identity is preserved; no ready hire, alternate harness, account change or existing-agent rebinding occurs.");
  c.add("waiting-without-unrequested-native-work", s.sourceWaiting === true && o.humanQueries.length === 1 && o.tasks.length === 0
    && o.runs.length === 1 && o.runs[0]?.agentId === o.leadId && o.runs[0].status === "succeeded",
    "The only native execution answers the original human; no employee work, second turn or automatic continuation is invented while access is absent.");
  return c.result();
}
export const runtimeClaudeAccountCases = [runtimeDefinition("agents.hire-needs-account", async ctx => {
  const availability = await readNegativeRuntimeChoices(ctx, false), companyId = ctx.input.fixtures.company.id;
  const [accounts, agents, session] = await Promise.all([
    ctx.input.api.get<AiConnectionList>(`/api/companies/${companyId}/ai-connections`),
    ctx.input.api.get<RuntimeAgent[]>(`/api/companies/${companyId}/agents`),
    ctx.input.api.get<{ user: { id: string } }>("/api/auth/get-session"),
  ]);
  if (!session.user?.id || session.user.id === "local-board" || accounts.connections.some(row => row.provider === "anthropic" && row.status === "connected")
    || agents.some(row => row.name === "Morgan")) throw new Error("Missing-account context requires an actual person, absent Anthropic access and absent Morgan");
  await ctx.input.api.patch(`/api/companies/${companyId}`, { requireBoardApprovalForNewAgents: false });
  return { availability, initialAnthropicAccounts: 0, humanId: session.user.id, beforeAgents: agents, beforeAccountConfiguration: accountConfigurationDigest(accounts) };
}, gradeClaudeAccount, {
  authentication: "human-session", expectedRunCount: 1, expectedHumanMessageCount: 1, attemptTimeoutMs: 900000,
  sourceFiles: ["chat-catalog-domains/runtime-claude-account.ts", "chat-catalog-domains/runtime-negative-prerequisites.ts", "chat-catalog-domains/runtime-support.ts", "../../server/src/routes/adapters.ts", "../../server/src/services/agent-runner-selection.ts", "../../server/src/routes/connection-intents.ts", "../../server/src/services/connection-intent-delivery.ts", "chat-scenarios/agents.yaml"],
  async act(ctx, state) {
    await waitForReply(ctx); const before = await observeRuntime(ctx, state), source = ctx.input.page.url(), firstRun = before.runs[0]!;
    const requests = await ctx.input.api.get<ConnectionIntentInteraction[]>(`/api/issues/${ctx.issue()!.id}/interactions`);
    const cards = requests.filter(row => row.kind === "connection_intent" && row.sourceRunId === firstRun.id && row.payload.serviceSlug === "anthropic");
    const matches = (request: ConnectionIntentInteraction | undefined) => pendingClaudeSetupMatches({ request, sourceId: ctx.issue()!.id,
      sourceRunId: firstRun.id, companyId: before.companyId, humanId: typeof state.humanId === "string" ? state.humanId : "" });
    if (cards.length > 1 || cards.some(row => !matches(row))) throw new Error("Anthropic setup request is duplicated, resolved or addressed to another person");
    const target = before.links.find(href => supportedClaudeSetupLink(href, before.origin, ctx.input.fixtures.company.issuePrefix!));
    const request = cards[0]; state.setupRequestId = request?.id;
    if (request) state.visibleSetupText = await ctx.input.page.locator(`[data-interaction-id=${JSON.stringify(request.id)}]`).innerText();
    if (target) await ctx.input.page.locator(`[id^="comment-"] a[href=${JSON.stringify(target)}]`).first().click();
    else {
      if (!request) throw new Error("Canonical reply exposed no supported account setup handoff");
      await ctx.input.page.locator(`[data-interaction-id=${JSON.stringify(request.id)}]`).getByRole("button", { name: /Connect|Set up|Continue/i }).first().click();
    }
    await expect(ctx.input.page.getByRole("heading", { name: /connections|Connect.*Anthropic|Connect a model provider/i }).first()).toBeVisible();
    state.supportedSetupVisible = true;
    await ctx.input.page.goto(source, { waitUntil: "domcontentloaded" });
    const current = await ctx.input.api.get<ConnectionIntentInteraction[]>(`/api/issues/${ctx.issue()!.id}/interactions`);
    state.pendingSetupStillBound = request ? matches(current.find(row => row.id === request.id)) : !current.some(row => row.kind === "connection_intent" && row.sourceRunId === firstRun.id);
    await ctx.refreshIssue(); state.sourceWaiting = ctx.issue()?.conversationState === "waiting";
  },
  async observe(ctx, state) {
    const o = await observeRuntime(ctx, state), companyId = ctx.input.fixtures.company.id;
    const accounts = await ctx.input.api.get<AiConnectionList>(`/api/companies/${companyId}/ai-connections`);
    state.accountConfigurationUnchanged = accountConfigurationDigest(accounts) === state.beforeAccountConfiguration;
    state.anthropicAccountsAfter = accounts.connections.filter(row => row.provider === "anthropic" && row.status === "connected").length;
    const prior = state.beforeAgents as RuntimeAgent[];
    state.originalBindingsUnchanged = prior.every(before => { const after = o.agents.find(row => row.id === before.id);
      return !!after && after.adapterType === before.adapterType && JSON.stringify(after.adapterConfig) === JSON.stringify(before.adapterConfig) && after.defaultEnvironmentId === before.defaultEnvironmentId; });
    state.sourceWaiting = ctx.issue()?.conversationState === "waiting";
    return o;
  },
})];
