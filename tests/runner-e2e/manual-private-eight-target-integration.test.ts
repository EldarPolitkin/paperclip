import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, writeFile, readFile, rm, realpath, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { stagePrivateDiagnostics, trackedPrivateSecrets, readPrivateDiagnosticSecrets } from "./private-diagnostics.js";
import { sealStandardOriginalEvidence, sealManualResultEvidence, preserveOriginalFrameworkResult, type ManualPrivateHandoff } from "./manual-private-handoff.js";
import { MANUAL_PRIVATE_EXECUTIONS, MANUAL_PRIVATE_PROTOCOL, manualCellKind } from "./manual-private-retention.js";
import { packageEvidence } from "./evidence.js";

const boundary = vi.hoisted(() => ({ reached: 0 }));
// Any regression past the preflight guard stops before even host preparation;
// this controller never starts a product/browser/DB/provider or native build.
vi.mock("./chat-remote-host.js", () => ({ prepareChatRemoteHost: async () => { boundary.reached++; throw new Error("SYNTHETIC_STARTUP_BOUNDARY"); } }));
const id = MANUAL_PRIVATE_EXECUTIONS[0]!, roots: string[] = [];
const originalArgv = [...process.argv], originalExit = process.exitCode;
const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
let previousListeners: Map<string, Function[]>;
let errors: string[] = [];
beforeEach(() => {
  boundary.reached = 0; errors = []; previousListeners = new Map(signals.map(signal => [signal, process.listeners(signal)]));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(value => { errors.push(String(value)); });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.stubEnv("GITHUB_ACTIONS", "true"); vi.stubEnv("GITHUB_SHA", "a".repeat(40)); vi.stubEnv("GITHUB_RUN_ID", "123"); vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  vi.stubEnv("PAPERCLIP_RUNNER_E2E_SOURCE_SHA", "b".repeat(40)); vi.stubEnv("PAPERCLIP_RUNNER_E2E_PRIVATE_PREFLIGHT", "");
  vi.stubEnv("PAPERCLIP_E2E_OPERATIONS_MANIFEST", "");
});
afterEach(async () => {
  process.argv = originalArgv; process.exitCode = originalExit;
  for (const signal of signals) for (const listener of process.listeners(signal)) if (!previousListeners.get(signal)!.includes(listener)) process.removeListener(signal, listener);
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "manual-eight-source-control-"))); roots.push(temporary);
  const root = path.join(temporary, "private"); await mkdir(root, { mode: 0o700 });
  const source = path.join(temporary, "case"); await mkdir(path.join(source, "snapshots"), { recursive: true, mode: 0o700 });
  const context = { root, protocol: MANUAL_PRIVATE_PROTOCOL, private: true, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [id] } as ManualPrivateHandoff;
  const file = path.join(root, "preflight.json"); await writeFile(file, JSON.stringify({ ...context, status: "verified" }), { mode: 0o600 });
  vi.stubEnv("RUNNER_TEMP", temporary); vi.stubEnv("PAPERCLIP_E2E_CAMPAIGN_ID", "synthetic-private-only");
  return { temporary, root, source, context, file };
}
async function launcher(args = ["--id", id]) {
  vi.resetModules(); process.argv = [process.execPath, fileURLToPath(new URL("./launch.ts", import.meta.url)), ...args];
  return import("./launch.js");
}
it.each(["absent", "operations-optout", "wrong-run", "wrong-attempt", "wrong-source", "wrong-id", "wrong-mode"])("actual launcher rejects %s before host/setup and legacy output", async kind => {
  const f = await fixture();
  if (!["absent", "operations-optout"].includes(kind)) vi.stubEnv("PAPERCLIP_RUNNER_E2E_PRIVATE_PREFLIGHT", f.file);
  if (kind === "operations-optout") vi.stubEnv("PAPERCLIP_E2E_OPERATIONS_MANIFEST", path.join(f.temporary, "not-an-approval.json"));
  if (kind === "wrong-run") vi.stubEnv("GITHUB_RUN_ID", "124");
  if (kind === "wrong-attempt") vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
  if (kind === "wrong-source") vi.stubEnv("PAPERCLIP_RUNNER_E2E_SOURCE_SHA", "c".repeat(40));
  if (kind === "wrong-id") await writeFile(f.file, JSON.stringify({ ...f.context, status: "verified", executionIds: [MANUAL_PRIVATE_EXECUTIONS[1]] }), { mode: 0o600 });
  if (kind === "wrong-mode") await chmod(f.file, 0o644);
  await launcher();
  expect(boundary.reached).toBe(0); expect(process.exitCode).toBe(1);
  expect(errors.join(" ")).toMatch(/verified restricted retention|exact attempt|preflight custody/);
  await expect(readFile(path.join(f.root, "results/synthetic-private-only/invocation-policy.json"))).rejects.toThrow();
});
it("actual metadata selection remains callback-free without a preflight or startup", async () => {
  await fixture(); await launcher(["--list", "--id", id]); expect(boundary.reached).toBe(0); expect(errors).toEqual([]);
});
it("actual matching synthetic preflight reaches only the mocked startup boundary and private root", async () => {
  const f = await fixture(); vi.stubEnv("PAPERCLIP_RUNNER_E2E_PRIVATE_PREFLIGHT", f.file);
  await launcher(); expect(boundary.reached).toBe(1); expect(errors).toContain("SYNTHETIC_STARTUP_BOUNDARY");
  // The stopped controller has no result to seal: it must not manufacture one.
  await expect(readFile(path.join(f.root, "sealed-results/result-evidence-inventory.json"))).rejects.toThrow();
});
it.each(["raw", "base64", "path"])("actual durable late-root registration stops %s evidence sealing", async kind => {
  const f = await fixture(); const target = await launcher(["--list", "--id", id]);
  const registryRoot = path.join(f.temporary, "attempt"); await mkdir(path.join(registryRoot, "selected-private-inputs"), { recursive: true, mode: 0o700 });
  const initial = "synthetic-initial-root-123456", late = "synthetic-late-cookie-987654321";
  const registry = stagePrivateDiagnostics(registryRoot, [id], [initial]);
  const secrets = trackedPrivateSecrets([initial], id, { PAPERCLIP_RUNNER_E2E_PRIVATE_DIAGNOSTICS: registry, PAPERCLIP_RUNNER_E2E_TEMP_ROOT: registryRoot });
  secrets.push(late); const roots = [initial], retained = new Set<string>();
  target.refreshManualEvidenceRoots(registry, registryRoot, roots, retained); expect(retained.has(late)).toBe(true);
  const name = kind === "path" ? `${late}.json` : "state.json";
  await writeFile(path.join(f.source, "snapshots", name), JSON.stringify({ value: kind === "raw" ? late : kind === "base64" ? Buffer.from(late).toString("base64") : "closed" }));
  const scanDir = path.join(f.temporary, "scan"), evidence = await packageEvidence({ privateDir: f.source, uploadDir: scanDir, secrets: roots, expectPassScreenshot: false });
  await expect(sealStandardOriginalEvidence({ context: f.context, executionId: id, source: f.source, evidence, secrets: [...retained], expectPassScreenshot: false })).rejects.toThrow();
});
it("a valid regressed registry cannot erase an initial root from original evidence scans or seals", async () => {
  const f = await fixture(), target = await launcher(["--list", "--id", id]);
  const attempt = path.join(f.temporary, "attempt"); await mkdir(path.join(attempt, "selected-private-inputs"), { recursive: true, mode: 0o700 });
  const initial = "synthetic-registered-initial-root-1234567890", roots = [initial], retained = new Set<string>();
  const registry = stagePrivateDiagnostics(attempt, [id], roots);
  target.refreshManualEvidenceRoots(registry, attempt, roots, retained);
  // Reproduce the actual post-worker reload with a valid owner-only carrier.
  // The normal writer is append-only; this synthetic regression checks that the
  // consumer cannot certify originals with fewer roots than it already knew.
  await writeFile(registry, JSON.stringify({ version: 1, executionIds: [id], secrets: [] }));
  roots.splice(0, roots.length, ...readPrivateDiagnosticSecrets(registry, attempt));
  target.refreshManualEvidenceRoots(registry, attempt, roots, retained);
  await writeFile(path.join(f.source, "snapshots/state.json"), JSON.stringify({ apiKey: initial }));
  const scan = path.join(f.temporary, "scan"), evidence = await packageEvidence({ privateDir: f.source, uploadDir: scan, secrets: roots, expectPassScreenshot: false });
  // A sanitized derivative alone cannot certify its unchanged raw original.
  expect(JSON.parse(await readFile(path.join(scan, "snapshots/state.json"), "utf8")).apiKey).toBe("[REDACTED]");
  expect(retained.has(initial)).toBe(true);
  await expect(sealStandardOriginalEvidence({ context: f.context, executionId: id, source: f.source, evidence, secrets: roots, expectPassScreenshot: false })).rejects.toThrow();
  expect(roots).toContain(initial);
});
it("retains accumulated roots even when no registry is available", async () => {
  const f = await fixture(), target = await launcher(["--list", "--id", id]);
  const initial = "synthetic-retained-only-root-1234567890", current = "synthetic-current-root-9876543210";
  const roots = [current], retained = new Set([initial]);
  target.refreshManualEvidenceRoots(undefined, f.temporary, roots, retained);
  expect(new Set(roots)).toEqual(new Set([initial, current]));
  expect(retained).toEqual(new Set([initial, current]));
});
it("an invalid staged registry throws without certifying a smaller root set", async () => {
  const f = await fixture(); const target = await launcher(["--list", "--id", id]);
  const attempt = path.join(f.temporary, "attempt"); await mkdir(path.join(attempt, "selected-private-inputs"), { recursive: true, mode: 0o700 });
  const registry = stagePrivateDiagnostics(attempt, [id], ["synthetic-initial-root"]); await chmod(registry, 0o644);
  const retained = new Set<string>(); expect(() => target.refreshManualEvidenceRoots(registry, attempt, [], retained)).toThrow(); expect(retained.size).toBe(0);
});
it("a known first scanner rejection cannot be cleared by a later clean rescan", async () => {
  const f = await fixture(), secret = "synthetic-first-scan-secret-123456789";
  const file = path.join(f.source, "snapshots/state.json"), validation = path.join(f.temporary, "scan");
  await writeFile(file, JSON.stringify({ value: secret }));
  const first = await packageEvidence({ privateDir: f.source, uploadDir: validation, secrets: [secret], expectPassScreenshot: false });
  expect(first.leaks.length).toBeGreaterThan(0);
  await writeFile(file, '{"value":"later-clean"}');
  expect((await packageEvidence({ privateDir: f.source, uploadDir: validation, secrets: [secret], expectPassScreenshot: false })).leaks).toEqual([]);
  await expect(sealStandardOriginalEvidence({ context: f.context, executionId: id, source: f.source, evidence: first, secrets: [secret], expectPassScreenshot: false })).rejects.toThrow("Credential-contaminated original evidence cannot be retained");
});
it("preserves genuine available originals and required-file failure, then seals actual post-cleanup result", async () => {
  const f = await fixture(); await writeFile(path.join(f.source, "result.json"), '{"status":"passed","cleanup":"passed"}');
  await preserveOriginalFrameworkResult(f.source);
  await writeFile(path.join(f.source, "result.json"), '{"status":"failed","failureClass":"permanent_infrastructure","error":"Required evidence missing: final-state.png"}');
  const evidence = await packageEvidence({ privateDir: f.source, uploadDir: path.join(f.temporary, "scan"), secrets: [], expectPassScreenshot: true });
  const original = await sealStandardOriginalEvidence({ context: f.context, executionId: id, source: f.source, evidence, secrets: [], expectPassScreenshot: true });
  expect(original.complete).toBe(true); expect(original.requiredEvidenceComplete).toBe(false); expect(original.missingRequiredEvidence).toContain("final-state.png");
  const out = path.join(f.root, "originals", manualCellKind(id));
  expect(JSON.parse(await readFile(path.join(out, "snapshots/manual-original-framework-result.json"), "utf8")).status).toBe("passed");
  const resultDir = path.join(f.root, "results/campaign/cell"); await mkdir(resultDir, { recursive: true });
  await writeFile(path.join(resultDir, "result.json"), '{"status":"failed","failureClass":"cleanup_failure","cleanup":"failed"}');
  await sealManualResultEvidence(f.context, []);
  expect(JSON.parse(await readFile(path.join(f.root, "sealed-results/html-report/campaign/cell/result.json"), "utf8"))).toMatchObject({ cleanup: "failed", failureClass: "cleanup_failure" });
});
it("actual launcher binds catch/cleanup/final seal to the private roots and real scans", async () => {
  const text = await readFile(new URL("./launch.ts", import.meta.url), "utf8");
  const caught = text.slice(text.indexOf("    if (error instanceof PublicOriginCleanupError)"), text.indexOf("\nfunction printList("));
  const final = caught.slice(caught.indexOf("  } finally {"));
  expect(final.indexOf("refreshManualRoots();")).toBeGreaterThan(-1);
  expect(final.indexOf("refreshManualRoots();")).toBeLessThan(final.indexOf("rm(selectedPrivateInputsDirectory"));
  expect(caught).toContain('path.join(privateDir, "cases", candidate.task.id)'); expect(caught).not.toContain('path.join(temporaryRoot, "artifacts-private"');
  expect(caught).toContain("const previousScan = originalPackageScans.get(candidate.id)");
  expect(caught).toContain("previousScan?.evidence ?? await packageEvidence("); expect(caught).toContain("await sealManualOriginal(candidate, casePrivateDir, evidence,");
  expect(text).toContain("if (manualEvidenceFailure) throw manualEvidenceFailure;\n    await sealManualResultEvidence");
});
