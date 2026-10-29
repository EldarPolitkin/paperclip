import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { publishRunnerE2EAttemptEvidence } from "./evidence.js";
import { prepareRunnerE2ECampaignDirectory, resolveRunnerE2EResultsRoot, RUNNER_E2E_RESULTS_ROOT } from "./results-root.js";
import type { RunnerE2EResult } from "./types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "runner-output-test-")));
  roots.push(root);
  const repository = path.join(root, "checkout");
  const privateDir = path.join(repository, "temporary", "case");
  await mkdir(privateDir, { recursive: true });
  const resultsRoot = resolveRunnerE2EResultsRoot(repository, { [RUNNER_E2E_RESULTS_ROOT]: path.join(root, "durable") });
  const campaignDir = await prepareRunnerE2ECampaignDirectory(resultsRoot, "unique-campaign");
  const uploadDir = path.join(campaignDir, "suite", "profile", "local", "case", "attempt-1");
  return { root, repository, privateDir, resultsRoot, uploadDir };
}

function result(status: "passed" | "failed" = "passed"): RunnerE2EResult {
  return {
    schema: "paperclip.runner-e2e.result/v2", executionId: "suite.profile.local.case",
    suiteId: "suite", profileId: "profile", environmentId: "local", caseId: "case",
    attempt: 1, provider: "fixture", model: "fixture", runtimeMode: "native", status,
    startedAt: "2026-10-29T00:00:00Z", finishedAt: "2026-10-29T00:00:01Z",
    durationMs: 1000, cleanup: status === "passed" ? "passed" : "not_started",
    ...(status === "failed" ? { failureClass: "permanent_infrastructure", error: "startup failed" } : {}),
  };
}

async function completeEvidence(privateDir: string) {
  for (const directory of ["snapshots", "html-report", "blob-report"])
    await mkdir(path.join(privateDir, directory));
  await writeFile(path.join(privateDir, "final-state.png"), "synthetic-test-png");
  await writeFile(path.join(privateDir, "junit.xml"), "<testsuite/>\n");
  await writeFile(path.join(privateDir, "html-report/index.html"), "<p>fixture</p>");
  await writeFile(path.join(privateDir, "snapshots/fixtures.json"), "{}\n");
  await writeFile(path.join(privateDir, "snapshots/api-state.json"), "{}\n");
  const blob = path.join(privateDir, "blob-report");
  await writeFile(path.join(blob, "report.txt"), "fixture report\n");
  execFileSync("zip", ["-q", "report.zip", "report.txt"], { cwd: blob });
}

it("publishes the real final evidence package outside the checkout and survives its removal", async () => {
  const f = await fixture();
  await completeEvidence(f.privateDir);
  expect(await publishRunnerE2EAttemptEvidence({ ...f, result: result(), secrets: [] })).toMatchObject({ status: "passed", cleanup: "passed" });
  await rm(f.repository, { recursive: true, force: true });
  expect(JSON.parse(await readFile(path.join(f.uploadDir, "result.json"), "utf8"))).toMatchObject({ status: "passed", cleanup: "passed" });
  const manifest = JSON.parse(await readFile(path.join(f.uploadDir, "evidence-manifest.json"), "utf8"));
  expect(manifest.missing).toEqual([]);
  expect(manifest.files).toEqual(expect.arrayContaining(["final-state.png", "snapshots/fixtures.json", "blob-report/report.zip"]));
  expect((await stat(f.resultsRoot)).mode & 0o777).toBe(0o700);
});

it("retains an early failure without requiring successful-flow evidence", async () => {
  const f = await fixture();
  await writeFile(path.join(f.privateDir, "server.log"), "startup failed\n");
  await publishRunnerE2EAttemptEvidence({ ...f, result: result("failed"), secrets: [] });
  await rm(f.repository, { recursive: true, force: true });
  const text = await readFile(path.join(f.uploadDir, "result.json"), "utf8");
  expect(JSON.parse(text)).toMatchObject({ status: "failed", failureClass: "permanent_infrastructure", cleanup: "not_started" });
  expect(await readFile(path.join(f.uploadDir, "server.log"), "utf8")).toBe("startup failed\n");
});

