import { generateText, tool as aiTool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openai = createOpenAI({ baseURL: "https://opencode.ai/zen/v1", apiKey: "test" });
const model = openai("deepseek-v4-flash-free");

const myTool = aiTool({
  description: "test",
  parameters: z.object({ x: z.string() }),
  execute: async ({ x }: { x: string }) => `got ${x}`,
});

const test = async () => {
  const result = await generateText({
    model,
    system: "test",
    prompt: "say hello",
    maxSteps: 1,
    tools: { test_tool: myTool },
  });
  console.log("text:", result.text);
  console.log("usage:", JSON.stringify(result.usage));
};

console.log("types check OK");
