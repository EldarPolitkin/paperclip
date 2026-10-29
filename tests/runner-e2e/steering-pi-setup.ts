import { spawn, type ChildProcess } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPiSetupEnvironment } from "../../cli/src/commands/runtime.js";
import { QUALIFIED_ACPX_PROFILES } from "../../packages/paperclip-runner/src/drivers/acpx/qualified-profiles.js";
import { readManualPrivateHandoff } from "./manual-private-handoff.js";
import { boundedOwnedFile, digest, requireSteeringPiTime, steeringPiAssetIdentity, STEERING_PI_EXECUTION, STEERING_PI_JOB_MS, STEERING_PI_RECEIPT, type SteeringPiReceipt } from "./steering-pi-receipt.js";

const DRAIN_MS = 310_000;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
export function steeringPiJob(value: unknown, env: NodeJS.ProcessEnv, now: number) {
  const page = value as { total_count?: number; jobs?: Record<string, unknown>[] };
  if (!Array.isArray(page.jobs) || page.total_count !== page.jobs.length || page.jobs.length > 100) throw new Error("Incomplete own-attempt jobs metadata");
  const matching = page.jobs.filter(job => job.run_id === Number(env.GITHUB_RUN_ID) && job.head_sha === env.GITHUB_SHA
    && job.name === STEERING_PI_EXECUTION && job.runner_name === env.RUNNER_NAME && job.workflow_name === "Runner Full-Stack E2E"
    && job.status === "in_progress" && job.completed_at === null);
  if (matching.length !== 1 || !env.RUNNER_NAME || env.GITHUB_RUN_ATTEMPT !== "1") throw new Error("Ambiguous current steering job");
  const job = matching[0]!, start = typeof job.started_at === "string" ? Date.parse(job.started_at) : NaN;
  if (!Number.isSafeInteger(job.id) || Number(job.id) <= 0 || !Number.isSafeInteger(start) || start > now || job.run_attempt !== undefined && job.run_attempt !== 1)
    throw new Error("Invalid current steering job clock");
  const deadline = start + STEERING_PI_JOB_MS;
  requireSteeringPiTime(deadline, now);
  const installMs = Math.min(900_000, deadline - now - 810_000 - DRAIN_MS);
  if (installMs <= 0) throw new Error("Insufficient installation and child-drain time");
  return { jobId: Number(job.id), runnerName: env.RUNNER_NAME, jobStartedAt: job.started_at as string, jobDeadlineMs: deadline, installMs };
}
export async function readSteeringPiJob(env: NodeJS.ProcessEnv) {
  if (env.GITHUB_REPOSITORY !== "paperclipai/paperclip" || env.GITHUB_SERVER_URL !== "https://github.com"
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_RUN_ATTEMPT !== "1" || !env.GH_TOKEN) throw new Error("Invalid own-run metadata authority");
  const response = await fetch(`https://api.github.com/repos/paperclipai/paperclip/actions/runs/${env.GITHUB_RUN_ID}/attempts/1/jobs?per_page=100`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(15_000), redirect: "error",
  });
  if (!response.ok || response.headers.get("link") || Number(response.headers.get("content-length") ?? 0) > 1024 * 1024 || !response.body) {
    await response.body?.cancel(); throw new Error("Own-run metadata is unavailable");
  }
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > 1024 * 1024) throw new Error("Own-run metadata exceeds its allowance"); chunks.push(part.value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return steeringPiJob(JSON.parse(Buffer.concat(chunks).toString()), env, Date.now());
}
interface InstallerPorts {
  spawn: typeof spawn; signal: (pid: number, signal: NodeJS.Signals) => void;
  timer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: typeof clearTimeout;
}
const installerPorts: InstallerPorts = { spawn, signal: (pid, signal) => process.kill(-pid, signal), timer: setTimeout, clear: clearTimeout };
export async function runSteeringPiInstaller(input: { entry: string; cwd: string; env: NodeJS.ProcessEnv; installMs: number; write: (stream: "stdout" | "stderr", bytes: Buffer) => void; signal?: AbortSignal }, ports = installerPorts) {
  if (input.installMs <= 0 || input.installMs > 900_000) throw new Error("Invalid Pi installation interval");
  const child: ChildProcess = ports.spawn(process.execPath, ["--use-env-proxy", input.entry], {
    cwd: input.cwd, env: buildPiSetupEnvironment(input.env), detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let cancelled = false, failure = false, output = 0, stdout = "", closed = false;
  let drain: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (closed || cancelled) return;
    cancelled = true;
    if (child.pid) { try { ports.signal(child.pid, "SIGTERM"); } catch { failure = true; } }
    drain = ports.timer(() => { if (!closed && child.pid) { try { ports.signal(child.pid, "SIGKILL"); } catch { failure = true; } } }, DRAIN_MS);
  };
  const deadline = ports.timer(stop, input.installMs);
  input.signal?.addEventListener("abort", stop, { once: true });
  if (input.signal?.aborted) stop();
  return await new Promise<{ status: SteeringPiReceipt["status"]; target: "linux-x64"; profileDigest: string }>((accept, reject) => {
    child.once("error", () => { failure = true; });
    for (const stream of ["stdout", "stderr"] as const) child[stream]?.on("data", (part: Buffer) => {
      output += part.length;
      if (output > OUTPUT_LIMIT) { failure = true; stop(); return; }
      try { input.write(stream, part); if (stream === "stdout") stdout += part.toString("utf8"); } catch { failure = true; stop(); }
    });
    child.once("close", (code, signal) => {
      closed = true; ports.clear(deadline); if (drain) ports.clear(drain); input.signal?.removeEventListener("abort", stop);
      if (cancelled || failure || signal || code !== 0) { reject(new Error("Pi installation unresolved; no assets admitted")); return; }
      try {
        const value = JSON.parse(stdout.trim());
        if (Object.keys(value).sort().join() !== "profileDigest,status,target" || !["installed_verified", "verified_existing"].includes(value.status)
          || value.target !== "linux-x64" || value.profileDigest !== QUALIFIED_ACPX_PROFILES.pi.commandDigest) throw new Error("Invalid Pi setup result");
        accept(value);
      } catch { reject(new Error("Pi installation produced no accepted verification receipt")); }
    });
  });
}
export async function prepareSteeringPi(env: NodeJS.ProcessEnv) {
  const context = await readManualPrivateHandoff(env, [STEERING_PI_EXECUTION]);
  if (!context || env.STEERING_PI_RESTORED !== "success" || env.STEERING_PI_BUILD_ARTIFACT !== `runner-e2e-build-${context.targetSha}-${context.runId}-1`
    || !/^[a-f0-9]{64}$/.test(env.STEERING_PI_BUILD_SHA256 ?? "")) throw new Error("Steering Pi requires verified original build custody");
  const target = await realpath(env.GITHUB_WORKSPACE ?? "");
  if (target !== path.resolve(env.GITHUB_WORKSPACE ?? "")) throw new Error("Invalid Pi target source root");
  const reader = "tests/runner-e2e/steering-pi-receipt.ts";
  if (digest(await boundedOwnedFile(path.join(target, reader), 65_536)) !== digest(await boundedOwnedFile(fileURLToPath(new URL("./steering-pi-receipt.ts", import.meta.url)), 65_536)))
    throw new Error("Target lacks the reviewed Pi admission reader");
  const packageRoot = path.join(target, "packages/paperclip-runner");
  const manifest = JSON.parse((await boundedOwnedFile(path.join(packageRoot, "package.json"), 65_536)).toString());
  if (manifest.name !== "@paperclipai/paperclip-runner") throw new Error("Invalid Pi runner package");
  const entry = path.join(packageRoot, "dist/cli/provision-pi.cjs"), provisionerSha256 = digest(await boundedOwnedFile(entry, 64 * 1024 * 1024));
  const job = await readSteeringPiJob(env);
  const output = await open(path.join(context.root, "steering-pi-installer.log"), "wx", 0o600);
  const controller = new AbortController(), cancel = () => controller.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  let writeFailure: unknown; let writes = Promise.resolve();
  try {
    const result = await runSteeringPiInstaller({ entry, cwd: packageRoot, env, installMs: Math.min(job.installMs, job.jobDeadlineMs - Date.now() - 810_000 - DRAIN_MS), signal: controller.signal,
      write: (_stream, bytes) => { writes = writes.then(async () => { await output.writeFile(bytes); }).catch(error => { writeFailure = error; controller.abort(); }); },
    });
    await writes; if (writeFailure) throw new Error("Pi installation evidence was not retained"); await output.sync();
    if (digest(await boundedOwnedFile(entry, 64 * 1024 * 1024)) !== provisionerSha256) throw new Error("Pi provisioner changed during setup");
    const assets = await steeringPiAssetIdentity(target);
    requireSteeringPiTime(job.jobDeadlineMs, Date.now());
    const { installMs: _installMs, ...clock } = job;
    const receipt: SteeringPiReceipt = { schema: "paperclip.steering-pi-assets/v1", executionId: STEERING_PI_EXECUTION,
      runId: context.runId, attempt: "1", workflowSha: context.workflowSha, targetSha: context.targetSha, ...clock,
      buildArtifact: env.STEERING_PI_BUILD_ARTIFACT!, buildSha256: env.STEERING_PI_BUILD_SHA256!, provisionerSha256, ...result, ...assets };
    const file = await open(path.join(context.root, STEERING_PI_RECEIPT), "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(receipt)}\n`); await file.sync(); } finally { await file.close(); }
  } finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); await writes; await output.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareSteeringPi(process.env).catch(() => { console.error("STEERING_PI_PREPARATION_STOPPED"); process.exitCode = 1; });
}
