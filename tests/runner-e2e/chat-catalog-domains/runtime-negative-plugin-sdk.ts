import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Prepare the excluded package's existing dev SDK link, not a cloud lease. */
export async function prepareOwnedDaytonaSdk(repositoryRoot: string, deadlineAt: number) {
  const budget = () => {
    if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) throw new Error("Original negative-runtime phase budget exhausted");
  };
  budget();
  const root = await realpath(repositoryRoot);
  const pluginRoot = path.join(root, "packages/plugins/sandbox-providers/daytona");
  const sdkRoot = path.join(root, "packages/plugins/sdk");
  for (const [directory, name] of [[pluginRoot, "@paperclipai/plugin-daytona"], [sdkRoot, "@paperclipai/plugin-sdk"]] as const) {
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) throw new Error("Negative-runtime package escapes its owned source");
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (manifest.name !== name) throw new Error("Negative-runtime package identity differs");
  }
  const entry = path.join(sdkRoot, "dist/index.js");
  if (!(await lstat(entry)).isFile() || await realpath(entry) !== entry) throw new Error("Prepared source SDK entry is unavailable");
  for (const directory of [path.join(pluginRoot, "node_modules"), path.join(pluginRoot, "node_modules/@paperclipai")]) {
    try {
      if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) throw new Error("Negative-runtime SDK parent escapes its owned package");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const link = path.join(pluginRoot, "node_modules/@paperclipai/plugin-sdk");
  let exists = false;
  try { await lstat(link); exists = true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists && await realpath(link) !== sdkRoot) throw new Error("Existing negative-runtime SDK belongs to another source");
  const linker = path.join(root, "scripts/link-plugin-dev-sdk.mjs");
  if (!(await lstat(linker)).isFile() || await realpath(linker) !== linker) throw new Error("Owned excluded-plugin linker is unavailable");
  budget();
  const { linkSdkInto } = await import(pathToFileURL(linker).href) as { linkSdkInto(packageDir: string): boolean };
  budget();
  linkSdkInto(pluginRoot);
  if (await realpath(link) !== sdkRoot) throw new Error("Negative-runtime SDK link did not bind the prepared source");
  budget();
}
