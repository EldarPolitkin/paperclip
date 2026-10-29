import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CursorCloudClient } from "./cloud-client.js";
import { createHash, randomUUID } from "node:crypto";

export async function stageCursorCloudArtifact(input: {
  arguments: unknown;
  agentId: string;
  runtimeDirectory: string;
  artifactRoot: string;
  client: Pick<CursorCloudClient, "listArtifacts" | "downloadArtifact">;
  signal: AbortSignal;
}): Promise<Record<string, unknown>> {
  if (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments)) throw new Error("Cursor Cloud deliverable input must be an object");
  const args = input.arguments as Record<string, unknown>;
  if (typeof args.contentRef !== "string" || !args.contentRef.startsWith("cursor-artifact:")) throw new Error("Cursor Cloud deliverables require contentRef cursor-artifact:<listed artifact path>");
  const path = args.contentRef.slice("cursor-artifact:".length);
  if (!path || path.startsWith("/") || /[\\\0\r\n]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Cursor Cloud artifact path must be a listed relative path");
  if (!Number.isSafeInteger(args.byteSize) || Number(args.byteSize) < 0 || Number(args.byteSize) > 16_777_216 || typeof args.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(args.sha256)) throw new Error("Cursor Cloud deliverables require exact byteSize and lowercase SHA-256");
  if (typeof args.filename !== "string" || !args.filename || args.filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(args.filename) || [".", ".."].includes(args.filename)) throw new Error("Cursor Cloud deliverable filename must be a single safe filename");
  if (!isAbsolute(input.artifactRoot) || resolve(input.artifactRoot) !== resolve(input.runtimeDirectory, "artifacts")) throw new Error("Cursor Cloud artifact root is outside its admitted session directory");
  const listed = await input.client.listArtifacts(input.agentId, { signal: input.signal });
  const artifact = listed.items.find(file => file.path === path);
  if (!artifact || artifact.sizeBytes !== args.byteSize) throw new Error("Cursor Cloud artifact is absent or its reported byte size does not match the claim");
  const bytes = await input.client.downloadArtifact(input.agentId, path, { signal: input.signal, maxBytes: Math.max(1, Number(args.byteSize)) });
  if (bytes.length !== args.byteSize || createHash("sha256").update(bytes).digest("hex") !== args.sha256) throw new Error("Cursor Cloud artifact bytes do not match the claimed size/SHA-256");
  input.signal.throwIfAborted();
  const directory = join(input.artifactRoot, args.sha256);
  for (const root of [input.artifactRoot, directory]) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Cursor Cloud artifact staging directory must be owned and private");
  }
  const contentRef = join(args.sha256, args.filename);
  const target = join(directory, args.filename);
  const temporary = join(directory, `.cursor-cloud-${randomUUID()}.tmp`);
  input.signal.throwIfAborted();
  const handle = await open(temporary, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const held = await handle.stat();
    try {
      await handle.writeFile(bytes); await handle.sync();
      const current = await lstat(temporary);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== held.dev || current.ino !== held.ino || current.size !== bytes.length
        || (current.mode & 0o077) !== 0 || (process.getuid && current.uid !== process.getuid())) throw new Error("Cursor Cloud artifact temporary ownership changed");
      input.signal.throwIfAborted();
      // A hard link publishes complete bytes without overwriting a concurrent final.
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const stat = await existing.stat();
          if (!stat.isFile() || stat.size !== bytes.length || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())
            || createHash("sha256").update(await existing.readFile()).digest("hex") !== args.sha256) throw new Error("Cursor Cloud artifact staging identity conflict");
        } finally { await existing.close(); }
      }
    } finally {
      const current = await lstat(temporary);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== held.dev || current.ino !== held.ino) throw new Error("Cursor Cloud artifact temporary ownership changed");
      await unlink(temporary);
    }
  } finally { await handle.close(); }
  // EEXIST retries also finish durability after a prior post-publication failure.
  for (const root of [directory, input.artifactRoot, input.runtimeDirectory]) {
    const handle = await open(root, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { await handle.sync(); } finally { await handle.close(); }
  }
  return { ...args, contentRef };
}
