import { afterEach, expect, it, vi } from "vitest";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { invitationSetupGrants, prepareInvitationAgentAuthority, sameInvitationGrants } from "./identity-invite-grant-setup.js";
import { accessGrantIdentityCases } from "./identity-access-grants.js";
const current = vi.hoisted(() => ({ probeStatus: 200, dispose: vi.fn() }));
vi.mock("./identity-auth.js", async original => ({ ...await original<object>(), createAuthenticatedPerson: async () => ({ id: "alex", dispose: current.dispose }) }));
vi.mock("./identity-support.js", async original => ({ ...await original<object>(), readAgentResource: async () => ({ status: current.probeStatus }) }));
afterEach(() => { current.probeStatus = 200; vi.clearAllMocks(); });
function fixture(existingInvite = false) {
 const member = { id: "membership", companyId: "company", principalId: "ceo", principalType: "agent", status: "active" };
 const grant = (permissionKey: string, scope: unknown = null) => ({ companyId: "company", principalType: "agent", principalId: "ceo", permissionKey, scope });
 const original = [grant("agents:configure", { agentIds: ["ceo"], details: { b: 2, a: 1 } }), ...(existingInvite ? [grant("users:invite", { recipients: ["alex@example.test"] })] : [])];
 const state = { patched: false, after: original, patchStatus: 200, wrongBeforeCompany: false, wrongPrincipal: false, wrongGrantCompany: false, wrongAfterCompany: false,
  changedScope: false, missingGrant: false, wrongAuditActor: false, staleAudit: false, wrongSession: false, wrongMembership: false };
 const writes: Array<{ route: string; grants: Array<{ permissionKey: string; scope?: unknown }> }> = [], reads: string[] = [];
 const audit = () => ({ id: "grant-write", companyId: "company", entityId: "membership", action: "company_member.permissions_updated", actorType: "user", actorId: state.wrongAuditActor ? "other" : "board-person", details: { principalType: "agent", principalId: "ceo", grantCount: state.after.length } });
 const currentGrants = () => state.patched ? state.after.filter((_, index) => !state.missingGrant || index > 0).map(row => ({ ...row, ...(state.changedScope && row.permissionKey === "agents:configure" ? { scope: { agentIds: ["foreign"] } } : {}) })) : original;
 const api = { baseURL: "http://127.0.0.1:42123", get: vi.fn(async (route: string) => { reads.push(route);
  if (route === "/api/auth/get-session") return { user: { id: state.wrongSession ? "local-board" : "board-person" } };
  if (route === "/api/agents/ceo") return { id: "ceo", companyId: state.wrongBeforeCompany && !state.patched || state.wrongAfterCompany && state.patched ? "foreign" : "company", access: { membership: { ...member, id: state.wrongMembership ? "other" : "membership" }, grants: currentGrants() } };
  if (route === "/api/companies/company/members?principalType=agent") return { members: [{ ...member, principalId: state.wrongPrincipal ? "foreign" : "ceo", grants: currentGrants().map(row => ({ ...row, companyId: state.wrongGrantCompany ? "foreign" : "company" })) }] };
  if (route === "/api/companies/company/activity?limit=1000") return state.patched || state.staleAudit ? [audit()] : [];
  if (route === "/api/companies/company/members") return { members: [] };
  if (route === "/api/companies/company/invites") return { invites: [] };
  throw new Error(`Unexpected public fixture read ${route}`);
 }) };
 const patch = async (route: string, grants: Array<{ permissionKey: string; scope?: unknown }>) => { writes.push({ route, grants }); state.patched = true; state.after = grants.map(row => grant(row.permissionKey, row.scope)); return state.patchStatus; };
 const context = { request: { patch: async (url: string, opts: { data: { grants: Array<{ permissionKey: string; scope?: unknown }> } }) => { const status = await patch(new URL(url).pathname, opts.data.grants); return { status: () => status, dispose: async () => {} }; } }, browser: () => ({}) };
 const ctx = { scenario: { id: "access.invite-teammate", query: "Invite alex@example.test to join this company." }, input: { api, page: { context: () => context }, privateSecrets: [], fixtures: { company: { id: "company" }, agent: { id: "ceo" } }, evidence: vi.fn() } } as unknown as ChatCatalogContext;
 const run = () => prepareInvitationAgentAuthority({ companyId: "company", agentId: "ceo", api: api as never, patch, probeInvites: async () => ({ status: current.probeStatus }) });
 return { ctx, run, state, original, writes, reads };
}
it("actual selected setup preserves every existing grant scope including an already scoped invitation permission", async () => {
 const f = fixture(true), selected = accessGrantIdentityCases.find(row => row.scenarioId === "access.invite-teammate")!;
 const result = await selected.setup(f.ctx); expect(result.publicGrantStatus).toBe(200);
 expect(f.writes).toHaveLength(1); expect(f.writes[0]!.grants).toEqual(f.original.map(({ permissionKey, scope }) => ({ permissionKey, scope })));
 expect(current.dispose).not.toHaveBeenCalled(); expect(f.reads).not.toEqual(expect.arrayContaining([expect.stringContaining("/accept")]));
});
it("adds only the actual public users:invite grant and proves same membership, fresh board audit and real agent read", async () => {
 const f = fixture(); expect(await f.run()).toMatchObject({ publicGrantStatus: 200, agentPermissionStatus: 200, publicMembershipId: "membership", setupBoardUserId: "board-person", setupAuditId: "grant-write", originalGrantScopesPreserved: true });
 expect(f.writes[0]).toEqual({ route: "/api/companies/company/members/membership/permissions", grants: [{ permissionKey: "agents:configure", scope: f.original[0]!.scope }, { permissionKey: "users:invite", scope: null }] });
});
it.each(["wrongBeforeCompany", "wrongPrincipal", "wrongGrantCompany", "wrongSession", "wrongMembership"] as const)("rejects %s before any grant write", async key => {
 const f = fixture(); f.state[key] = true; await expect(f.run()).rejects.toThrow(); expect(f.writes).toHaveLength(0);
});
it.each(["wrongAfterCompany", "changedScope", "missingGrant", "wrongAuditActor", "staleAudit"] as const)("rejects false persisted %s", async key => {
 const f = fixture(); f.state[key] = true; await expect(f.run()).rejects.toThrow();
});
it.each([403, 404, 500])("does not manufacture authority from failed grant HTTP%s", async status => { const f = fixture(); f.state.patchStatus = status; await expect(f.run()).rejects.toThrow("failed"); });
it("requires the CEO's actual bearer read rather than the board's successful grant alone", async () => { const f = fixture(); current.probeStatus = 403; await expect(f.run()).rejects.toThrow("actual CEO"); });
it("uses the actual schema, preserves nested scope object meaning and scope array order, rejects unknown/protected/malformed grants", () => {
 const grants = [{ permissionKey: "agents:configure", scope: { agentIds: ["one", "two"], details: { a: 1, b: 2 } } }];
 expect(invitationSetupGrants(grants)).toHaveLength(2);
 expect(sameInvitationGrants(grants, [{ permissionKey: "agents:configure", scope: { details: { b: 2, a: 1 }, agentIds: ["one", "two"] } }])).toBe(true);
 expect(sameInvitationGrants(grants, [{ permissionKey: "agents:configure", scope: { agentIds: ["two", "one"], details: { a: 1, b: 2 } } }])).toBe(false);
 for (const invalid of [[{ permissionKey: "projects:manage" }], [{ permissionKey: "users:manage_permissions" }], [{ permissionKey: "joins:approve" }], [{ permissionKey: "tasks:assign", scope: "all" }]]) expect(() => invitationSetupGrants(invalid)).toThrow();
});
