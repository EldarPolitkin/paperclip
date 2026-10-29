import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { chatCatalogAgentIsReady } from "./chat-catalog-contract.js";
import { chatCatalogRunStatusAllowed } from "./chat-catalog-run-policy.js";
import { pollUntil } from "./api.js";

describe("catalog agent lifecycle readiness", () => {
  it.each(["idle", "active", "running"])("accepts a lifecycle-ready %s agent", status => {
    expect(chatCatalogAgentIsReady({ lifecycleState: "ready", status, lifecycleError: null })).toBe(true);
  });
  it.each(["paused", "error", "terminated", "pending_approval", "verifying", "failed", ""])("rejects non-ready operational status %s", status => {
    expect(chatCatalogAgentIsReady({ lifecycleState: "ready", status })).toBe(false);
  });
  it.each(["verifying", "pending", "failed", "paused", undefined, null])("rejects unready lifecycle %s even while running", lifecycleState => {
    expect(chatCatalogAgentIsReady({ lifecycleState, status: "running" })).toBe(false);
  });
  it("rejects lifecycle errors even when the status says ready and running", () => {
    expect(chatCatalogAgentIsReady({ lifecycleState: "ready", status: "running", lifecycleError: "failure" })).toBe(false);
    expect(chatCatalogAgentIsReady({ lifecycleState: "ready" })).toBe(false);
  });
  it("the actual polling helper accepts a ready busy worker without another readiness request", async () => {
    let reads = 0;
    const actual = { id: "held-worker", lifecycleState: "ready", status: "running", lifecycleError: null };
    expect(await pollUntil({ label: "held worker readiness", deadlineAt: Date.now() + 45_000,
      load: async () => { reads++; return actual; }, accept: chatCatalogAgentIsReady })).toBe(actual);
    expect(reads).toBe(1);
  });
  it("accepting a busy agent does not accept a running canonical native as a completed run", () => {
    expect(chatCatalogAgentIsReady({ lifecycleState: "ready", status: "running" })).toBe(true);
    expect(chatCatalogRunStatusAllowed({ implementation: {}, run: { status: "running" } as never,
      companyId: "company", leadId: "lead" })).toBe(false);
  });
});

interface PublicReadinessState { lifecycleVersion: number; lifecycleState: string; status: string; lifecycleError: string | null }
const flowSource = readFileSync(new URL("./chat-catalog-flow.ts", import.meta.url), "utf8");
const readinessCalls = [...flowSource.matchAll(/await (pollUntil\(\{ label: `catalog agent readiness[\s\S]*?\n    \}\))/g)].map(match => match[1]!);
if (readinessCalls.length !== 1) throw new Error("Expected one actual shared catalog readiness call");
const readinessFunction = stripTypeScriptTypes(`async function actual(input: any, agent: any, deadlineAt: number) { return await ${readinessCalls[0]}; }`);
const actualReadiness = new Function("pollUntil", "chatCatalogAgentIsReady", `${readinessFunction}; return actual;`)(pollUntil, chatCatalogAgentIsReady) as
  (input: { api: { get: (url: string) => Promise<PublicReadinessState> } }, agent: { id: string }, deadlineAt: number) => Promise<PublicReadinessState>;

describe("actual shared catalog readiness wait", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  function fixture(load: () => PublicReadinessState) {
    let reads = 0;
    return { agent: { id: "synthetic-primary" }, input: { api: { get: async (url: string) => {
      expect(url).toBe("/api/agents/synthetic-primary"); reads++; return load();
    } } }, reads: () => reads };
  }
  it("waits for an already-claimed same-version automatic retry to become ready inside its original window", async () => {
    const initial = { lifecycleVersion: 3, lifecycleState: "verifying", status: "paused", lifecycleError: "synthetic prior same-version error" };
    const ready = { ...initial, lifecycleVersion: 4, lifecycleState: "ready", status: "idle", lifecycleError: null };
    const f = fixture(() => Date.now() < 500 ? initial : ready);
    const pending = actualReadiness(f.input, f.agent, 870_000).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ value: ready });
    expect(f.reads()).toBe(2);
  });
  it.each([null, "synthetic retry error"])("does not accept never-ready verification with error %s after the original 45 seconds", async lifecycleError => {
    const f = fixture(() => ({ lifecycleVersion: 3, lifecycleState: "verifying", status: "paused", lifecycleError }));
    const pending = expect(actualReadiness(f.input, f.agent, 870_000)).rejects.toThrow("Timed out waiting for catalog agent readiness");
    await vi.advanceTimersByTimeAsync(45_000); await pending;
    expect(f.reads()).toBe(90); expect(Date.now()).toBe(45_000);
  });
  it("keeps a smaller remaining overall deadline", async () => {
    const f = fixture(() => ({ lifecycleVersion: 3, lifecycleState: "verifying", status: "paused", lifecycleError: "synthetic retry error" }));
    const pending = expect(actualReadiness(f.input, f.agent, 1_000)).rejects.toThrow("Timed out waiting for catalog agent readiness");
    await vi.advanceTimersByTimeAsync(1_000); await pending;
    expect(f.reads()).toBe(2); expect(Date.now()).toBe(1_000);
  });
  it.each([["rejected", "terminated"], ["terminated", "terminated"], ["ready", "idle"], ["verifying", "terminated"], ["preparing", "paused"]])("still rejects an error in %s/%s", async (lifecycleState, status) => {
    const f = fixture(() => ({ lifecycleVersion: 4, lifecycleState, status, lifecycleError: "synthetic current error" }));
    await expect(actualReadiness(f.input, f.agent, 870_000)).rejects.toThrow("Stopped waiting for catalog agent readiness synthetic-primary");
    expect(f.reads()).toBe(1);
  });
});
