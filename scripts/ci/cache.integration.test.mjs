import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { executionPlan } from "./execution-plan.mjs";

const repositoryRoot = new URL("../../", import.meta.url);
const turbo = process.env.PAPERCLIP_CI_TEST_TURBO ?? new URL("node_modules/.bin/turbo", repositoryRoot).pathname;

test("every cached lane maps to an existing package script with complete inputs", () => {
  const config = JSON.parse(readFileSync(new URL("turbo.json", repositoryRoot), "utf8"));
  for (const [name, definition] of Object.entries(config.tasks).filter(([, task]) => task.cache)) {
    const plan = executionPlan(config, name.slice(3), ["--shard-index", "0"]);
    const rootTask = plan.target.startsWith("//#");
    const manifest = JSON.parse(readFileSync(new URL(rootTask ? "package.json"
      : "packages/paperclip-runner/package.json", repositoryRoot), "utf8"));
    const script = plan.target.split("#")[1];
    assert.equal(typeof manifest.scripts[script], "string", plan.target);
    assert.ok(plan.config.tasks[plan.target].inputs.length > 0);
    for (const input of plan.config.tasks[plan.target].inputs) {
      const file = rootTask ? input : input.slice("$TURBO_ROOT$/".length);
      assert.ok(definition.inputs.some((glob) => path.matchesGlob(file, glob)), input);
      assert.doesNotMatch(file, /\/(?:node_modules|target|dist)\//);
    }
    assert.ok(plan.args.includes("--shard-index"));
  }
});

test("real CI wrapper forces execution and invalidates cached inputs and failed tasks", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ci-turbo-"));
  const write = (name, content) => writeFileSync(path.join(directory, name), content);
  const json = (name, value) => write(name, JSON.stringify(value));
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory });
    write(".gitignore", ".turbo/\ngenerated/\nresult.txt\ncalls.txt\n");
    mkdirSync(path.join(directory, "packages/fixture"), { recursive: true });
    json("packages/fixture/package.json", { name: "fixture", private: true });
    json("package.json", { name: "cache-proof", private: true, packageManager: "npm@10.0.0", workspaces: ["packages/*"],
      scripts: { "test:run:general": "node check.cjs" } });
    json("package-lock.json", { name: "cache-proof", lockfileVersion: 3, packages: { "": { name: "cache-proof" } } });
    const definition = { globalDependencies: ["package.json", "package-lock.json", "turbo.json", ".gitignore"], globalEnv: ["CI_TASK_CACHE_SCOPE"], tasks: {
      "//#ci:server": { inputs: ["*.txt", "check.cjs"], outputs: ["result.txt"], env: ["FLAVOR"], cache: true },
    } };
    const taskArgs = ["--shard-index", "0", "--shard-count", "12"];
    mkdirSync(path.join(directory, "bin"));
    write("bin/pnpm", `#!/bin/sh
if [ "$1" = "--version" ]; then printf '9.15.4\n'; exit 0; fi
[ "$1" = "exec" ] || exit 2
shift
[ "$1" = "turbo" ] || exit 2
shift
exec "$PAPERCLIP_CI_TEST_TURBO" "$@"
`);
    chmodSync(path.join(directory, "bin/pnpm"), 0o755);
    write("input[one].txt", "first");
    write("check.cjs", `const fs = require('node:fs'); fs.appendFileSync('calls.txt','call\\n'); const input=fs.readFileSync('input[one].txt','utf8'); if(input==='fail') process.exit(1); if(!process.argv.includes('general-server-without-chat')) process.exit(2); fs.writeFileSync('result.txt',input+process.env.FLAVOR);`);
    const run = (extra = {}, args = taskArgs) => {
      json("turbo.json", definition);
      return spawnSync(process.execPath, [process.env.PAPERCLIP_CI_TEST_RUN_TASK
        ?? fileURLToPath(new URL("./run-task.mjs", import.meta.url))], {
        cwd: directory, encoding: "utf8", env: { ...process.env,
          PATH: `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`,
          PAPERCLIP_CI_TEST_TURBO: turbo, CI_TASK: "ci:server", CI_TASK_ARGS: JSON.stringify(args),
          CI_FORCE_TASKS: "false", TURBO_TELEMETRY_DISABLED: "1", FLAVOR: "a", ...extra },
      });
    };
    const calls = () => readFileSync(path.join(directory, "calls.txt"), "utf8").trim().split("\n").length;
    const pass = (extra) => { const r = run(extra); assert.equal(r.status, 0, r.stdout + r.stderr); return r; };
    pass(); assert.equal(calls(), 1);
    rmSync(path.join(directory, "result.txt"));
    pass(); assert.equal(calls(), 1, "cached task must not execute");
    pass({ CI_FORCE_TASKS: "true" }); assert.equal(calls(), 2, "forced task must execute despite a cached result");
    pass({ CI_FORCE_TASKS: "true" }); assert.equal(calls(), 3, "every forced attempt must execute");
    assert.equal(readFileSync(path.join(directory, "result.txt"), "utf8"), "firsta");
    write("unrelated.md", "another push");
    pass(); assert.equal(calls(), 4, "unclassified input must invalidate the safety scope");
    write("input[one].txt", "second");
    pass(); assert.equal(calls(), 5, "source must invalidate checks");
    pass({ FLAVOR: "b" }); assert.equal(calls(), 6);
    pass({ FLAVOR: "b", CI_FORCE_TASKS: "true" }); assert.equal(calls(), 7);
    assert.equal(run({}, [...taskArgs, "--another-argument"]).status, 0);
    assert.equal(calls(), 8, "different shard arguments must not share a task result");
    write("input[one].txt", "fail");
    assert.notEqual(run().status, 0); assert.notEqual(run().status, 0);
    assert.equal(calls(), 10, "a failed task must execute on every attempt");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
