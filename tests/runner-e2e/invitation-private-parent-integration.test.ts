import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectCellReportProducer, privateCellEvidenceOwner } from "./manual-private-report-assets.js";
import { packageEvidence } from "./evidence.js";
import { preserveOriginalFrameworkResult, readManualPrivateHandoff, sealStandardOriginalEvidence } from "./manual-private-handoff.js";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sealManualResultEvidence, type ManualPrivateHandoff } from "./manual-private-handoff.js";
import { execFileSync } from "node:child_process";
import { declareSelectedInvitationEvidence, INVITATION_PRIVATE_EXECUTION, invitationDiagnosticRecord,
  invitationDiagnosticDisposition, invitationPrivateResultEnvelope } from "./invitation-private-capability.js";
import { createPrivateDiagnosticStream } from "./private-diagnostics.js";
import { authorizeManualPrivateEvidence, MANUAL_PRIVATE_PROTOCOL, MANUAL_PRIVATE_EXECUTIONS } from "./manual-private-retention.js";
import type { RunnerE2EResult } from "./types.js";
const startup = vi.hoisted(() => ({ reached: 0 }));
vi.mock("./chat-remote-host.js", () => ({ prepareChatRemoteHost: async () => { startup.reached++; throw new Error("PURE_SOURCE_MUST_NOT_START"); } }));
function scope() { return declareSelectedInvitationEvidence(INVITATION_PRIVATE_EXECUTION, 1, "a".repeat(40))!; }
function traceInitialization(source: string) {
  const statement = source.match(/^\s*const traceConfig = .*;$/m)?.[0];
  if (!statement) throw new Error("Missing actual caller trace initialization");
  return new Function("invitationScope", "evalBraintrustConfig", "process", `${statement}\nreturn traceConfig;`) as (s: unknown, factory: (env: unknown) => unknown, process: { env: Record<string,string> }) => unknown;
}
afterEach(() => vi.restoreAllMocks());
it.each(["runner.spec.ts", "launch.ts"])("actual %s evaluator initialization does not export before registration or after a private failure", file => {
  const run = traceInitialization(readFileSync(new URL(file, import.meta.url), "utf8"));
  const factory = vi.fn(() => ({ enabled: true })), s = scope();
  expect(run(s, factory, { env: {} })).toBeUndefined();
  const failure = invitationPrivateResultEnvelope({ executionId: INVITATION_PRIVATE_EXECUTION, suiteId: "chat-features", caseId: "access.invite-teammate", status: "failed", cleanup: "failed", matcherResults: [] } as unknown as RunnerE2EResult);
  expect(failure.productJourney?.privacy).toBe("private");
  expect(run(s, factory, { env: {} })).toBeUndefined(); expect(factory).not.toHaveBeenCalled();
  expect(run(undefined, factory, { env: {} })).toEqual({ enabled: true }); expect(factory).toHaveBeenCalledOnce();
});
it("preserves the real prior caller counterexample: private result flags alone did not prevent evaluator configuration", () => {
  const parent = execFileSync("git", ["show", "b58110f2dc42a62347a26670816f898ba981dee6:tests/runner-e2e/runner.spec.ts"], { encoding: "utf8", cwd: new URL("../..", import.meta.url) });
  const factory = vi.fn(() => ({ enabled: true }));
  expect(traceInitialization(parent)(scope(), factory, { env: {} })).toEqual({ enabled: true }); expect(factory).toHaveBeenCalledOnce();
});
it.each(["actual-root", "unknown-shape"])("actual diagnostic scanner keeps %s fatal before constant external disposition", kind => {
  const s = scope(), root = "synthetic-registered-root-1234567890", cap = `/invite/pcp_invite_${"a".repeat(43)}`, originals: string[] = [], external: string[] = [];
  const stream = createPrivateDiagnosticStream(() => [root], safe => { const record = invitationDiagnosticRecord(s, safe); originals.push(record.privateText); external.push(record.publicText); });
  const text = `${cap}; ${kind === "actual-root" ? root : "sk-proj-syntheticUnknownCredential123456789"}\n`;
  stream.write(Buffer.from(text.slice(0, 30))); stream.write(Buffer.from(text.slice(30))); stream.end();
  expect(originals.join("")).toContain(cap); expect(originals.join("")).not.toContain(root);
  expect(external.join("")).not.toContain(cap); expect(stream.redactedSecret()).toBe(true);
  expect(() => invitationDiagnosticDisposition(s, { failed: stream.failed(), redactedSecret: stream.redactedSecret() })).toThrow(/real credential/);
});
it("retains exact approved private diagnostic bytes without classifying them public before registration", () => {
  const s = scope(), cap = `/invite/pcp_invite_${"b".repeat(43)}`, originals: string[] = [], external: string[] = [];
  const stream = createPrivateDiagnosticStream(() => [], text => { const record = invitationDiagnosticRecord(s, text); originals.push(record.privateText); external.push(record.publicText); });
  stream.write(Buffer.from(cap + "\n")); stream.end(); expect(originals.join("")).toBe(cap + "\n");
  expect(external.join("")).not.toContain(cap); expect(invitationDiagnosticDisposition(s, { failed: stream.failed(), redactedSecret: stream.redactedSecret() }).disposition).toContain("private");
});
it("the enrolled policy recognizes the exact invitation target but still requires its protected identity", () => {
  expect(MANUAL_PRIVATE_EXECUTIONS).toHaveLength(244); expect(MANUAL_PRIVATE_EXECUTIONS).toContain(INVITATION_PRIVATE_EXECUTION);
  const identity = { workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [INVITATION_PRIVATE_EXECUTION] };
  // Pure local authorization metadata; never an actual operator record or verified preflight.
  const row = { ...identity, protocol: MANUAL_PRIVATE_PROTOCOL, launchSha256: "c".repeat(64) };
  expect(authorizeManualPrivateEvidence(identity, JSON.stringify({ version: 1, approvals: [row] })).executionIds).toEqual(identity.executionIds);
  expect(() => authorizeManualPrivateEvidence(identity, JSON.stringify({ version: 1, approvals: [] }))).toThrow();
  expect(() => authorizeManualPrivateEvidence({ ...identity, targetSha: "d".repeat(40) }, JSON.stringify({ version: 1, approvals: [row] }))).toThrow();
});
it("actual invitation launcher missing preflight stops before host or fixture setup with constant error text", async () => {
  const argv = [...process.argv], exit = process.exitCode, signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const listeners = new Map(signals.map(s => [s, process.listeners(s)])), errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(x => { errors.push(String(x)); });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true); vi.stubEnv("GITHUB_ACTIONS", "true"); vi.stubEnv("GITHUB_SHA", "a".repeat(40)); vi.stubEnv("PAPERCLIP_RUNNER_E2E_SOURCE_SHA", "b".repeat(40)); vi.stubEnv("PAPERCLIP_RUNNER_E2E_PRIVATE_PREFLIGHT", "");
  try { process.argv = [process.execPath, new URL("launch.ts", import.meta.url).pathname, "--id", INVITATION_PRIVATE_EXECUTION];
    await import("./launch.js"); expect(startup.reached).toBe(0); expect(process.exitCode).toBe(1);
    expect(errors).toEqual(["Invitation operation failed; inspect its restricted attempt result"]);
  } finally { process.argv = argv; process.exitCode = exit; vi.unstubAllEnvs(); for (const s of signals) for (const listener of process.listeners(s)) if (!listeners.get(s)!.includes(listener)) process.removeListener(s, listener); }
});

