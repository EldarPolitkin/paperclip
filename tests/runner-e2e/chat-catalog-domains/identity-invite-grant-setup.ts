import { isDeepStrictEqual } from "node:util";
import { updateMemberPermissionsSchema } from "../../../packages/shared/src/validators/access.js";
import type { RunnerApi } from "../api.js";
interface Grant { permissionKey: string; scope?: unknown; companyId?: string; principalType?: string; principalId?: string }
interface AgentMember { id: string; companyId: string; principalType: string; principalId: string; status: string; grants: Grant[] }
interface AgentDetail { id: string; companyId: string; access?: { membership?: { id: string; principalType: string; principalId: string } | null; grants?: Grant[] } }
interface Activity { id: string; companyId: string; action: string; entityId: string; actorType: string; actorId: string; details?: { principalType?: string; principalId?: string; grantCount?: number } }
function scoped(grants: Grant[]) { return grants.map(({ permissionKey, scope }) => ({ permissionKey, scope: scope ?? null })); }
export function invitationSetupGrants(grants: Grant[]) {
 const original = scoped(grants);
 const desired = original.some(row => row.permissionKey === "users:invite") ? original : [...original, { permissionKey: "users:invite", scope: null }];
 const parsed = updateMemberPermissionsSchema.safeParse({ grants: desired });
 if (!parsed.success || desired.some(row => ["users:manage_permissions", "joins:approve"].includes(row.permissionKey))) throw new Error("Invitation setup grants do not match the supported operational agent contract");
 return parsed.data.grants;
}
export function sameInvitationGrants(a: Grant[], b: Grant[]) {
 const remaining = scoped(b);
 for (const grant of scoped(a)) { const index = remaining.findIndex(row => isDeepStrictEqual(row, grant)); if (index < 0) return false; remaining.splice(index, 1); }
 return remaining.length === 0;
}
function boundGrants(grants: Grant[] | undefined, companyId: string, agentId: string): grants is Grant[] {
 return Array.isArray(grants) && grants.every(row => row.companyId === companyId && row.principalType === "agent" && row.principalId === agentId);
}
/** Board establishes only the frozen setup grant; the real CEO bearer must independently read invitations. */
export async function prepareInvitationAgentAuthority(input: { companyId: string; agentId: string; api: Pick<RunnerApi, "get">;
 patch(route: string, grants: ReturnType<typeof invitationSetupGrants>): Promise<number>; probeInvites(): Promise<{ status: number }> }) {
 const { companyId, agentId, api } = input, root = `/api/companies/${companyId}`;
 if (!companyId || !agentId) throw new Error("Missing invitation principal/company binding");
 const [session, detail, directory, beforeActivity] = await Promise.all([
  api.get<{ user: { id: string } }>("/api/auth/get-session"), api.get<AgentDetail>(`/api/agents/${agentId}`),
  api.get<{ members: AgentMember[] }>(`${root}/members?principalType=agent`), api.get<Activity[]>(`${root}/activity?limit=1000`),
 ]);
 const matches = directory.members.filter(row => row.companyId === companyId && row.principalType === "agent" && row.principalId === agentId && row.status === "active");
 const member = matches.length === 1 ? matches[0] : undefined;
 if (!session.user?.id || session.user.id === "local-board" || detail.id !== agentId || detail.companyId !== companyId || !member
  || detail.access?.membership?.id !== member.id || detail.access.membership.principalType !== "agent" || detail.access.membership.principalId !== agentId
  || !boundGrants(member.grants, companyId, agentId) || !boundGrants(detail.access.grants, companyId, agentId) || !sameInvitationGrants(member.grants, detail.access.grants))
  throw new Error("Invitation setup requires the actual authenticated board, same-company agent membership and complete original grants");
 const desired = invitationSetupGrants(member.grants), publicGrantStatus = await input.patch(`${root}/members/${member.id}/permissions`, desired);
 if (publicGrantStatus !== 200) throw new Error(`Invitation public agent-grant setup failed (HTTP ${publicGrantStatus})`);
 const [after, directoryAfter, activity, probe] = await Promise.all([
  api.get<AgentDetail>(`/api/agents/${agentId}`), api.get<{ members: AgentMember[] }>(`${root}/members?principalType=agent`),
  api.get<Activity[]>(`${root}/activity?limit=1000`), input.probeInvites(),
 ]);
 const stored = directoryAfter.members.filter(row => row.id === member.id && row.companyId === companyId && row.principalType === "agent" && row.principalId === agentId && row.status === member.status);
 const priorIds = new Set(beforeActivity.map(row => row.id));
 const audits = activity.filter(row => !priorIds.has(row.id) && row.companyId === companyId && row.action === "company_member.permissions_updated" && row.entityId === member.id
  && row.actorType === "user" && row.actorId === session.user.id && row.details?.principalType === "agent" && row.details.principalId === agentId && row.details.grantCount === desired.length);
 if (stored.length !== 1 || after.id !== agentId || after.companyId !== companyId || after.access?.membership?.id !== member.id
  || after.access.membership.principalType !== "agent" || after.access.membership.principalId !== agentId
  || !boundGrants(stored[0]!.grants, companyId, agentId) || !boundGrants(after.access.grants, companyId, agentId)
  || !sameInvitationGrants(desired, stored[0]!.grants) || !sameInvitationGrants(desired, after.access.grants) || audits.length !== 1 || probe.status !== 200)
  throw new Error("Invitation grant readback, board attribution or actual CEO invitation read did not establish the frozen authority");
 return { permissionKey: "users:invite", publicGrantStatus, grantPrincipalId: agentId, effectiveGrants: after.access.grants,
  agentPermissionStatus: probe.status, publicMembershipId: member.id, setupBoardUserId: session.user.id, setupAuditId: audits[0]!.id,
  originalGrantScopesPreserved: true, onlyInvitationPermissionAdded: !member.grants.some(row => row.permissionKey === "users:invite") };
}
