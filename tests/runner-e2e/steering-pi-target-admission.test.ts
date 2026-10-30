import { stripTypeScriptTypes } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile, chmod } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { runnerMatrix } from "./catalog.js";
import { admitSteeringPiTarget, enterSteeringPiTarget, recordSteeringPiMainFailure, retainSteeringPiAttemptGate, retainSteeringPiAttemptOriginals } from "./steering-pi-target-admission.js";
import { digest, STEERING_PI_EXECUTION, STEERING_PI_JOB_MS, STEERING_PI_PROFILE, STEERING_PI_SOURCE_CLOSURE } from "./steering-pi-receipt.js";
import { PI_NODE_VERSION } from "../../packages/paperclip-runner/src/drivers/acpx/pi-node-pins.js";
import { MANUAL_PRIVATE_PROTOCOL } from "./manual-private-retention.js";
import type { ManualPrivateHandoff } from "./manual-private-handoff.js";
import type { MatrixExecution } from "./types.js";
vi.mock("../../packages/paperclip-runner/src/drivers/acpx/pi-closure-pins.js", async () => {
 const { createHash } = await import("node:crypto");
 const entries = [{ path: "a", sha256: "0".repeat(64), size: 1, executable: false }];
 return { PI_DISTRIBUTION_CLOSURE_SHA256: { "linux-x64": createHash("sha256").update(JSON.stringify(entries)).digest("hex") } };
});
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
 vi.spyOn(process, "platform", "get").mockReturnValue("linux"); vi.spyOn(process, "arch", "get").mockReturnValue("x64");
 const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "pi-target-gate-")); roots.push(root);
 const original = runnerMatrix.find(row => row.id === STEERING_PI_EXECUTION)!;
 const execution = { ...original, profile: { ...original.profile }, task: { ...original.task, attemptTimeoutMs: { ...original.task.attemptTimeoutMs } } };
 const context = { root, protocol: MANUAL_PRIVATE_PROTOCOL, private: true, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [STEERING_PI_EXECUTION] } as ManualPrivateHandoff;
 const started = Date.parse("2026-10-29T00:00:00Z"); let current = started + 1000;
 const entries = [{ path: "a", sha256: "0".repeat(64), size: 1, executable: false }], closure = digest(JSON.stringify(entries));
 const entry = path.join(root, "packages/paperclip-runner/dist/cli/provision-pi.cjs"), assets = path.join(root, "packages/paperclip-runner/provider-assets/pi/linux-x64"), bundle = path.join(root, "runner-e2e-build/runner-e2e-build-bundle.tar.gz");
 await mkdir(path.dirname(entry), { recursive: true }); await mkdir(assets, { recursive: true }); await mkdir(path.dirname(bundle));
 await writeFile(entry, "synthetic compiled provisioner", { mode: 0o600 }); await writeFile(bundle, "synthetic verified build bundle", { mode: 0o600 });
 const distribution = JSON.stringify({ schema: "paperclip.pi-distribution.v1", runtimeRoot: "runtime", nativeClosureSha256: closure, target: { platform: "linux", architecture: "x64", nodeVersion: PI_NODE_VERSION }, pins: { wrapper: "0.0.33", runtime: "1.0.0", sdk: "0.26.0", zod: "3.25.76" } });
 const native = JSON.stringify({ entries }); await writeFile(path.join(assets, "pi-distribution.json"), distribution, { mode: 0o600 }); await writeFile(path.join(assets, "native-closure.json"), native, { mode: 0o600 });
 const receipt = { schema: "paperclip.steering-pi-assets/v1", executionId: STEERING_PI_EXECUTION, runId: context.runId, attempt: "1", workflowSha: context.workflowSha, targetSha: context.targetSha,
  jobId: 23, runnerName: "owned-runner", jobStartedAt: new Date(started).toISOString(), jobDeadlineMs: started + STEERING_PI_JOB_MS,
  buildArtifact: `runner-e2e-build-${context.targetSha}-123-1`, buildSha256: digest("synthetic verified build bundle"), provisionerSha256: digest("synthetic compiled provisioner"), status: "verified_existing", target: "linux-x64", profileDigest: STEERING_PI_PROFILE.digest,
  sourceClosureSha256: STEERING_PI_SOURCE_CLOSURE, closureSha256: closure, distributionSha256: digest(distribution), nativeManifestSha256: digest(native) };
 const receiptFile = path.join(root, "steering-pi-assets.json"), save = () => writeFile(receiptFile, JSON.stringify(receipt), { mode: 0o600 }); await save();
 const input = { executions: [execution], context, root, runnerName: "owned-runner" };
 const now = () => current;
 const fingerprint = vi.fn(() => ({ digest: "c".repeat(64), definitionDigest: "c".repeat(64), graderDigest: "c".repeat(64), fingerprintKind: "complete-execution-and-oracle-closure" }));
 return { root, input, execution, context, receipt, save, receiptFile, entry, bundle, fingerprint, now, advance: (ms: number) => { current += ms; } };
}
function ports(f: Awaited<ReturnType<typeof fixture>>) { return { now: f.now, readReceipt: undefined as never, verifyBundle: undefined as never }; }
it("valid actual receipt/artifact checks join post-setup fingerprint and preserve full original admission", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js");
 const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 await admitSteeringPiTarget({ ...f.input, stage: "selection" }, deps);
 const captured = await admitSteeringPiTarget({ ...f.input, stage: "post-setup", fingerprint: f.fingerprint }, deps);
 expect(captured?.sourceFingerprintDigest).toBe("c".repeat(64)); f.advance(5000);
 const ready = await admitSteeringPiTarget({ ...f.input, stage: "pre-framework" }, deps);
 expect(ready).toMatchObject({ sourceFingerprintDigest: "c".repeat(64), actualRuntimeFingerprint: null, originalCaseMs: 720000, cleanupReserveMs: 90000 });
 expect(f.fingerprint).toHaveBeenCalledTimes(1);
});
it.each(["runId", "targetSha", "workflowSha", "profileDigest", "buildArtifact"] as const)("rejects foreign %s before admission", async field => {
 const f = await fixture(); Object.assign(f.receipt, { [field]: "foreign" }); await f.save();
 const { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js");
 await expect(admitSteeringPiTarget({ ...f.input, stage: "selection" }, { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle })).rejects.toThrow();
});
it("missing or public-mode receipt fails closed", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js"); const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 await chmod(f.receiptFile, 0o644); await expect(admitSteeringPiTarget({ ...f.input, stage: "selection" }, deps)).rejects.toThrow();
 await rm(f.receiptFile); await expect(admitSteeringPiTarget({ ...f.input, stage: "selection" }, deps)).rejects.toThrow(/ENOENT/);
});
it("expired preparation or fingerprint overhead never admits a framework", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js"); const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 const admission = vi.fn(); const fingerprint = () => { f.advance(STEERING_PI_JOB_MS); return f.fingerprint(); };
 await expect((async () => { await admitSteeringPiTarget({ ...f.input, stage: "post-setup", fingerprint }, deps); admission(); })()).rejects.toThrow(); expect(admission).not.toHaveBeenCalled();
});
it("requires the actual earlier post-setup capture before the final framework boundary", async () => {
 const f = await fixture(); await expect(admitSteeringPiTarget({ ...f.input, stage: "pre-framework" }, ports(f))).rejects.toThrow("not captured");
});
it("actual verified bundle and provisioner bytes cannot be swapped", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js"); const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 await writeFile(f.bundle, "wrong bundle"); await expect(admitSteeringPiTarget({ ...f.input, stage: "selection" }, deps)).rejects.toThrow("differs from verified setup");
 await writeFile(f.bundle, "synthetic verified build bundle"); await writeFile(f.entry, "wrong provisioner"); await expect(admitSteeringPiTarget({ ...f.input, stage: "selection" }, deps)).rejects.toThrow("changed after setup");
});
it("rejects symlink bundles and incomplete fingerprint claims", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js"); const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 await rm(f.bundle); await symlink(f.entry, f.bundle); await expect(admitSteeringPiTarget({ ...f.input, stage: "selection" }, deps)).rejects.toThrow("custody");
 await expect(admitSteeringPiTarget({ ...f.input, stage: "post-setup", fingerprint: () => ({ ...f.fingerprint(), graderDigest: "d".repeat(64) }) }, deps)).rejects.toThrow("incomplete");
});
it("keeps unrelated cases unchanged and rejects a wrong steering controller or mixed selection", async () => {
 const f = await fixture(); const other = { ...f.execution, task: { ...f.execution.task, id: "other" } } as MatrixExecution;
 expect(await admitSteeringPiTarget({ ...f.input, executions: [other], context: undefined, stage: "selection" }, ports(f))).toBeUndefined();
 for (const change of [{ executions: [f.execution, f.execution] }, { executions: [{ ...f.execution, profile: { ...f.execution.profile, model: "other" } }] }, { context: undefined }])
  await expect(admitSteeringPiTarget({ ...f.input, ...change, stage: "selection" }, ports(f))).rejects.toThrow("exact original private native selection");
});

