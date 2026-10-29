import { expect, it } from "vitest";
import { currentNativeCaller, emptyDiagnosticInventory, validDiagnosticObservations, drainDiagnosticTarget } from "./diagnostic-owned-target.js";
const run = { id: "run", companyId: "company", agentId: "ceo", nativeIssueId: "chat", runnerInstanceId: "runner", nativeSessionId: "session", status: "running", runtimeMode: "native",
  processPid: 200, processStartedAt: new Date("2026-10-29T12:00:00Z"), runnerProfileJson: { sessionCheckpoint: { process: { providerPid: 205, providerProcessStartedAt: "2026-10-29T12:00:01.000Z" } } } };
const event = { payload: { prpEvent: { runId: "run", sourceKind: "runner", sourceInstanceId: "runner", normalizedSessionId: "session", eventType: "session.started", payload: { processId: 205 } } } };
it("requires the actual public run, provider generation and exact durable session identity together", () => {
  const binding = { companyId: "company", agentId: "ceo", issueId: "chat" };
  expect(currentNativeCaller(run as any, [event], binding)?.currentRunBound).toBe(true);
  for (const change of [{ companyId: "foreign" }, { agentId: "worker" }, { nativeIssueId: "other" }, { processPid: null }, { processStartedAt: null }, { runtimeMode: "legacy" }, { status: "failed" }, { runnerProfileJson: {} }])
    expect(currentNativeCaller({ ...run, ...change } as any, [event], binding)).toBeUndefined();
  for (const change of [{ runId: "other" }, { sourceInstanceId: "other" }, { normalizedSessionId: "other" }, { payload: { processId: 999 } }, { sourceKind: "model" }])
    expect(currentNativeCaller(run as any, [{ payload: { prpEvent: { ...event.payload.prpEvent, ...change } } }], binding)?.currentRunBound).toBe(false);
});

it("permits only an actually empty target inventory, not a cloned idle or verifying worker", () => {
  expect(emptyDiagnosticInventory({ agents: 0, runs: 0 })).toBe(true);
  for (const value of [{ agents: 1, runs: 0 }, { agents: 0, runs: 1 }, { agents: 1, runs: 1 }]) expect(emptyDiagnosticInventory(value)).toBe(false);
});

import { diagnosticContext } from "./privileged-diagnose-health.js";
import { buildPaperclipTaskMarkdown } from "../../../server/src/services/heartbeat/task-markdown.js";
import { buildNativeExecutionInput } from "../../../server/src/services/native-runtime/native-execution-input.js";
import { nativeRuntimeContextFixture } from "../../../server/src/services/native-runtime/runtime-context.test-fixture.js";
it("carries the ordinary saved source title into the actual native chat prompt without diagnostic preseeding", () => {
  const context = diagnosticContext("http://127.0.0.1:31097", "http://127.0.0.1:3100");
  const issue = { id: "20000000-0000-4000-8000-000000000002", identifier: "HEALTH-1", ...context, workMode: "standard", conversationAgentId: "30000000-0000-4000-8000-000000000003" };
  const query = "Is this Paperclip instance healthy enough to run work?";
  const markdown = buildPaperclipTaskMarkdown({ issue, wakeComment: { id: "comment", body: query }, nativeRunner: true })!;
  const actual = buildNativeExecutionInput({ companyId: "10000000-0000-4000-8000-000000000001", runId: "50000000-0000-4000-8000-000000000005", agentId: issue.conversationAgentId,
    issue, taskPrompt: markdown, conversationMode: true, provider: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash-1017",
    workspace: { id: "50000000-0000-4000-8000-000000000005", cwd: "/owned", repoUrl: null, repoRef: null, branchName: null }, normalizedSessionId: null,
    runtimeContext: nativeRuntimeContextFixture(), completionContract: { id: "70000000-0000-4000-8000-000000000007", sha256: `sha256:${"a".repeat(64)}`, schemaVersion: "paperclip.run-result.v1", contract: { revision: "1", objective: query, criteria: [{ id: "answer", requirement: query }] } } });
  expect(actual.task.prompt).toContain(context.title); expect(actual.task.title).toBe(context.title); expect(actual.task.description).toBe(context.description);
  expect(markdown).toContain(query); expect(context.title + context.description).not.toMatch(/unhealthy|database|503|readiness|doctor|curl/i);
});

it("drains the actual owned stop despite recovery failure and preserves both failures", async () => {
  const original = new Error("recovery failed"), calls: string[] = [];
  await expect(drainDiagnosticTarget(async () => { calls.push("recover"); throw original; }, async () => { calls.push("stop"); })).rejects.toBe(original);
  expect(calls).toEqual(["recover", "stop"]);
  try { await drainDiagnosticTarget(async () => { throw original; }, async () => { throw new Error("stop failed"); }); throw new Error("accepted"); }
  catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors[0]).toBe(original); }
});
it("retains only the exact content-free scalar evidence contract", () => {
  const p = { pid: 100, parent: 1, uid: 501, ticks: "1000", born: "2026-10-29T12:00:00.000Z", namespace: "net:[123]" };
  const row = { target: p, chain: [p], finished: true, status: 503, unknown: false };
  expect(validDiagnosticObservations([row])).toBe(true);
  for (const value of [[{ ...row, body: "withheld" }], [{ ...row, target: { ...p, born: "raw message" } }], [{ ...row, chain: [{ ...p, arguments: "forbidden" }] }], [{ ...row, status: "503" }]]) expect(validDiagnosticObservations(value)).toBe(false);
});
