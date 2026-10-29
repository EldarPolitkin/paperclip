import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { listenOnFetchAllowedPort } from "../../e2e/fetch-allowed-port.js";
import { pollUntil } from "../api.js";
import { createDb } from "../../../packages/db/src/index.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { chatCatalogAgentIsReady } from "../chat-catalog-contract.js";
import { prepareOwnedDevSource, ownedDevCommand, stopOwnedDev, type OwnedDev } from "./privileged-owned-dev.js";
import { prepareOwnedDatabaseFaultAt } from "./privileged-database-fault.js";
import { processScalar, nativeHealthResponse, type PeerObservation, type NativeCallerBinding } from "./diagnostic-target-observer.js";
import { collectRunEvents } from "../run-observations.js";
import type { NativeFaultRun } from "./runtime-native-fault.js";
const owned = new WeakMap<ChatCatalogContext, { dev: OwnedDev; fault?: Awaited<ReturnType<typeof prepareOwnedDatabaseFaultAt>>; output?: string; target?: { pid: number; born: string }; hz?: number; connection?: string; deadline: number }>();
const execute = promisify(execFile);
export function remainingDiagnosticBudget(ctx: ChatCatalogContext) {
  const deadline = owned.get(ctx)?.deadline;
  if (!deadline || Date.now() >= deadline) throw new Error("Original diagnostic attempt budget exhausted");
  return deadline - Date.now();
}
export async function createDiagnosticTarget(ctx: ChatCatalogContext) {
  const deadline = ctx.observationDeadlineAt;
  if (!deadline || Date.now() >= deadline) throw new Error("Missing original diagnostic deadline");
  const dev = await prepareOwnedDevSource(ctx, dev => owned.set(ctx, { dev, deadline }));
  const o = owned.get(ctx)!;
  const reserve = async () => { const s = createServer(); const p = await listenOnFetchAllowedPort(s); await new Promise<void>((resolve, reject) => s.close(e => e ? reject(e) : resolve())); return p; };
  const port = await reserve(), dbPort = await reserve(); if (port === dbPort) throw new Error("Diagnostic ports collide");
  dev.config = path.join(dev.checkout, ".paperclip/config.json");
  await ownedDevCommand(dev, ["worktree", "init", "--instance", dev.instance, "--home", dev.home, "--from-config", dev.sourceConfig, "--server-port", String(port), "--db-port", String(dbPort), "--empty"], remainingDiagnosticBudget(ctx));
  const c = JSON.parse(await readFile(dev.config, "utf8"));
  if (c.server.port !== port || c.database.embeddedPostgresPort !== dbPort || !(await realpath(c.database.embeddedPostgresDataDir)).startsWith(dev.root + path.sep)) throw new Error("Diagnostic target config is not owned");
  const observerRoot = path.join(dev.root, "observer"); await mkdir(observerRoot, { mode: 0o700 });
  const hz = Number((await execute("getconf", ["CLK_TCK"], { env: { PATH: "/usr/bin:/bin", LANG: "C" }, timeout: Math.min(1500, remainingDiagnosticBudget(ctx)) })).stdout.trim());
  o.hz = hz; o.output = path.join(observerRoot, "observations.json"); const config = path.join(observerRoot, "config.json");
  await writeFile(config, JSON.stringify({ output: o.output, armed: path.join(observerRoot, "armed"), hz }), { mode: 0o600 });
  const preload = fileURLToPath(new URL("./diagnostic-target-preload.mjs", import.meta.url));
  dev.child = spawn(process.execPath, ["--import", dev.loader, "--import", preload, dev.entry, "run", "--config", dev.config, "--yes"], { cwd: dev.checkout, env: { ...dev.env, PAPERCLIP_E2E_DIAGNOSTIC_OBSERVER: config }, stdio: "ignore" });
  dev.closed = new Promise<void>((resolve, reject) => { dev.child!.once("error", reject); dev.child!.once("close", () => resolve()); });
  const targetUrl = `http://127.0.0.1:${port}`;
  await pollUntil({ label: "Owned diagnostic target initial readiness", deadlineAt: Math.min(deadline, Date.now() + 45000),
    load: async () => { try { const r = await fetch(new URL("/api/health", targetUrl), { signal: AbortSignal.timeout(Math.min(3000, remainingDiagnosticBudget(ctx))) }); return r.ok && (await r.json() as { status?: string }).status === "ok"; } catch { return false; } },
    accept: Boolean, reject: () => dev.child?.exitCode != null ? "Owned diagnostic target exited" : undefined });
  const pid = dev.child.pid; if (!pid) throw new Error("Missing actual diagnostic target PID");
  const target = processScalar(pid, await readFile(`/proc/${pid}/stat`, "utf8"), await readFile(`/proc/${pid}/status`, "utf8"), await readFile("/proc/stat", "utf8"), hz, await (await import("node:fs/promises")).readlink(`/proc/${pid}/ns/net`));
  o.target = { pid, born: target.born };
  o.connection = `postgres://paperclip:paperclip@127.0.0.1:${dbPort}/paperclip`;
  ctx.input.privateSecrets?.push(o.connection);
  await assertEmptyDiagnosticTarget(o.connection);
  o.fault = await prepareOwnedDatabaseFaultAt(ctx, dev.root, dev.config); await o.fault.stop();
  const health = await fetch(new URL("/api/health", targetUrl), { signal: AbortSignal.timeout(Math.min(3000, remainingDiagnosticBudget(ctx))) });
  const body = await health.json() as { error?: string }; const doctor = await o.fault.doctor();
  const controller = await fetch(new URL("/api/health", ctx.input.api.baseURL), { signal: AbortSignal.timeout(Math.min(3000, remainingDiagnosticBudget(ctx))) });
  const agent = await ctx.input.api.get<{ status?: string; lifecycleState?: string; lifecycleError?: unknown }>(`/api/agents/${ctx.input.fixtures.agent.id}`);
  if (health.status !== 503 || body.error !== "database_unreachable" || doctor.status !== "fail" || !doctor.connectionFailure || !controller.ok) throw new Error("Diagnostic subject/controller boundary not established");
  await writeFile(path.join(observerRoot, "armed"), "", { mode: 0o600 });
  return { targetUrl, targetInitiallyReady: true, targetOwned: true, targetPid: pid, targetBorn: target.born, healthStatus: health.status, healthError: body.error,
    doctorFailed: true, controllerHealthy: true, controllerAgentReady: chatCatalogAgentIsReady(agent), sourceRevision: dev.revision };
}
export function currentNativeCaller(run: NativeFaultRun, events: Array<{ seq?: number; payload?: { prpEvent?: Record<string, unknown> } }>, binding: { companyId: string; agentId: string; issueId: string }): NativeCallerBinding | undefined {
  const checkpoint = run.runnerProfileJson?.sessionCheckpoint as { process?: { providerPid?: number; providerProcessStartedAt?: string } } | undefined;
  const providerPid = checkpoint?.process?.providerPid, providerBorn = checkpoint?.process?.providerProcessStartedAt;
  if (!run.processPid || !run.processStartedAt || !providerPid || !providerBorn || run.runtimeMode !== "native" || !["running", "succeeded"].includes(run.status)
    || run.companyId !== binding.companyId || run.agentId !== binding.agentId || run.nativeIssueId !== binding.issueId || !run.runnerInstanceId || !run.nativeSessionId) return;
  const bound = events.some(row => { const e = row.payload?.prpEvent, p = e?.payload as { processId?: number } | undefined;
    return e?.runId === run.id && e.sourceKind === "runner" && e.sourceInstanceId === run.runnerInstanceId && e.normalizedSessionId === run.nativeSessionId
      && ["session.started", "session.resumed"].includes(String(e.eventType)) && p?.processId === providerPid; });
  return { runnerPid: run.processPid, runnerBorn: new Date(run.processStartedAt).toISOString(), providerPid, providerBorn, currentRunBound: bound };
}
export async function diagnosticActionEvidence(ctx: ChatCatalogContext, runId: string) {
  const o = owned.get(ctx); if (!o?.output || !o.target) return false;
  remainingDiagnosticBudget(ctx);
  const run = await ctx.input.api.get<NativeFaultRun>(`/api/heartbeat-runs/${runId}`);
  const events = await collectRunEvents<{ seq?: number; payload?: { prpEvent?: Record<string, unknown> } }>((afterSeq, limit) => ctx.input.api.get(`/api/heartbeat-runs/${run.id}/events?afterSeq=${afterSeq}&limit=${limit}`));
  const b = currentNativeCaller(run, events, { companyId: ctx.input.fixtures.company.id, agentId: ctx.input.fixtures.agent.id, issueId: ctx.issue()!.id }); if (!b) return false;
  let rows: PeerObservation[]; try { const raw = await readFile(o.output, "utf8"); if (raw.length > 262144) return false; rows = JSON.parse(raw); } catch { return false; }
  if (!validDiagnosticObservations(rows)) throw new Error("Owned diagnostic observer returned unsupported evidence");
  const accepted = rows.some(row => nativeHealthResponse(row, b, o.target!));
  await ctx.input.evidence("chat-catalog-diagnostic-native-caller.json", { runId: run.id, issueId: ctx.issue()!.id, companyId: run.companyId, agentId: run.agentId,
    target: o.target, nativeBinding: b, observations: rows, accepted });
  return accepted;
}
export async function operatorDiagnosticCheck(ctx: ChatCatalogContext) {
  remainingDiagnosticBudget(ctx); const result = await owned.get(ctx)!.fault!.doctor(); return result.status === "fail" && result.connectionFailure;
}
export function emptyDiagnosticInventory(value: { agents: number; runs: number }) { return value.agents === 0 && value.runs === 0; }
async function assertEmptyDiagnosticTarget(connection: string) {
  const db = createDb(connection, { maxConnections: 1, prepare: false }).$client;
  try { const rows = await db.unsafe<{ agents: number; runs: number }[]>("select (select count(*)::int from agents) as agents, (select count(*)::int from heartbeat_runs) as runs");
    if (rows.length !== 1 || !emptyDiagnosticInventory(rows[0]!)) throw new Error("Diagnostic target contains unexpected agent or inference work");
  } finally { await db.end({ timeout: 5 }); }
}
export function validDiagnosticObservations(value: unknown): value is PeerObservation[] {
  const keys = (v: object, names: string[]) => Object.keys(v).sort().join() === names.sort().join();
  const validProcess = (v: any) => v && typeof v === "object" && keys(v, ["pid", "parent", "uid", "ticks", "born", "namespace"])
    && Number.isSafeInteger(v.pid) && v.pid > 1 && Number.isSafeInteger(v.parent) && v.parent >= 0 && Number.isSafeInteger(v.uid) && v.uid >= 0
    && typeof v.ticks === "string" && /^\d+$/.test(v.ticks) && typeof v.namespace === "string" && /^net:\[\d+\]$/.test(v.namespace)
    && typeof v.born === "string" && Number.isFinite(Date.parse(v.born)) && new Date(v.born).toISOString() === v.born;
  return Array.isArray(value) && value.length <= 16 && value.every(v => v && typeof v === "object" && keys(v, ["target", "chain", "finished", "status", "unknown"])
    && validProcess(v.target) && Array.isArray(v.chain) && v.chain.length <= 64 && v.chain.every(validProcess) && typeof v.finished === "boolean" && typeof v.unknown === "boolean"
    && (v.status === null || Number.isInteger(v.status) && v.status >= 100 && v.status <= 599));
}
export async function drainDiagnosticTarget(recover: () => Promise<unknown>, stop: () => Promise<unknown>) {
  let failure: unknown;
  try { await recover(); } catch (error) { failure = error; }
  try { await stop(); } catch (error) { if (failure) throw new AggregateError([failure, error], "Owned diagnostic recovery and stop failed"); throw error; }
  if (failure) throw failure;
}
export async function cleanupDiagnosticTarget(ctx: ChatCatalogContext) {
  const o = owned.get(ctx); if (!o) return;
  await drainDiagnosticTarget(async () => { await o.fault?.recover(); if (o.connection) await assertEmptyDiagnosticTarget(o.connection); }, () => stopOwnedDev(o.dev));
  if (o.dev.config && await readFile(o.dev.config).then(() => true, () => false)) await ownedDevCommand(o.dev, ["worktree:cleanup", o.dev.instance, "--instance", o.dev.instance, "--home", o.dev.home]);
  const root = await realpath(process.env.PAPERCLIP_RUNNER_E2E_TEMP_ROOT!), directory = await realpath(o.dev.root);
  if (!directory.startsWith(root + path.sep) || !path.basename(directory).startsWith("operator-dev-")) throw new Error("Refusing foreign diagnostic cleanup");
  await rm(directory, { recursive: true }); owned.delete(ctx);
}