it("rechecks the full remaining case budget at the final boundary after earlier setup admission", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js"); const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 await admitSteeringPiTarget({ ...f.input, stage: "post-setup", fingerprint: f.fingerprint }, deps); f.advance(STEERING_PI_JOB_MS);
 const framework = vi.fn(); await expect((async () => { await admitSteeringPiTarget({ ...f.input, stage: "pre-framework" }, deps); framework(); })()).rejects.toThrow(); expect(framework).not.toHaveBeenCalled();
});
it("actual launcher call expressions retain the selected tuple and all three phase contracts", async () => {
 const f = await fixture(), { readSteeringPiReceipt } = await import("./steering-pi-receipt.js"), { verifySteeringPiBundle } = await import("./steering-pi-target-admission.js"); const deps = { now: f.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
 const source = await readFile(new URL("./launch.ts", import.meta.url), "utf8");
 const expressions = [...source.matchAll(/admitSteeringPiTarget\((\{[\s\S]*?\})\)(?:;|\.catch)/g)].map(match => match[1]!);
 const inputs = expressions.map(expression => Function("executions", "manualPrivateHandoff", "repositoryRoot", "process", "chatCatalogCaseFingerprint", "findChatCatalogCase", "normalizedChatCatalogExecution", `return ${stripTypeScriptTypes(`(${expression})`, { mode: "strip" })}`)(f.input.executions, f.context, f.root, { env: { RUNNER_NAME: f.input.runnerName } }, f.fingerprint, () => ({}), () => ({})));
 for (const stage of ["selection", "post-setup", "pre-framework"] as const) {
  const input = inputs.find(value => value.stage === stage); expect(input).toBeDefined(); expect((await admitSteeringPiTarget(input, deps))?.receipt.runId).toBe("123");
 }
 expect(f.fingerprint).toHaveBeenCalledTimes(1);
});
it.each(["missing-receipt", "verified-selection", "expired-post-setup", "entered-coordinator", "admitted-inner"] as const)("actual main stops at the safe %s boundary", async mode => {
 const f = await fixture(), calls: string[] = [], argv = process.argv, exit = process.exitCode;
 const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const, listeners = new Map(signals.map(signal => [signal, process.listeners(signal)]));
 vi.doMock("./manual-private-handoff.js", async original => ({ ...await original<typeof import("./manual-private-handoff.js")>(), readManualPrivateHandoff: async () => f.context, sealManualResultEvidence: async () => { calls.push("finalize"); }, sealStandardOriginalEvidence: async () => { calls.push("original-seal"); } }));
 vi.doMock("./steering-pi-target-admission.js", async original => {
  const actual = await original<typeof import("./steering-pi-target-admission.js")>();
  return { ...actual, admitSteeringPiTarget: (input: Parameters<typeof actual.admitSteeringPiTarget>[0]) => { if (mode === "admitted-inner" && input.stage === "pre-framework") { calls.push("inner-gate"); return Promise.reject(new Error("SYNTHETIC_INNER_GATE_STOP")); } return actual.admitSteeringPiTarget(input, {
   now: f.now, readReceipt: async () => { calls.push("receipt"); if (mode === "missing-receipt") throw new Error("SYNTHETIC_MISSING_RECEIPT"); return f.receipt as Awaited<ReturnType<typeof import("./steering-pi-receipt.js").readSteeringPiReceipt>>; },
   verifyBundle: async () => { calls.push("bundle"); },
  }); } };
 });
 vi.doMock("./chat-remote-host.js", () => ({ prepareChatRemoteHost: async () => { calls.push("host"); if (mode === "verified-selection") throw new Error("SYNTHETIC_HOST_STOP"); return undefined; } }));
 vi.doMock("./chat-catalog-fingerprint.js", async original => ({ ...await original<typeof import("./chat-catalog-fingerprint.js")>(), chatCatalogCaseFingerprint: () => { calls.push("fingerprint"); if (mode === "expired-post-setup") f.advance(STEERING_PI_JOB_MS); return f.fingerprint(); } }));
 vi.doMock("./operations.js", () => ({ openEvalOperations: async () => { calls.push("coordinator"); if (mode !== "admitted-inner") throw new Error("SYNTHETIC_COORDINATOR_STOP"); return {
  manifest: { ledgerPath: "/synthetic/ledger", limits: { campaignId: "synthetic", maxConcurrent: 1 } }, start: async () => { calls.push("attempt-admitted"); return undefined; }, close: async () => { calls.push("coordinator-close"); },
 }; } }));
 vi.doMock("./manual-private-report-assets.js", async original => ({ ...await original<typeof import("./manual-private-report-assets.js")>(), privateCellEvidenceOwner: async () => ({}) }));
 vi.doMock("./evidence.js", async original => { const actual = await original<typeof import("./evidence.js")>(); return { ...actual, packageEvidence: (input: Parameters<typeof actual.packageEvidence>[0]) => actual.packageEvidence({ ...input, privateCell: undefined }) }; });
 vi.doMock("./ports.js", () => ({ reserveRunnerE2EServerPort: async () => 12345 }));
 vi.doMock("./shared-memory.js", () => ({ snapshotDarwinSharedMemory: () => [], reapNewDetachedDarwinSharedMemory: () => {} }));
 vi.doMock("./source-sdk-evidence.js", () => ({ copyRetainedSourceSdk: async () => {} }));
 vi.doMock("./operations-report.js", () => ({ readEvalOperationsReport: async () => undefined }));
 vi.doMock("./harness-env.js", async original => ({ ...await original<typeof import("./harness-env.js")>(), resolvePaperclipRunnerBinaryForHarness: () => undefined }));
 vi.doMock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: () => { throw new Error("Process spawn forbidden in admission controls"); } }));
 vi.stubEnv("PAPERCLIP_E2E_CAMPAIGN_ID", "synthetic-steering-main"); vi.stubEnv("PAPERCLIP_E2E_OPERATIONS_MANIFEST", ["entered-coordinator", "admitted-inner"].includes(mode) ? "/synthetic/manifest" : ""); vi.stubEnv("RUNNER_NAME", "owned-runner");
 vi.stubEnv("OPENROUTER_API_KEY", "synthetic-admission-model-root-123456");
 vi.stubGlobal("fetch", () => { throw new Error("Network forbidden in main boundary controls"); });
 vi.spyOn(console, "log").mockImplementation(() => {}); const errors = vi.spyOn(console, "error").mockImplementation(() => {});
 try {
  vi.resetModules(); process.argv = [process.execPath, "/synthetic/launch.ts", "--id", STEERING_PI_EXECUTION]; process.exitCode = undefined;
  await import("./launch.js"); expect(process.exitCode).toBe(1);
  if (mode === "missing-receipt" || mode === "expired-post-setup") expect(JSON.parse(await readFile(path.join(f.root, "steering-pi-target-failure.json"), "utf8"))).toMatchObject({ kind: "steering-pi-target-admission", gate: mode === "missing-receipt" ? "selection" : "post-setup", state: "closed", attemptCoordinatorStarted: false, frameworkStarted: false, runId: f.context.runId });
  if (mode === "admitted-inner") {
   expect(calls).toContain("attempt-admitted"); expect(calls).toContain("inner-gate"); expect(calls).toContain("original-seal");
   const result = JSON.parse(await readFile(path.join(f.root, "results/synthetic-steering-main/chat-features/runner-opencode/local/steering.steer-active/attempt-1/result.json"), "utf8"));
   expect(result).toMatchObject({ status: "failed", attempt: 1, executionId: STEERING_PI_EXECUTION });
   const gate = JSON.parse(await readFile(path.join(f.root, "capture/cases/steering.steer-active/snapshots/steering-pi-attempt-gate.json"), "utf8"));
   expect(gate).toMatchObject({ gate: "pre-framework", attemptAdmitted: true });
   await expect(readFile(path.join(f.root, "steering-pi-target-failure.json"))).rejects.toThrow(/ENOENT/);
  }
  if (mode === "entered-coordinator") { expect(JSON.parse(await readFile(path.join(f.root, "steering-pi-target-entered.json"), "utf8"))).toMatchObject({ state: "entered", runId: "123" }); await expect(readFile(path.join(f.root, "steering-pi-target-failure.json"))).rejects.toThrow(/ENOENT/); expect(calls).toContain("coordinator"); }
  if (mode === "missing-receipt") { expect(calls).toEqual(["receipt"]); expect(errors).toHaveBeenCalledWith("SYNTHETIC_MISSING_RECEIPT"); }
  if (mode === "verified-selection") { expect(calls).toEqual(["receipt", "bundle", "host", "finalize"]); expect(errors).toHaveBeenCalledWith("SYNTHETIC_HOST_STOP"); }
  if (mode === "expired-post-setup") { expect(calls).toEqual(["receipt", "bundle", "host", "fingerprint", "receipt", "bundle"]); expect(errors).toHaveBeenCalledWith("Insufficient time for the unchanged steering case and cleanup"); }
 } finally {
  process.argv = argv; process.exitCode = exit;
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!listeners.get(signal)!.includes(listener)) process.removeListener(signal, listener);
  for (const module of ["./manual-private-handoff.js", "./steering-pi-target-admission.js", "./chat-remote-host.js", "./chat-catalog-fingerprint.js", "./operations.js", "./ports.js", "./shared-memory.js", "./source-sdk-evidence.js", "./operations-report.js", "./harness-env.js", "./evidence.js", "./manual-private-report-assets.js", "node:child_process"]) vi.doUnmock(module);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
 }
});

