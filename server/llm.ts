import { generateText, dynamicTool, stepCountIs, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";

export type ToolExecuteFn = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

export interface ToolDef {
  description: string;
  parameters: z.ZodTypeAny | Record<string, unknown>;
  execute: ToolExecuteFn;
}

export type ToolMap = Record<string, ToolDef>;

export interface GenerateOpts {
  system?: string;
  prompt?: string;
  tools?: ToolMap;
  maxSteps?: number;
  onStep?: (step: { text: string; toolCalls: Array<{ name: string; input: Record<string, unknown> }> }) => void;
}

export interface GenerateResult {
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

function createProvider() {
  const provider = process.env.LLM_PROVIDER || "opencode";
  const apiKey = process.env.OPENCODE_API_KEY || process.env.LLM_API_KEY;

  if (!apiKey) {
    console.warn("[llm] No API key set (OPENCODE_API_KEY or LLM_API_KEY)");
  }

  const model = process.env.LLM_MODEL || "deepseek-v4-flash-free";

  switch (provider) {
    case "opencode": {
      const deepseek = createDeepSeek({
        baseURL: "https://opencode.ai/zen/v1",
        apiKey,
      });
      return deepseek.chat(model);
    }
    case "deepseek": {
      const deepseek = createDeepSeek({
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
        apiKey,
      });
      return deepseek.chat(model);
    }
    case "openrouter": {
      const openai = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      });
      return openai.chat(model);
    }
    case "ollama": {
      const openai = createOpenAI({
        baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      return openai.chat(model);
    }
    default: {
      const deepseek = createDeepSeek({
        baseURL: "https://opencode.ai/zen/v1",
        apiKey,
      });
      return deepseek.chat(model);
    }
  }
}

function getModel() {
  return createProvider();
}

export function tool(
  description: string,
  parameters: z.ZodTypeAny | Record<string, unknown>,
  execute: ToolExecuteFn,
): ToolDef {
  return { description, parameters, execute };
}

function toInputSchema(params: z.ZodTypeAny | Record<string, unknown>) {
  if (params instanceof z.ZodType) return params;
  if (typeof params !== "object" || params === null) {
    return jsonSchema({ type: "object", properties: {} });
  }
  const hasZodValues = Object.values(params).some((v) => v instanceof z.ZodType);
  if (hasZodValues) {
    return z.object(params as Record<string, z.ZodTypeAny>);
  }
  return jsonSchema(
    Object.keys(params).length > 0
      ? (params as Record<string, unknown>)
      : { type: "object", properties: {} },
  );
}

export async function generateResponse(opts: GenerateOpts): Promise<GenerateResult> {
  const model = getModel();
  const sdkTools: Record<string, object> = {};

  if (opts.tools) {
    for (const [name, def] of Object.entries(opts.tools)) {
      sdkTools[name] = dynamicTool({
        description: def.description,
        inputSchema: toInputSchema(def.parameters),
        execute: async (args) => {
          const result = await def.execute(args as Record<string, unknown>);
          return result.content[0]?.text ?? "";
        },
      });
    }
  }

  const result = await generateText({
    model,
    system: opts.system,
    prompt: opts.prompt,
    tools: Object.keys(sdkTools).length > 0 ? (sdkTools as any) : undefined,
    stopWhen: stepCountIs(opts.maxSteps ?? 5),
    onStepFinish: (step: any) => {
      const text = step.text ?? "";
      const toolCalls = (step.toolCalls ?? []).map((tc: any) => ({
        name: tc.toolName,
        input: tc.input as Record<string, unknown>,
      }));
      opts.onStep?.({ text, toolCalls });
    },
  } as any);

  return {
    text: result.text ?? "",
    usage: {
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      costUsd: 0,
    },
  };
}
