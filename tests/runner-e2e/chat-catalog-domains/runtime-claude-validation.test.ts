import { afterEach, expect, it, vi } from "vitest";
import { actualAuthenticationFailure, savedValidationReceipts, savedValidationDigests, validationDigest, validationOperation, validationFailureReplyMatches, gradeClaudeValidation, runtimeClaudeValidationCases, validationTargetSetupMatches } from "./runtime-claude-validation.js";
import type { Agent } from "../../../packages/shared/src/types/agent.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stageChatPrivateInputs, chatPrivateInputNameIdentity, chatPrivateSetupBlockers, readChatPrivateInputs, CHAT_PRIVATE_INPUTS_ENV } from "../chat-private-inputs.js";
const companyId = "company", issueId = "issue", leadId = "ceo", runId = "run";
const worker = { id: "morgan", companyId, name: "Morgan", reportsTo: leadId, status: "paused", lifecycleState: "paused", pauseReason: "setup", lifecycleHolds: ["setup"], adapterType: "paperclip_runner", adapterConfig: { provider: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash-1017", timeoutSec: 0 }, defaultEnvironmentId: "target", runtimeConfig: { aiConnection: { provider: "openrouter", method: "api_key", mode: "delegated", connectionId: "account", grantId: "grant" } } } as unknown as Agent;
const expected = { companyId, issueId, leadId, runId, worker };
function evidence() {
  const input = { operationId: validationOperation, pathParams: { companyId, type: worker.adapterType }, body: { agentId: worker.id, adapterConfig: worker.adapterConfig, environmentId: worker.defaultEnvironmentId, aiConnection: worker.runtimeConfig.aiConnection } };
  const digest = validationDigest(input);
  return { input, run: { id: runId, companyId, issueId, agentId: leadId, resultJson: { apiToolReceipts: { privateKey: { operationId: validationOperation, digest, state: "completed", result: { ok: true, status: 200, apiOperationId: validationOperation, data: { status: "fail", checks: [{ code: "opencode_hello_probe_auth_required" }] } } } } } }, activity: [{ companyId, actorType: "agent", actorId: leadId, agentId: leadId, runId, entityType: "issue", entityId: issueId, action: "runner.api_called", details: { operationId: validationOperation, requestFingerprint: digest, pathParams: input.pathParams, status: 200 } }] };
}
function valid() { const e = evidence(); return { companyId, leadId, agents: [worker], tasks: [], links: [], activity: [], humanQueries: ["Check that Morgan can actually start before I give them work."], runs: [{ id: runId, agentId: leadId, status: "succeeded" }], reply: "Morgan cannot start yet: validation failed authentication. Reconnect the selected account in settings; saving the profile is not proof it works.", state: { worker, actualAccountEligible: true, noTargetWorkBeforeQuery: true, targetVisibleToController: true, targetAuthTransition: true, sameAccountIdentities: true, controllerBindingUnchanged: true, noEmployeeRuns: true, canonicalValidationReceipts: savedValidationReceipts(e.run, e.activity, expected) } }; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("accepts existing durable canonical request/result and run-bound actor receipt", () => {
 const e = evidence(); expect(savedValidationReceipts(e.run,e.activity,expected)).toEqual([{sameConfiguration:true,authenticatedFailure:true,checkCodes:["opencode_hello_probe_auth_required"]}]);
 expect(savedValidationDigests(companyId,worker).has(validationDigest(e.input))).toBe(true); expect(gradeClaudeValidation(valid()).passed).toBe(true);
});
it("rejects foreign run, issue, company or actor without time/sequence inference", () => {
 for(const change of [{id:"foreign"},{issueId:"foreign"},{companyId:"foreign"},{agentId:"foreign"}]) { const e=evidence();expect(savedValidationReceipts({...e.run,...change},e.activity,expected)).toEqual([]); }
 for(const change of [{actorId:"foreign"},{runId:"foreign"},{entityId:"foreign"},{agentId:"foreign"}]) {const e=evidence();Object.assign(e.activity[0]!,change);expect(savedValidationReceipts(e.run,e.activity,expected)[0]?.sameConfiguration).toBe(false);}
});
it("rejects changed saved config/account digest, missing or duplicate public execution receipt", () => {
 const e=evidence(), changed=structuredClone(worker);changed.adapterConfig.model="different";
 expect(savedValidationReceipts(e.run,e.activity,{...expected,worker:changed})[0]?.sameConfiguration).toBe(false);
 expect(savedValidationReceipts(e.run,[],expected)[0]?.sameConfiguration).toBe(false);
 expect(savedValidationReceipts(e.run,[...e.activity,...e.activity],expected)[0]?.sameConfiguration).toBe(false);
 const changedAccount=structuredClone(worker);changedAccount.runtimeConfig.aiConnection={...worker.runtimeConfig.aiConnection,grantId:"foreign"} as typeof worker.runtimeConfig.aiConnection;
 expect(savedValidationReceipts(e.run,e.activity,{...expected,worker:changedAccount})[0]?.sameConfiguration).toBe(false);
});
it("does not read pending or encrypted result leaves, decrypt, or accept missing as zero", () => {
 for(const change of [{state:"pending"},{encryptedResult:{opaque:true}}]) {const e=evidence();const receipt=e.run.resultJson.apiToolReceipts.privateKey;Object.assign(receipt,change);Object.defineProperty(receipt,"result",{get(){throw new Error("private leaf must not be inspected");}});expect(savedValidationReceipts(e.run,e.activity,expected)[0]?.authenticatedFailure).toBe(false);}
 expect(savedValidationReceipts({id:runId,companyId,issueId,agentId:leadId},[],expected)).toEqual([]);
});
it("does not mistake a generic probe failure or HTTP denial for actual target auth failure", () => {
 for(const code of ["opencode_hello_probe_failed","provider_timeout","command_missing","other_auth_required"]) {const e=evidence();e.run.resultJson.apiToolReceipts.privateKey.result.data.checks[0]!.code=code;expect(savedValidationReceipts(e.run,e.activity,expected)[0]?.authenticatedFailure).toBe(false);}
 const e=evidence();e.run.resultJson.apiToolReceipts.privateKey.result.status=403;expect(savedValidationReceipts(e.run,e.activity,expected)[0]?.authenticatedFailure).toBe(false);
 expect(actualAuthenticationFailure(["ai_connection_api_key_rejected"])).toBe(true);
});
it("accepts legitimate repair/operator wording and expected account health transition", () => {
 const o=valid();o.reply="The saved Morgan profile exists, but startup failed due to credentials. An operator must repair the selected account before work.";expect(gradeClaudeValidation(o).passed).toBe(true);
 expect(validationFailureReplyMatches("Morgan is ready; reconnect later.")).toBe(false);
});
it("rejects setup hello, target work, controller substitution, false readiness and invented eligibility", () => {
 for(const key of ["actualAccountEligible","noTargetWorkBeforeQuery","targetVisibleToController","targetAuthTransition","sameAccountIdentities","controllerBindingUnchanged","noEmployeeRuns"] as const){const o=valid();o.state[key]=false;expect(gradeClaudeValidation(o).passed).toBe(false);}
 const o=valid();o.state.canonicalValidationReceipts.push(o.state.canonicalValidationReceipts[0]!);expect(gradeClaudeValidation(o).passed).toBe(false);expect(gradeClaudeValidation(undefined).passed).toBe(false);
});
function setupMock(change?: { slotOwner?: string; controllerMode?: string; targetStatus?: string; setupState?: string; environmentId?: string; environmentDriver?: string; profileId?: string; model?: string; credentialName?: string; missingCredential?: boolean; noPrivateSink?: boolean; leadStates?: Array<{ lifecycleState: string; status: string; lifecycleError?: string | null }> }) {
 const calls:string[]=[], privateSecrets:string[]=[];const target=structuredClone(worker);if(change?.setupState)target.lifecycleState=change.setupState as Agent["lifecycleState"];target.runtimeConfig.aiConnection={...worker.runtimeConfig.aiConnection,grantId:"fresh-grant",connectionId:"fresh-account"} as typeof worker.runtimeConfig.aiConnection;
 let leadReads=0; const lead={...worker,id:leadId,status:"idle",lifecycleState:"ready",runtimeConfig:{aiConnection:{provider:"openrouter",method:"api_key",mode:change?.controllerMode??"delegated",connectionId:"controller-account",grantId:"controller-grant"}}};
 const account={id:"fresh-account",grantId:"fresh-grant",provider:"openrouter",status:change?.targetStatus??"connected",ownership:"personal",ownerUserId:"owner"};
 const api={baseURL:"http://fixture.invalid",async get(path:string){calls.push(`GET ${path}`);if(path===`/api/environments/target`)return{id:change?.environmentId??"target",driver:change?.environmentDriver??"local",status:"active"};if(path===`/api/agents/${leadId}`){const states=change?.leadStates;return {...lead,...(states?.[Math.min(leadReads++,states.length-1)]??{})};}if(path===`/api/agents/${target.id}`)return target;if(path.endsWith('/ai-connections'))return{connections:[account]};if(path.endsWith('/me/user-secrets'))return[{definition:{id:"def",key:"ai_fresh_grant",companyId},secret:{id:"target-slot",scope:"user",companyId,ownerUserId:change?.slotOwner??"owner",userSecretDefinitionId:"def",status:"active"}}];throw new Error("unexpected public read");},async post(path:string,body:unknown){calls.push(`POST ${path}`);expect(path).toBe(`/api/companies/${companyId}/agents`);expect((body as {setupId?:string}).setupId).toBeTruthy();Object.assign(target,body,{id:(body as {setupId:string}).setupId});return target;},async postSensitive(path:string,body:unknown){calls.push(`POST_SENSITIVE ${path}`);if(path.endsWith('/ai-connections')){expect(body).not.toHaveProperty('connectionId');expect(body).toMatchObject({allAgents:false,agentIds:[],apiKey:"synthetic-qa-key"});return{connectionId:"fresh-account",grantId:"fresh-grant"};}if(path.endsWith('/rotate')){expect(path).toContain('/target-slot/');expect((body as {value:string}).value).toMatch(/^eval-invalid-/);return{};}if(path.endsWith('/keys'))return{id:"probe-key",token:"synthetic-agent-token"};throw new Error("unexpected sensitive request");},async getRunObservation(path:string){calls.push(`GET_RUN ${path}`);return[];}};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:200})));
 const ctx={scenario:{id:"runs-adapters.validate-hire"},input:{execution:{profile:{id:change?.profileId??"runner-opencode",credential:change?.credentialName??"OPENROUTER_API_KEY",model:change?.model??"openrouter/deepseek/deepseek-v4.1-flash-1017"},environment:{id:"local"}},api,fixtures:{company:{id:companyId},agent:{id:leadId},environment:{id:"target"}},privateSecrets:change?.noPrivateSink?undefined:privateSecrets,workspacePath:"/owned/workspace",privateInputs:{configuration:()=>undefined,credentials:change?.missingCredential?{}:{OPENROUTER_API_KEY:"synthetic-qa-key"},read:()=>undefined}},allRuns:async()=>[]} as unknown as ChatCatalogContext;
 return{ctx,calls,privateSecrets};
}
it("actual setup callback uses validated separate app slot and genuine setup hold without target probe/work", async()=>{
 const f=setupMock();const state=await runtimeClaudeValidationCases[0]!.setup(f.ctx);expect(state).toMatchObject({actualAccountEligible:true,noTargetWorkBeforeQuery:true,targetVisibleToController:true});expect(f.calls.some(c=>c.includes('test-environment'))).toBe(false);expect(f.calls.filter(c=>c.includes('/rotate')).length).toBe(1);expect(f.privateSecrets.length).toBeGreaterThanOrEqual(2);expect(JSON.stringify(state)).not.toContain('synthetic-qa-key');expect(JSON.stringify(state)).not.toContain('eval-invalid-');
});
it("refuses foreign target slot, noneligible account, or unfixed controller binding before unsafe next step",async()=>{
 for(const change of [{slotOwner:"foreign"},{targetStatus:"needs_attention"},{controllerMode:"responsible_user"},{setupState:"preparing"}]){const f=setupMock(change);await expect(runtimeClaudeValidationCases[0]!.setup(f.ctx)).rejects.toThrow();expect(f.calls.some(c=>c.includes('/rotate'))).toBe(false);if(change.controllerMode)expect(f.calls.some(c=>c.includes('POST_SENSITIVE'))).toBe(false);}
});
it("keeps the selected lazy declaration coherent and other private runtime rows unchanged", async()=>{
 const {chatCatalogCases,loadChatCatalogImplementation}=await import('../chat-catalog-registry.js');
 const row=chatCatalogCases.find(r=>r.scenarioId==='runs-adapters.validate-hire')!;
 expect(await loadChatCatalogImplementation(row)).toBe(runtimeClaudeValidationCases[0]);
 expect(row.requiredCredentials).toEqual(['OPENROUTER_API_KEY']);expect(row.externalInput).toBeUndefined();expect(row.attemptTimeoutMs).toBe(600000);expect(row.turnTimeoutMs).toBe(120000);expect(row.expectedRunCount).toBe(1);
 const {runtimePrivateRequirements}=await import('../chat-runtime-private-requirements.js');
 expect(runtimePrivateRequirements['agents.hire-claude-code'].credentials).toEqual(['ANTHROPIC_API_KEY']);expect(runtimePrivateRequirements['runs-adapters.upgrade-runner'].provider).toBe('claude');
});

