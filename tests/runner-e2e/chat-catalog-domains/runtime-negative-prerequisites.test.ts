import { beforeEach, expect, it, vi } from "vitest";
import path from "node:path";
import { getEnvironmentCapabilities } from "../../../packages/shared/src/environment-support.js";
import { authorizeManualPrivateEvidence, MANUAL_PRIVATE_PROTOCOL } from "../manual-private-retention.js";
import { cleanupNegativeRuntimeChoices } from "./runtime-negative-prerequisites.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { runtimeClaudeAccountCases } from "./runtime-claude-account.js";
import { runtimeCloudChoiceCases } from "./runtime-cloud-choice.js";
import { prepareOwnedDaytonaSdk } from "./runtime-negative-plugin-sdk.js";
vi.mock("./runtime-negative-plugin-sdk.js", () => ({ prepareOwnedDaytonaSdk: vi.fn(async () => {}) }));
beforeEach(() => vi.clearAllMocks());
function cloudCapabilities() {
  return getEnvironmentCapabilities(["claude_local", "paperclip_runner"], { sandboxProviders: { daytona: {
    status: "supported", source: "plugin", pluginKey: "paperclip.daytona-sandbox-provider", pluginId: "daytona-id", supportsRunExecution: true,
  } } });
}
function fixture(id: string) {
  const calls: string[] = [];
  const api = { get: vi.fn<(route: string) => Promise<unknown>>(async (route: string) => { calls.push(`GET ${route}`);
    if (route.startsWith("/api/adapters?")) return [{ type: "claude_local", loaded: true, disabled: false, supportedRunners: ["paperclip", "legacy"] }];
    if (route.endsWith("/environments/capabilities")) return cloudCapabilities();
    if (route.endsWith("/environments")) return [{ id: "environment", driver: "local", config: {} }];
    if (route.endsWith("/ai-connections")) return { connections: [] };
    if (route.endsWith("/agents")) return [{ id: "ceo", companyId: "company", name: "CEO", adapterType: "paperclip_runner", adapterConfig: { provider: "opencode" }, defaultEnvironmentId: "environment" }];
    if (route === "/api/auth/get-session") return { user: { id: "person" } };
    throw new Error(`Unexpected public read ${route}`);
  }), patch: vi.fn(async () => ({})), post: vi.fn<(route: string, body?: unknown, options?: unknown) => Promise<unknown>>(async () => { throw new Error("Unexpected mutation or external setup"); }), delete: vi.fn() };
  const ctx = { scenario: { id }, observationDeadlineAt: Date.now() + 870000, input: { api, privateSecrets: [], nonce: "nonce", execution: { id: `chat-features.runner-opencode.local.${id}` }, fixtures: { company: { id: "company" }, agent: { id: "ceo" }, environment: { id: "environment" } }, evidence: vi.fn() } } as unknown as ChatCatalogContext;
  return { ctx, api, calls };
}
it("actual missing-account setup admits a genuine absent-account catalog without a provider key or employee inference", async () => {
  const f = fixture("agents.hire-needs-account"); const state = await runtimeClaudeAccountCases[0]!.setup(f.ctx);
  expect(state.initialAnthropicAccounts).toBe(0); expect(f.api.post).not.toHaveBeenCalled();
});
it("actual ambiguity setup accepts independently published supported configuration choices without a cloud lease or account", async () => {
  const f = fixture("agents.ambiguous-cloud-code"); const state = await runtimeCloudChoiceCases[0]!.setup(f.ctx);
  expect(state.claudeAvailable).toBe(true); expect(state.cloudAvailable).toBe(true); expect(f.api.post).not.toHaveBeenCalled();
});

