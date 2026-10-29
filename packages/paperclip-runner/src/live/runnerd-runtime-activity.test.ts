import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { CodexAppServerDriver } from "../drivers/codex/codex-app-server-driver.js";
import { collectUntilTerminal } from "../drivers/codex/codex-app-server-driver.test-support.js";
import { validatePrpEvent } from "../protocol/replay-contract.js";
import { createCodexTaskEnvelope } from "../contracts/codex.js";
import { createRunnerdCodexTransport, defaultCapabilityRunnerdBinary } from "./runnerd-codex-transport.js";

const execute = promisify(execFile);

it("delivers authenticated runtime activity through the real Runner bridge across runs", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "runnerd-runtime-activity-")));
  const runner = process.env.PAPERCLIP_ATTACH_TRANSITION_RUNNER ?? defaultCapabilityRunnerdBinary();
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(workspace), mkdir(join(root, "home"))]);
  const environment = { PATH: process.env.PATH, HOME: join(root, "home"), CODEX_HOME: join(root, "codex-home") };
  const bundle = createRunnerdCodexTransport({
    runnerBinary: runner,
    codexCommand: resolve(import.meta.dirname, "../../runner/target/debug/fake-codex-app-server"),
    codexArgs: ["--state-file", join(root, "provider.json")],
    stateDirectory: root, environment,
    lifecyclePolicy: { mode: "warm", idleTimeoutMs: 60_000 },
    prpIdentity: { runnerInstanceId: "runner-activity", environmentLeaseId: "lease-activity",
      runId: "activity-first", normalizedSessionId: "session-activity", turnId: "turn-activity", itemId: "item-activity" },
  });
  const driver = new CodexAppServerDriver({
    approvalPolicy: "never", includeCollaborationModeInstructions: false, environment,
    taskEnvelope: createCodexTaskEnvelope({ objective: "Verify runtime activity.", contractRevision: "1",
      criteria: [{ id: "objective", requirement: "Finish." }], constraints: [] }),
    transportFactory: () => bundle.transport,
  });
  const helper = (args: string[]) => execute(runner, args, { env: {
    ...environment, PAPERCLIP_RUNTIME_NOTIFICATION_CONTEXT: join(root, "runner/runtime-notifications.json"),
  } });
  const payload = { namespace: "example.runtime", activityKey: "screen.used" };
  let session: Awaited<ReturnType<typeof driver.openSession>> | undefined;
  try {
    session = await driver.openSession({ runId: "activity-first", normalizedSessionId: "session-activity", workingDirectory: workspace });
    const firstContext = (await helper(["notification-context"])).stdout.trim();
    for (const runId of ["activity-first", "activity-next"]) {
      if (runId === "activity-next") {
        await session.attachRun!({ runId });
        await vi.waitFor(async () => {
          expect((await helper(["notification-context"])).stdout.trim()).not.toBe(firstContext);
        });
        await expect(helper(["record-activity", firstContext, payload.namespace, payload.activityKey])).rejects.toThrow();
      }
      const context = (await helper(["notification-context"])).stdout.trim();
      await helper(["record-activity", context, payload.namespace, payload.activityKey]);
      await vi.waitFor(async () => {
        const journal = JSON.parse(await readFile(join(root, "control-plane/control-plane-state.json"), "utf8"));
        expect(journal.committedEvents.some((event: { eventType: string; envelope: { runId: string } }) =>
          event.eventType === "runtime.activity.recorded" && event.envelope.runId === runId)).toBe(true);
      });
      await session.startTurn({ message: { role: "user", text: "Finish." } });
      const events = await collectUntilTerminal(session.events());
      const activities = events.filter(event => event.eventType === "runtime.activity.recorded");
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({ runId, sourceKind: "runner", priority: 1, payload });
      expect(validatePrpEvent(activities[0]).ok).toBe(true);
    }
  } finally {
    await session?.close();
    await bundle.transport.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