it("checks real target identity/config/native clock and rejects a Codex-only marker",()=>{
 const x={id:worker.id,companyId,leadId,environmentId:worker.defaultEnvironmentId!,binding:worker.runtimeConfig.aiConnection};expect(validationTargetSetupMatches(worker,x)).toBe(true);
 for(const change of [{id:"foreign"},{companyId:"foreign"},{reportsTo:"foreign"},{defaultEnvironmentId:"foreign"},{adapterConfig:{...worker.adapterConfig,timeoutSec:120}},{adapterConfig:{...worker.adapterConfig,model:"other"}}])expect(validationTargetSetupMatches({...worker,...change} as Agent,x)).toBe(false);
 expect(actualAuthenticationFailure(["adapter_auth_missing"])).toBe(false);
});

it("rejects missing declared input, wrong protected profile or foreign local target before mutation",async()=>{
 for(const change of [{missingCredential:true},{noPrivateSink:true},{profileId:"runner-codex"},{model:"other"},{credentialName:"ANTHROPIC_API_KEY"},{environmentId:"foreign"},{environmentDriver:"daytona"}]) {
  const f=setupMock(change);await expect(runtimeClaudeValidationCases[0]!.setup(f.ctx)).rejects.toThrow();
  expect(f.calls.some(c=>c.startsWith("POST"))).toBe(false);expect(f.privateSecrets).toEqual([]);
 }
});

