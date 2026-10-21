import type { Settings } from "./config.ts";
import { resolveApiKey } from "./system-one.ts";

export function readiness(settings: Settings, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!settings.enabled) return "Suggestions are off. Run /next-prompt enable when ready; nothing is auto-sent.";
  if (settings.mode === "generate") return null;
  if (settings.mode === "classifier" && !settings.classes.length) return "Define classes with id, description and text in next-prompt.json, then /next-prompt reload. No built-in classes are supplied.";
  if (settings.classifier.mode !== "system-one") return "Configure the System One classifier connection, or choose /next-prompt mode generate.";
  try { resolveApiKey(settings.classifier.apiKey, env); }
  catch { return "The System One key is missing or invalid. Set the configured environment variable before starting Pi."; }
  return null;
}
