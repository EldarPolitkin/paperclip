import path from "node:path";
import type { GitWorkspaceSnapshot } from "./git-workspace-sync.js";

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

const refreshScript = String.raw`
const fs = require('node:fs/promises'), path = require('node:path');
const { randomUUID } = require('node:crypto'), { spawn } = require('node:child_process');
const deadline = performance.now() + Number(process.argv[2]);
const same = (a, b) => a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const stat = file => fs.lstat(file, { bigint: true }).catch(() => null);
async function refresh(directory) {
  const git = path.join(directory, '.git'), index = path.join(git, 'index');
  const gitStat = await stat(git), original = await stat(index);
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink() || !original?.isFile() || original.isSymbolicLink() || await stat(index + '.lock')) return;
  const temporary = path.join(git, '.paperclip-index-' + randomUUID());
  let publication, publicationIdentity;
  try {
    await fs.copyFile(index, temporary);
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0 || !same(original, await stat(index) ?? {})) return;
    const child = spawn('git', ['-C', directory, '-c', 'core.fsmonitor=false', 'update-index', '--refresh'], {
      env: { ...process.env, GIT_INDEX_FILE: temporary }, detached: true, stdio: 'ignore',
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, remaining);
    const code = await new Promise(resolve => { child.once('error', () => resolve(null)); child.once('exit', resolve); });
    clearTimeout(timer);
    if (timedOut || code !== 0 && code !== 1 || performance.now() >= deadline) return;
    publication = await fs.open(index + '.lock', 'wx', Number(original.mode & 0o777n));
    publicationIdentity = await publication.stat({ bigint: true });
    if (!same(original, await stat(index) ?? {})) return;
    await publication.writeFile(await fs.readFile(temporary));
    await publication.close(); publication = undefined;
    if (performance.now() >= deadline) return;
    await fs.rename(index + '.lock', index); publicationIdentity = undefined;
  } finally {
    await publication?.close().catch(() => {});
    if (publicationIdentity) {
      const current = await stat(index + '.lock');
      if (current?.ino === publicationIdentity.ino && current?.dev === publicationIdentity.dev) await fs.rm(index + '.lock', { force: true });
    }
    await fs.rm(temporary, { force: true });
    await fs.rm(temporary + '.lock', { force: true });
  }
}
(async () => { for (const directory of JSON.parse(process.argv[1])) {
  if (performance.now() >= deadline) break;
  try { await refresh(directory); } catch {}
} })().catch(() => {});
`;

export function workspaceGitIndexRefreshCommand(input: {
  workspaceRemoteDir: string;
  git: GitWorkspaceSnapshot | null;
  repositories: NonNullable<GitWorkspaceSnapshot["repositories"]>;
  timeoutMs: number;
}): string | null {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 5_000) return null;
  const directories = new Set<string>();
  const visit = (relative: string, snapshot: GitWorkspaceSnapshot) => {
    directories.add(path.posix.join(input.workspaceRemoteDir, relative));
    for (const repository of snapshot.repositories ?? []) child(relative, repository);
  };
  const child = (relative: string, repository: (typeof input.repositories)[number]) => {
    if (path.posix.isAbsolute(repository.path) || repository.path.split("/").includes("..")) throw new Error("workspace_seed_git_path_invalid");
    visit(path.posix.join(relative, repository.path), repository.snapshot);
  };
  if (input.git) visit("", input.git);
  else for (const repository of input.repositories) child("", repository);
  if (!directories.size) return null;
  return `NODE_OPTIONS= node --input-type=commonjs -e ${shellQuote(refreshScript)} ${shellQuote(JSON.stringify([...directories]))} 2000 || true`;
}