it("the refreshed shared handoff keeps report static assets out of ordinary invitation result admission", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synthetic-invite-static-asset-")));
  try {
    const source = path.join(root, "source"), file = path.join(source, "normalized/assets/InterVariable.woff2");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, readFileSync(new URL("../../ui/public/fonts/InterVariable.woff2", import.meta.url)));
    const context: ManualPrivateHandoff = { root, protocol: MANUAL_PRIVATE_PROTOCOL, private: true, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [INVITATION_PRIVATE_EXECUTION] };
    await expect(sealManualResultEvidence(context, [], source)).rejects.toThrow("Unsupported packaged evidence carrier");
  } finally { await rm(root, { recursive: true, force: true }); }
});


// The copy function is executed from its actual target source. This covers copy
// behavior and package arguments, not the complete runAttempt lifecycle.
function actualTargetCopy() {
  const source = readFileSync(new URL("launch.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function copySharedEvidence("), end = source.indexOf("\nasync function runAttempt(", start);
  if (start < 0 || end < start) throw new Error("Actual target copier missing");
  const body = stripTypeScriptTypes(source.slice(start, end));
  return new Function("cp", "path", `${body};return copySharedEvidence;`)(cp, path) as (from: string, to: string) => Promise<void>;
}
it.each(["valid", "tampered-static", "foreign-owner", "unknown-nested"])("current invitation private pipeline preserves %s report authority and originals", async kind => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synthetic-invite-current-pipeline-")));
  try {
    const reporter = path.join(root, "reporter"), tests = path.join(root, "node-only");
    await mkdir(tests); await mkdir(reporter);
    const require = createRequire(import.meta.url), pkg = require.resolve("@playwright/test/package.json"), entry = require.resolve("@playwright/test");
    await writeFile(path.join(tests, "failure.spec.cjs"), `const {test,expect}=require(${JSON.stringify(entry)});test('synthetic Node-only failure',async()=>{expect('wrong').toBe('expected');});`);
    const config = path.join(tests, "isolated.config.cjs");
    await writeFile(config, `module.exports=${JSON.stringify({ testDir: tests, testMatch: "failure.spec.cjs", workers: 1, outputDir: path.join(reporter, "playwright-output"), use: { trace: "retain-on-failure" }, reporter: [["html", { outputFolder: path.join(reporter, "html-report"), open: "never" }], ["junit", { outputFile: path.join(reporter, "junit.xml") }], ["blob", { outputDir: path.join(reporter, "blob-report") }]] })};`);
    const failure = await promisify(execFile)(process.execPath, [path.join(path.dirname(pkg), "cli.js"), "test", "--config", config], { cwd: tests, timeout: 30_000, maxBuffer: 1024*1024, env: { PATH: process.env.PATH, CI: "1", NODE_OPTIONS: "", NODE_PATH: "", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } }).then(() => false, error => { expect(error.code).toBe(1); return true; });
    expect(failure).toBe(true);
    const id = INVITATION_PRIVATE_EXECUTION, scenario = "access.invite-teammate", cell = path.join(root, "capture/cases", scenario);
    await mkdir(cell, { recursive: true }); await actualTargetCopy()(reporter, cell);
    await writeFile(path.join(cell, "result.json"), JSON.stringify({ status: "failed", failureClass: "assertion", cleanup: "passed" }));
    const context: ManualPrivateHandoff = { root, private: true, protocol: MANUAL_PRIVATE_PROTOCOL, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [id], cellReportProducer: await inspectCellReportProducer() };
    const owner = await privateCellEvidenceOwner(context, id), prefix = `gha-123-1-${id}/chat-features/runner-opencode/local/${scenario}/attempt-1`, upload = path.join(root, "results", prefix);
    if (kind === "tampered-static") await writeFile(path.join(cell, "html-report/trace/index.html"), "tampered static HTML");
    if (kind === "foreign-owner") { await mkdir(path.join(cell, "html-report/foreign/html-report/trace"), { recursive: true }); await cp(path.join(cell, "html-report/trace/index.html"), path.join(cell, "html-report/foreign/html-report/trace/index.html")); }
    if (kind === "unknown-nested") { await mkdir(path.join(cell, "snapshots/node_modules"), { recursive: true }); await writeFile(path.join(cell, "snapshots/node_modules/unknown.bin"), "unapproved"); }
    if (kind !== "valid") {
      await expect(packageEvidence({ privateDir: cell, uploadDir: upload, secrets: [], expectPassScreenshot: false, privateCell: { owner, layout: "original" } })).rejects.toThrow(/canonical|owner|carrier|trace asset/); return;
    }
    await preserveOriginalFrameworkResult(cell);
    const evidence = await packageEvidence({ privateDir: cell, uploadDir: upload, secrets: [], expectPassScreenshot: false, privateCell: { owner, layout: "original" } });
    expect(evidence.leaks).toEqual([]); expect(evidence.files).toContain("html-report/trace/playwright-logo.svg"); expect(evidence.files.some(name => name.endsWith(".ttf"))).toBe(true);
    const original = await sealStandardOriginalEvidence({ context, executionId: id, source: cell, evidence, secrets: [], expectPassScreenshot: false });
    const final = await sealManualResultEvidence(context, []);
    expect(original.complete).toBe(true); expect(final.complete).toBe(true);
    const saved = JSON.parse(await readFile(path.join(root, "sealed-results/html-report", prefix, "snapshots/manual-original-framework-result.json"), "utf8"));
    expect(saved).toEqual({ status: "failed", failureClass: "assertion", cleanup: "passed" });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 40_000);
it("current invitation producer mismatch rejects the actual preflight reader before host setup", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synthetic-invite-current-preflight-")));
  try {
    const file = path.join(root, "preflight.json"), producer = await inspectCellReportProducer();
    producer.staticManifestSha256 = "0".repeat(64);
    await writeFile(file, JSON.stringify({ root, private: true, status: "verified", protocol: MANUAL_PRIVATE_PROTOCOL, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [INVITATION_PRIVATE_EXECUTION], cellReportProducer: producer }), { mode: 0o600 });
    await expect(readManualPrivateHandoff({ PAPERCLIP_RUNNER_E2E_PRIVATE_PREFLIGHT: file, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: "a".repeat(40), PAPERCLIP_RUNNER_E2E_SOURCE_SHA: "b".repeat(40), RUNNER_TEMP: path.dirname(root) }, [INVITATION_PRIVATE_EXECUTION])).rejects.toThrow("producer differs");
    expect(startup.reached).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.each([0, 1, 2])("actual selected package call %s validates its full producer owner before packaging", async selected => {
  const source = readFileSync(new URL("launch.ts", import.meta.url), "utf8"), calls: string[] = [];
  let cursor = 0;
  while ((cursor = source.indexOf("await packageEvidence(", cursor)) >= 0) {
    const start = cursor, open = source.indexOf("(", start); let depth = 1, end = open + 1;
    while (depth && end < source.length) { if (source[end] === "(") depth++; else if (source[end] === ")") depth--; end++; }
    if (depth) throw new Error("Unclosed actual package call");
    calls.push(source.slice(start, end)); cursor = end;
  }
  if (calls.length !== 3) throw new Error("Unexpected selected package call count");
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "synthetic-invite-package-caller-")));
  try {
    const context: ManualPrivateHandoff = { root, private: true, protocol: MANUAL_PRIVATE_PROTOCOL, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [INVITATION_PRIVATE_EXECUTION], cellReportProducer: await inspectCellReportProducer() };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const call = new AsyncFunction("packageEvidence", "privateCellEvidenceOwner", "manualPrivateHandoff", "candidate", "casePrivateDir", "uploadDir", "credentials", "result", "validation", "attemptSecrets", "original", `${stripTypeScriptTypes(`async function selectedPackageCall(){return ${calls[selected]};}`)};return selectedPackageCall();`);
    const packager = vi.fn(async (value: unknown) => value), directory = path.join(root, "capture"); await mkdir(directory);
    const args = [packager, privateCellEvidenceOwner, context, { id: INVITATION_PRIVATE_EXECUTION }, directory, path.join(root, "upload"), [], { status: "failed" }, path.join(root, "validation"), [], { status: "failed" }];
    const options = await call(...args);
    expect(options.privateCell).toMatchObject({ layout: "original", owner: { root, executionId: INVITATION_PRIVATE_EXECUTION, producer: context.cellReportProducer } });
    expect(options.expectPassScreenshot).toBe(false); expect(packager).toHaveBeenCalledOnce();
    packager.mockClear(); context.cellReportProducer = { ...context.cellReportProducer!, staticManifestSha256: "0".repeat(64) };
    await expect(call(...args)).rejects.toThrow("producer differs"); expect(packager).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});
