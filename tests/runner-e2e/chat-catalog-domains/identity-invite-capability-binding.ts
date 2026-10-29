import { assertInvitationRawEvidence, registerInvitationCapability, type InvitationCapabilityProof } from "../invitation-private-capability.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import type { IdentityObservation } from "./identity-support.js";

type Invitation = InvitationCapabilityProof["invite"];
/** Public GET/visible reply custody only. Called before the existing first
 * token-path acceptance; never creates an invitation or changes its authority. */
export async function bindActualInvitationCapability(ctx: ChatCatalogContext, observation: IdentityObservation,
  invite: Invitation, setupRunIds: readonly string[]): Promise<string> {
  const scope = ctx.input.invitationScope, humanId = ctx.input.invitationHumanId;
  const issueId = ctx.issue()?.id, companyId = ctx.input.fixtures.company.id, agentId = ctx.input.fixtures.agent.id;
  if (!scope || !humanId || !issueId || !ctx.input.privateSecrets)
    throw new Error("Actual invitation scope and authenticated source person are required");
  const origin = ctx.input.api.baseURL;
  const links = (observation.renderedLinkEvidence ?? []).filter(link => {
    try {
      const url = new URL(link.href, origin);
      return url.origin === origin && /^\/invite\/pcp_invite_[A-Za-z0-9_-]{43}$/.test(url.pathname);
    } catch { return false; }
  });
  if (links.length !== 1) throw new Error("One actual invitation reply anchor is required");
  const link = links[0]!;
  const [comments, runs, activity] = await Promise.all([
    ctx.input.api.get<Array<InvitationCapabilityProof["human"] | InvitationCapabilityProof["comment"]>>(`/api/issues/${issueId}/comments?order=asc`),
    ctx.allRuns(),
    ctx.input.api.get<InvitationCapabilityProof["activity"][]>(`/api/companies/${companyId}/activity?limit=1000`),
  ]);
  const humans = comments.filter((row): row is InvitationCapabilityProof["human"] =>
    "authorUserId" in row && row.authorUserId === humanId && row.body === ctx.scenario.query && !row.authorAgentId);
  const replies = comments.filter((row): row is InvitationCapabilityProof["comment"] =>
    row.id === link.commentId && "createdByRunId" in row);
  const sourceRuns = runs.filter(run => run.id === replies[0]?.createdByRunId);
  const creations = activity.filter(row => row.action === "invite.created" && row.entityType === "invite" && row.entityId === invite.id);
  if (humans.length !== 1 || replies.length !== 1 || sourceRuns.length !== 1 || creations.length !== 1)
    throw new Error("Invitation public source custody is missing or ambiguous");
  const run = sourceRuns[0]!;
  const proof: InvitationCapabilityProof = { origin, expected: { companyId, agentId, issueId, humanId,
    query: ctx.scenario.query, setupRunIds }, invite, human: humans[0]!, comment: replies[0]!, activity: creations[0]!,
    run: { ...run, runtimeMode: run.runtimeMode ?? "", startedAt: run.startedAt ?? "",
      contextSnapshot: { issueId: typeof run.contextSnapshot?.issueId === "string" ? run.contextSnapshot.issueId : "" } },
    renderedLink: { ...link, commentId: link.commentId ?? "" },
  };
  assertInvitationRawEvidence(scope, "invitation-public-custody", proof, ctx.input.privateSecrets);
  registerInvitationCapability(scope, proof, ctx.input.privateSecrets);
  return new URL(link.href, origin).pathname.slice("/invite/".length);
}
