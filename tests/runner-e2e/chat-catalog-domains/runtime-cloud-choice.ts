import { createHash } from "node:crypto";
import type { AiConnectionList } from "../../../packages/shared/src/ai-connections.js";
import type { Agent } from "../../../packages/shared/src/types/agent.js";
import type { IssueThreadInteraction } from "../../../packages/shared/src/types/issue.js";
import { expect } from "@playwright/test";
import { checks } from "./internal-support.js";
import { waitForReply } from "./identity-support.js";
import { runtimeDefinition, runtimeObservation, observeRuntime } from "./runtime-support.js";
import { accountConfigurationDigest, readNegativeRuntimeChoices, cleanupNegativeRuntimeChoices, negativeRuntimeChoicesMatch } from "./runtime-negative-prerequisites.js";
export function cloudChoiceMatches(reply: string) {
  return /Claude\s*(?:Code)?/i.test(reply) && /(?:cloud|hosted|remote)\s+(?:computer|machine|environment|execution|runtime)|running (?:in|on) (?:the )?cloud/i.test(reply)
    && /\?|which|do you mean|did you mean|choose|prefer|clarif|whether/i.test(reply) && reply.length < 1200
    && !/claude_local|paperclip_runner|adapterType|acpxAgent|supply.*(?:adapter|internal).*id/i.test(reply)
    && !/(?:already|I(?:['’]ve| have))\s+(?:created|hired|selected|assigned)|(?:cloud code)\s+(?:definitely|always|clearly)\s+means/i.test(reply);
}
export function gradeCloudChoice(value: unknown) {
  const c = checks(), o = runtimeObservation(value); c.add("actual-two-available-context", !!o, "Both publicly offered configuration choices and independent no-commit evidence are required; runtime health is not inferred."); if (!o) return c.result();
  const s = o.state;
  c.add("concrete-clarification-retains-role", cloudChoiceMatches(`${o.reply}\n${String(s.visibleChoiceText ?? "")}`) && s.questionVisible === true && s.clarificationAuthorityBound === true, "The actual human sees a short concrete Claude Code versus cloud-computer choice retaining the requested engineer role, with no internal adapter vocabulary.");
  c.add("waits-before-consequential-commit", negativeRuntimeChoicesMatch(s.availability, o.companyId, true) && s.claudeAvailable === true && s.cloudAvailable === true && s.noNewEmployee === true && s.originalEnvironmentsUnchanged === true && s.accountConfigurationUnchanged === true && s.originalBindingsUnchanged === true && s.sourceWaiting === true
    && o.runs.length === 1 && o.runs[0]?.agentId === o.leadId && o.runs[0].status === "succeeded" && o.tasks.length === 0 && o.humanQueries.length === 1,
    "Real available choices remain unselected: no employee, harness/computer binding or delegated task is committed before the person's answer.");
  return c.result();
}
export const runtimeCloudChoiceCases = [runtimeDefinition("agents.ambiguous-cloud-code", async ctx => {
  try {
    const availability = await readNegativeRuntimeChoices(ctx, true), companyId = ctx.input.fixtures.company.id;
    const [beforeAgents, environments, accounts, session] = await Promise.all([
      ctx.input.api.get<Agent[]>(`/api/companies/${companyId}/agents`),
      ctx.input.api.get<Array<{ id: string; driver: string; config: unknown }>>(`/api/companies/${companyId}/environments`),
      ctx.input.api.get<AiConnectionList>(`/api/companies/${companyId}/ai-connections`),
      ctx.input.api.get<{ user: { id: string } }>("/api/auth/get-session"),
    ]);
    if (!session.user?.id || session.user.id === "local-board") throw new Error("Cloud-code clarification requires an actual signed-in person");
    return { availability, humanId: session.user.id, claudeAvailable: true, cloudAvailable: true, beforeAgents, beforeAccountConfiguration: accountConfigurationDigest(accounts),
      beforeEnvironments: environments.map(row => ({ id: row.id, driver: row.driver, configSha256: createHash("sha256").update(JSON.stringify(row.config)).digest("hex") })) };
  } catch (error) {
    try { await cleanupNegativeRuntimeChoices(ctx); } catch (cleanup) { throw new AggregateError([error, cleanup], "Cloud-choice prerequisite cleanup failed"); }
    throw error;
  }
}, gradeCloudChoice, {
  authentication: "human-session", expectedRunCount: 1, expectedHumanMessageCount: 1, attemptTimeoutMs: 900000,
  sourceFiles: ["chat-catalog-domains/runtime-cloud-choice.ts", "chat-catalog-domains/runtime-negative-prerequisites.ts", "chat-catalog-domains/runtime-support.ts", "../../server/src/routes/adapters.ts", "../../server/src/services/agent-runner-selection.ts", "../../server/src/routes/environments.ts", "../../packages/shared/src/environment-support.ts", "../../packages/plugins/sandbox-providers/daytona/src/plugin.ts", "chat-scenarios/agents.yaml"],
  async act(ctx, state) {
    await waitForReply(ctx); const source = ctx.issue()!, interactions = await ctx.input.api.get<IssueThreadInteraction[]>(`/api/issues/${source.id}/interactions`);
    const questions = interactions.filter(row => row.kind === "ask_user_questions" && row.status === "pending");
    if (questions.length) {
      const runs = await ctx.allRuns();
      if (questions.some(row => row.sourceRunId !== runs[0]?.id || row.issueId !== source.id || row.companyId !== ctx.input.fixtures.company.id || row.addresseeUserId !== state.humanId || !!row.addresseeAgentId)) throw new Error("Clarification card is not attributed to the actual canonical source run");
      await expect(ctx.input.page.getByTestId("task-chat-unanswered-question").first()).toBeVisible();
      state.visibleChoiceText = await ctx.input.page.locator(`[data-interaction-id=${JSON.stringify(questions[0]!.id)}]`).innerText();
    }
    else await expect(ctx.input.page.getByTestId("task-chat-composer-input")).toBeVisible();
    state.clarificationAuthorityBound = typeof state.humanId === "string" && !!state.humanId;
    state.questionVisible = questions.length > 0 || /\?|which|do you mean/i.test((await observeRuntime(ctx, state)).reply); state.sourceWaiting = source.conversationState === "waiting";
  },
  async observe(ctx, state) { const o = await observeRuntime(ctx, state), prior = state.beforeAgents as Agent[];
    const environments = await ctx.input.api.get<Array<{ id: string; driver: string; config: unknown }>>(`/api/companies/${o.companyId}/environments`);
    const accounts = await ctx.input.api.get<AiConnectionList>(`/api/companies/${o.companyId}/ai-connections`);
    state.accountConfigurationUnchanged = accountConfigurationDigest(accounts) === state.beforeAccountConfiguration;
    const before = state.beforeEnvironments as Array<{ id: string; driver: string; configSha256: string }>;
    state.originalEnvironmentsUnchanged = before.length === environments.length && before.every(row => environments.some(after => after.id === row.id && after.driver === row.driver && createHash("sha256").update(JSON.stringify(after.config)).digest("hex") === row.configSha256)); state.noNewEmployee = o.agents.length === prior.length && prior.every(before => o.agents.some(row => row.id === before.id)); state.originalBindingsUnchanged = prior.every(before => { const after = o.agents.find(row => row.id === before.id); return after?.adapterType === before.adapterType && JSON.stringify(after.adapterConfig) === JSON.stringify(before.adapterConfig) && after.defaultEnvironmentId === before.defaultEnvironmentId; }); return o; },
  async cleanup(ctx) { await cleanupNegativeRuntimeChoices(ctx); },
})];
