import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { PI_NODE_VERSION } from "../../packages/paperclip-runner/src/drivers/acpx/pi-node-pins.js";
import { runSteeringPiInstaller, steeringPiJob, readSteeringPiJob, prepareSteeringPi } from "./steering-pi-setup.js";
import { boundedOwnedFile, digest, readSteeringPiReceipt, requireSteeringPiTime, STEERING_PI_EXECUTION, STEERING_PI_JOB_MS, STEERING_PI_PROFILE, STEERING_PI_SOURCE_CLOSURE } from "./steering-pi-receipt.js";
import type { ManualPrivateHandoff } from "./manual-private-handoff.js";
const handoff = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("./manual-private-handoff.js", () => ({ readManualPrivateHandoff: async () => handoff.value }));
vi.mock("../../packages/paperclip-runner/src/drivers/acpx/pi-closure-pins.js", () => ({ PI_DISTRIBUTION_CLOSURE_SHA256: { "linux-x64": "64e0ccc3717492fb3e6dc9eb9af74b521e12e6d6f94de44d7deff6f97395c33d" } }));
const env = { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: "a".repeat(40), RUNNER_NAME: "owned-runner" };
const start = Date.parse("2026-10-29T00:00:00Z");
const job = { id: 23, run_id: 123, head_sha: env.GITHUB_SHA, name: STEERING_PI_EXECUTION, runner_name: env.RUNNER_NAME,
  workflow_name: "Runner Full-Stack E2E", status: "in_progress", completed_at: null, started_at: new Date(start).toISOString() };
