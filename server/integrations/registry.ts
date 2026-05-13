import type { ToolMap } from "../llm.js";
export type { ToolMap };

export interface IntegrationModule {
  name: string;
  description: string;
  requiredEnv?: string[];
  createTools: (ctx: IntegrationContext) => Promise<ToolMap>;
}

export interface IntegrationContext {
  conversationId?: string;
}

const registry = new Map<string, IntegrationModule>();

export function registerIntegration(mod: IntegrationModule): void {
  registry.set(mod.name, mod);
}

export function listIntegrations(): IntegrationModule[] {
  return [...registry.values()];
}

export function getIntegration(name: string): IntegrationModule | undefined {
  return registry.get(name);
}

export async function loadIntegrations(): Promise<void> {
  const { registerComposioToolkits } = await import("./composio-loader.js");
  await registerComposioToolkits();
  const { buildCalendarIntegrationModule } = await import("../calendar.js");
  const calMod = buildCalendarIntegrationModule();
  if (calMod) registerIntegration(calMod);
  const { preloadSkills } = await import("../skills/loader.js");
  preloadSkills();
  const loaded = [...registry.keys()];
  console.log(
    `[integrations] loaded: ${loaded.join(", ") || "(none — connect a toolkit from the Debug UI's Connections tab)"}`,
  );
}

export async function refreshIntegrations(): Promise<void> {
  registry.clear();
  await loadIntegrations();
}

export function makeContext(conversationId?: string): IntegrationContext {
  return { conversationId };
}

export async function buildIntegrationTools(
  names: string[],
  conversationId?: string,
): Promise<ToolMap> {
  const ctx = makeContext(conversationId);
  const out: ToolMap = {};
  for (const name of names) {
    const mod = registry.get(name);
    if (!mod) {
      console.warn(`[integrations] unknown integration: ${name}`);
      continue;
    }
    try {
      const tools = await mod.createTools(ctx);
      Object.assign(out, tools);
    } catch (err) {
      console.error(`[integrations] failed to build ${name}`, err);
    }
  }
  return out;
}