it("actual selected credential envelope needs no external configuration and registers the private root",async()=>{
 const {chatCatalogCases}=await import('../chat-catalog-registry.js'), {runnerMatrix}=await import('../catalog.js');
 const d=chatCatalogCases.find(r=>r.scenarioId==='runs-adapters.validate-hire')!,e=runnerMatrix.find(r=>r.id==='chat-features.runner-opencode.local.runs-adapters.validate-hire')!;
 const root=mkdtempSync(path.join(tmpdir(),"validate-input-control-"));
 try {
  const secrets:string[]=[], staged=stageChatPrivateInputs({execution:e,descriptor:d,privateDir:root,env:{OPENROUTER_API_KEY:"synthetic-declared-key"},secrets});
  const env={[CHAT_PRIVATE_INPUTS_ENV]:staged.filename,PAPERCLIP_RUNNER_E2E_TEMP_ROOT:root},inputs=readChatPrivateInputs(e.id,secrets,env);
  expect(chatPrivateSetupBlockers(inputs,d)).toEqual([]);expect(inputs.configuration("external-provider")).toBeUndefined();
  expect(inputs.credentials.OPENROUTER_API_KEY).toBe("synthetic-declared-key");expect(secrets).toContain("synthetic-declared-key");
  expect(chatPrivateInputNameIdentity(e.id,env)).toEqual({credentialNames:["OPENROUTER_API_KEY"],referenceNames:[],externalRequirements:[]});
  const raw=JSON.parse(readFileSync(staged.filename,"utf8"));expect(raw).not.toHaveProperty("external");
 } finally {rmSync(root,{recursive:true,force:true});}
});