const page = { total_count: 1, jobs: [job] };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("binds the actual current job and reserves full case, cleanup and child drain", () => {
 const clock = steeringPiJob(page, env, start + 60_000);
 expect(clock.jobDeadlineMs).toBe(start + STEERING_PI_JOB_MS);
 expect(clock.installMs).toBe(740_000);
 requireSteeringPiTime(clock.jobDeadlineMs, clock.jobDeadlineMs - 810_000);
 expect(() => requireSteeringPiTime(clock.jobDeadlineMs, clock.jobDeadlineMs - 809_999)).toThrow();
});
it.each([
 ["foreign runner", { ...page, jobs: [{ ...job, runner_name: "other" }] }],
 ["foreign workflow", { ...page, jobs: [{ ...job, head_sha: "b".repeat(40) }] }],
 ["ambiguous", { total_count: 2, jobs: [job, job] }],
 ["incomplete", { ...page, total_count: 2 }],
 ["clock skew", { ...page, jobs: [{ ...job, started_at: new Date(start + 1).toISOString() }] }],
 ["finished", { ...page, jobs: [{ ...job, status: "completed" }] }],
])("rejects %s before installation", (_name, value) => { expect(() => steeringPiJob(value, env, start)).toThrow(); });
it("refuses a late start and a replayed attempt", () => {
 expect(() => steeringPiJob(page, env, start + 1_000_000)).toThrow();
 expect(() => steeringPiJob(page, { ...env, GITHUB_RUN_ATTEMPT: "2" }, start)).toThrow();
});
it("uses one fixed own-attempt metadata read and fails without expanding permission", async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(page), { status: 200 })); vi.stubGlobal("fetch", fetcher);
 vi.spyOn(Date, "now").mockReturnValue(start + 1_000);
 await readSteeringPiJob({ ...env, GITHUB_REPOSITORY: "paperclipai/paperclip", GITHUB_SERVER_URL: "https://github.com", GH_TOKEN: "synthetic-token" });
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(fetcher.mock.calls[0]![0]).toBe("https://api.github.com/repos/paperclipai/paperclip/actions/runs/123/attempts/1/jobs?per_page=100");
 await expect(readSteeringPiJob({ ...env, GITHUB_REPOSITORY: "other/repo" })).rejects.toThrow();
 expect(fetcher).toHaveBeenCalledTimes(1); vi.unstubAllGlobals();
});
function installer() {
 const child = Object.assign(new EventEmitter(), { pid: 1234, stdout: new PassThrough(), stderr: new PassThrough() });
 const spawn = vi.fn().mockReturnValue(child), signal = vi.fn(), write = vi.fn();
 const ports = { spawn: spawn as never, signal, timer: setTimeout, clear: clearTimeout };
 const promise = runSteeringPiInstaller({ entry: "/owned/dist/cli/provision-pi.cjs", cwd: "/owned", installMs: 100,
  env: { PATH: "/bin", GH_TOKEN: "no", OPENROUTER_API_KEY: "no", AWS_SESSION_TOKEN: "no", NODE_OPTIONS: "no", HOME: "/private", HTTPS_PROXY: "http://operator-proxy" }, write }, ports);
 return { child, spawn, signal, write, promise };
}
it.each(["installed_verified", "verified_existing"])("accepts only the producer's closed %s receipt", async status => {
 const f = installer(); f.child.stdout.write(JSON.stringify({ status, target: "linux-x64", profileDigest: STEERING_PI_PROFILE.digest }));
 f.child.emit("close", 0, null); expect((await f.promise).status).toBe(status);
 expect(f.spawn.mock.calls[0]![1]).toEqual(["--use-env-proxy", "/owned/dist/cli/provision-pi.cjs"]);
 expect(f.spawn.mock.calls[0]![2]).toEqual({ cwd: "/owned", detached: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/bin", LANG: "C.UTF-8", HTTPS_PROXY: "http://operator-proxy" } });
 expect(f.write).toHaveBeenCalled(); expect(f.signal).not.toHaveBeenCalled();
});
it.each([
 [0, "{}"], [0, '{"status":"installed_verified","target":"darwin-arm64","profileDigest":"foreign"}'], [1, ""],
])("rejects incomplete/foreign/nonzero installer result %s %s", async (code, body) => {
 const f = installer(); f.child.stdout.write(body); f.child.emit("close", code, null); await expect(f.promise).rejects.toThrow();
});
it("cancels its owned group, drains then kills, and never accepts timeout output", async () => {
 vi.useFakeTimers(); const f = installer(); const failure = expect(f.promise).rejects.toThrow("unresolved");
 await vi.advanceTimersByTimeAsync(100); expect(f.signal).toHaveBeenCalledWith(1234, "SIGTERM");
 await vi.advanceTimersByTimeAsync(310_000); expect(f.signal).toHaveBeenCalledWith(1234, "SIGKILL");
 f.child.stdout.write(JSON.stringify({ status: "verified_existing", target: "linux-x64", profileDigest: STEERING_PI_PROFILE.digest }));
 f.child.emit("close", 0, null); await failure;
});
it("retains output only through the private writer and rejects overflow", async () => {
 const f = installer(); f.child.stderr.write("synthetic diagnostic"); expect(f.write.mock.calls[0]![0]).toBe("stderr");
 f.child.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1)); f.child.emit("close", 0, null);
 await expect(f.promise).rejects.toThrow(); expect(f.signal).toHaveBeenCalledWith(1234, "SIGTERM");
});
it("rejects symlinks and public-mode custody before reading", async () => {
 const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "pi-receipt-"));
 try { await writeFile(path.join(root, "file"), "synthetic", { mode: 0o644 }); await symlink(path.join(root, "file"), path.join(root, "link"));
  await expect(boundedOwnedFile(path.join(root, "link"), 100)).rejects.toThrow();
  await expect(boundedOwnedFile(path.join(root, "file"), 100, true)).rejects.toThrow();
  await chmod(path.join(root, "file"), 0o600); expect((await boundedOwnedFile(path.join(root, "file"), 100, true)).toString()).toBe("synthetic");
 } finally { await rm(root, { recursive: true, force: true }); }
});
it("rechecks actual bound files and the full remaining clock at target admission", async () => {
 vi.spyOn(process, "platform", "get").mockReturnValue("linux"); vi.spyOn(process, "arch", "get").mockReturnValue("x64");
 const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "pi-receipt-"));
 try {
  const entry = path.join(root, "packages/paperclip-runner/dist/cli/provision-pi.cjs"), assets = path.join(root, "packages/paperclip-runner/provider-assets/pi/linux-x64");
  await mkdir(path.dirname(entry), { recursive: true }); await mkdir(assets, { recursive: true }); await writeFile(entry, "synthetic compiled entry", { mode: 0o600 });
  const metadata = JSON.stringify({ schema: "paperclip.pi-distribution.v1", runtimeRoot: "runtime", nativeClosureSha256: "64e0ccc3717492fb3e6dc9eb9af74b521e12e6d6f94de44d7deff6f97395c33d", target: { platform: "linux", architecture: "x64", nodeVersion: PI_NODE_VERSION }, pins: { wrapper: "0.0.33", runtime: "1.0.0", sdk: "0.26.0", zod: "3.25.76" } });
  const native = JSON.stringify({ entries: [{ path: "a", sha256: "0".repeat(64), size: 1, executable: false }] });
  await writeFile(path.join(assets, "pi-distribution.json"), metadata, { mode: 0o600 }); await writeFile(path.join(assets, "native-closure.json"), native, { mode: 0o600 });
  const context = { root, executionIds: [STEERING_PI_EXECUTION], runId: "123", attempt: "1", workflowSha: env.GITHUB_SHA, targetSha: "b".repeat(40) } as ManualPrivateHandoff;
  const receipt = { schema: "paperclip.steering-pi-assets/v1", executionId: STEERING_PI_EXECUTION, runId: context.runId, attempt: "1", workflowSha: context.workflowSha, targetSha: context.targetSha,
   jobId: 23, runnerName: env.RUNNER_NAME, jobStartedAt: job.started_at, jobDeadlineMs: start + STEERING_PI_JOB_MS,
   buildArtifact: `runner-e2e-build-${context.targetSha}-123-1`, buildSha256: "c".repeat(64), provisionerSha256: digest("synthetic compiled entry"), status: "verified_existing", target: "linux-x64", profileDigest: STEERING_PI_PROFILE.digest, sourceClosureSha256: STEERING_PI_SOURCE_CLOSURE,
   closureSha256: "64e0ccc3717492fb3e6dc9eb9af74b521e12e6d6f94de44d7deff6f97395c33d", distributionSha256: digest(metadata), nativeManifestSha256: digest(native) };
  const file = path.join(root, "steering-pi-assets.json"); await writeFile(file, JSON.stringify(receipt), { mode: 0o600 });
  expect((await readSteeringPiReceipt(context, root, env.RUNNER_NAME!, () => start + 1_000)).jobId).toBe(23);
  await expect(readSteeringPiReceipt(context, root, env.RUNNER_NAME!, () => start + STEERING_PI_JOB_MS - 1)).rejects.toThrow("Insufficient time");
  await expect(readSteeringPiReceipt({ ...context, runId: "456" }, root, env.RUNNER_NAME!, () => start)).rejects.toThrow();
  await writeFile(entry, "modified entry"); await expect(readSteeringPiReceipt(context, root, env.RUNNER_NAME!, () => start)).rejects.toThrow("changed after setup");
 } finally { await rm(root, { recursive: true, force: true }); }
});
it("the actual preparation caller rejects missing custody or target consumer before metadata or installer", async () => {
 const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
 await expect(prepareSteeringPi({})).rejects.toThrow("verified original build custody");
 const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "pi-preflight-"));
 try {
  handoff.value = { root, executionIds: [STEERING_PI_EXECUTION], runId: "123", attempt: "1", workflowSha: env.GITHUB_SHA, targetSha: "b".repeat(40) };
  await expect(prepareSteeringPi({ GITHUB_WORKSPACE: root, STEERING_PI_RESTORED: "success", STEERING_PI_BUILD_ARTIFACT: `runner-e2e-build-${"b".repeat(40)}-123-1`, STEERING_PI_BUILD_SHA256: "c".repeat(64) })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
 } finally { handoff.value = undefined; vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});
