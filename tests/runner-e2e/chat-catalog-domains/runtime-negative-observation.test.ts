import { expect, it, vi } from "vitest";
import type { AiManagedConnectionSummary } from "../../../packages/shared/src/ai-connections.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { accountConfigurationDigest } from "./runtime-negative-prerequisites.js";
const boundary = vi.hoisted(() => ({ agents: [] as Array<Record<string, unknown>> }));
vi.mock("./runtime-support.js", async original => ({ ...await original<object>(), observeRuntime: vi.fn(async (_ctx, state) => ({
  scenarioId: "selected", companyId: "company", leadId: "ceo", agents: boundary.agents, tasks: [], projects: [], goals: [], comments: [], documents: [], revisions: [], links: [], activity: [],
  humanQueries: ["canonical"], runs: [{ id: "first", agentId: "ceo", status: "succeeded" }], state,
  reply: "For this engineer hire, do you mean Claude Code or an agent running on a cloud computer?",
})) }));
vi.mock("./identity-support.js", async original => ({ ...await original<object>(), waitForReply: vi.fn(async () => undefined) }));
import { runtimeCloudChoiceCases, gradeCloudChoice } from "./runtime-cloud-choice.js";
import { runtimeClaudeAccountCases, gradeClaudeAccount } from "./runtime-claude-account.js";
const lead = () => ({ id: "ceo", companyId: "company", name: "CEO", adapterType: "paperclip_runner", adapterConfig: { provider: "opencode" }, defaultEnvironmentId: "environment" });
function fixture() {
  const environment = { id: "environment", driver: "local", config: {} };
  const accounts: Array<{ id: string; provider?: string; status?: string }> = [];
  const environments = [environment]; boundary.agents = [lead()];
  const state: Record<string, unknown> = { availability: { companyId: "company", environmentId: "environment", scope: "supported-configuration-choices", claude: { type: "claude_local", loaded: true, disabled: false, supportedRunners: ["paperclip"] }, cloud: { provider: "daytona", pluginId: "daytona-id", pluginKey: "paperclip.daytona-sandbox-provider", status: "supported", supportsRunExecution: true } }, beforeAgents: [lead()], beforeAccountConfiguration: accountConfigurationDigest({ connections: [] }),
    beforeEnvironments: [{ id: "environment", driver: "local", configSha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a" }],
    questionVisible: true, clarificationAuthorityBound: true, claudeAvailable: true, cloudAvailable: true, sourceWaiting: true, initialAnthropicAccounts: 0, supportedSetupVisible: true, pendingSetupStillBound: true };
  const ctx = { issue: () => ({ conversationState: "waiting" }), input: { fixtures: { company: { id: "company" } }, api: { get: vi.fn(async (route: string) => {
    if (route.endsWith("/environments")) return environments;
    if (route.endsWith("/ai-connections")) return { connections: accounts };
    throw new Error("Unexpected public read");
  }) } } } as unknown as ChatCatalogContext;
  return { ctx, state, accounts, environments };
}
it.each(["valid", "agentCreated", "rebound", "targetCreated", "targetChanged", "accountCreated"])("actual ambiguity observer derives %s from durable public state despite a correct-sounding clarification", async variant => {
  const f = fixture();
  if (variant === "agentCreated") boundary.agents.push({ id: "morgan", companyId: "company", name: "Morgan" });
  if (variant === "rebound") boundary.agents[0]!.defaultEnvironmentId = "changed";
  if (variant === "targetCreated") f.environments.push({ id: "committed", driver: "sandbox", config: {} });
  if (variant === "targetChanged") f.environments[0]!.driver = "ssh";
  if (variant === "accountCreated") f.accounts.push({ id: "fabricated", provider: "anthropic", status: "connected" });
  const actual = await runtimeCloudChoiceCases[0]!.observe(f.ctx, f.state);
  expect(gradeCloudChoice(actual).passed).toBe(variant === "valid");
});
it.each(["valid", "readyMorgan", "wrongHarness", "unexpectedReady", "unexpectedPending", "accountCreated", "rebound"])("actual missing-account observer rejects %s when saved state conflicts with a truthful waiting reply", async variant => {
  const f = fixture();
  if (["readyMorgan", "wrongHarness"].includes(variant)) boundary.agents.push({ id: "morgan", companyId: "company", name: "Morgan", lifecycleState: variant === "readyMorgan" ? "ready" : "paused", status: "paused", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: variant === "wrongHarness" ? "codex" : "claude" } });
  if (variant.startsWith("unexpected")) boundary.agents.push({ id: "unexpected", companyId: "company", name: "Jordan", lifecycleState: variant === "unexpectedReady" ? "ready" : "paused", status: "idle", adapterType: "paperclip_runner", adapterConfig: { provider: "opencode" } });
  if (variant === "accountCreated") f.accounts.push({ id: "fabricated", provider: "anthropic", status: "connected" });
  if (variant === "rebound") boundary.agents[0]!.defaultEnvironmentId = "changed";
  const actual = await runtimeClaudeAccountCases[0]!.observe(f.ctx, f.state);
  (actual as { reply: string }).reply = "Your requested Morgan frontend hire using Claude Code needs an Anthropic account. Connect it; until then the hire is waiting for setup.";
  expect(gradeClaudeAccount(actual).passed).toBe(variant === "valid");
});

it("actual ambiguity observer rejects changed account configuration even when the saved account ID is unchanged", async () => {
  const f = fixture();
  const account: AiManagedConnectionSummary = { id: "account", grantId: "grant", companyId: "company", provider: "openrouter", method: "api_key", name: "Controller", ownership: "shared", isDefault: true, status: "connected" };
  f.state.beforeAccountConfiguration = accountConfigurationDigest({ connections: [account] });
  const changed = { ...account, grantId: "changed-grant" }; f.accounts.push(changed);
  const actual = await runtimeCloudChoiceCases[0]!.observe(f.ctx, f.state);
  expect(gradeCloudChoice(actual).passed).toBe(false);
});
it.each(["foreignPerson", "foreignCompany", "foreignRun"])("actual clarification caller rejects %s question custody before any UI action", async variant => {
  const f = fixture(); f.state.humanId = "person";
  const source = { id: "source", conversationState: "waiting" };
  const request = { id: "question", kind: "ask_user_questions", status: "pending", issueId: "source", companyId: variant === "foreignCompany" ? "foreign" : "company", sourceRunId: variant === "foreignRun" ? "foreign" : "first", addresseeUserId: variant === "foreignPerson" ? "other" : "person" };
  Object.assign(f.ctx, { issue: () => source, allRuns: async () => [{ id: "first" }] });
  const get = vi.fn(async () => [request]); const ui = vi.fn(() => { throw new Error("Unexpected UI action"); });
  Object.assign(f.ctx.input, { api: { get }, page: { getByTestId: ui } });
  await expect(runtimeCloudChoiceCases[0]!.act!(f.ctx, f.state)).rejects.toThrow(/attributed/);
  expect(ui).not.toHaveBeenCalled();
});