it("awaits existing primary verification before any target mutation without restarting it", async () => {
 vi.useFakeTimers(); vi.setSystemTime(0);
 const verifying={status:"paused",lifecycleState:"verifying"},ready={status:"idle",lifecycleState:"ready"};
 const f=setupMock({leadStates:[verifying,ready]});
 const pending=runtimeClaudeValidationCases[0]!.setup(f.ctx).then(value=>({value}),error=>({error}));
 await vi.advanceTimersByTimeAsync(0);
 expect(f.calls.some(c=>c.startsWith("POST"))).toBe(false);
 await vi.advanceTimersByTimeAsync(500);
 expect(await pending).toMatchObject({value:{controllerBefore:{lifecycleState:"ready",status:"idle"},noTargetWorkBeforeQuery:true}});
 expect(Date.now()).toBe(500);expect(f.calls.some(c=>/test-environment|resume|retry|wake/.test(c))).toBe(false);
});
it.each([45000,1000])("caps primary-only observation at original available %sms and never starts Morgan",async cap=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 const f=setupMock({leadStates:[{status:"paused",lifecycleState:"verifying"}]});
 Object.assign(f.ctx,{observationDeadlineAt:cap});
 const rejected=expect(runtimeClaudeValidationCases[0]!.setup(f.ctx)).rejects.toThrow(/Timed out waiting/);
 await vi.advanceTimersByTimeAsync(cap);await rejected;
 expect(Date.now()).toBe(cap);expect(f.calls.some(c=>c.startsWith("POST"))).toBe(false);
 expect(f.calls.some(c=>/test-environment|resume|retry|wake/.test(c))).toBe(false);
});
it("preserves terminal primary error rejection before target mutation",async()=>{
 const f=setupMock({leadStates:[{status:"paused",lifecycleState:"paused",lifecycleError:"synthetic terminal failure"}]});
 await expect(runtimeClaudeValidationCases[0]!.setup(f.ctx)).rejects.toThrow(/Agent setup failed; diagnostic details withheld/);
 expect(f.calls.some(c=>c.startsWith("POST"))).toBe(false);
});

