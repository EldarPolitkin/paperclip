import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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
  expect(MANUAL_PRIVATE_EXECUTIONS).toHaveLength(10); expect(MANUAL_PRIVATE_EXECUTIONS).toContain(INVITATION_PRIVATE_EXECUTION);
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
