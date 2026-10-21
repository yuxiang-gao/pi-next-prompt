import type { ClassifierChoiceAnswer, ClassifierContext, Usage } from "@earendil-works/pi-ai";
import type { SystemOneConfig } from "./config.ts";
import { debug, debugAnswer } from "./debug.ts";

/** Raw HTTP usage has no price metadata; do not claim that zero means free. */
export type CallUsage = Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens"> & { cost?: Usage["cost"] };
export interface DecisionResult {
  stopReason: "stop";
  answers: { next: ClassifierChoiceAnswer };
  usage?: CallUsage;
}
interface Dependencies {
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}

export function resolveApiKey(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const match = /^\$(?:([A-Z_][A-Z0-9_]*)|\{([A-Z_][A-Z0-9_]*)\})$/iu.exec(value);
  const key = match ? env[match[1] ?? match[2]] : value;
  if (!key?.trim()) throw new Error("System One API key environment variable is not set");
  if (/[\u0000-\u001f\u007f]/u.test(key)) throw new Error("Invalid System One API key");
  return key.trim();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid System One response");
  return value as Record<string, unknown>;
}

/** TypeSafe-compatible POST /v1/systemone. No Pi classifier registration required. */
export async function classifySystemOne(config: SystemOneConfig, context: ClassifierContext, signal: AbortSignal, dependencies: Dependencies = {}): Promise<DecisionResult> {
  let stage = "authentication";
  const started = Date.now();
  try {
    signal.throwIfAborted();
    const key = resolveApiKey(config.apiKey, dependencies.env);
    stage = "transport";
    const response = await (dependencies.fetch ?? globalThis.fetch)(config.endpoint, {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: config.model, state: context.state, questions: context.questions }),
    });
    stage = "http";
    debug("jev-http", { status: response.status, elapsedMs: Date.now() - started });
    // Never include remote response bodies, headers, endpoint or credentials in errors.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`System One request failed (HTTP ${response.status})`);
    }
    stage = "body";
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty System One response");
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65_536) { await reader.cancel(); throw new Error("System One response exceeds limit"); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    signal.throwIfAborted();
    stage = "json";
    let raw: Record<string, unknown>;
    try { raw = record(JSON.parse(text)); }
    catch { throw new Error("Invalid System One JSON response"); }
    stage = "answer";
    const answer = record(record(raw.answers).next);
    const next = context.questions.next;
    debug("jev-response", { bytes, answer: debugAnswer(answer, next?.type === "choice" ? Object.keys(next.criteria) : []) });
    const probabilities = record(answer.probabilities);
    if (answer.type !== "choice" || typeof answer.choice !== "string" || typeof answer.confidence !== "number" ||
        !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
        Object.values(probabilities).some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) ||
        typeof probabilities[answer.choice] !== "number") throw new Error("Invalid System One decision");
    const result: DecisionResult = {
      stopReason: "stop", answers: { next: { type: "choice", choice: answer.choice, confidence: answer.confidence, probabilities: probabilities as Record<string, number> } },
    };
    stage = "usage";
    if (raw.usage !== undefined) {
      const usage = record(raw.usage);
      const input = usage.input_tokens, output = usage.output_tokens;
      if (typeof input !== "number" || typeof output !== "number" || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) throw new Error("Invalid System One usage");
      result.usage = { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output };
    }
    return result;
  } catch (error) {
    debug("jev-error", { stage, aborted: signal.aborted, elapsedMs: Date.now() - started });
    throw error;
  }
}