function delayedPrimarySetup(cap: number, delay: number) {
 const f=setupMock(),get=f.ctx.input.api.get.bind(f.ctx.input.api);
 Object.assign(f.ctx,{observationDeadlineAt:cap});
 f.ctx.input.api.get=async<T>(url:string)=>{
  const value=await get<T>(url);
  if(url===`/api/agents/${leadId}`)await new Promise(resolve=>setTimeout(resolve,delay));
  return value;
 };
 return f;
}
it.each([45000,1000])("rejects primary GET readiness returned after the %sms cap before any target mutation",async cap=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 const f=delayedPrimarySetup(cap,cap+1);
 const pending=runtimeClaudeValidationCases[0]!.setup(f.ctx).then(value=>({value}),error=>({error}));
 await vi.advanceTimersByTimeAsync(cap+1);
 expect(await pending).toMatchObject({error:expect.objectContaining({message:expect.stringContaining("primary readiness exceeded")})});
 expect(f.calls.some(c=>c.startsWith("POST"))).toBe(false);
 expect(f.privateSecrets).toEqual([]);
});
it("accepts genuine ready primary GET returned within the original remaining window",async()=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 const f=delayedPrimarySetup(1000,999);
 const pending=runtimeClaudeValidationCases[0]!.setup(f.ctx).then(value=>({value}),error=>({error}));
 await vi.advanceTimersByTimeAsync(999);
 expect(await pending).toMatchObject({value:{actualAccountEligible:true,noTargetWorkBeforeQuery:true}});
 expect(Date.now()).toBe(999);expect(f.calls.filter(c=>c.includes('/rotate'))).toHaveLength(1);
});
