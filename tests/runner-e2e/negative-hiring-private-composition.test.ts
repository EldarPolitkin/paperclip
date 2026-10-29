import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { copySharedEvidence } from "./launch.js";
import { packageEvidence, inspectZip, inspectEmbeddedReport } from "./evidence.js";
import { inspectCellReportProducer, privateCellEvidenceOwner, type CellReportProducerIdentity } from "./manual-private-report-assets.js";
import { sealStandardOriginalEvidence, sealManualResultEvidence, type ManualPrivateHandoff } from "./manual-private-handoff.js";
import { validateSealedInventory, validateSealedOriginals } from "./manual-private-transfer.js";
import { authorizeManualPrivateEvidence, MANUAL_PRIVATE_PROTOCOL, manualCellKind } from "./manual-private-retention.js";
import { manualEvidenceRouting } from "./manual-private-policy.mjs";
import { archivePrivateEvidence } from "./private-history.js";

const scenarios = ["agents.hire-needs-account", "agents.ambiguous-cloud-code"];
const ids = scenarios.map(id => `chat-features.runner-opencode.local.${id}`);
const roots: string[] = [];
const temporary = await realpath(os.tmpdir());
let reporter: string, reportRoot: string, producer: CellReportProducerIdentity;
beforeAll(async () => {
 reportRoot = await mkdtemp(path.join(temporary, "synthetic-negative-report-")); reporter = path.join(reportRoot, "reporter");
 const tests = path.join(reportRoot, "node-tests"); await mkdir(tests);
 const require = createRequire(import.meta.url), pkg = require.resolve("@playwright/test/package.json"), entry = require.resolve("@playwright/test");
 await writeFile(path.join(tests, "failed.spec.cjs"), `const {test,expect}=require(${JSON.stringify(entry)});test('synthetic Node-only failure',async()=>{expect(false).toBe(true);});`);
 const config = path.join(tests, "isolated.config.cjs");
 await writeFile(config, `module.exports=${JSON.stringify({ testDir: tests, testMatch: "failed.spec.cjs", workers: 1, outputDir: path.join(reporter, "playwright-output"), use: { trace: "retain-on-failure" }, reporter: [["html", { outputFolder: path.join(reporter, "html-report"), open: "never" }], ["junit", { outputFile: path.join(reporter, "junit.xml") }], ["blob", { outputDir: path.join(reporter, "blob-report") }]] })};`);
 const outcome = await promisify(execFile)(process.execPath, [path.join(path.dirname(pkg), "cli.js"), "test", "--config", config], { cwd: tests, timeout: 30000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, CI: "1", NODE_OPTIONS: "", NODE_PATH: "", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } }).then(() => 0, error => error.code);
 expect(outcome).toBe(1); producer = await inspectCellReportProducer();
}, 30000);
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
afterAll(async () => { await rm(reportRoot, { recursive: true, force: true }); });
async function fixture(scenario: string) {
 const root = await mkdtemp(path.join(temporary, "synthetic-negative-private-")); roots.push(root);
 const id = `chat-features.runner-opencode.local.${scenario}`, cell = path.join(root, "capture/cases", scenario); await mkdir(cell, { recursive: true });
 await copySharedEvidence(reporter, cell); await writeFile(path.join(cell, "result.json"), '{"status":"failed","failureClass":"assertion"}');
 const context = { root, private: true, protocol: MANUAL_PRIVATE_PROTOCOL, workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: [id], cellReportProducer: producer } as ManualPrivateHandoff;
 const prefix = `gha-123-1-${id}/chat-features/runner-opencode/local/${scenario}/attempt-1`;
 return { root, id, cell, context, upload: path.join(root, "results", prefix) };
}
async function actualCalls() {
 const source = await readFile(new URL("./launch.ts", import.meta.url), "utf8"), calls: string[] = [];
 for (const match of source.matchAll(/await packageEvidence\(/g)) {
  let depth = 1, quote = "", escaped = false, end = match.index! + match[0].length;
  for (; end < source.length && depth; end++) {
   const char = source[end]!;
   if (quote) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === quote) quote = ""; }
   else if (char === '"' || char === "'" || char === "`") quote = char;
   else if (char === "(") depth++;
   else if (char === ")") depth--;
  }
  calls.push(source.slice(match.index!, end));
 }
 expect(calls).toHaveLength(3); return calls;
}
it("future source admission requires the real exact tuple for these two frozen IDs", () => {
 const identity = { workflowSha: "a".repeat(40), targetSha: "b".repeat(40), runId: "123", attempt: "1", executionIds: ids };
 const approval = JSON.stringify({ version: 1, approvals: [{ ...identity, protocol: MANUAL_PRIVATE_PROTOCOL, launchSha256: "c".repeat(64) }] });
 expect(authorizeManualPrivateEvidence(identity, approval).executionIds).toEqual([...ids].sort());
 expect(() => authorizeManualPrivateEvidence({ ...identity, runId: "124" }, approval)).toThrow();
 expect(manualEvidenceRouting({ EVENT_NAME: "workflow_dispatch", EVAL_CADENCE: "manual", TEST_RUNNER: "runs-on/fleet=paperclip-public-pr-x64/env=public-ci", SELECT_ID: ids.join(",") }).executionIds).toEqual([...ids].sort());
});
it.each(scenarios)("actual three packaging expressions retain the private producer for %s", async scenario => {
 const f = await fixture(scenario), scope = { packageEvidence, privateCellEvidenceOwner, manualPrivateHandoff: f.context, candidate: { id: f.id }, casePrivateDir: f.cell, uploadDir: f.upload, validation: path.join(f.root, "abnormal-scan"), credentials: [], attemptSecrets: [], result: { status: "failed" }, original: { status: "failed" } };
 let evidence: Awaited<ReturnType<typeof packageEvidence>> | undefined;
 for (const call of await actualCalls()) {
  const code = stripTypeScriptTypes(`async function invoke(){ return ${call}; }`, { mode: "strip" });
  const body = code.slice(code.indexOf("{") + 1, code.lastIndexOf("}"));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  evidence = await new AsyncFunction(...Object.keys(scope), body)(...Object.values(scope));
  expect(evidence!.files).toContain("html-report/trace/playwright-logo.svg");
  expect(evidence!.files).toContain("html-report/trace/manifest.webmanifest");
 }
 await sealStandardOriginalEvidence({ context: f.context, executionId: f.id, source: f.cell, evidence: evidence!, secrets: [], expectPassScreenshot: false });
 await sealManualResultEvidence(f.context, []);
 expect((await validateSealedOriginals(f.root, f.id, f.context)).complete).toBe(true);
 expect((await validateSealedInventory(path.join(f.root, "sealed-results/html-report"), "../result-evidence-inventory.json", undefined, "standard", f.context)).complete).toBe(true);
 const archive = path.join(f.root, "synthetic-original.zip"), restored = path.join(f.root, "restored");
 await archivePrivateEvidence("pack", path.join(f.root, "originals", manualCellKind(f.id)), archive); await archivePrivateEvidence("unpack", archive, restored);
 expect(await readFile(path.join(restored, "html-report/trace/playwright-logo.svg"))).toEqual(await readFile(path.join(f.cell, "html-report/trace/playwright-logo.svg")));
});
it("the retained strong ZIP and embedded-report inspectors reject compressed synthetic credentials", async () => {
 const f = await fixture(scenarios[0]!), source = path.join(f.root, "synthetic-zip-source"), archive = path.join(f.root, "synthetic-secret.zip"), secret = "SYNTHETIC_STRONG_ZIP_SECRET_123456789";
 await mkdir(source); await writeFile(path.join(source, "proof.txt"), secret); await archivePrivateEvidence("pack", source, archive);
 expect(await inspectZip(archive, [secret])).not.toBeNull();
 expect(await inspectEmbeddedReport(`data:application/zip;base64,${(await readFile(archive)).toString("base64")}`, [secret])).not.toBeNull();
});
it("an unknown private trace carrier remains rejected under the composed producer", async () => {
 const f = await fixture(scenarios[0]!), owner = await privateCellEvidenceOwner(f.context, f.id);
 await writeFile(path.join(f.cell, "html-report/trace/unknown.svg"), '<svg/>');
 await expect(packageEvidence({ privateDir: f.cell, uploadDir: f.upload, secrets: [], expectPassScreenshot: false, privateCell: { owner, layout: "original" } })).rejects.toThrow();
});
