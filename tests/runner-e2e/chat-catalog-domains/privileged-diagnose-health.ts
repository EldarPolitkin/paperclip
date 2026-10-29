import { expect } from "@playwright/test";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { chatCatalogAgentIsReady } from "../chat-catalog-contract.js";
import { checks, observeInternal, project, type Entity } from "./internal-support.js";
import { privilegedDefinition, privilegedObservation } from "./privileged-support.js";
import { createDiagnosticTarget, cleanupDiagnosticTarget, diagnosticActionEvidence, operatorDiagnosticCheck, remainingDiagnosticBudget } from "./diagnostic-owned-target.js";
export function diagnosticContext(targetUrl: string, controllerUrl: string) {
  return { title: `Diagnostic subject ${targetUrl} (operator-owned; chat controller ${controllerUrl})`,
    description: `Diagnostic subject: ${targetUrl}. This conversation's subject is that owned instance; the chat controller is ${controllerUrl}.` };
}
export function supportedDiagnosticOperator(reply: string, targetUrl: string) {
  let targetOrigin: string;
  try { targetOrigin = new URL(targetUrl).origin; } catch { return false; }
  let subjectKnown = false;
  for (const clause of reply.split(/(?<=[.!?])\s+|;|\n/)) {
    const origins = [...clause.matchAll(/https?:\/\/[^\s<>()]+/g)].map(m => { try { return new URL(m[0].replace(/[.,!?]+$/, "")).origin; } catch { return "unknown"; } });
    if (origins.length) subjectKnown = origins.every(origin => origin === targetOrigin);
    const subject = subjectKnown && (origins.length > 0 || /\b(?:that|this|owned|diagnostic) (?:target|instance)\b/i.test(clause));
    const assignment = /\b(?:operator|human|you)\b\s*,?\s*(?:(?:can|could|should|must|may|will|need to|needs to)\s+)?(?:run|use|execute|check)\b[\s\S]*\bdoctor\b/i.test(clause)
      || /(?:^|[:,]\s*)(?:please\s+)?(?:run|use|execute|check)\b[\s\S]*\bdoctor\b/i.test(clause);
    if (subject && assignment
      && !/\b(?:do not|don't|never|cannot|can't|unable to|won't)\b/i.test(clause) && !clause.trim().endsWith("?")) return true;
  }
  return false;
}
export function gradeDiagnoseHealth(value: unknown) {
  const c = checks(), o = privilegedObservation(value);
  c.add("actual-owned-diagnostic-evidence", !!o, "The real separate owned diagnostic subject and healthy controller are required."); if (!o) return c.result();
  const s = o.state, p = s.targetProject as Entity | undefined;
  c.add("live-http-not-ready", s.healthStatus === 503 && s.healthError === "database_unreachable" && s.doctorFailed === true
    && s.targetOwned === true && s.targetInitiallyReady === true && s.controllerHealthy === true && s.controllerAgentReady === true,
    "The owned subject listens with its actual database stopped while the canonical chat controller stays healthy and ready.");
  c.add("ordinary-visible-subject", s.targetContextVisible === true && !!p && o.projects.some(actual => actual.id === p.id && actual.companyId === o.companyId
    && actual.description === p.description && actual.description?.includes(String(s.targetUrl))) && s.sourceProjectId === p?.id,
    "The diagnostic subject is bound through the source conversation's ordinary, rendered same-company project context before the unchanged query.");
  c.add("canonical-native-response", o.humanQueries.length === 1 && o.humanQueries[0] === "Is this Paperclip instance healthy enough to run work?"
    && o.runs.length === 1 && o.runs[0]?.status === "succeeded" && !!o.reply,
    "The unchanged canonical request reaches the healthy controller and receives its one native response.");
  c.add("independent-action-or-operator", s.nativeTargetHealthResponse === true || (s.operatorDoctorAfterGuidance === true && supportedDiagnosticOperator(o.reply, String(s.targetUrl))),
    "Either an independently owned native caller receives this target's real 503, or the actual reply assigns its restricted doctor check to the operator and the real target check confirms failure.");
  const positive = o.reply.split(/[.!?;\n]/).filter(clause => !/\b(?:not|cannot|can't|no)\b/i.test(clause)).join(".");
  c.add("honest-database-diagnosis", /database|PostgreSQL|postgres/i.test(o.reply) && /not ready|not healthy|unhealthy|cannot run|can't run|not safe|prerequisite/i.test(o.reply)
    && !/healthy (?:enough|and ready)|ready to run work/i.test(positive), "The response identifies failed database readiness instead of liveness-only success or generic diagnostic prose.");
  return c.result();
}
const diagnose = privilegedDefinition("instance-operations.diagnose-health", "privileged-diagnose-health", {
  async setup(ctx) {
    await ctx.input.api.post(`/api/companies/${ctx.input.fixtures.company.id}/chats/${ctx.input.fixtures.agent.id}`);
    await ctx.refreshIssue(); const source = ctx.issue(); if (!source) throw new Error("Diagnostic source conversation was not created");
    const state = await createDiagnosticTarget(ctx);
    const name = "Owned diagnostic instance", { title, description } = diagnosticContext(state.targetUrl, ctx.input.api.baseURL);
    const targetProject = await project(ctx, name, { description });
    await ctx.input.api.patch(`/api/issues/${source.id}`, { projectId: targetProject.id, title, description });
    const readback = await ctx.input.api.get<Entity>(`/api/issues/${source.id}`), saved = await ctx.input.api.get<Entity>(`/api/projects/${targetProject.id}/configuration`);
    if (readback.title !== title || readback.description !== description || readback.projectId !== targetProject.id || saved.description !== description || saved.companyId !== ctx.input.fixtures.company.id) throw new Error("Diagnostic context binding failed");
    await ctx.input.page.goto(new URL(`/${ctx.input.fixtures.company.issuePrefix}/projects/${targetProject.id}/configuration`, ctx.input.api.baseURL).href, { timeout: remainingDiagnosticBudget(ctx) });
    await expect(ctx.input.page.getByRole("heading", { name, exact: true }).first()).toBeVisible({ timeout: remainingDiagnosticBudget(ctx) });
    await expect(ctx.input.page.getByText(description, { exact: true }).first()).toBeVisible({ timeout: remainingDiagnosticBudget(ctx) });
    await ctx.input.page.goto(new URL(`/${ctx.input.fixtures.company.issuePrefix}/issues/${source.id}`, ctx.input.api.baseURL).href, { timeout: remainingDiagnosticBudget(ctx) });
    await expect(ctx.input.page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible({ timeout: remainingDiagnosticBudget(ctx) });
    await ctx.refreshIssue();
    return { ...state, sourceTitle: title, targetProject: saved, sourceProjectId: readback.projectId, targetContextVisible: true };
  }, grade: gradeDiagnoseHealth,
  async verifyResult(ctx) { await expect(ctx.input.page.getByTestId("task-chat-composer-input")).toBeVisible(); },
});
diagnose.attemptTimeoutMs = 600000;
diagnose.observe = async (ctx, state) => {
  const o = await observeInternal(ctx, state);
  const controller = await ctx.input.api.get<{ status?: string; lifecycleState?: string; lifecycleError?: unknown }>(`/api/agents/${ctx.input.fixtures.agent.id}`);
  state.controllerAgentReady = chatCatalogAgentIsReady(controller);
  if (o.runs.length === 1) state.nativeTargetHealthResponse = await diagnosticActionEvidence(ctx, o.runs[0]!.id);
  if (!state.operatorDoctorAfterGuidance && supportedDiagnosticOperator(o.reply, String(state.targetUrl))) state.operatorDoctorAfterGuidance = await operatorDiagnosticCheck(ctx);
  await ctx.input.evidence("chat-catalog-owned-diagnostic-target.json", { targetUrl: state.targetUrl, controllerHealthy: state.controllerHealthy, controllerAgentReady: state.controllerAgentReady,
    healthStatus: state.healthStatus, healthError: state.healthError, doctorFailed: state.doctorFailed, targetContextVisible: state.targetContextVisible,
    nativeTargetHealthResponse: state.nativeTargetHealthResponse === true, operatorDoctorAfterGuidance: state.operatorDoctorAfterGuidance === true });
  return o;
};
diagnose.cleanup = cleanupDiagnosticTarget;
diagnose.sourceFiles = [...diagnose.sourceFiles, "chat-catalog-domains/diagnostic-owned-target.ts", "chat-catalog-domains/diagnostic-target-observer.ts", "chat-catalog-domains/diagnostic-target-preload.mjs",
  "chat-catalog-domains/privileged-owned-dev.ts", "chat-catalog-domains/privileged-database-fault.ts", "chat-catalog-domains/privileged-docker-database.ts", "docker-postgres.ts", "../../cli/src/index.ts", "../../cli/src/commands/run.ts", "../../cli/src/commands/worktree.ts", "../../cli/src/checks/database-check.ts", "../../server/src/routes/health.ts", "../../server/src/services/heartbeat/task-markdown.ts", "../../server/src/services/native-runtime/native-execution-input.ts", "../../ui/src/pages/IssueDetail.tsx"];
export const privilegedDiagnosticCases = [diagnose];
