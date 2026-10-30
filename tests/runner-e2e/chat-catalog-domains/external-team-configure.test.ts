import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { runnerMatrix } from "../catalog.js";
import { teamConfigureExternalCases } from "./external-team-configure.js";
function valid() {
  return { scenarioId: "teams.configure-team", origin: "http://fixture.invalid", companyId: "company", leadId: "ceo", connections: [], profiles: [], secrets: [], endpoints: [], interactions: [], tasks: [], projects: [], goals: [], comments: [], documents: [], revisions: [], humanQueries: [], links: [],
    reply: "QA has been configured and each team member is ready.", phaseReplies: [{ runId: "initial", body: "QA needs the eligible account; open QA configuration." }, { runId: "verified", body: "QA and the senior coder are now configured and ready." }], runs: [{ id: "initial", status: "succeeded" }, { id: "verified", status: "succeeded" }],
    activity: [{ id: "repair", action: "agent.updated", actorType: "user", entityId: "qa", agentId: null as string | null }], state: {
      installedFromCatalog: true, missingId: "qa", workingId: "coder", expectedMembers: 2, memberIdsBefore: ["coder", "qa"], workingRevisionIdsBefore: ["revision"], workingRevisionIdsAfter: ["revision"],
      initialProbes: [{ agentId: "qa", status: "fail", testedAt: "2026-10-26T10:00:00Z", checks: [{ code: "codex_auth", level: "error" }] }, { agentId: "coder", status: "pass", testedAt: "2026-10-26T10:00:00Z", checks: [] }],
      afterProbes: [{ agentId: "qa", status: "pass", testedAt: "2026-10-26T10:05:01Z", checks: [] }, { agentId: "coder", status: "pass", testedAt: "2026-10-26T10:05:02Z", checks: [] }],
      repairVerifiedAfter: Date.parse("2026-10-26T10:05:00Z"), initialMemberNamed: true, initialHandoffSupported: true, repairConfirmed: true, repairChannel: "human-board-configuration", workingHashBefore: "same-config", workingHashAfter: "same-config", memberIdsPreserved: true, initialRunId: "initial", noPrematureWholeTeamClaim: true,
    } };
}
describe("installed team per-member readiness oracle", () => {
  const definition = teamConfigureExternalCases[0]!;
  it("accepts real missing-account diagnosis, human repair and fresh separate readiness checks", () => { expect(definition.grade(valid()).passed).toBe(true); });
  it("also accepts an actually attributed eligible agent configuration repair", () => { const o = valid(); o.state.repairChannel = "agent-configuration"; o.activity[0]!.actorType = "agent"; o.activity[0]!.agentId = "ceo"; expect(definition.grade(o).passed).toBe(true); });
  it("rejects stale/member-substituted readiness, unrelated config edits and premature success", () => {
    for (const change of [
      (o: ReturnType<typeof valid>) => { o.state.afterProbes[0]!.testedAt = "2026-10-26T09:00:00Z"; },
      (o: ReturnType<typeof valid>) => { o.state.afterProbes[0]!.status = "fail"; },
      (o: ReturnType<typeof valid>) => { o.state.afterProbes[0]!.agentId = "coder"; },
      (o: ReturnType<typeof valid>) => { o.state.workingHashAfter = "changed-working-account"; },
      (o: ReturnType<typeof valid>) => { o.state.workingRevisionIdsAfter = ["masked-env-change"]; },
      (o: ReturnType<typeof valid>) => { o.state.noPrematureWholeTeamClaim = false; },
      (o: ReturnType<typeof valid>) => { o.phaseReplies[1]!.runId = "initial"; },
    ]) { const o = valid(); change(o); expect(definition.grade(o).passed).toBe(false); }
  });
  it("missing observations cannot pass", () => { expect(definition.grade(undefined).passed).toBe(false); expect(definition.grade({ reply: "Everyone is ready." }).passed).toBe(false); });
});
afterEach(() => vi.unstubAllGlobals());
function selectedSetup(mode: "native-split" | "legacy-warning" | "all-pass" | "all-fail", evidenceFailure = false) {
  const execution = runnerMatrix.find(row => row.id === "chat-features.runner-opencode.local.teams.configure-team")!;
  const members: Array<Record<string, any>> = [], order: string[] = [], probes: string[] = [];
  const testedAt = "2026-10-29T12:00:00.000Z", marker = "WITHHELD_PROBE_CONTENT";
  const evidence = vi.fn(async (name: string, value: unknown) => { order.push("evidence"); if (evidenceFailure) throw new Error("SYNTHETIC_EVIDENCE_FAILURE"); return { name, value }; });
  const api = {
    async get(url: string) {
      if (url === "/api/teams/catalog") return [{ id: "team", name: "Product Engineering", slug: "product-engineering", compatibility: "compatible", agentSlugs: ["qa", "senior-coder", "cto"] }];
      if (url === "/api/companies/company/agents") return members;
      if (/\/(?:projects|routines|teams\/catalog\/installed)$/.test(url)) return [];
      if (url === "/api/agents/senior-coder/config-revisions") return [{ id: "revision" }];
      if (url === "/api/agents/senior-coder") return members.find(row => row.id === "senior-coder");
      throw new Error("Unexpected mocked public read");
    },
    async postSensitive(url: string, body: Record<string, any>) {
      if (url === "/api/companies/company/teams/catalog/team/install") {
        for (const [slug, override] of Object.entries(body.adapterOverrides) as Array<[string, Record<string, any>]>) members.push({ id: slug, companyId: "company", ...override, defaultEnvironmentId: "target", metadata: { paperclip: { catalogTeam: { catalogId: "team", agentSlug: slug } } } });
        return { portabilityImport: { agents: members.map(row => ({ slug: row.id, id: row.id })) } };
      }
      expect(url).toBe("/api/companies/company/adapters/paperclip_runner/test-environment");
      probes.push(body.agentId); order.push(`probe:${body.agentId}`);
      expect(body.adapterConfig.provider).toBe("opencode"); expect(body.adapterConfig.model).toBe("openrouter/deepseek/deepseek-v4.1-flash-1017"); expect(body.adapterConfig.timeoutSec).toBe(0);
      const missing = body.agentId === "qa", failed = mode === "all-fail" || missing && mode !== "all-pass";
      const check = { code: failed ? "opencode_hello_probe_auth_required" : "opencode_hello_probe_passed", level: failed ? mode === "legacy-warning" ? "warn" : "error" : "info" };
      Object.defineProperty(check, "message", { get() { throw new Error(marker); } }); Object.defineProperty(check, "detail", { get() { throw new Error(marker); } });
      return { status: failed ? mode === "legacy-warning" ? "warn" : "fail" : "pass", testedAt, checks: [check], body: marker };
    },
    async patchSensitive(url: string, body: Record<string, any>) { expect(url).toBe("/api/agents/qa"); Object.assign(members.find(row => row.id === "qa")!, body); },
    async post(url: string) { order.push("chat"); expect(url).toBe("/api/companies/company/chats/ceo"); return {}; },
    async patch(url: string) { expect(url).toBe("/api/issues/issue"); return {}; },
  };
  vi.stubGlobal("fetch", () => { throw new Error("Real API/provider calls forbidden in selected setup controls"); });
  const ctx = { scenario: { id: "teams.configure-team" }, input: { api, evidence, execution, nonce: "synthetic", workspacePath: "/synthetic/workspace", fixtures: { company: { id: "company" }, agent: { id: "ceo" }, environment: { id: "target" }, secretRefs: { OPENROUTER_API_KEY: { type: "secret_ref", secretId: "synthetic-account", version: "latest" } } } }, issue: () => ({ id: "issue" }), refreshIssue: async () => {} } as unknown as ChatCatalogContext;
  return { ctx, evidence, order, probes, members, marker, testedAt };
}
describe("selected native team setup probe evidence", () => {
  it("retains actual typed per-member rows before the strict split and keeps all original probes", async () => {
    const f = selectedSetup("native-split"), definition = teamConfigureExternalCases[0]!;
    try {
      const state = await definition.setup(f.ctx);
      expect(f.probes).toEqual(["qa", "senior-coder", "cto"]); expect(f.evidence).toHaveBeenCalledTimes(1);
      const [name, payload] = f.evidence.mock.calls[0]!; expect(name).toBe("chat-catalog-team-initial-probes.json");
      expect(payload).toEqual({ initialProbes: state.initialProbes }); expect(f.order.indexOf("evidence")).toBeLessThan(f.order.indexOf("chat"));
      expect(JSON.stringify(payload)).not.toContain(f.marker);
      expect(payload).toEqual({ initialProbes: f.probes.map(agentId => ({ agentId, status: agentId === "qa" ? "fail" : "pass", testedAt: f.testedAt, checks: [{ code: agentId === "qa" ? "opencode_hello_probe_auth_required" : "opencode_hello_probe_passed", level: agentId === "qa" ? "error" : "info" }] })) });
      expect(f.members.find(row => row.id === "qa")!.adapterConfig.env.OPENROUTER_API_KEY).toBe("");
      expect(f.members.find(row => row.id === "senior-coder")!.adapterConfig.env.OPENROUTER_API_KEY).toMatchObject({ type: "secret_ref", secretId: "synthetic-account" });
    } finally { await definition.cleanup?.(f.ctx, {}); }
  });
  it.each(["legacy-warning", "all-pass", "all-fail"] as const)("retains the actual %s split then refuses canonical chat without a severity waiver", async mode => {
    const f = selectedSetup(mode);
    await expect(teamConfigureExternalCases[0]!.setup(f.ctx)).rejects.toThrow("missing-versus-ready account split");
    expect(f.probes).toHaveLength(3); expect(f.evidence).toHaveBeenCalledTimes(1); expect(f.order).not.toContain("chat");
    expect(JSON.stringify(f.evidence.mock.calls)).not.toContain(f.marker);
  });
  it("stops before chat if the existing evidence writer cannot retain the probe rows", async () => {
    const f = selectedSetup("native-split", true);
    await expect(teamConfigureExternalCases[0]!.setup(f.ctx)).rejects.toThrow("SYNTHETIC_EVIDENCE_FAILURE"); expect(f.probes).toHaveLength(3); expect(f.order).not.toContain("chat");
  });
});
