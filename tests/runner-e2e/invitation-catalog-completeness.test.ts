import { afterEach, expect, it, vi } from "vitest";
import type { ChatCatalogCase, ChatCatalogContext, ChatCatalogGrade } from "./chat-catalog-contract.js";
import type { IdentityObservation } from "./chat-catalog-domains/identity-support.js";
import { accessGrantIdentityCases } from "./chat-catalog-domains/identity-access-grants.js";
const fixture=vi.hoisted(()=>({implementation:undefined as unknown as ChatCatalogCase,sent:false}));
vi.mock("./chat-catalog-registry.js",async original=>({...await original<typeof import("./chat-catalog-registry.js")>(),loadChatCatalogImplementation:async()=>fixture.implementation}));
vi.mock("./chat-catalog-fingerprint.js",()=>({chatCatalogCaseFingerprint:()=>({}),normalizedChatCatalogExecution:()=>({})}));
vi.mock("./api.js",async original=>({...await original<typeof import("./api.js")>(),pollUntil:async(input:{load:()=>Promise<unknown>})=>input.load()}));
vi.mock("./chat-rendered-links.js",()=>({collectConversationLinks:async()=>[]}));
vi.mock("./chat-flow.js",()=>({sendChatMessage:async()=>{fixture.sent=true;},collectChatRunEvidence:async()=>({})}));
import { runChatCatalogFlow } from "./chat-catalog-flow.js";
afterEach(()=>vi.unstubAllGlobals());
const invitation=accessGrantIdentityCases.find(row=>row.scenarioId==="access.invite-teammate")!;
const query="Invite alex@example.test to join this company.";
// Same independently checked creation/acceptance and role-question shapes as
// identity-access-grants.test.ts; production grade and common flow stay real.
function observation(kind:"invite"|"clarification"|"wrong-invite"|"wrong-clarification"):IdentityObservation{
 const o:IdentityObservation={scenarioId:invitation.scenarioId,origin:"http://fixture.invalid",companyId:"acorn",leadId:"ceo",company:{id:"acorn"},companies:[],agents:[],interactions:[],tasks:[],projects:[],goals:[],documents:[],revisions:[],comments:[],links:["/invite/real-link"],runs:[{id:"run",companyId:"acorn",agentId:"ceo",status:"succeeded",runtimeMode:"native",contextSnapshot:{issueId:"chat"}}] as IdentityObservation["runs"],humanQueries:[query],reply:"Invitation for alex@example.test is pending; membership follows acceptance.",activity:[{id:"created",action:"invite.created",entityId:"invite",actorType:"agent",actorId:"ceo"}],state:{permissionKey:"users:invite",publicGrantStatus:200,agentPermissionStatus:200,grantPrincipalId:"ceo",effectiveGrants:[{permissionKey:"users:invite"}],invitations:[{id:"invite",companyId:"acorn",state:"accepted",humanRole:"viewer"}],invitationCreated:{id:"invite",companyId:"acorn",state:"active",humanRole:"viewer"},creationReplyNamesAlex:true,actualJoinLinkBound:true,notMemberBeforeAcceptance:true,realAlexJoinedOnce:true,reusedLinkDifferentIdentityDenied:true}};
 if(kind.includes("clarification")){
  delete o.state.invitationCreated;o.state.invitations=[];o.state.alexMembershipAfter=null;o.reply="Which company role should Alex receive?";
  o.interactions=[{id:"role",companyId:"acorn",createdByAgentId:"ceo",sourceRunId:"run",kind:"ask_user_questions",status:"pending",payload:{questionSet:{questions:[{id:"role",prompt:kind==="wrong-clarification"?"What company role should Morgan receive?":"What company role should Alex receive?",answerMode:"text",required:true}]}}}];
 }
 if(kind==="wrong-invite")o.state.reusedLinkDifferentIdentityDenied=false;
 return o;
}
async function actualCommonGrade(o:IdentityObservation){
 fixture.sent=false;const recorded:ChatCatalogGrade[]=[];
 fixture.implementation={...invitation,setup:async()=>o.state,act:async()=>{},observe:async()=>o,verifySetup:undefined,verifyResult:async()=>{},cleanup:async()=>{}};
 vi.stubGlobal("fetch",()=>{throw new Error("Oracle calibration cannot call network");});
 const issue={id:"chat",companyId:"acorn",conversationState:"waiting"};
 const ctx={scenario:{id:invitation.scenarioId,query},refreshIssue:async()=>{},issue:()=>fixture.sent?issue:undefined,allRuns:async()=>fixture.sent?o.runs:[],input:{execution:{id:"chat-features.runner-opencode.local.access.invite-teammate",task:{turnTimeoutMs:0}},fixtures:{company:{id:"acorn"},agent:{id:"ceo"}},page:{locator:()=>({count:async()=>0})},api:{baseURL:o.origin,get:async(path:string)=>{
  if(path.endsWith("/comments?order=asc"))return fixture.sent?[{id:"human",body:query,authorUserId:"person"}]:[];
  if(path.endsWith("/agents"))return[];
  if(path==="/api/agents/ceo")return{adapterConfig:{timeoutSec:0}};
  if(path.endsWith("/budgets/overview"))return{policies:[{scopeType:"company",scopeId:"acorn",amount:500,hardStopEnabled:true,isActive:true,unpricedUsagePolicy:"allow"}]};
  throw new Error("Unexpected common-grade public read");
 },post:async()=>({})},evidence:async(name:string,value:unknown)=>{
  if(name==="chat-catalog-observation.json"){recorded.push((value as {grade:ChatCatalogGrade}).grade);throw new Error("STOP_AFTER_ACTUAL_COMMON_GRADE");}
 }}} as unknown as ChatCatalogContext;
 await expect(runChatCatalogFlow(ctx)).rejects.toThrow("STOP_AFTER_ACTUAL_COMMON_GRADE");
 expect(recorded.length).toBeGreaterThan(0);return recorded[0]!;
}
it.each(["invite","clarification"] as const)("actual selected full common grader accepts supported %s evidence",async kind=>{
 const grade=await actualCommonGrade(observation(kind));
 expect(grade.checks.find(row=>row.id==="catalog-complete-conditions")?.passed).toBe(true);
 expect(grade.checks.filter(row=>!row.passed)).toEqual([]);expect(grade.passed).toBe(true);
});
it.each(["wrong-invite","wrong-clarification"] as const)("actual selected feature oracle still rejects %s evidence",async kind=>{
 const grade=await actualCommonGrade(observation(kind));expect(grade.passed).toBe(false);
 expect(grade.checks.some(row=>!row.passed&&["scoped-invitation-or-consequential-role-question","invitation-human-boundary-verified"].includes(row.id))).toBe(true);
});