it("exclusive entry and failure states are monotonic, reject a foreign existing carrier and never infer missing means blocked", async () => {
 const f = await fixture(); await enterSteeringPiTarget(f.context);
 await expect(recordSteeringPiMainFailure(f.context, "post-setup")).rejects.toThrow("Conflicting");
 await expect(enterSteeringPiTarget(f.context)).rejects.toThrow();
 const g = await fixture(); await recordSteeringPiMainFailure(g.context, "selection");
 await expect(enterSteeringPiTarget(g.context)).rejects.toThrow("Conflicting");
 await expect(recordSteeringPiMainFailure(g.context, "selection")).rejects.toThrow();
 const h = await fixture(); await writeFile(path.join(h.root, "steering-pi-target-entered.json"), '{"state":"unknown"}', { mode: 0o600 });
 await expect(recordSteeringPiMainFailure(h.context, "selection")).rejects.toThrow();
});
it("admitted gate retains a normal typed attempt failure and actual known originals without producing a main-stop operation", async () => {
 const f = await fixture(); await enterSteeringPiTarget(f.context);
 const directory = path.join(f.root, "capture/cases/steering.steer-active");
 await writeFile(path.join(f.root, "steering-pi-operation.json"), '{"actualInstaller":"unchanged"}', { mode: 0o600 });
 await writeFile(path.join(f.root, "launcher-output.log"), 'actual observed launcher prefix', { mode: 0o600 });
 await retainSteeringPiAttemptGate(f.context, directory, "pre-framework");
 await retainSteeringPiAttemptOriginals(f.context, directory);
 expect(JSON.parse(await readFile(path.join(directory, "snapshots/steering-pi-attempt-gate.json"), "utf8"))).toMatchObject({ attemptAdmitted: true, gate: "pre-framework", runtimeFingerprint: null });
 expect(await readFile(path.join(directory, "playwright-output/launcher-output.log"), "utf8")).toBe('actual observed launcher prefix');
 await expect(readFile(path.join(f.root, "steering-pi-target-failure.json"))).rejects.toThrow(/ENOENT/);
});