it("the actual workflow selects only private local steering after restore and before model credentials", async () => {
 const source = await readFile(new URL("../../.github/workflows/runner-full-stack-e2e.yml", import.meta.url), "utf8"); const jobs = YAML.parse(source).jobs;
 const steps = jobs.test_manual_private.steps;
 const name = "Prepare source-built Pi for selected steering feature", index = steps.findIndex((s: any) => s.name === name), step = steps[index];
 expect(index).toBeGreaterThan(steps.findIndex((s: any) => s.id === "restored_campaign_outputs"));
 expect(index).toBeLessThan(steps.findIndex((s: any) => s.name === "Run paid cell"));
 const state = { needs: { catalog: { outputs: { operations_cadence: "" } } }, matrix: { executionId: STEERING_PI_EXECUTION, suiteId: "chat-features", profileId: "runner-opencode", environmentId: "local" }, steps: { manual_private_verified: { outcome: "success" }, restored_campaign_outputs: { outcome: "success" } } };
 const condition = (s: typeof state) => Function("needs", "matrix", "steps", `return (${step.if})`)(s.needs, s.matrix, s.steps);
 expect(condition(state)).toBe(true);
 for (const key of ["executionId", "suiteId", "profileId", "environmentId"] as const) expect(condition({ ...state, matrix: { ...state.matrix, [key]: "other" } })).toBe(false);
 for (const key of ["manual_private_verified", "restored_campaign_outputs"] as const) expect(condition({ ...state, steps: { ...state.steps, [key]: { outcome: "failure" } } })).toBe(false);
 expect(condition({ ...state, needs: { catalog: { outputs: { operations_cadence: "recurring" } } } })).toBe(false);
 expect(step.env.GH_TOKEN).toBe("${{ github.token }}"); expect(step.env.OPENROUTER_API_KEY).toBeUndefined();
});

