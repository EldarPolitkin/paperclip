import path from "node:path";
import { createHash } from "node:crypto";
import type { AiConnectionList } from "../../../packages/shared/src/ai-connections.js";
import daytonaManifest from "../../../packages/plugins/sandbox-providers/daytona/src/manifest.js";
import type { EnvironmentCapabilities } from "../../../packages/shared/src/environment-support.js";
import type { PluginRecord } from "../../../packages/shared/src/types/plugin.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import { pollUntil } from "../api.js";
import { prepareOwnedDaytonaSdk } from "./runtime-negative-plugin-sdk.js";

interface AdapterChoice { type: string; loaded: boolean; disabled: boolean; supportedRunners: string[] }
export interface NegativeRuntimeChoices {
  companyId: string;
  environmentId: string;
  scope: "supported-configuration-choices";
  claude: AdapterChoice;
  cloud?: { provider: "daytona"; pluginId: string; pluginKey: string; status: "supported"; supportsRunExecution: true };
}
const pluginKey = daytonaManifest.id;
const pluginRoot = path.resolve(import.meta.dirname, "../../../packages/plugins/sandbox-providers/daytona");
const installed = new WeakMap<ChatCatalogContext, string>();
/** Only public, noncredential account configuration is compared. */
export function accountConfigurationDigest(accounts: Pick<AiConnectionList, "connections">) {
  const rows = accounts.connections.map(row => ({ id: row.id, grantId: row.grantId, provider: row.provider,
    method: row.method, name: row.name, ownership: row.ownership, ownerUserId: row.ownerUserId,
    isDefault: row.isDefault, status: row.status, routing: row.routing })).sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
function remaining(ctx: ChatCatalogContext) {
  if (!Number.isFinite(ctx.observationDeadlineAt) || ctx.observationDeadlineAt! <= Date.now()) throw new Error("Original negative-runtime phase budget exhausted");
  return Math.min(15_000, ctx.observationDeadlineAt! - Date.now());
}
export function negativeRuntimeChoicesMatch(value: unknown, companyId: string, cloud: boolean): value is NegativeRuntimeChoices {
  const v = value as NegativeRuntimeChoices | undefined;
  return !!v && v.companyId === companyId && !!v.environmentId && v.scope === "supported-configuration-choices"
    && v.claude?.type === "claude_local" && v.claude.loaded === true && v.claude.disabled === false
    && v.claude.supportedRunners?.includes("paperclip") === true && (!cloud || !!v.cloud
      && v.cloud.provider === "daytona" && v.cloud.pluginKey === pluginKey && !!v.cloud.pluginId
      && v.cloud.status === "supported" && v.cloud.supportsRunExecution === true);
}
/** Availability is a real offered configuration choice, never an account,
 * qualified computer, lease, executable check or permission to execute it. */
export async function readNegativeRuntimeChoices(ctx: ChatCatalogContext, cloud: boolean): Promise<NegativeRuntimeChoices> {
  const id = ctx.scenario.id;
  if (!["agents.hire-needs-account", "agents.ambiguous-cloud-code"].includes(id)
    || ctx.input.execution.id !== `chat-features.runner-opencode.local.${id}`) throw new Error("Negative runtime prerequisites belong to the selected native case");
  const { api, fixtures } = ctx.input, companyId = fixtures.company.id, environmentId = fixtures.environment.id;
  const read = async <T>(route: string) => { const result = await api.get<T>(route, { timeout: remaining(ctx) }); remaining(ctx); return result; };
  const adapters = await read<AdapterChoice[]>(`/api/adapters?companyId=${companyId}&environmentId=${environmentId}`);
  const claude = adapters.find(row => row.type === "claude_local");
  const result: NegativeRuntimeChoices = { companyId, environmentId, scope: "supported-configuration-choices", claude: claude! };
  if (!negativeRuntimeChoicesMatch(result, companyId, false)) throw new Error("Public catalog does not offer an enabled native Claude configuration choice");
  if (cloud) {
    const route = `/api/companies/${companyId}/environments/capabilities`;
    const supported = (caps: EnvironmentCapabilities) => caps.drivers.sandbox === "supported"
      && caps.adapters.some(row => row.adapterType === "claude_local" && row.drivers.sandbox === "supported" && row.sandboxProviders.daytona === "supported")
      && caps.sandboxProviders.daytona?.status === "supported" && caps.sandboxProviders.daytona.source === "plugin"
      && caps.sandboxProviders.daytona.pluginKey === pluginKey && !!caps.sandboxProviders.daytona.pluginId
      && caps.sandboxProviders.daytona.supportsRunExecution === true;
    let caps = await read<EnvironmentCapabilities>(route);
    if (!supported(caps)) {
      const before = await read<PluginRecord[]>("/api/plugins");
      let plugin = before.find(row => row.pluginKey === pluginKey);
      if (!plugin) {
        await prepareOwnedDaytonaSdk(path.resolve(pluginRoot, "../../../.."), ctx.observationDeadlineAt!);
        remaining(ctx);
        plugin = await api.post<PluginRecord>("/api/plugins/install", { packageName: pluginRoot, isLocalPath: true }, { timeout: remaining(ctx) });
        if (!plugin.id || plugin.pluginKey !== pluginKey || before.some(row => row.id === plugin!.id)) throw new Error("Public plugin installation did not establish an owned Daytona choice");
        installed.set(ctx, plugin.id);
      }
      await pollUntil({ label: "Owned cloud configuration plugin readiness", deadlineAt: ctx.observationDeadlineAt!,
        load: () => read<PluginRecord>(`/api/plugins/${plugin!.id}`),
        accept: row => row.id === plugin!.id && row.pluginKey === pluginKey && row.status === "ready",
        reject: row => row.status === "error" ? "Owned cloud configuration plugin failed" : undefined });
      caps = await read<EnvironmentCapabilities>(route);
    }
    if (!supported(caps)) throw new Error("Public cloud configuration capability is unavailable");
    const driver = caps.sandboxProviders.daytona!;
    result.cloud = { provider: "daytona", pluginId: driver.pluginId!, pluginKey: driver.pluginKey!, status: "supported", supportsRunExecution: true };
  }
  await ctx.input.evidence("chat-catalog-negative-runtime-choices.json", result);
  return result;
}
export async function cleanupNegativeRuntimeChoices(ctx: ChatCatalogContext) {
  const id = installed.get(ctx); if (!id) return;
  const row = await ctx.input.api.get<PluginRecord>(`/api/plugins/${id}`);
  if (row.id !== id || row.pluginKey !== pluginKey || row.packagePath !== pluginRoot) throw new Error("Owned cloud configuration plugin identity changed before cleanup");
  await ctx.input.api.delete(`/api/plugins/${id}`, { allowNotFound: true }); installed.delete(ctx);
}
