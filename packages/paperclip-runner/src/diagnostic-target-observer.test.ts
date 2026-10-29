import { describe, expect, it } from "vitest";
import { attachTargetObserver, healthRequest, observeSocket, peerInode, nativeHealthResponse, type KernelPort, type PeerObservation } from "../scripts/diagnostic-observer/diagnostic-target-observer.js";
function kernel() {
  const data = new Map<string, string>(), dirs = new Map<string, string[]>(), links = new Map<string, string>(); let now = 0;
  data.set("/proc/stat", "btime 1000000000\n"); dirs.set("/proc", ["90", "200", "205", "210", "220"]);
  for (const [pid, parent] of [[90, 1], [200, 1], [205, 200], [210, 205], [220, 210]]) {
    const fields = Array(20).fill("0"); fields[0] = "S"; fields[1] = String(parent); fields[19] = String(pid * 100);
    data.set(`/proc/${pid}/stat`, `${pid} (synthetic worker) ${fields.join(" ")}`); data.set(`/proc/${pid}/status`, "Uid:\t501\t501\t501\t501\n");
    links.set(`/proc/${pid}/ns/net`, "net:[123]"); dirs.set(`/proc/${pid}/fd`, pid === 220 ? ["4"] : []);
  }
  const table = "sl local_address rem_address st tx rx tr tm retr uid timeout inode\n0: 0100007F:9C40 0100007F:7979 01 0:0 0:0 0 501 0 555";
  data.set("/proc/90/net/tcp", table); data.set("/proc/90/net/tcp6", "sl local_address rem_address st\n"); links.set("/proc/220/fd/4", "socket:[555]");
  const reads: string[] = [];
  const port: KernelPort = { now: () => now, read: async p => { reads.push(p); if (!data.has(p)) throw Error("missing"); return data.get(p)!; }, list: async p => { if (!dirs.has(p)) throw Error("missing"); return dirs.get(p)!; }, link: async p => { if (!links.has(p)) throw Error("missing"); return links.get(p)!; } };
  return { port, data, dirs, links, reads, expire: () => { now = 1000; } };
}
const socket = { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1", localPort: 31097, remotePort: 40000 };
const born = (pid: number) => new Date((1000000000 + pid) * 1000).toISOString();
const binding = { runnerPid: 200, runnerBorn: born(200), providerPid: 205, providerBorn: born(205), currentRunBound: true };
async function proof() { const k = kernel(); const p = await observeSocket(k.port, socket, 90, 100); expect(p).toBeDefined(); return { k, p: { ...p!, finished: true, status: 503, unknown: false } }; }
describe("target-only diagnostic observer", () => {
  it("binds a genuine socket ancestry to current native ownership and actual response", async () => {
    const { k, p } = await proof(); expect(nativeHealthResponse(p, binding, { pid: 90, born: born(90) })).toBe(true);
    expect(k.reads.every(p => !/cmdline|environ|stack|mem|log/.test(p))).toBe(true);
    for (const change of [{ currentRunBound: false }, { providerPid: 210, providerBorn: born(205) }, { runnerBorn: born(201) }]) expect(nativeHealthResponse(p, { ...binding, ...change }, { pid: 90, born: born(90) })).toBe(false);
  });
  it.each([{ method: "GET", url: "/api/health?token=never-persist" }, { method: "GET", url: "/api/health" }])("recognizes health pathname while discarding query", v => { expect(healthRequest(v.method, v.url)).toBe(true); });
  it.each([["POST", "/api/health"], ["GET", "/api/healthz"], ["GET", "//foreign/api/health"], ["GET", "/api/health/other"]])("does not admit unsupported request %s %s", (m, u) => expect(healthRequest(m, u)).toBe(false));
  it("rejects fixture/operator and other provider callers despite identical target/time/status", async () => {
    const { p } = await proof(); expect(nativeHealthResponse({ ...p, chain: p.chain.filter(r => r.pid !== 205) }, binding, { pid: 90, born: born(90) })).toBe(false);
    expect(nativeHealthResponse(p, { ...binding, runnerPid: 90, runnerBorn: born(90) }, { pid: 90, born: born(90) })).toBe(false);
    expect(nativeHealthResponse({ ...p, finished: false }, binding, { pid: 90, born: born(90) })).toBe(false);
    expect(nativeHealthResponse({ ...p, status: 200 }, binding, { pid: 90, born: born(90) })).toBe(false);
  });
  it("treats reused PID generation during resolution as unknown", async () => {
    const k = kernel(), read = k.port.read; let n = 0;
    k.port.read = async p => { const result = await read(p); return p === "/proc/220/stat" && ++n > 1 ? result.replace(/22000$/, "99999") : result; };
    expect(await observeSocket(k.port, socket, 90, 100)).toBeUndefined();
  });
  it.each(["namespace", "multiple-owner", "duplicate-tuple", "missing", "expired"])("fails unknown for %s without escalation", async kind => {
    const k = kernel();
    if (kind === "namespace") k.links.set("/proc/220/ns/net", "net:[456]");
    if (kind === "multiple-owner") { k.dirs.set("/proc/210/fd", ["7"]); k.links.set("/proc/210/fd/7", "socket:[555]"); }
    if (kind === "duplicate-tuple") k.data.set("/proc/90/net/tcp", k.data.get("/proc/90/net/tcp")! + "\n0: 0100007F:9C40 0100007F:7979 01 0:0 0:0 0 501 0 556");
    if (kind === "missing") k.data.delete("/proc/90/net/tcp");
    if (kind === "expired") { let n = 0; k.port.now = () => ++n * 100; }
    expect(await observeSocket(k.port, socket, 90, 100)).toBeUndefined();
  });
  it("uses actual matched channel messages and never reads headers/bodies/query into evidence", async () => {
    const k = kernel(), callbacks = new Map<string, (m: any) => void>(), saved: PeerObservation[][] = []; let armed = false;
    const close = attachTargetObserver({ pid: 90, hz: 100, version: "v24.10.0", kernel: k.port, armed: () => armed, on: (n, c) => callbacks.set(n, c), off: n => { callbacks.delete(n); }, save: async rows => { saved.push(rows); } });
    const request = { method: "GET", url: "/api/health?secret=PRIVATE", get headers() { throw Error("forbidden"); }, get body() { throw Error("forbidden"); } };
    const response = { statusCode: 503, get body() { throw Error("forbidden"); } }, m = { request, response, socket };
    for (let i = 0; i < 32; i++) callbacks.get("http.server.request.start")!(m as any);
    armed = true;
    callbacks.get("http.server.request.start")!(m as any); callbacks.get("http.server.response.finish")!({ ...m, request: {} } as any); expect(saved).toEqual([]);
    callbacks.get("http.server.response.finish")!(m as any); await close(); expect(saved.at(-1)).toHaveLength(1);
    expect(nativeHealthResponse(saved.at(-1)![0]!, binding, { pid: 90, born: born(90) })).toBe(true); expect(JSON.stringify(saved)).not.toMatch(/PRIVATE|secret|headers|body|api\/health/);
  });
  it("does not make request-only, unsupported channel/runtime, or observer errors into app exceptions", async () => {
    const k = kernel(), callbacks = new Map<string, (m: any) => void>(), saved: unknown[] = [];
    const close = attachTargetObserver({ pid: 90, hz: 100, version: "v24.1.0", kernel: k.port, armed: () => true, on: (n, c) => callbacks.set(n, c), off: n => { callbacks.delete(n); }, save: async r => { saved.push(r); } });
    callbacks.get("http.server.request.start")!({ request: { method: "GET", url: "/api/health" }, response: {}, socket } as any); await close(); expect(saved).toEqual([]);
    await attachTargetObserver({ pid: 90, hz: 100, version: "v20.1.0", kernel: k.port, armed: () => true, on: () => { throw Error("no channel"); }, off: () => {}, save: async () => {} })();
    expect(() => attachTargetObserver({ pid: 90, hz: 100, version: "v24.1.0", kernel: k.port, armed: () => true, on: () => { throw Error("no channel"); }, off: () => {}, save: async () => {} })).not.toThrow();
  });
});

it("requires the full reverse tuple including normalized loopback address families", () => {
  const header = "sl local_address rem_address st\n", row = "0: 00000000000000000000000001000000:9C40 00000000000000000000000001000000:7979 01 0:0 0:0 0 501 0 555";
  expect(peerInode([header + row], socket)).toBeUndefined();
  expect(peerInode([header + row], { ...socket, localAddress: "::1", remoteAddress: "::1" })).toBe("555");
  const mapped = row.replaceAll("00000000000000000000000001000000", "0000000000000000FFFF00000100007F");
  expect(peerInode([header + mapped], { ...socket, localAddress: "::ffff:127.0.0.1", remoteAddress: "::ffff:127.0.0.1" })).toBe("555");
  expect(peerInode([header + mapped], socket)).toBe("555");
  expect(peerInode([header + mapped], { ...socket, remotePort: 40001 })).toBeUndefined();
});