it("still rejects and redacts leaked diagnostics at the external destination", async () => {
  const f = await fixture(), secret = "synthetic-private-fixture-credential";
  await writeFile(path.join(f.privateDir, "server.log"), `startup failed: ${secret}\n`);
  await publishRunnerE2EAttemptEvidence({ ...f, result: { ...result("failed"), error: `startup failed: ${secret}` }, secrets: [secret] });
  const text = await readFile(path.join(f.uploadDir, "result.json"), "utf8");
  expect(JSON.parse(text)).toMatchObject({ status: "failed", failureClass: "secret_leak", cleanup: "not_started" });
  expect(text).not.toContain(secret);
  expect(await readFile(path.join(f.uploadDir, "server.log"), "utf8")).toContain("[REDACTED]");
});

it("still fails a nominal pass when required evidence is missing at the external destination", async () => {
  const f = await fixture();
  await completeEvidence(f.privateDir);
  await rm(path.join(f.privateDir, "final-state.png"));
  const final = await publishRunnerE2EAttemptEvidence({ ...f, result: result(), secrets: [] });
  expect(final).toMatchObject({ status: "failed", failureClass: "permanent_infrastructure", error: "Required evidence missing: final-state.png" });
  expect(JSON.parse(await readFile(path.join(f.uploadDir, "result.json"), "utf8"))).toEqual(final);
});

it("preserves the default and rejects unsafe override roots before any output or provider admission", async () => {
  const f = await fixture();
  expect(resolveRunnerE2EResultsRoot(f.repository, {})).toBe(path.join(f.repository, "tests/runner-e2e/results"));
  const alias = path.join(f.root, "alias");
  await symlink(f.resultsRoot, alias);
  const file = path.join(f.root, "file");
  await writeFile(file, "not a directory");
  for (const unsafe of ["", "relative", `${f.root}/missing/../other`, path.parse(f.root).root,
    os.homedir(), f.repository, path.join(f.repository, "source"), path.dirname(f.repository), alias, path.join(alias, "child"), file]) {
    expect(() => resolveRunnerE2EResultsRoot(f.repository, { [RUNNER_E2E_RESULTS_ROOT]: unsafe })).toThrow(RUNNER_E2E_RESULTS_ROOT);
  }
});

it("denies traversal and symlink destinations before deleting or writing final evidence", async () => {
  const f = await fixture();
  for (const unsafe of [".", "..", "../outside", "one/two", ""])
    await expect(prepareRunnerE2ECampaignDirectory(f.resultsRoot, unsafe)).rejects.toThrow("safe path segment");
  const outside = path.join(f.root, "outside");
  await mkdir(path.join(outside, "attempt-1"), { recursive: true });
  const sentinel = path.join(outside, "attempt-1", "sentinel.txt");
  await writeFile(sentinel, "preserve me");
  await symlink(outside, path.join(f.resultsRoot, "alias-campaign"));
  await expect(prepareRunnerE2ECampaignDirectory(f.resultsRoot, "alias-campaign")).rejects.toThrow("physical directories");
  await symlink(outside, path.join(f.resultsRoot, "unique-campaign", "alias-profile"));
  const uploadDir = path.join(f.resultsRoot, "unique-campaign", "alias-profile", "attempt-1");
  await expect(publishRunnerE2EAttemptEvidence({ ...f, uploadDir, result: result("failed"), secrets: [] })).rejects.toThrow("physical directories");
  await expect(publishRunnerE2EAttemptEvidence({ ...f, uploadDir: outside, result: result("failed"), secrets: [] })).rejects.toThrow("beneath its results root");
  expect(await readFile(sentinel, "utf8")).toBe("preserve me");
});

it("allows a normal retry in the same physical campaign", async () => {
  const f = await fixture();
  await completeEvidence(f.privateDir);
  await publishRunnerE2EAttemptEvidence({ ...f, result: result(), secrets: [] });
  expect(await prepareRunnerE2ECampaignDirectory(f.resultsRoot, "unique-campaign")).toBe(path.join(f.resultsRoot, "unique-campaign"));
  await publishRunnerE2EAttemptEvidence({ ...f, result: result("failed"), secrets: [] });
  expect(JSON.parse(await readFile(path.join(f.uploadDir, "result.json"), "utf8"))).toMatchObject({ status: "failed", error: "startup failed" });
});
