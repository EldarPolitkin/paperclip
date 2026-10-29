import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { readSteeringPiReceipt, requireSteeringPiTime, STEERING_PI_EXECUTION } from "./steering-pi-receipt.js";
import type { MatrixExecution } from "./types.js";
import type { ManualPrivateHandoff } from "./manual-private-handoff.js";

type Fingerprint = { digest: string; definitionDigest: string; graderDigest: string; fingerprintKind: string };
export function selectsSteeringPiAdmission(executions: readonly MatrixExecution[]) {
  return executions.some(execution => execution.task.id === "steering.steer-active");
}
export async function verifySteeringPiBundle(root: string, expected: string, deadline: number, now: () => number = Date.now) {
  requireSteeringPiTime(deadline, now());
  const file = path.join(root, "runner-e2e-build/runner-e2e-build-bundle.tar.gz");
  if (await realpath(file) !== file || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Invalid steering build bundle custody");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size <= 0n || before.uid !== BigInt(process.getuid!())) throw new Error("Invalid steering build bundle ownership");
    const hash = createHash("sha256"); let bytes = 0n;
    const remaining = deadline - now() - 810_000; if (remaining <= 0) throw new Error("Insufficient steering admission time");
    for await (const part of handle.createReadStream({ autoClose: false, signal: AbortSignal.timeout(remaining) })) { hash.update(part); bytes += BigInt(part.length); }
    const after = await handle.stat({ bigint: true }), named = await lstat(file, { bigint: true });
    if (bytes !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || named.dev !== before.dev || named.ino !== before.ino || named.isSymbolicLink() || hash.digest("hex") !== expected) throw new Error("Steering build bundle differs from verified setup");
    requireSteeringPiTime(deadline, now());
  } finally { await handle.close(); }
}
interface AdmissionPorts {
  now: () => number;
  readReceipt: typeof readSteeringPiReceipt;
  verifyBundle: typeof verifySteeringPiBundle;
}
const fingerprints = new WeakMap<MatrixExecution, { digest: string; runId: string; targetSha: string; workflowSha: string }>();
const ports: AdmissionPorts = { now: Date.now, readReceipt: readSteeringPiReceipt, verifyBundle: verifySteeringPiBundle };
export async function admitSteeringPiTarget(input: {
  executions: readonly MatrixExecution[]; context?: ManualPrivateHandoff; root: string; runnerName: string;
  stage: "selection" | "post-setup" | "pre-framework"; fingerprint?: () => Fingerprint;
}, dependencies = ports) {
  if (!selectsSteeringPiAdmission(input.executions)) return undefined;
  const execution = input.executions[0]!;
  if (input.executions.length !== 1 || execution.id !== STEERING_PI_EXECUTION || execution.suite.id !== "chat-features" || execution.environment.id !== "local"
    || execution.profile.id !== "runner-opencode" || execution.profile.provider !== "opencode" || execution.profile.generation !== "native"
    || execution.profile.model !== "openrouter/deepseek/deepseek-v4.1-flash-1017" || execution.profile.credential !== "OPENROUTER_API_KEY"
    || execution.task.automaticRetryPolicy !== "single_attempt" || execution.task.expectedRunCount !== 3 || execution.task.minimumExpectedRunCount !== 2 || execution.task.attemptTimeoutMs.local !== 720_000 || execution.task.turnTimeoutMs !== 0
    || !input.context || input.context.executionIds.length !== 1 || input.context.executionIds[0] !== STEERING_PI_EXECUTION) throw new Error("Steering Pi requires its exact original private native selection");
  if (!["selection", "post-setup", "pre-framework"].includes(input.stage) || (input.stage === "post-setup") !== !!input.fingerprint) throw new Error("Invalid steering admission phase");
  const fingerprint = input.fingerprint?.();
  if (input.fingerprint && (!fingerprint || fingerprint.fingerprintKind !== "complete-execution-and-oracle-closure" || !/^[a-f0-9]{64}$/.test(fingerprint.digest)
    || fingerprint.definitionDigest !== fingerprint.digest || fingerprint.graderDigest !== fingerprint.digest)) throw new Error("Steering source fingerprint is incomplete");
  const before = fingerprints.get(execution);
  if (input.stage === "pre-framework" && (!before || before.runId !== input.context.runId || before.targetSha !== input.context.targetSha || before.workflowSha !== input.context.workflowSha))
    throw new Error("Steering source fingerprint was not captured before attempt admission");
  const receipt = await dependencies.readReceipt(input.context, input.root, input.runnerName, dependencies.now);
  await dependencies.verifyBundle(input.root, receipt.buildSha256, receipt.jobDeadlineMs, dependencies.now);
  requireSteeringPiTime(receipt.jobDeadlineMs, dependencies.now());
  if (fingerprint) fingerprints.set(execution, { digest: fingerprint.digest, runId: input.context.runId, targetSha: input.context.targetSha, workflowSha: input.context.workflowSha });
  return { schema: "paperclip.steering-pi-target-admission/v1" as const, receipt,
    sourceFingerprintDigest: fingerprint?.digest ?? before?.digest ?? null, actualRuntimeFingerprint: null,
    originalCaseMs: 720_000, cleanupReserveMs: 90_000 };
}