it.each(["missing", "disabled", "legacyOnly"])("actual missing-account setup rejects %s Claude configuration choice before any mutation", async invalid => {
  const f = fixture("agents.hire-needs-account");
  f.api.get.mockResolvedValueOnce(invalid === "missing" ? [] : [{ type: "claude_local", loaded: true, disabled: invalid === "disabled", supportedRunners: invalid === "legacyOnly" ? ["legacy"] : ["paperclip"] }]);
  await expect(runtimeClaudeAccountCases[0]!.setup(f.ctx)).rejects.toThrow(/catalog/);
  expect(f.api.patch).not.toHaveBeenCalled(); expect(f.api.post).not.toHaveBeenCalled();
});
it("actual missing-account setup rejects an existing usable account instead of pretending it is missing", async () => {
  const f = fixture("agents.hire-needs-account"), read = f.api.get.getMockImplementation()!;
  f.api.get.mockImplementation(route => route.endsWith("/ai-connections") ? Promise.resolve({ connections: [{ id: "existing", provider: "anthropic", status: "connected" }] }) : read(route));
  await expect(runtimeClaudeAccountCases[0]!.setup(f.ctx)).rejects.toThrow(/absent Anthropic/); expect(f.api.patch).not.toHaveBeenCalled();
});
it.each(["foreignExecution", "expired"])("actual selected setup rejects %s before a public read", async invalid => {
  const f = fixture("agents.ambiguous-cloud-code");
  if (invalid === "expired") Object.assign(f.ctx, { observationDeadlineAt: Date.now() - 1 });
  else f.ctx.input.execution.id = "chat-features.runner-codex.local.agents.ambiguous-cloud-code";
  await expect(runtimeCloudChoiceCases[0]!.setup(f.ctx)).rejects.toThrow(); expect(f.api.get).not.toHaveBeenCalled(); expect(f.api.post).not.toHaveBeenCalled();
  expect(prepareOwnedDaytonaSdk).not.toHaveBeenCalled();
});
function pluginFixture(existing = false, fail = false) {
  const f = fixture("agents.ambiguous-cloud-code"), read = f.api.get.getMockImplementation()!;
  let installed = existing;
  const plugin = { id: "daytona-id", pluginKey: "paperclip.daytona-sandbox-provider", packagePath: path.resolve(import.meta.dirname, "../../../packages/plugins/sandbox-providers/daytona"), status: fail ? "error" : "ready" };
  f.api.get.mockImplementation(async route => {
    if (route.endsWith("/environments/capabilities")) return installed && !fail ? cloudCapabilities() : getEnvironmentCapabilities(["claude_local", "paperclip_runner"]);
    if (route === "/api/plugins") return existing ? [plugin] : [];
    if (route === `/api/plugins/${plugin.id}`) return plugin;
    return read(route);
  });
  f.api.post.mockImplementation(async () => { installed = true; return plugin; });
  return { ...f, plugin };
}
it("actual ambiguity setup can register the bundled provider and owns only its local plugin cleanup, with no environment, secret or probe call", async () => {
  const f = pluginFixture(); const result = await runtimeCloudChoiceCases[0]!.setup(f.ctx);
  expect(result.cloudAvailable).toBe(true); expect(f.api.post).toHaveBeenCalledExactlyOnceWith("/api/plugins/install", { packageName: f.plugin.packagePath, isLocalPath: true }, expect.objectContaining({ timeout: expect.any(Number) }));
  expect(prepareOwnedDaytonaSdk).toHaveBeenLastCalledWith(path.resolve(f.plugin.packagePath, "../../../.."), f.ctx.observationDeadlineAt);
  await cleanupNegativeRuntimeChoices(f.ctx); expect(f.api.delete).toHaveBeenCalledExactlyOnceWith(`/api/plugins/${f.plugin.id}`, { allowNotFound: true });
});
it("actual ambiguity setup never replaces or removes an existing failed plugin", async () => {
  const f = pluginFixture(true, true); await expect(runtimeCloudChoiceCases[0]!.setup(f.ctx)).rejects.toThrow(/plugin failed/);
  expect(f.api.post).not.toHaveBeenCalled(); expect(f.api.delete).not.toHaveBeenCalled();
});
it("actual ambiguity partial setup preserves the original failure and removes its own plugin", async () => {
  const f = pluginFixture(false, true); await expect(runtimeCloudChoiceCases[0]!.setup(f.ctx)).rejects.toThrow(/plugin failed/);
  expect(f.api.delete).toHaveBeenCalledExactlyOnceWith(`/api/plugins/${f.plugin.id}`, { allowNotFound: true });
});
it("actual ambiguity partial cleanup preserves both errors and rejects changed plugin ownership before deletion", async () => {
  const f = pluginFixture(false, true); f.plugin.packagePath = "/foreign";
  let error: unknown; try { await runtimeCloudChoiceCases[0]!.setup(f.ctx); } catch (value) { error = value; }
  expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors.map(value => String(value))).toEqual([expect.stringContaining("plugin failed"), expect.stringContaining("identity changed")]);
  expect(f.api.delete).not.toHaveBeenCalled();
});

it("actual ambiguity setup requires the published execution capability, not plugin health alone", async () => {
  const f = pluginFixture(true), read = f.api.get.getMockImplementation()!;
  f.api.get.mockImplementation(route => route.endsWith("/environments/capabilities") ? Promise.resolve(getEnvironmentCapabilities(["claude_local", "paperclip_runner"])) : read(route));
  await expect(runtimeCloudChoiceCases[0]!.setup(f.ctx)).rejects.toThrow(/capability is unavailable/);
  expect(f.api.post).not.toHaveBeenCalled(); expect(f.api.delete).not.toHaveBeenCalled();
});
it.each(["agents.hire-needs-account", "agents.ambiguous-cloud-code"])("future private source policy admits the exact %s tuple without claiming deployment", id => {
  const identity = { workflowSha: "1".repeat(40), targetSha: "2".repeat(40), runId: "123", attempt: "1", executionIds: [`chat-features.runner-opencode.local.${id}`] };
  const approval = JSON.stringify({ version: 1, approvals: [{ ...identity, protocol: MANUAL_PRIVATE_PROTOCOL, launchSha256: "3".repeat(64) }] });
  expect(authorizeManualPrivateEvidence(identity, approval).executionIds).toEqual(identity.executionIds);
  expect(() => authorizeManualPrivateEvidence({ ...identity, runId: "124" }, approval)).toThrow(/approval missing/);
});
