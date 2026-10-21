import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { normalizeDraft } from "./tags.ts";

export interface ModelRef { provider: string; id: string }
export interface SuggestionClass {
  id: string;
  /** Meaning sent to Jev when choosing this class. */
  description: string;
  /** Draft offered when Jev selects this class. */
  text: string;
}
export interface SystemOneConfig {
  mode: "system-one";
  /** Complete POST URL, including /v1/systemone. */
  endpoint: string;
  model: string;
  /** Literal key, $ENV_NAME or ${ENV_NAME}. Never evaluated as a shell command. */
  apiKey: string;
}
export interface Settings {
  enabled: boolean;
  autoSuggest: boolean;
  mode: "generate" | "hybrid" | "classifier";
  classifier: { mode: "off" } | SystemOneConfig;
  classes: SuggestionClass[];
  suggestionCount: number;
  /** Minimum Jev confidence/probability; generation has no numeric threshold. */
  confidence: number;
  timeoutMs: number;
  maxContextChars: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration object");
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Invalid ${field}`);
  return value.trim();
}

export function parseSettings(value: unknown): Settings {
  const raw = object(value);
  const number = (key: string, fallback: number, min: number, max: number): number => {
    const n = raw[key] === undefined ? fallback : raw[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  const enabled = raw.enabled === undefined ? false : raw.enabled;
  if (typeof enabled !== "boolean") throw new Error("Invalid enabled flag");
  const autoSuggest = raw.autoSuggest === undefined ? true : raw.autoSuggest;
  if (typeof autoSuggest !== "boolean") throw new Error("Invalid autoSuggest flag");
  const mode = raw.mode === undefined ? "generate" : raw.mode;
  if (mode !== "generate" && mode !== "hybrid" && mode !== "classifier") throw new Error("Invalid suggestion mode");
  const c = object(raw.classifier === undefined ? { mode: "off" } : raw.classifier);
  let classifier: Settings["classifier"];
  if (c.mode === "off") classifier = { mode: "off" };
  else if (c.mode === "system-one") {
    const endpoint = string(c.endpoint, "classifier.endpoint");
    const url = new URL(endpoint);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash) throw new Error("Classifier endpoint must use HTTPS (HTTP is allowed only on loopback), without credentials or query parameters");
    const apiKey = string(c.apiKey, "classifier.apiKey");
    if (apiKey.startsWith("$") && !/^\$(?:[A-Z_][A-Z0-9_]*|\{[A-Z_][A-Z0-9_]*\})$/iu.test(apiKey)) throw new Error("Invalid environment variable reference");
    classifier = { mode: "system-one", endpoint, model: string(c.model, "classifier.model"), apiKey };
  } else throw new Error("Invalid classifier mode");
  const suggestionCount = number("suggestionCount", 1, 1, 3);
  if (!Number.isInteger(suggestionCount)) throw new Error("suggestionCount must be an integer from 1 to 3");
  const definitions = raw.classes === undefined ? [] : raw.classes;
  if (!Array.isArray(definitions)) throw new Error("classes must be an array");
  const ids = new Set<string>();
  const classes = definitions.map((value): SuggestionClass => {
    const definition = object(value);
    const id = string(definition.id, "classes.id");
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id) || ["none", "generate", "constructor", "prototype"].includes(id) || ids.has(id)) throw new Error("Class IDs must be unique and cannot use reserved names");
    ids.add(id);
    const text = normalizeDraft(string(definition.text, "classes.text"));
    if (!text) throw new Error("Invalid classes.text");
    return { id, description: string(definition.description, "classes.description"), text };
  });
  return {
    enabled, autoSuggest, mode, classifier, classes, suggestionCount,
    confidence: number("confidence", 0.8, 0.5, 1),
    timeoutMs: number("timeoutMs", 10_000, 100, 60_000),
    maxContextChars: number("maxContextChars", 8_000, 1_000, 16_000),
  };
}

/** Safe template: contains every connection field, but no requests until enabled. */
export function initialSettings(): Settings {
  return parseSettings({
    classifier: { mode: "system-one", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", apiKey: "$TYPESAFE_API_KEY" },
  });
}

export async function loadSettings(path: string): Promise<Settings> {
  try { return parseSettings(JSON.parse(await readFile(path, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseSettings({});
    throw error;
  }
}

/** Write complete private files atomically; exclusive publication never clobbers backups. */
async function atomicWrite(path: string, data: string | Buffer, exclusive = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
    if (exclusive) await link(temporary, path);
    else await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
const serialize = (settings: Settings) => `${JSON.stringify(parseSettings(settings), null, 2)}\n`;
export interface InitResult { backupPath: string | null }

/** Back up exact existing bytes (even invalid JSON) before publishing a fresh template. */
export async function initSettings(path: string): Promise<InitResult> {
  return withFileMutationQueue(path, async () => {
    let existing: Buffer | undefined;
    try { existing = await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    let backupPath: string | null = null;
    if (existing !== undefined) {
      backupPath = `${path}.backup-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`;
      // If preservation fails, do not replace the original configuration.
      await atomicWrite(backupPath, existing, true);
    }
    await atomicWrite(path, serialize(initialSettings()));
    return { backupPath };
  });
}

export async function saveSettings(path: string, settings: Settings): Promise<void> {
  const data = serialize(settings);
  await withFileMutationQueue(path, () => atomicWrite(path, data));
}

/** Read-modify-write against the latest file, serialized with init/save in this process. */
export async function updateSettings(path: string, patch: Partial<Pick<Settings, "enabled" | "mode">>): Promise<Settings> {
  return withFileMutationQueue(path, async () => {
    const next = parseSettings({ ...await loadSettings(path), ...patch });
    await atomicWrite(path, serialize(next));
    return next;
  });
}
