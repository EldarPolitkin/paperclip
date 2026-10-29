import { expect, it, vi } from "vitest";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { runnerMatrix } from "../catalog.js";
import { gradeActiveSteering, isBlueColor, hasVisibleBlueDesign, runtimeActiveSteeringCases } from "./runtime-active-steering.js";
vi.mock("../api.js", async importOriginal => ({ ...await importOriginal<typeof import("../api.js")>(),
  pollUntil: async (options: { load: () => Promise<unknown>; accept: (value: unknown) => boolean }) => {
    const value = await options.load();
    if (!options.accept(value)) throw new Error("Actual fixture admission predicate rejected the observed state");
    return value;
  },
}));
vi.mock("./runtime-busy-worker.js", async importOriginal => ({ ...await importOriginal<typeof import("./runtime-busy-worker.js")>(),
  busyRuntimeWorker: async (ctx: ChatCatalogContext, options: { worker?: Record<string, unknown> } = {}) => {
    const { runtimeWorker } = await import("./runtime-support.js");
    return { worker: options.worker ?? await runtimeWorker(ctx), task: { id: "website", identifier: "QA-1" }, workerRunId: "worker-run", workerWasReallyWaiting: true };
  },
}));
vi.mock("../user-actions.js", async importOriginal => ({ ...await importOriginal<typeof import("../user-actions.js")>(), submitTaskReply: vi.fn() }));
vi.mock("@playwright/test", async importOriginal => ({ ...await importOriginal<typeof import("@playwright/test")>(),
  expect: (value: { enabled: boolean }) => ({ toBeEnabled: async () => { if (!value.enabled) throw new Error("The real public control is not enabled"); } }),
}));
function valid() {
  return { scenarioId: "steering.steer-active", companyId: "company", leadId: "ceo", agents: [], links: [], humanQueries: [], reply: "", tasks: [{ id: "website" }], activity: [],
    runs: [{ id: "worker", status: "succeeded" }, { id: "source", status: "succeeded" }],
    state: { task: { id: "website" }, targetId: "blue", humanId: "human", workerRunId: "worker", workerWasReallyWaiting: true,
      queueBefore: { issueId: "website", targetRunId: "worker", protocol: "paperclip_runner_v1", steeringDisposition: "available", entries: [{ comment: { id: "blue", body: "Switch to a blue design while you are working.", authorUserId: "human", authorAgentId: null } }] },
      queueAfterAction: { entries: [] as Array<{ comment: { id: string; body: string } }> }, humanSteerSelected: true, agentSteerStatus: 403,
      queryReply: "Use Steer beside your saved message to send this direction to Morgan's active turn; waiting in the queue is separate from delivery.",
      steerObservedBranch: "same-run-acknowledged", steerStatus: 200, acknowledgedSameRun: true, steerAuditBound: true, idempotentRetryStatus: 200, ordinaryConsumerCount: 0,
      actualBlueArtifact: true, blueRevisionBound: true, workerTaskDone: true, queueEmptyAtEnd: true,
      steerFailureCode: "", providerFailureVisible: false, failureRetainedMessage: false, supportedContinuationVisible: false, continuationInputBound: false } };
}
it("accepts real explicit same-turn delivery and actual blue result", () => expect(gradeActiveSteering(valid()).passed).toBe(true));
it("accepts natural human-control guidance", () => { const o = valid(); o.state.queryReply = "Your direction is saved. Select the Steer action in Morgan's task to apply it during this execution."; expect(gradeActiveSteering(o).passed).toBe(true); });
it("accepts an actual visible provider rejection with retained one-time normal delivery", () => {
  const o = valid(); Object.assign(o.state, { steerObservedBranch: "provider-rejected-normal-continuation", steerStatus: 409, steerFailureCode: "steering_rejected", providerFailureVisible: true, failureRetainedMessage: true, supportedContinuationVisible: true, ordinaryConsumerCount: 1, continuationInputBound: true, acknowledgedSameRun: false, steerAuditBound: false });
  o.state.queueAfterAction.entries = [{ comment: { id: "blue", body: "Switch to a blue design while you are working." } }]; o.runs.push({ id: "ordinary", status: "succeeded" });
  expect(gradeActiveSteering(o).passed).toBe(true);
  o.state.failureRetainedMessage = false; expect(gradeActiveSteering(o).passed).toBe(false);
});
it("rejects queue admission without actual same-run acknowledgement", () => { const o = valid(); o.state.acknowledgedSameRun = false; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects hidden normal replay after accepted same-turn delivery", () => { const o = valid(); o.state.ordinaryConsumerCount = 1; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects steering a foreign run", () => { const o = valid(); o.state.queueBefore.targetRunId = "other"; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects falsely claiming the queued direction was already implemented", () => { const o = valid(); o.state.queryReply = "I have implemented the blue design with Steer."; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects a forged human steering action", () => { const o = valid(); o.state.agentSteerStatus = 200; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects saved blue prose without a rendered blue deliverable", () => { const o = valid(); o.state.actualBlueArtifact = false; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects unavailable advertised capability", () => { const o = valid(); o.state.queueBefore.steeringDisposition = "unsupported"; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects wrong human ownership", () => { const o = valid(); o.state.queueBefore.entries[0]!.comment.authorUserId = "other"; expect(gradeActiveSteering(o).passed).toBe(false); });
it("rejects absent actual evidence", () => expect(gradeActiveSteering(undefined).passed).toBe(false));
it.each(["rgb(0, 0, 255)", "rgb(42, 90, 180)", "rgba(15, 30, 98, 1)"])("accepts actual blue computed colors %s", color => expect(isBlueColor(color)).toBe(true));
it.each(["rgb(255, 0, 0)", "rgb(240, 240, 240)", "rgb(100, 150, 100)", "transparent"])("rejects other computed colors %s", color => expect(isBlueColor(color)).toBe(false));

it.each(["rgba(0, 0, 255, 0)", "rgba(0, 0, 255, 0.01)"])("rejects transparent blue computed colors %s", color => expect(isBlueColor(color)).toBe(false));
it("rejects claiming the unobserved branch as qualified", () => { const o = valid(); o.state.steerObservedBranch = "provider-rejected-normal-continuation"; expect(gradeActiveSteering(o).passed).toBe(false); });

it("rejects a red page with only default blue links", () => expect(hasVisibleBlueDesign([{ tag: "BODY", color: "rgb(0, 0, 0)", background: "rgb(255, 0, 0)" }, { tag: "A", color: "rgb(0, 0, 238)", background: "rgba(0, 0, 0, 0)" }])).toBe(false));
it("accepts a natural blue heading accent on a white page", () => expect(hasVisibleBlueDesign([{ tag: "BODY", color: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)" }, { tag: "H1", color: "rgb(25, 70, 180)", background: "rgba(0, 0, 0, 0)" }])).toBe(true));
it("rejects transparent blue design elements", () => expect(hasVisibleBlueDesign([{ tag: "SECTION", color: "rgb(0, 0, 0)", background: "rgba(0, 0, 255, 0)" }])).toBe(false));

function setupFixture(options: { available?: boolean; targetRunId?: string; publicOverride?: Record<string, unknown>; secret?: boolean } = {}) {
  const execution = runnerMatrix.find(row => row.id === "chat-features.runner-opencode.local.steering.steer-active")!;
  const secretRef = { type: "secret_ref", secretId: "selected-openrouter", version: "latest" } as const;
  const posts: Array<Record<string, unknown>> = [], evidence: unknown[] = [], controls: string[] = [];
  let saved: Record<string, unknown>;
  const queue = { issueId: "website", targetRunId: options.targetRunId ?? "worker-run", protocol: "paperclip_runner_v1",
    steeringDisposition: options.available === false ? "unsupported" : "available", entries: [{ comment: {
      id: "direction", body: "Switch to a blue design while you are working.", authorUserId: "human", authorAgentId: null,
    } }] };
  const ctx = { input: { execution, nonce: "selected-case", workspacePath: "/owned/workspace",
    fixtures: { company: { id: "company", issuePrefix: "QA" }, agent: { id: "ceo" }, environment: { id: "environment" }, secretRefs: options.secret === false ? {} : { OPENROUTER_API_KEY: secretRef } },
    api: { post: async (_url: string, body: Record<string, unknown>) => { posts.push(body); saved = { ...body, id: "morgan", companyId: "company", lifecycleState: "ready", ...options.publicOverride }; return saved; },
      get: async (url: string) => url.endsWith("/queued-comments") ? queue : url === "/api/auth/get-session" ? { user: { id: "human" } } : saved },
    page: { url: () => "https://fixture.invalid/QA/chats/ceo", goto: vi.fn(), getByTestId: (id: string) => { controls.push(id); return { enabled: true }; } },
    evidence: async (_name: string, value: unknown) => { evidence.push(value); },
  } } as unknown as ChatCatalogContext;
  return { ctx, execution, secretRef, posts, evidence, controls };
}

it("creates the genuine Pi feature profile with the existing OpenRouter reference while leaving the controller unchanged", async () => {
  const fixture = setupFixture();
  const before = structuredClone(fixture.execution.profile.buildAgent({ environmentId: "environment", environmentFixtureId: "local", workspacePath: "/owned/workspace", executionId: "selected-case", secretRefs: { OPENROUTER_API_KEY: fixture.secretRef } }));
  const state = await runtimeActiveSteeringCases[0]!.setup(fixture.ctx);
  expect(fixture.posts).toHaveLength(1);
  expect(fixture.posts[0]).toMatchObject({ name: "Morgan", role: "engineer", reportsTo: "ceo", adapterType: "paperclip_runner", adapterConfig: {
    provider: "acpx", acpxAgent: "pi", model: "openrouter/anthropic/claude-sonnet-4.6", env: { OPENROUTER_API_KEY: fixture.secretRef },
  }, runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } } });
  expect(fixture.execution.profile.buildAgent({ environmentId: "environment", environmentFixtureId: "local", workspacePath: "/owned/workspace", executionId: "selected-case", secretRefs: { OPENROUTER_API_KEY: fixture.secretRef } })).toEqual(before);
  expect(before.adapterConfig).toMatchObject({ provider: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash-1017" });
  expect((fixture.posts[0]!.adapterConfig as Record<string, unknown>).timeoutSec).toBe((before.adapterConfig as Record<string, unknown>).timeoutSec);
  expect(state.workerRunId).toBe("worker-run");
  expect(fixture.controls).toEqual(["task-chat-queued-steer-direction"]);
});

it.each([
  { adapterType: "opencode_local" },
  { adapterConfig: { provider: "opencode", model: "openrouter/anthropic/claude-sonnet-4.6" } },
  { adapterConfig: { provider: "acpx", acpxAgent: "pi", model: "other/model" } },
  { adapterConfig: { provider: "acpx", acpxAgent: "pi", model: "openrouter/anthropic/claude-sonnet-4.6", timeoutSec: 120 } },
  { companyId: "foreign" },
])("rejects a mismatched actual saved feature worker before creating an active task: %j", async publicOverride => {
  const fixture = setupFixture({ publicOverride });
  await expect(runtimeActiveSteeringCases[0]!.setup(fixture.ctx)).rejects.toThrow();
  expect(fixture.controls).toEqual([]);
});

it.each([{ available: false }, { targetRunId: "foreign-run" }])("requires genuine available steering on the exact active worker: %j", async options => {
  const fixture = setupFixture(options);
  await expect(runtimeActiveSteeringCases[0]!.setup(fixture.ctx)).rejects.toThrow("Actual fixture admission predicate");
  expect(fixture.controls).toEqual([]);
});

it("does not replace an absent selected OpenRouter credential reference with ambient authority", async () => {
  const fixture = setupFixture({ secret: false });
  await expect(runtimeActiveSteeringCases[0]!.setup(fixture.ctx)).rejects.toThrow("Missing fixture secret reference OPENROUTER_API_KEY");
  expect(fixture.posts).toEqual([]);
});
