import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunnerApi } from "./api.js";
import { buildRuntimeUsage } from "./billing.js";
import { runnerMatrix } from "./catalog.js";
import { setupLiveFixtures, selectFixtureRuntimeLeases, fixtureRuntimeCostCoverage } from "./live-fixtures.js";

describe("live runner fixtures", () => {
  it.each([
    ["receipt-smoke", 100], ["same-task-roundtrip", 1_000],
  ] as const)("bounds %s before creating its initial subscription agent", async (taskId, budget) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "case-fixture-limits-")));
    const home = path.join(root, "paperclip-home");
    await mkdir(home);
    vi.stubEnv("PAPERCLIP_RUNNER_E2E_TEMP_ROOT", root);
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_INSTANCE_ID", "runner-e2e-case-fixture-test");
    const execution = runnerMatrix.find(row => row.id === `case-handoffs.runner-codex-subscription.local.${taskId}`)!;
    const companyId = "11111111-2222-4333-8444-555555555555";
    let companyBody: any;
    let agentBody: any;
    let fixtures: Awaited<ReturnType<typeof setupLiveFixtures>> | undefined;
    const api = {
      async get() { return [{ id: "local", driver: "local" }]; },
      async post(url: string, data: any) {
        if (url === "/api/companies") { companyBody = data; return { id: companyId, name: "Test" }; }
        if (url.endsWith("/agents")) { agentBody = data; return { id: "triage", ...data }; }
        throw new Error(`Unexpected POST ${url}`);
      },
    } as unknown as RunnerApi;
    try {
      fixtures = await setupLiveFixtures({ api, execution, executionNonce: "fixture-limit-test", workspacePath: path.join(root, "workspace"),
        credentials: { CODEX_AUTH_JSON: JSON.stringify({ tokens: { account_id: "synthetic-account", access_token: "synthetic-access",
          refresh_token: "synthetic-refresh", id_token: "synthetic-id" } }) } });
      expect(companyBody.budgetMonthlyCents).toBe(budget);
      expect(agentBody.budgetMonthlyCents).toBe(budget);
      expect(agentBody).not.toHaveProperty("instructionsBundle");
      expect(agentBody.adapterConfig.env).toMatchObject({ OPENAI_API_KEY: "", CODEX_API_KEY: "" });
      if (taskId === "receipt-smoke") {
        expect(agentBody.adapterConfig).toMatchObject({ provider: "codex", timeoutSec: 90, modelReasoningEffort: "low" });
        expect(agentBody.runtimeConfig.heartbeat).toMatchObject({ enabled: false, maxConcurrentRuns: 1, maxDailyRuns: 1, maxDailyCostCents: 100 });
      } else {
        expect(agentBody.adapterConfig).not.toHaveProperty("modelReasoningEffort");
        expect(agentBody.runtimeConfig).not.toHaveProperty("heartbeat");
      }
    } finally {
      await fixtures?.teardown();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["runner-codex", "runner-acpx-claude", "runner-opencode"].flatMap(profile =>
    ["hire-reuse", "delegate-feedback"].map(task => [profile, task]))) (
    "applies %s %s budget stops in actual setup with a nonce and only its selected credential", async (profile, task) => {
      const execution = runnerMatrix.find(row => row.id === `everyday-workflows.${profile}.local.${task}`)!;
      let agentBody: any;
      let companyBody: any;
      const api = {
        async get() { return [{ id: "local", driver: "local" }]; },
        async postSensitive(url: string) { return url.endsWith("/ai-connections") ? { connectionId: "account" } : { id: "secret" }; },
        async post(url: string, data: any) {
          if (url === "/api/companies") { companyBody = data; return { id: "company", name: "Test" }; }
          if (url.endsWith("/agents")) { agentBody = data; return { id: "lead", ...data }; }
          throw new Error(`Unexpected POST ${url}`);
        },
      } as unknown as RunnerApi;
      const fixtures = await setupLiveFixtures({ api, execution, executionNonce: "random-nonce", workspacePath: "/tmp/test",
        credentials: { [execution.profile.credential]: "test-value" } });
      expect(companyBody.budgetMonthlyCents).toBe(1_000);
      expect(agentBody.budgetMonthlyCents).toBe(1_000);
      await fixtures.teardown();
    },
  );

  it.each(["runner-codex", "runner-acpx-claude", "runner-opencode"])(
    "sets both connection-guidance budget stops for %s before execution", async profile => {
      const execution = runnerMatrix.find(row => row.suite.id === "native-connection-guidance" && row.profile.id === profile)!;
      let companyBudget: unknown;
      let agentBudget: unknown;
      const api = {
        async get() { return [{ id: "local", driver: "local" }]; },
        async postSensitive() { return { id: "secret" }; },
        async post(url: string, data: any) {
          if (url === "/api/companies") { companyBudget = data.budgetMonthlyCents; return { id: "company", name: "Test" }; }
          if (url.endsWith("/agents")) { agentBudget = data.budgetMonthlyCents; return { id: "lead", ...data }; }
          throw new Error("Unexpected POST " + url);
        },
      } as unknown as RunnerApi;
      const fixtures = await setupLiveFixtures({ api, execution, executionNonce: "nonce", workspacePath: "/tmp/test",
        credentials: { [execution.profile.credential]: "test-value" } });
      expect(companyBudget).toBe(1_000);
      expect(agentBudget).toBe(1_000);
      await fixtures.teardown();
    },
  );

  it.each(["runner-codex", "legacy-codex", "runner-acpx-claude", "legacy-opencode"])(
    "creates a production-default %s hire with company and agent budget stops", async (profile) => {
      const execution = runnerMatrix.find(row => row.suite.id === "stock-harness" && row.profile.id === profile)!;
      let agentBody: any;
      const api = {
        async get() { return [{ id: "local", driver: "local" }]; },
        async postSensitive() { return { id: "secret" }; },
        async post(url: string, data: any) {
          if (url === "/api/companies") {
            expect(data.budgetMonthlyCents).toBe(1_000);
            return { id: "company", name: "Fixture" };
          }
          if (url.endsWith("/agents")) { agentBody = data; return { id: "agent", ...data }; }
          throw new Error(`Unexpected POST ${url}`);
        },
      } as unknown as RunnerApi;
      const fixtures = await setupLiveFixtures({ api, execution, executionNonce: "nonce", workspacePath: "/tmp/fixture",
        credentials: { [execution.profile.credential]: "fixture-key" } });
      expect(agentBody).not.toHaveProperty("instructionsBundle");
      expect(agentBody.budgetMonthlyCents).toBe(1_000);
      expect(agentBody.adapterConfig.env[execution.profile.credential]).toEqual({ type: "secret_ref", secretId: "secret", version: "latest" });
      await fixtures.teardown();
    },
  );
  it("anchors extended file validation to a public project workspace for local and remote copy-back", async () => {
    const execution = runnerMatrix.find(e => e.id === "extended-harnesses.runner-acpx-pi.local.file-edit-validate")!;
    let projectBody: any;
    const api = {
      async get() { return [{ id: "local", driver: "local" }]; },
      async postSensitive() { return { id: "secret" }; },
      async post(url: string, data: any) {
        if (url === "/api/companies") return { id: "company", name: "Test" };
        if (url.endsWith("/agents")) return { id: "agent", ...data };
        if (url.endsWith("/projects")) { projectBody = data; return { id: "project", ...data }; }
        throw new Error(`Unexpected POST ${url}`);
      },
    } as unknown as RunnerApi;
    const fixtures = await setupLiveFixtures({ api, execution, executionNonce: "nonce", workspacePath: "/tmp/fixture-workspace", credentials: { OPENROUTER_API_KEY: "fixture-key" } });
    expect(fixtures.project?.id).toBe("project");
    expect(projectBody).toMatchObject({ executionWorkspacePolicy: { environmentId: "local", workspaceStrategy: { type: "project_primary" } }, workspace: { cwd: "/tmp/fixture-workspace", sourceType: "local_path" } });
  });

  it.each([
    ["runner-codex", "hiring-templates", "hire-coder-template-reuse"],
    ["runner-acpx-claude", "hiring-templates", "hire-coder-template-reuse"],
    ["runner-codex", "everyday-workflows", "hire-reuse"],
    ["runner-acpx-claude", "everyday-workflows", "hire-reuse"],
    ["runner-opencode", "everyday-workflows", "hire-reuse"],
    ["runner-codex", "agent-chat-hardening", "hire-delegate-reuse"],
    ["runner-acpx-claude", "agent-chat-hardening", "hire-delegate-reuse"],
  ])(
    "gives %s %s/%s a personal managed account without env overrides",
    async (profile, suite, task) => {
      const execution = runnerMatrix.find(
        (e) =>
          e.suite.id === suite &&
          e.task.id === task &&
          e.profile.id === profile &&
          e.environment.id === "local",
      )!;
      const provider =
        profile === "runner-acpx-claude" ? "anthropic" : profile === "runner-opencode" ? "openrouter" : "openai";
      let connected = false;
      let agentBody: any;
      const api = {
        async post(url: string, data: any) {
          if (url === "/api/companies") return { id: "company", name: "Test" };
          if (url.endsWith("/agents")) {
            agentBody = data;
            return { id: "lead", ...data };
          }
          throw new Error(`Unexpected POST ${url}`);
        },
        async postSensitive(url: string, data: any) {
          if (url.endsWith("/ai-connections")) {
            expect(data).toMatchObject({
              provider,
              method: "api_key",
              ownership: "personal",
              apiKey: "test-value",
              agentIds: [],
              allAgents: false,
            });
            connected = true;
            return { connectionId: "managed-account" };
          }
          return { id: "secret" };
        },
        async get() {
          return [{ id: "local", driver: "local" }];
        },
      } as unknown as RunnerApi;
      const fixtures = await setupLiveFixtures({
        api,
        execution,
        executionNonce: "nonce",
        workspacePath: "/tmp/test",
        credentials: {
          [execution.profile.credential]: "test-value",
        },
      });
      expect(connected).toBe(true);
      expect(agentBody.adapterConfig.env).toBeUndefined();
      expect(agentBody.runtimeConfig.aiConnection).toEqual({
        provider,
        method: "api_key",
        mode: "responsible_user",
      });
      expect((fixtures as any).aiConnection.connectionId).toBe(
        "managed-account",
      );
    },
  );

  it.each(["legacy-codex", "runner-acpx-claude", "runner-opencode"])("installs Daytona before its %s environment without adding a Codex qualification probe", async profile => {
    const calls: string[] = [];
    const api = {
      async post(path: string, data?: Record<string, unknown>) {
        calls.push(`POST ${path}`);
        if (path === "/api/plugins/install") {
          expect(data).toMatchObject({ isLocalPath: true });
          expect(data?.packageName).toEqual(
            expect.stringContaining(
              "packages/plugins/sandbox-providers/daytona",
            ),
          );
          return {
            id: "plugin-daytona",
            pluginKey: "paperclip.daytona-sandbox-provider",
            status: "ready",
          };
        }
        if (path === "/api/companies") {
          return { id: "company-1", name: "Runner E2E" };
        }
        if (path.endsWith("/environments")) {
          expect(calls).toContain("POST /api/plugins/install");
          return { id: "environment-1", driver: "sandbox", config: data?.config };
        }
        if (path.endsWith("/agents")) {
          return { id: "agent-1", name: "Agent", companyId: "company-1" };
        }
        throw new Error(`Unexpected POST ${path}`);
      },
      async postSensitive(path: string, data?: Record<string, unknown>) {
        calls.push(`POST ${path}`);
        return { id: `secret-${String(data?.key).toLowerCase()}` };
      },
      async delete(path: string) {
        calls.push(`DELETE ${path}`);
      },
    } as unknown as RunnerApi;
    const execution = runnerMatrix.find(
      (candidate) =>
        candidate.id ===
        `core-compatibility.${profile}.daytona.message-marker`,
    );
    expect(execution).toBeDefined();

    const fixtures = await setupLiveFixtures({
      api,
      execution: execution!,
      executionNonce: "nonce",
      workspacePath: "/tmp/workspace",
      credentials: {
        [execution!.profile.credential]: "provider-test-value",
        DAYTONA_API_KEY: "daytona-test-value",
      },
      daytonaImage:
        "ghcr.io/paperclip/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(calls.indexOf("POST /api/plugins/install")).toBeLessThan(
      calls.indexOf("POST /api/companies/company-1/environments"),
    );
    expect(calls.some(call => call.includes("/probe"))).toBe(false);
    await fixtures.teardown();
    expect(calls).toContain(
      "DELETE /api/environments/environment-1?destroyReusableSandboxLeases=true",
    );
  });

  it.each(["explicit", "auto"])("qualifies the immutable Codex image once before %s agent creation", async mode => {
    const original = runnerMatrix.find(row => row.id === "core-compatibility.runner-codex.daytona.message-marker")!;
    const execution = { ...original, profile: { ...original.profile, buildAgent(input: Parameters<typeof original.profile.buildAgent>[0]) {
      const payload = original.profile.buildAgent(input);
      return { ...payload, adapterType: mode === "auto" ? "codex_local" : "paperclip_runner",
        runner: mode === "auto" ? "auto" : "paperclip" };
    } } };
    const calls: string[] = [];
    const api = {
      async get(path: string) {
        calls.push(`GET ${path}`);
        return [{ type: "codex_local", defaultRunner: "paperclip", supportedRunners: ["paperclip", "legacy"] }];
      },
      async post(path: string, data: any, options: any) {
        calls.push(`POST ${path}`);
        if (path === "/api/plugins/install") return { id: "plugin", status: "ready" };
        if (path === "/api/companies") return { id: "company", name: "Fixture" };
        if (path.endsWith("/environments")) return { id: "environment", driver: "sandbox", config: data.config };
        if (path === "/api/environments/environment/probe?companyId=company") {
          expect(options).toEqual({ timeout: 330_000 });
          return { ok: true, details: { platformQualificationRecorded: true, leaseId: "setup-probe" } };
        }
        if (path.endsWith("/agents")) {
          expect(calls).toContain("POST /api/environments/environment/probe?companyId=company");
          expect(data.adapterType).toBe(mode === "auto" ? "codex_local" : "paperclip_runner");
          expect(data.runner).toBe(mode === "auto" ? "auto" : "paperclip");
          if (mode === "auto") expect(calls).toContain("GET /api/adapters?companyId=company&environmentId=environment");
          return { id: "agent", companyId: "company", ...data };
        }
        throw new Error(`Unexpected POST ${path}`);
      },
      async postSensitive() { return { id: "secret" }; },
      async delete() {},
    } as unknown as RunnerApi;
    const fixtures = await setupLiveFixtures({ api, execution, executionNonce: "nonce", workspacePath: "/tmp/fixture",
      credentials: { OPENAI_API_KEY: "fixture-key", DAYTONA_API_KEY: "fixture-provider-key" },
      daytonaImage: `registry.example.test/runtime@sha256:${"a".repeat(64)}` });
    expect(fixtures.setupProbe).toMatchObject({ leaseId: "setup-probe", ...(mode === "auto" ? { defaultRunner: "paperclip" } : {}) });
    expect(calls.filter(call => call.includes("/probe?"))).toHaveLength(1);
    expect(calls.filter(call => call.startsWith("GET"))).toHaveLength(mode === "auto" ? 1 : 0);
    await fixtures.teardown();
  });

  it.each(["probe-failed", "not-recorded", "wrong-default"])("stops before automatic Codex creation when image qualification is %s", async failure => {
    const original = runnerMatrix.find(row => row.id === "core-compatibility.runner-codex.daytona.message-marker")!;
    const execution = { ...original, profile: { ...original.profile, buildAgent(input: Parameters<typeof original.profile.buildAgent>[0]) {
      return { ...original.profile.buildAgent(input), adapterType: "codex_local", runner: "auto" };
    } } };
    const calls: string[] = [];
    const api = {
      async get() { return [{ type: "codex_local", defaultRunner: "legacy", supportedRunners: ["legacy"] }]; },
      async post(path: string, data: any) {
        calls.push(path);
        if (path === "/api/plugins/install") return { id: "plugin", status: "ready" };
        if (path === "/api/companies") return { id: "company", name: "Fixture" };
        if (path.endsWith("/environments")) return { id: "environment", driver: "sandbox", config: data.config };
        if (path.includes("/probe?")) return { ok: failure !== "probe-failed",
          details: { platformQualificationRecorded: failure !== "not-recorded", leaseId: "setup-probe" } };
        throw new Error(`Unexpected POST ${path}`);
      },
      async postSensitive() { return { id: "secret" }; },
      async delete(path: string) { calls.push(`DELETE ${path}`); },
    } as unknown as RunnerApi;
    await expect(setupLiveFixtures({ api, execution, executionNonce: "nonce", workspacePath: "/tmp/fixture",
      credentials: { OPENAI_API_KEY: "fixture-key", DAYTONA_API_KEY: "fixture-provider-key" },
      daytonaImage: `registry.example.test/runtime@sha256:${"a".repeat(64)}` })).rejects.toThrow(failure === "wrong-default" ? "server-owned default" : "not recorded");
    expect(calls.some(call => call.endsWith("/agents"))).toBe(false);
    expect(calls.filter(call => call.includes("/probe?"))).toHaveLength(1);
    expect(calls).toContain("DELETE /api/environments/environment?destroyReusableSandboxLeases=true");
  });

  it("includes the owned setup probe in existing runtime estimates while excluding unrelated leases", () => {
    const lease = (id: string, duration: number, heartbeatRunId?: string) => ({ id, provider: "daytona", heartbeatRunId,
      acquiredAt: "2026-10-12T00:00:00Z", releasedAt: new Date(Date.parse("2026-10-12T00:00:00Z") + duration).toISOString(),
      metadata: { cpu: 4, memory: 4, disk: 10 } });
    const leases = [lease("task", 20_000, "selected-run"), lease("setup-probe", 10_000), lease("unrelated", 600_000, "other-run")];
    const selected = selectFixtureRuntimeLeases({ leases, runIds: ["selected-run"], setupProbeLeaseId: "setup-probe" });
    expect(selected.map(value => value.id)).toEqual(["task", "setup-probe"]);
    const usage = buildRuntimeUsage({ environmentId: "daytona", runs: [], leases: selected });
    expect(usage.leaseCount).toBe(2);
    expect(usage.leaseDurationMs).toBe(30_000);
    expect(usage.costStatus).toBe("estimated");
    expect(usage.estimatedListCostUsd).toBeGreaterThan(0);
    expect(selectFixtureRuntimeLeases({ leases, runIds: ["selected-run"] }).map(value => value.id)).toEqual(["task"]);
  });

  it("creates a primary project workspace for reusable Daytona scope", async () => {
    const calls: string[] = [];
    const api = {
      async post(path: string, data?: Record<string, unknown>) {
        calls.push(`POST ${path}`);
        if (path === "/api/plugins/install") {
          return {
            id: "plugin-daytona",
            pluginKey: "paperclip.daytona-sandbox-provider",
            status: "ready",
          };
        }
        if (path === "/api/companies") {
          return { id: "company-1", name: "Runner E2E" };
        }
        if (path.endsWith("/environments")) {
          return { id: "environment-1", driver: "sandbox", config: data?.config };
        }
        if (path.endsWith("/agents")) {
          return { id: "agent-1", name: "Agent", companyId: "company-1" };
        }
        if (path.startsWith("/api/environments/environment-1/probe?")) {
          return { ok: true, details: { platformQualificationRecorded: true, leaseId: "setup-probe" } };
        }
        if (path.endsWith("/projects")) {
          expect(data).toMatchObject({
            executionWorkspacePolicy: {
              enabled: true,
              defaultMode: "shared_workspace",
              environmentId: "environment-1",
            },
            workspace: {
              sourceType: "local_path",
              cwd: "/tmp/workspace",
              isPrimary: true,
            },
          });
          return {
            id: "project-1",
            name: data?.name,
            primaryWorkspace: {
              id: "project-workspace-1",
              cwd: "/tmp/workspace",
            },
          };
        }
        throw new Error(`Unexpected POST ${path}`);
      },
      async get() { return [{ type: "codex_local", defaultRunner: "paperclip", supportedRunners: ["paperclip", "legacy"] }]; },
      async postSensitive(_path: string, data?: Record<string, unknown>) {
        return { id: `secret-${String(data?.key).toLowerCase()}` };
      },
      async delete() {},
    } as unknown as RunnerApi;
    const execution = runnerMatrix.find(
      (candidate) =>
        candidate.id ===
        "daytona-warm-continuity.runner-codex.daytona.warm-three-turn",
    )!;

    const fixtures = await setupLiveFixtures({
      api,
      execution,
      executionNonce: "nonce",
      workspacePath: "/tmp/workspace",
      credentials: {
        [execution!.profile.credential]: "provider-test-value",
        DAYTONA_API_KEY: "daytona-test-value",
      },
      daytonaImage:
        "ghcr.io/paperclip/image@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(fixtures.project?.primaryWorkspace?.id).toBe("project-workspace-1");
    expect(
      calls.indexOf("POST /api/companies/company-1/environments"),
    ).toBeLessThan(calls.indexOf("POST /api/companies/company-1/projects"));
    await fixtures.teardown();
  });
});

describe("owned browser setup lease accounting", () => {
  it("includes both exact setup IDs and task runs while excluding unrelated leases", () => {
    const leases = [{ id: "platform", provider: "daytona" }, { id: "adapter", provider: "daytona" },
      { id: "task", provider: "daytona", heartbeatRunId: "run" }, { id: "unrelated", provider: "daytona" }];
    expect(selectFixtureRuntimeLeases({ leases, runIds: ["run"], setupLeaseIds: ["platform", "adapter"] }).map(lease => lease.id)).toEqual(["platform", "adapter", "task"]);
    expect(selectFixtureRuntimeLeases({ leases, runIds: [], setupLeaseIds: ["platform"] }).map(lease => lease.id)).toEqual(["platform"]);
    expect(selectFixtureRuntimeLeases({ leases, runIds: [], setupLeaseIds: [] })).toEqual([]);
  });
});

describe("managed setup runtime cost coverage", () => {
  it("prices both exact setup windows with task usage and keeps missing attribution unknown", () => {
    const leases = ["platform", "adapter", "task", "unrelated"].map((id, index) => ({ id, provider: "daytona", heartbeatRunId: id === "task" ? "run" : null,
      acquiredAt: "2026-10-13T00:00:00Z", releasedAt: `2026-10-13T00:00:0${index + 1}Z`, metadata: { cpu: 4, memory: 4, disk: 10 } }));
    const selected = selectFixtureRuntimeLeases({ leases, runIds: ["run"], setupLeaseIds: ["platform", "adapter"] });
    const usage = buildRuntimeUsage({ environmentId: "daytona", runs: [], leases: selected });
    expect(usage.leaseCount).toBe(3);
    expect(usage.leaseDurationMs).toBe(6000);
    expect(usage.estimatedListCostUsd).toBeGreaterThan(0);
    expect(fixtureRuntimeCostCoverage(usage, {})).toEqual(usage);
    const incomplete = fixtureRuntimeCostCoverage(usage, { setupLeaseAccountingIncomplete: true });
    expect(incomplete.costStatus).toBe("unavailable");
    expect(incomplete.costSource).toBe("provider_cost_unavailable");
    expect(incomplete).not.toHaveProperty("estimatedListCostUsd");
    expect(incomplete.leaseCount).toBe(3);
  });
});


it.each([true,false])("selected validation primary fixture binding and real setup composition (selected=%s)",async selected=>{
 const {createAgentSchema}=await import("../../packages/shared/src/validators/agent.js");
 const {runtimeClaudeValidationCases}=await import("./chat-catalog-domains/runtime-claude-validation.js");
 const companyId="11111111-1111-4111-8111-111111111111",environmentId="22222222-2222-4222-8222-222222222222",leadId="33333333-3333-4333-8333-333333333333";
 const connectionIds=["44444444-4444-4444-8444-444444444444","55555555-5555-4555-8555-555555555555"],grantIds=["66666666-6666-4666-8666-666666666666","77777777-7777-4777-8777-777777777777"];
 const execution=runnerMatrix.find(e=>e.id===`chat-features.runner-opencode.local.${selected?"runs-adapters.validate-hire":"teams.configure-team"}`)!;
 const order:string[]=[],accounts:Array<Record<string,unknown>>=[];let lead:any,target:any,primaryBody:any;
 const api={baseURL:"http://fixture.invalid",async get(url:string){
   if(url.endsWith("/environments?driver=local"))return[{id:environmentId,driver:"local"}];
   if(url===`/api/environments/${environmentId}`)return{id:environmentId,driver:"local",status:"active"};
   if(url===`/api/agents/${leadId}`)return{...lead,status:"idle",lifecycleState:"ready",lifecycleHolds:[],pauseReason:null};
   if(target&&url===`/api/agents/${target.id}`)return target;
   if(url.endsWith("/ai-connections"))return{connections:accounts};
   if(url.endsWith("/me/user-secrets"))return[{definition:{id:"definition",companyId,key:`ai_${grantIds[1]!.replaceAll("-","_")}`},secret:{id:"slot",companyId,userSecretDefinitionId:"definition",scope:"user",status:"active",ownerUserId:"owner"}}];
   throw new Error("Unexpected fixture public read");
 },async post(url:string,body:any){
   if(url==="/api/companies")return{id:companyId,name:"Synthetic company"};
   expect(url).toBe(`/api/companies/${companyId}/agents`);
   const parsed=createAgentSchema.parse(body);
   if(body.setupId){order.push("target-create");target={...parsed,id:body.setupId,companyId,status:"paused",lifecycleState:"paused",pauseReason:"setup",lifecycleHolds:["setup"]};return target;}
   order.push("primary-create");primaryBody=parsed;lead={...parsed,id:leadId,companyId,status:"paused",lifecycleState:"verifying",lifecycleHolds:[],pauseReason:null};return lead;
 },async postSensitive(url:string,body:any){
   if(url.endsWith("/secrets"))return{id:"88888888-8888-4888-8888-888888888888"};
   if(url.endsWith("/ai-connections")){const n=accounts.length;expect(body).toMatchObject({provider:"openrouter",method:"api_key",ownership:"personal",apiKey:"synthetic-key",allAgents:false,agentIds:[]});order.push(n===0?"primary-account":"target-account");accounts.push({id:connectionIds[n],grantId:grantIds[n],provider:"openrouter",status:"connected",ownership:"personal",ownerUserId:"owner"});return{connectionId:connectionIds[n],grantId:grantIds[n]};}
   if(url.endsWith("/rotate")){expect(url).toContain("/slot/");order.push("target-rotate");return{};}
   if(url.endsWith("/keys"))return{id:"probe",token:"synthetic-permission-token"};
   throw new Error("Unexpected sensitive fixture write");
 },async getRunObservation(){return[];}} as unknown as RunnerApi;
 vi.stubGlobal("fetch",vi.fn(async(url:string|URL)=>{expect(String(url)).toMatch(new RegExp(`/api/agents/[^/]+$`));return new Response(null,{status:200});}));
 let fixtures:Awaited<ReturnType<typeof setupLiveFixtures>>|undefined;
 try{
   fixtures=await setupLiveFixtures({api,execution,executionNonce:"nonce",workspacePath:"/synthetic/workspace",credentials:{OPENROUTER_API_KEY:"synthetic-key"}});
   expect(primaryBody).not.toHaveProperty("setupId");expect(primaryBody).not.toHaveProperty("status");expect(primaryBody).not.toHaveProperty("pauseReason");expect(primaryBody).not.toHaveProperty("lifecycleHolds");
   expect(primaryBody.runtimeConfig.heartbeat.enabled).toBe(false);expect(primaryBody.adapterConfig.timeoutSec).toBe(0);
   if(!selected){expect(order).toEqual(["primary-create"]);expect(primaryBody.runtimeConfig.aiConnection).toBeUndefined();expect(primaryBody.adapterConfig.env.OPENROUTER_API_KEY.type).toBe("secret_ref");return;}
   expect(order).toEqual(["primary-account","primary-create"]);
   expect(primaryBody.runtimeConfig.aiConnection).toEqual({provider:"openrouter",method:"api_key",mode:"delegated",connectionId:connectionIds[0],grantId:grantIds[0]});expect(primaryBody.adapterConfig.env).toBeUndefined();
   const ctx={scenario:{id:"runs-adapters.validate-hire"},input:{api,execution,fixtures,privateSecrets:[],privateInputs:{credentials:{OPENROUTER_API_KEY:"synthetic-key"}},workspacePath:"/synthetic/workspace"},allRuns:async()=>[]} as unknown as import("./chat-catalog-contract.js").ChatCatalogContext;
   const state=await runtimeClaudeValidationCases[0]!.setup(ctx);
   expect(state).toMatchObject({actualAccountEligible:true,noTargetWorkBeforeQuery:true,controllerBefore:{runtimeConfig:{aiConnection:primaryBody.runtimeConfig.aiConnection}}});
   expect(order).toEqual(["primary-account","primary-create","target-account","target-create","target-rotate"]);
   expect(target.runtimeConfig.aiConnection).toMatchObject({mode:"delegated",connectionId:connectionIds[1],grantId:grantIds[1]});expect(target.pauseReason).toBe("setup");
 }finally{await fixtures?.teardown();vi.unstubAllGlobals();}
});
