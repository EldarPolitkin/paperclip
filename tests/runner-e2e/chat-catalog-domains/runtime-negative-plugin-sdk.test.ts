import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureLocalPluginBuilt } from "../../../server/src/services/plugin-loader.js";
import { prepareOwnedDaytonaSdk } from "./runtime-negative-plugin-sdk.js";

const source = path.resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "negative-runtime-sdk-"))); roots.push(root);
  const plugin = path.join(root, "packages/plugins/sandbox-providers/daytona"), sdk = path.join(root, "packages/plugins/sdk");
  const pkg = JSON.parse(await readFile(path.join(source, "packages/plugins/sandbox-providers/daytona/package.json"), "utf8"));
  await mkdir(plugin, { recursive: true }); await mkdir(path.join(sdk, "dist"), { recursive: true }); await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(plugin, "package.json"), JSON.stringify(pkg));
  await writeFile(path.join(plugin, "pnpm-workspace.yaml"), "packages:\n  - '.'\n");
  await writeFile(path.join(sdk, "package.json"), JSON.stringify({ name: "@paperclipai/plugin-sdk" }));
  await writeFile(path.join(sdk, "dist/index.js"), "export {};\n");
  // Execute the unchanged real linker in a synthetic owned layout. No SDK/compiler is executed.
  await writeFile(path.join(root, "scripts/link-plugin-dev-sdk.mjs"), await readFile(path.join(source, "scripts/link-plugin-dev-sdk.mjs")));
  const link = path.join(plugin, "node_modules/@paperclipai/plugin-sdk");
  const exec = vi.fn(async (_file: string, args: readonly string[]) => {
    // External install/build is intercepted. Only actual declared dependency directories
    // and declared output entrypoints are materialized; no implicit postinstall is assumed.
    if (args[0] === "install") for (const name of Object.keys(pkg.dependencies ?? {})) await mkdir(path.join(plugin, "node_modules", ...name.split("/")), { recursive: true });
    if (args[0] === "build") for (const relative of Object.values(pkg.paperclipPlugin) as string[]) {
      const file = path.resolve(plugin, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "export {};\n");
    }
    return { stdout: "", stderr: "" };
  });
  return { root, plugin, sdk, pkg, link, exec, deadline: Date.now() + 60_000 };
}
it("binds the actual dev SDK before the real standalone loader checks the package graph", async () => {
  const f = await fixture();
  await expect(ensureLocalPluginBuilt(f.plugin, f.pkg, { repoRoot: f.root, processEnv: {}, execFileAsyncImpl: f.exec })).rejects.toThrow(/runtime dependencies: @paperclipai\/plugin-sdk/);
  await prepareOwnedDaytonaSdk(f.root, f.deadline);
  expect(await realpath(f.link)).toBe(f.sdk);
  await expect(ensureLocalPluginBuilt(f.plugin, f.pkg, { repoRoot: f.root, processEnv: {}, execFileAsyncImpl: f.exec })).resolves.toBeUndefined();
  expect(f.exec.mock.calls.filter(call => call[1][0] === "install").every(call => call[1].includes("--ignore-scripts"))).toBe(true);
});
it("preserves an existing correctly owned SDK link", async () => {
  const f = await fixture(); await prepareOwnedDaytonaSdk(f.root, f.deadline); const before = await readlink(f.link);
  await prepareOwnedDaytonaSdk(f.root, f.deadline); expect(await readlink(f.link)).toBe(before);
});
it.each(["plugin", "sdk"])("rejects the wrong %s identity before linking", async owner => {
  const f = await fixture(); await writeFile(path.join(owner === "plugin" ? f.plugin : f.sdk, "package.json"), '{"name":"foreign"}');
  await expect(prepareOwnedDaytonaSdk(f.root, f.deadline)).rejects.toThrow(/identity/);
  await expect(readlink(f.link)).rejects.toThrow();
});
it.each([false, true])("does not replace an existing foreign or dangling link (dangling=%s)", async dangling => {
  const f = await fixture(), foreign = path.join(f.root, "foreign"); if (!dangling) await mkdir(foreign);
  await mkdir(path.dirname(f.link), { recursive: true }); await symlink(foreign, f.link);
  await expect(prepareOwnedDaytonaSdk(f.root, f.deadline)).rejects.toThrow(); expect(await readlink(f.link)).toBe(foreign);
});
it("rejects a bundled package redirected outside its exact owned path", async () => {
  const f = await fixture(), moved = path.join(f.root, "moved"); await mkdir(moved); await rm(f.plugin, { recursive: true }); await symlink(moved, f.plugin);
  await expect(prepareOwnedDaytonaSdk(f.root, f.deadline)).rejects.toThrow(/owned source/);
});
it.each(["node_modules", "node_modules/@paperclipai"])("rejects redirected SDK parent %s before creating a link", async parent => {
  const f = await fixture(), foreign = path.join(f.root, "foreign"); await mkdir(foreign);
  const redirected = path.join(f.plugin, parent); await mkdir(path.dirname(redirected), { recursive: true }); await symlink(foreign, redirected);
  await expect(prepareOwnedDaytonaSdk(f.root, f.deadline)).rejects.toThrow(/owned package/);
  await expect(readlink(f.link)).rejects.toThrow();
});
it("does not create a link when the prepared SDK entry is absent", async () => {
  const f = await fixture(); await rm(path.join(f.sdk, "dist/index.js"));
  await expect(prepareOwnedDaytonaSdk(f.root, f.deadline)).rejects.toThrow(); await expect(readlink(f.link)).rejects.toThrow();
});
it.each([Date.now() - 1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid original deadline %s before filesystem admission", async deadline => {
  await expect(prepareOwnedDaytonaSdk("/this-source-does-not-exist", deadline)).rejects.toThrow(/budget/);
});