it("rejects the workflow profile35 result rather than substituting it for approved target30", async () => {
 const f = installer(); f.child.stdout.write(JSON.stringify({ status: "verified_existing", target: "linux-x64", profileDigest: "sha256:9473de6ef4baf2bd82fe8b6757239bdc160960b0a78ae6f47fa9e0996544226c" }));
 f.child.emit("close", 0, null); await expect(f.promise).rejects.toThrow("no accepted verification receipt");
});
it("does not launch any installer when its caller is already cancelled", async () => {
 const controller = new AbortController(); controller.abort(); const spawn = vi.fn();
 await expect(runSteeringPiInstaller({ entry: "/owned/provision-pi.cjs", cwd: "/owned", env: {}, installMs: 100, write: () => {}, signal: controller.signal }, { spawn: spawn as never, signal: vi.fn(), timer: setTimeout, clear: clearTimeout })).rejects.toThrow();
 expect(spawn).not.toHaveBeenCalled();
});

it("the actual trusted failure sealer runs on failed or cancelled preparation, never on another stage", async () => {
 const source = YAML.parse(await readFile(new URL("../../.github/workflows/runner-full-stack-e2e.yml", import.meta.url), "utf8"));
 const step = source.jobs.test_manual_private.steps.find((row: any) => row.id === "steering_pi_failure");
 const evaluate = (setup: string, verified: string) => Function("always", "steps", `return (${step.if})`)(() => true, { steering_pi_setup: { outcome: setup }, manual_private_verified: { outcome: verified } });
 expect(evaluate("failure", "success")).toBe(true); expect(evaluate("cancelled", "success")).toBe(true);
 for (const outcome of ["success", "skipped", ""]) expect(evaluate(outcome, "success")).toBe(false);
 expect(evaluate("failure", "failure")).toBe(false);
});
