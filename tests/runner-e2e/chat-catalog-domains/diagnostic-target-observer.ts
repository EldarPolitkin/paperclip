import { readFile, readdir, readlink, writeFile, rename, lstat } from "node:fs/promises";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { lstatSync } from "node:fs";
export interface ProcessScalar { pid: number; parent: number; uid: number; ticks: string; born: string; namespace: string }
export interface PeerObservation { target: ProcessScalar; chain: ProcessScalar[]; finished: boolean; status: number | null; unknown: boolean }
export interface KernelPort { read(name: string): Promise<string>; list(name: string): Promise<string[]>; link(name: string): Promise<string>; now(): number }
export interface SocketScalar { localAddress?: string; remoteAddress?: string; localPort?: number; remotePort?: number }
const loopback = (s?: string) => s === "127.0.0.1" || s === "::1" || s === "::ffff:127.0.0.1";
export function healthRequest(method: unknown, url: unknown): boolean {
  try { return method === "GET" && typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && new URL(url, "http://127.0.0.1").pathname === "/api/health"; } catch { return false; }
}
export function processScalar(pid: number, stat: string, status: string, boot: string, hz: number, namespace: string): ProcessScalar {
  const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/), uid = /^Uid:\s+(\d+)/m.exec(status)?.[1];
  const btime = /^btime (\d+)$/m.exec(boot)?.[1], ticks = fields[19];
  if (!stat.startsWith(`${pid} (`) || !/^\d+$/.test(ticks ?? "") || !uid || !btime || !Number.isSafeInteger(hz) || hz <= 0 || !/^net:\[\d+\]$/.test(namespace)) throw new Error("unknown_process");
  return { pid, parent: Number(fields[1]), uid: Number(uid), ticks: ticks!, namespace,
    born: new Date(Number(BigInt(btime) * 1000n + BigInt(ticks!) * 1000n / BigInt(hz))).toISOString() };
}
function tcpAddress(raw: string): string | undefined {
  if (raw === "0100007F" || raw === "0000000000000000FFFF00000100007F") return "loopback4";
  if (raw === "00000000000000000000000001000000") return "loopback6";
}
export function peerInode(tables: string[], socket: SocketScalar): string | undefined {
  if (!loopback(socket.localAddress) || !loopback(socket.remoteAddress) || !socket.localPort || !socket.remotePort) return;
  const matches: string[] = [];
  for (const table of tables) for (const line of table.trim().split("\n").slice(1)) {
    const f = line.trim().split(/\s+/), local = f[1]?.split(":"), remote = f[2]?.split(":");
    if (f[3] === "01" && tcpAddress(local?.[0] ?? "") && tcpAddress(remote?.[0] ?? "")
      && Number.parseInt(local![1]!, 16) === socket.remotePort && Number.parseInt(remote![1]!, 16) === socket.localPort && /^\d+$/.test(f[9] ?? "")) matches.push(f[9]!);
  }
  return matches.length === 1 ? matches[0] : undefined;
}
export async function observeSocket(port: KernelPort, socket: SocketScalar, targetPid: number, hz: number): Promise<Pick<PeerObservation, "target" | "chain"> | undefined> {
  const deadline = port.now() + 100;
  let operations = 0;
  const limit = () => { if (++operations > 8192 || port.now() >= deadline) throw new Error("unknown_budget"); };
  const read = async (name: string) => { limit(); const s = await port.read(name); if (s.length > 262144) throw new Error("unknown_size"); return s; };
  let boot = "";
  const identity = async (pid: number) => { limit(); return processScalar(pid, await read(`/proc/${pid}/stat`), await read(`/proc/${pid}/status`), boot, hz, await port.link(`/proc/${pid}/ns/net`)); };
  try {
    boot = await read("/proc/stat");
    const target = await identity(targetPid), tables = [await read(`/proc/${targetPid}/net/tcp`), await read(`/proc/${targetPid}/net/tcp6`)];
    const inode = peerInode(tables, socket); if (!inode) return;
    const pids = (await port.list("/proc")).filter(s => /^[1-9]\d*$/.test(s)); if (pids.length > 4096) return;
    const owners: ProcessScalar[] = [];
    for (const raw of pids) {
      limit(); const pid = Number(raw);
      try {
        const p = await identity(pid); if (p.uid !== target.uid || p.namespace !== target.namespace) continue;
        limit(); const fds = await port.list(`/proc/${pid}/fd`); if (fds.length > 1024) return;
        for (const fd of fds) {
          if (!/^\d+$/.test(fd)) continue;
          limit(); if (await port.link(`/proc/${pid}/fd/${fd}`).catch(() => "") === `socket:[${inode}]`) {
            if (JSON.stringify(p) !== JSON.stringify(await identity(pid))) return;
            owners.push(p); break;
          }
        }
      } catch { if (port.now() >= deadline || operations > 8192) return; }
    }
    if (owners.length !== 1) return;
    const chain = [owners[0]!];
    while (chain.at(-1)!.parent > 1 && chain.length < 64) {
      const parent = await identity(chain.at(-1)!.parent);
      if (parent.uid !== target.uid || parent.namespace !== target.namespace) break;
      if (chain.some(p => p.pid === parent.pid)) return;
      chain.push(parent);
    }
    if (chain.length === 64) return;
    const again = peerInode([await read(`/proc/${targetPid}/net/tcp`), await read(`/proc/${targetPid}/net/tcp6`)], socket);
    if (again !== inode || JSON.stringify(target) !== JSON.stringify(await identity(targetPid))) return;
    for (const p of chain) if (JSON.stringify(p) !== JSON.stringify(await identity(p.pid))) return;
    return { target, chain };
  } catch { return; }
}
export interface NativeCallerBinding { runnerPid: number; runnerBorn: string; providerPid: number; providerBorn: string; currentRunBound: boolean }
export function nativeHealthResponse(o: PeerObservation, b: NativeCallerBinding, target: { pid: number; born: string }): boolean {
  const runner = o.chain.findIndex(p => p.pid === b.runnerPid && p.born === b.runnerBorn), provider = o.chain.findIndex(p => p.pid === b.providerPid && p.born === b.providerBorn);
  return b.currentRunBound && o.finished && o.status === 503 && !o.unknown && o.target.pid === target.pid && o.target.born === target.born
    && runner > provider && provider >= 0 && b.runnerPid !== target.pid && b.providerPid !== target.pid
    && o.chain.every(p => p.namespace === o.target.namespace && p.uid === o.target.uid)
    && o.chain.every((p, i) => i === o.chain.length - 1 || p.parent === o.chain[i + 1]!.pid);
}
interface ChannelMessage { request: IncomingMessage; response: ServerResponse; socket: Socket }
export function attachTargetObserver(input: { pid: number; hz: number; version: string; kernel: KernelPort; armed(): boolean;
  on(name: string, cb: (m: unknown) => void): void; off(name: string, cb: (m: unknown) => void): void; save(rows: PeerObservation[]): Promise<void> }) {
  const entries = new WeakMap<IncomingMessage, { response: ServerResponse; socket: Socket; proof: Promise<Pick<PeerObservation, "target" | "chain"> | undefined> }>();
  const rows: PeerObservation[] = []; let count = 0, closed = false; let writing = Promise.resolve();
  if (!/^v24\./.test(input.version)) return async () => {};
  const start = (raw: unknown) => {
    try {
      const m = raw as ChannelMessage;
      if (closed || !input.armed() || count >= 16 || !healthRequest(m.request.method, m.request.url)) return;
      count++;
      const s: SocketScalar = { localAddress: m.socket.localAddress, remoteAddress: m.socket.remoteAddress, localPort: m.socket.localPort, remotePort: m.socket.remotePort };
      entries.set(m.request, { response: m.response, socket: m.socket, proof: observeSocket(input.kernel, s, input.pid, input.hz).catch(() => undefined) });
    } catch { }
  };
  const finish = (raw: unknown) => {
    try {
      const m = raw as ChannelMessage;
      const e = entries.get(m.request); if (!e || e.response !== m.response || e.socket !== m.socket || closed) return;
      entries.delete(m.request);
      const status = Number.isInteger(m.response.statusCode) && m.response.statusCode >= 100 && m.response.statusCode <= 599 ? m.response.statusCode : null;
      writing = writing.then(async () => { const proof = await e.proof; if (proof) { rows.push({ ...proof, status, finished: true, unknown: false }); await input.save(rows.slice()); } }).catch(() => undefined);
    } catch { }
  };
  try { input.on("http.server.request.start", start); input.on("http.server.response.finish", finish); } catch {
    try { input.off("http.server.request.start", start); input.off("http.server.response.finish", finish); } catch { }
    return async () => {};
  }
  return async () => { closed = true; try { input.off("http.server.request.start", start); input.off("http.server.response.finish", finish); } catch { } await writing; };
}
export async function installTargetObserver(configPath: string) {
  const meta = await lstat(configPath); if (!meta.isFile() || meta.isSymbolicLink() || meta.uid !== process.getuid?.() || (meta.mode & 0o077)) throw new Error("Unowned target observer config");
  const c = JSON.parse(await readFile(configPath, "utf8")) as { output: string; armed: string; hz: number };
  if (!path.isAbsolute(c.output) || path.dirname(c.output) !== path.dirname(configPath) || path.dirname(c.armed) !== path.dirname(configPath) || c.output === c.armed) throw new Error("Observer output escapes owned fixture");
  const root = await lstat(path.dirname(configPath)); if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.() || (root.mode & 0o077)) throw new Error("Unowned observer root");
  const kernel: KernelPort = { read: p => readFile(p, "utf8"), list: p => readdir(p), link: p => readlink(p), now: () => performance.now() };
  return attachTargetObserver({ pid: process.pid, version: process.version, hz: c.hz, kernel, armed: () => { const m = lstatSync(c.armed, { throwIfNoEntry: false }); return !!m?.isFile() && !m.isSymbolicLink() && m.uid === process.getuid?.() && !(m.mode & 0o077); }, on: subscribe, off: unsubscribe,
    save: async rows => { const temp = `${c.output}.tmp`; await writeFile(temp, JSON.stringify(rows), { mode: 0o600 }); await rename(temp, c.output); } });
}
