import type { Api, AssistantMessage, Model, Usage } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export const usage: Usage = { input: 100, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 112, cost: { input: 0.0001, output: 0.0001, cacheRead: 0, cacheWrite: 0, total: 0.0002 } };
export const main: Model<Api> = { id: "active", name: "Active fixture", provider: "test", api: "openai-completions", baseUrl: "https://invalid.test", reasoning: false, input: ["text"], contextWindow: 32_000, maxTokens: 2048, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
export const classifier = { mode: "system-one", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", apiKey: "test-key" } as const;
export function answer(text = "运行相关测试，并修复发现的问题。", stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "test", model: main.id, stopReason, usage, timestamp: 1 };
}
export function registry(overrides: Record<string, unknown> = {}): ModelRegistry {
  return { streamSimple: () => ({ result: async () => answer("<next>Compare options.</next>") }), ...overrides } as unknown as ModelRegistry;
}
export const testClasses = [{ id: "tests", description: "The conversation has unfinished testing or verification.", text: "运行相关测试，并修复发现的问题。" }];
export const conversation = [
  { role: "user" as const, content: "实现这个功能", timestamp: 1 },
  answer("功能已实现，但尚未运行测试。"),
];
