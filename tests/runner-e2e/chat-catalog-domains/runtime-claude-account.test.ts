import { expect, it } from "vitest";
import { gradeClaudeAccount, supportedClaudeSetupLink, pendingClaudeSetupMatches } from "./runtime-claude-account.js";
const availability = () => ({ companyId: "company", environmentId: "environment", scope: "supported-configuration-choices", claude: { type: "claude_local", loaded: true, disabled: false, supportedRunners: ["paperclip"] } });
function valid() { return { companyId: "company", leadId: "ceo", agents: [] as Array<Record<string, unknown>>, tasks: [], links: [], activity: [], humanQueries: ["Hire Morgan as a frontend engineer using Claude Code."], runs: [{ id: "first", agentId: "ceo", status: "succeeded" }], reply: "The Morgan frontend hire using Claude Code needs your Anthropic account. Connect it using this setup request; until then the hire is waiting for setup.", state: { beforeAgents: [] as Array<Record<string, unknown>>, initialAnthropicAccounts: 0, anthropicAccountsAfter: 0, availability: availability(), supportedSetupVisible: true, pendingSetupStillBound: true, accountConfigurationUnchanged: true, originalBindingsUnchanged: true, sourceWaiting: true } }; }
it("accepts the actual missing-account waiting branch without creating an employee or claiming provider access", () => {
  expect(gradeClaudeAccount(valid()).passed).toBe(true);
  const o = valid(); o.agents = [{ id: "pending", companyId: "company", name: "Morgan", lifecycleState: "paused", status: "paused", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }];
  expect(gradeClaudeAccount(o).passed).toBe(true);
});
it.each(["ready", "wrongHarness", "foreign", "duplicate", "account", "newAccount", "missingHandoff", "resolvedRequest", "rebound", "notWaiting", "employeeRun", "extraHuman", "falseReady", "runningDraft", "missingLifecycle"])("rejects %s instead of treating a missing-account request as a completed hire", invalid => {
  const o = valid();
  if (["ready", "wrongHarness", "foreign", "duplicate"].includes(invalid)) o.agents = [{ id: "morgan", companyId: invalid === "foreign" ? "foreign" : "company", name: "Morgan", lifecycleState: invalid === "ready" ? "ready" : "paused", status: "paused", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: invalid === "wrongHarness" ? "codex" : "claude" } }];
  if (invalid === "duplicate") o.agents.push({ ...o.agents[0], id: "duplicate" });
  if (invalid === "account") o.state.anthropicAccountsAfter = 1;
  if (invalid === "newAccount") o.state.accountConfigurationUnchanged = false;
  if (invalid === "missingHandoff") o.state.supportedSetupVisible = false;
  if (invalid === "resolvedRequest") o.state.pendingSetupStillBound = false;
  if (invalid === "rebound") o.state.originalBindingsUnchanged = false;
  if (invalid === "notWaiting") o.state.sourceWaiting = false;
  if (invalid === "employeeRun") o.runs.push({ id: "employee", agentId: "morgan", status: "succeeded" });
  if (invalid === "extraHuman") o.humanQueries.push("Invented continuation");
  if (invalid === "runningDraft" || invalid === "missingLifecycle") o.agents = [{ id: "morgan", companyId: "company", name: "Morgan", lifecycleState: invalid === "runningDraft" ? "paused" : undefined, status: invalid === "runningDraft" ? "running" : "paused", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }];
  if (invalid === "falseReady") o.reply = "Morgan is ready for work. Connect the missing Anthropic account later for this frontend Claude hire.";
  expect(gradeClaudeAccount(o).passed).toBe(false);
});
it("rejects missing evidence and unsupported configuration availability", () => { expect(gradeClaudeAccount(undefined).passed).toBe(false); const o = valid(); o.state.availability.claude.disabled = true; expect(gradeClaudeAccount(o).passed).toBe(false); });
it("accepts exact same-company setup routes and rejects foreign company/provider and prefixed lookalikes", () => {
  for (const href of ["/ACORN/apps/connect?source=anthropic", "http://fixture.invalid/ACORN/apps/connect?provider=claude", "/ACORN/company/settings/connections"]) expect(supportedClaudeSetupLink(href, "http://fixture.invalid", "ACORN")).toBe(true);
  for (const href of ["https://foreign.invalid/ACORN/apps/connect?source=anthropic", "/BIRCH/apps/connect?source=anthropic", "/ACORN/apps/connect?source=openai", "/ACORN/foreign/company/settings/connections"]) expect(supportedClaudeSetupLink(href, "http://fixture.invalid", "ACORN")).toBe(false);
});
it("keeps setup pending for the original actual person/source/native run and never accepts a completion", () => {
  const value = { sourceId: "source", sourceRunId: "first", companyId: "company", humanId: "person", request: { kind: "connection_intent", issueId: "source", companyId: "company", sourceRunId: "first", addresseeUserId: "person", status: "pending", resolvedByUserId: null, resolvedByAgentId: null, payload: { serviceSlug: "anthropic" } } } as unknown as Parameters<typeof pendingClaudeSetupMatches>[0];
  expect(pendingClaudeSetupMatches(value)).toBe(true);
  for (const patch of [{ status: "accepted" }, { sourceRunId: "wrong-run" }, { addresseeUserId: "wrong-human" }, { resolvedByAgentId: "agent" }, { issueId: "foreign-source" }, { companyId: "foreign" }, { payload: { serviceSlug: "openai" } }]) expect(pendingClaudeSetupMatches({ ...value, request: { ...value.request!, ...patch } as typeof value.request })).toBe(false);
  expect(pendingClaudeSetupMatches({ ...value, humanId: "" })).toBe(false);
});

it.each(["ready", "pending", "alongsideMorgan"])("rejects an unrelated NEW employee in %s state despite truthful setup guidance", variant => {
  const o = valid();
  o.agents.push({ id: "unexpected", name: "Jordan", companyId: "company", lifecycleState: variant === "ready" ? "ready" : "paused", status: "idle", adapterType: "paperclip_runner", adapterConfig: { provider: "opencode" } });
  if (variant === "alongsideMorgan") o.agents.push({ id: "requested", name: "Morgan", companyId: "company", lifecycleState: "paused", status: "paused", adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } });
  expect(gradeClaudeAccount(o).passed).toBe(false);
});
it("permits an unchanged pre-existing unrelated employee, while requiring the original inventory", () => {
  const o = valid(), existing = { id: "existing", name: "Jordan", companyId: "company", lifecycleState: "ready", status: "idle", adapterType: "paperclip_runner", adapterConfig: { provider: "opencode" } };
  o.state.beforeAgents.push(existing); o.agents.push(existing);
  expect(gradeClaudeAccount(o).passed).toBe(true);
  delete (o.state as Partial<typeof o.state>).beforeAgents;
  expect(gradeClaudeAccount(o).passed).toBe(false);
});
