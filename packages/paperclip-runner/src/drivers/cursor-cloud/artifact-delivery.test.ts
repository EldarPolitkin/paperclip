import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stageCursorCloudArtifact } from "./artifact-delivery.js";

vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const root = await mkdtemp("/tmp/cc-artifact-"); roots.push(root);
  const bytes = Buffer.from("downloaded provider result\n"); const sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = { listArtifacts: vi.fn(async () => ({ items: [{ path: "artifacts/result.txt", sizeBytes: bytes.length, updatedAt: "2026-10-28" }] })), downloadArtifact: vi.fn(async () => bytes) };
  const args = { contentRef: "cursor-artifact:artifacts/result.txt", filename: "result.txt", byteSize: bytes.length, sha256, contentType: "text/plain" };
  const controller = new AbortController(); const artifactRoot = join(root, "artifacts"); const directory = join(artifactRoot, sha256);
  const input = { arguments: args, agentId: "agent", runtimeDirectory: root, artifactRoot, client, signal: controller.signal };
  return { root, bytes, args, input, controller, directory, target: join(directory, args.filename), normalized: { ...args, contentRef: join(sha256, args.filename) } };
}

describe("Cursor Cloud artifact registration boundary", () => {
  it("never exposes a partial final file and allows retry after a failed write", async () => {
    const f = await fixture();
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const partial = deferred(); const resume = deferred(); let injected = false;
    vi.mocked(open).mockImplementation((async (path, flags, mode) => {
      const handle = await original.open(path, flags, mode);
      if (!injected && String(path).startsWith(`${f.directory}/`) && (flags === "wx" || (typeof flags === "number" && (flags & constants.O_EXCL) !== 0))) {
        injected = true;
        vi.spyOn(handle, "writeFile").mockImplementation(async () => {
          await handle.write(f.bytes.subarray(0, 4), 0, 4, 0);
          partial.resolve(); await resume.promise; throw new Error("fixture partial artifact write failed");
        });
      }
      return handle;
    }) as typeof open);
    const staging = stageCursorCloudArtifact(f.input);
    try {
      await partial.promise;
      const visible = await readFile(f.target).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      resume.resolve();
      await expect(staging).rejects.toThrow("fixture partial artifact write failed");
      expect(visible).toBeNull();
      await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(f.directory)).toEqual([]);
      expect(await stageCursorCloudArtifact(f.input)).toEqual(f.normalized);
      expect(await readFile(f.target)).toEqual(f.bytes);
    } finally { resume.resolve(); await staging.catch(() => {}); }
  });

  it("does not publish an artifact cancelled while its private write is pending", async () => {
    const f = await fixture();
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const written = deferred(); const resume = deferred(); let injected = false;
    vi.mocked(open).mockImplementation((async (path, flags, mode) => {
      const handle = await original.open(path, flags, mode);
      if (!injected && String(path).startsWith(`${f.directory}/`) && (flags === "wx" || (typeof flags === "number" && (flags & constants.O_EXCL) !== 0))) {
        injected = true; const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementation(async (...args) => { await write(...args); written.resolve(); await resume.promise; });
      }
      return handle;
    }) as typeof open);
    const staging = stageCursorCloudArtifact(f.input);
    try {
      await written.promise; f.controller.abort(new Error("fixture artifact cancellation")); resume.resolve();
      await expect(staging).rejects.toThrow("fixture artifact cancellation");
      await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(f.directory)).toEqual([]);
    } finally { resume.resolve(); await staging.catch(() => {}); }
  });

  it("keeps the final absent through an actual writer crash and retries without reaping the orphan", async () => {
    const f = await fixture();
    const script = join(f.root, "crash-writer.mjs");
    await writeFile(script, `
      import fs from "node:fs/promises";
      import { constants } from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const original = fs.open;
      fs.open = async (...args) => {
        const handle = await original(...args);
        const flags = args[1];
        if (String(args[0]).startsWith(${JSON.stringify(`${f.directory}/`)}) && (flags === "wx" || (typeof flags === "number" && (flags & constants.O_EXCL) !== 0))) {
          handle.writeFile = async bytes => {
            await handle.write(bytes.subarray(0, 4), 0, 4, 0); await handle.sync();
            process.send("partial-written");
            await new Promise(resolve => process.once("message", resolve));
          };
        }
        return handle;
      };
      syncBuiltinESMExports();
      const { stageCursorCloudArtifact } = await import(${JSON.stringify(new URL("./artifact-delivery.ts", import.meta.url).href)});
      const bytes = Buffer.from(${JSON.stringify(f.bytes.toString("base64"))}, "base64");
      await stageCursorCloudArtifact({ arguments: ${JSON.stringify(f.args)}, agentId: "agent", runtimeDirectory: ${JSON.stringify(f.root)}, artifactRoot: ${JSON.stringify(f.input.artifactRoot)},
        client: { listArtifacts: async () => ({ items: [{ path: "artifacts/result.txt", sizeBytes: bytes.length }] }), downloadArtifact: async () => bytes }, signal: new AbortController().signal });
      process.send("unexpected-completed");
    `, { mode: 0o600 });
    const child = spawn(process.execPath, [script], { env: {}, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = ""; child.stderr?.on("data", bytes => { stderr = (stderr + bytes).slice(-4_096); });
    const exited = once(child, "exit");
    try {
      const message = await Promise.race([once(child, "message"), exited.then(() => { throw new Error(`artifact crash fixture exited early: ${stderr}`); })]);
      expect(message[0]).toBe("partial-written");
      await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" });
      child.kill("SIGKILL"); expect(await exited).toEqual([null, "SIGKILL"]);
      const orphans = await readdir(f.directory);
      expect(orphans).toHaveLength(1);
      const orphan = join(f.directory, orphans[0]!);
      expect(await readFile(orphan)).toEqual(f.bytes.subarray(0, 4));
      expect(await stageCursorCloudArtifact(f.input)).toEqual(f.normalized);
      expect(await readFile(f.target)).toEqual(f.bytes);
      expect(await readFile(orphan)).toEqual(f.bytes.subarray(0, 4));
      expect((await readdir(f.directory)).sort()).toEqual([...orphans, f.args.filename].sort());
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  });

  it("concurrently stages identical bytes without replacing the first verified final", async () => {
    const f = await fixture();
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const written = deferred(); const resume = deferred(); let held = false;
    vi.mocked(open).mockImplementation((async (path, flags, mode) => {
      const handle = await original.open(path, flags, mode);
      if (!held && String(path).startsWith(`${f.directory}/`) && (flags === "wx" || (typeof flags === "number" && (flags & constants.O_EXCL) !== 0))) {
        held = true; const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementation(async (...args) => { await write(...args); written.resolve(); await resume.promise; });
      }
      return handle;
    }) as typeof open);
    const first = stageCursorCloudArtifact(f.input);
    try {
      await written.promise;
      expect(await stageCursorCloudArtifact(f.input)).toEqual(f.normalized);
      const published = await lstat(f.target);
      resume.resolve(); expect(await first).toEqual(f.normalized);
      const retained = await lstat(f.target);
      expect([retained.dev, retained.ino]).toEqual([published.dev, published.ino]);
      expect(await readFile(f.target)).toEqual(f.bytes);
      expect(await readdir(f.directory)).toEqual([f.args.filename]);
    } finally { resume.resolve(); await first.catch(() => {}); }
  });

  it("requires directory sync again when retry verifies an already-published final", async () => {
    const f = await fixture();
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const synced: string[] = []; let failures = 2;
    vi.mocked(open).mockImplementation((async (path, flags, mode) => {
      const handle = await original.open(path, flags, mode);
      if ([f.directory, f.input.artifactRoot, f.root].includes(String(path))) {
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          synced.push(String(path));
          if (String(path) === f.directory && failures-- > 0) throw new Error("fixture artifact directory sync failed");
          await sync();
        });
      }
      return handle;
    }) as typeof open);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(stageCursorCloudArtifact(f.input)).rejects.toThrow("fixture artifact directory sync failed");
      expect(await readFile(f.target)).toEqual(f.bytes);
      expect(await readdir(f.directory)).toEqual([f.args.filename]);
    }
    expect(await stageCursorCloudArtifact(f.input)).toEqual(f.normalized);
    expect(synced).toEqual([f.directory, f.directory, f.directory, f.input.artifactRoot, f.root]);
  });

  it.each(["partial", "wrong-hash", "public-mode", "symlink", "directory"])("refuses an existing %s final unchanged", async mode => {
    const f = await fixture(); await mkdir(f.directory, { recursive: true, mode: 0o700 });
    const bytes = mode === "partial" ? f.bytes.subarray(0, 4) : mode === "wrong-hash" ? Buffer.alloc(f.bytes.length, "x") : f.bytes;
    if (mode === "directory") await mkdir(f.target, { mode: 0o700 });
    else if (mode === "symlink") {
      const target = join(f.root, "unrelated-result");
      await writeFile(target, bytes, { mode: 0o600 }); await symlink(target, f.target);
    } else await writeFile(f.target, bytes, { mode: mode === "public-mode" ? 0o644 : 0o600 });
    const before = await lstat(f.target);
    await expect(stageCursorCloudArtifact(f.input)).rejects.toThrow();
    const after = await lstat(f.target);
    expect([after.dev, after.ino, after.mode]).toEqual([before.dev, before.ino, before.mode]);
    if (mode !== "directory") expect(await readFile(f.target)).toEqual(bytes);
    expect(await readdir(f.directory)).toEqual([f.args.filename]);
  });

  it.each(["replace", "symlink"])("retains a foreign %s temporary file without publishing or deleting it", async mode => {
    const f = await fixture();
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let temporary = "";
    vi.mocked(open).mockImplementation((async (path, flags, fileMode) => {
      const handle = await original.open(path, flags, fileMode);
      if (String(path).startsWith(`${f.directory}/`) && typeof flags === "number" && (flags & constants.O_EXCL) !== 0) {
        temporary = String(path); const sync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          await sync(); await rename(temporary, join(f.root, "retained-own-temporary"));
          if (mode === "replace") await writeFile(temporary, "foreign temporary", { mode: 0o600 });
          else {
            const target = join(f.root, "foreign-temporary");
            await writeFile(target, "foreign temporary", { mode: 0o600 }); await symlink(target, temporary);
          }
        });
      }
      return handle;
    }) as typeof open);
    await expect(stageCursorCloudArtifact(f.input)).rejects.toThrow("temporary ownership changed");
    expect(await readFile(temporary, "utf8")).toBe("foreign temporary");
    expect(await readFile(join(f.root, "retained-own-temporary"))).toEqual(f.bytes);
    await expect(lstat(f.target)).rejects.toMatchObject({ code: "ENOENT" });
    if (mode === "symlink") expect((await lstat(temporary)).isSymbolicLink()).toBe(true);
  });

  it.each(["fresh", "existing"])("stages %s verified bytes with a contentRef relative to the artifact root", async state => {
    const root = await mkdtemp("/tmp/cc-artifact-"); roots.push(root);
    const bytes = Buffer.from("downloaded provider result\n"); const sha256 = createHash("sha256").update(bytes).digest("hex");
    const client = { listArtifacts: vi.fn(async () => ({ items: [{ path: "artifacts/result.txt", sizeBytes: bytes.length, updatedAt: "2026-10-28" }] })), downloadArtifact: vi.fn(async () => bytes) };
    const args = { contentRef: "cursor-artifact:artifacts/result.txt", filename: "result.txt", byteSize: bytes.length, sha256, contentType: "text/plain" };
    const artifactRoot = join(root, "artifacts");
    const input = { arguments: args, agentId: "agent", runtimeDirectory: root, artifactRoot, client, signal: new AbortController().signal };
    if (state === "existing") await stageCursorCloudArtifact(input);
    const normalized = await stageCursorCloudArtifact(input);
    expect(normalized).toEqual({ ...args, contentRef: join(sha256, "result.txt") });
    expect(await readFile(join(artifactRoot, normalized.contentRef as string))).toEqual(bytes);
    await expect(stageCursorCloudArtifact({ arguments: { ...args, sha256: "a".repeat(64) }, agentId: "agent", runtimeDirectory: root, artifactRoot: join(root, "artifacts"), client, signal: new AbortController().signal })).rejects.toThrow("do not match");
  });
  it("rejects host paths, traversal, unlisted paths, size mismatches and an unadmitted root", async () => {
    const root = await mkdtemp("/tmp/cc-artifact-"); roots.push(root);
    const client = { listArtifacts: vi.fn(async () => ({ items: [] })), downloadArtifact: vi.fn(async () => Buffer.from("not read")) };
    const input = { agentId: "agent", runtimeDirectory: root, artifactRoot: join(root, "artifacts"), client, signal: new AbortController().signal };
    for (const contentRef of ["/etc/passwd", "cursor-artifact:../outside", "cursor-artifact:artifacts/missing"]) {
      await expect(stageCursorCloudArtifact({ ...input, arguments: { contentRef, filename: "file", byteSize: 1, sha256: "a".repeat(64) } })).rejects.toThrow();
    }
    await expect(stageCursorCloudArtifact({ ...input, artifactRoot: root, arguments: { contentRef: "cursor-artifact:artifacts/file", filename: "file", byteSize: 1, sha256: "a".repeat(64) } })).rejects.toThrow("outside");
    expect(client.downloadArtifact).not.toHaveBeenCalled();
  });
});
