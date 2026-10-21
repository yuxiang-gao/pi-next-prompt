import { appendFileSync } from "node:fs";

/** Opt-in JSONL diagnostics. Callers pass metadata, never credentials or conversation text. */
export function debug(event: string, details: Record<string, unknown> = {}): void {
  const path = process.env.NEXT_PROMPT_DEBUG_FILE;
  if (!path) return;
  try {
    appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event, ...details }) + "\n", { mode: 0o600 });
  } catch {
    // A diagnostic destination must never change suggestion behavior or write into the TUI.
  }
}

/** Only expose offered labels and numeric scores from an untrusted remote answer. */
export function debugAnswer(value: unknown, offered: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { type: "invalid" };
  const answer = value as Record<string, unknown>;
  const probabilities = answer.probabilities;
  return {
    type: answer.type === "choice" ? "choice" : "invalid",
    choice: typeof answer.choice === "string" && offered.includes(answer.choice) ? answer.choice : "[unknown]",
    ...(typeof answer.confidence === "number" ? { confidence: answer.confidence } : { confidenceType: typeof answer.confidence }),
    probabilities: probabilities && typeof probabilities === "object" && !Array.isArray(probabilities)
      ? Object.fromEntries(offered.filter(choice => Object.hasOwn(probabilities, choice)).map(choice => {
        const probability = (probabilities as Record<string, unknown>)[choice];
        return [choice, typeof probability === "number" ? probability : null];
      })) : null,
  };
}
