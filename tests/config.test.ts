import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config.ts";
import { parseSettings } from "../src/config.ts";
import { testClasses } from "./fixtures.ts";
const api = config as Record<string, any>;

export const classifierConfig = { mode: "system-one", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", apiKey: "$TYPESAFE_API_KEY" };

test("settings ignore legacy generator selection and retain classifier connections", () => {
  const settings = api.parseSettings({ mode: "hybrid", generator: { mode: "model", provider: "proxy", model: "org/small-model" }, classifier: classifierConfig });
  assert.equal(settings.generator, undefined);
  assert.deepEqual(settings.classifier, classifierConfig);
  assert.equal(api.parseSettings({}).generator, undefined);
  assert.deepEqual(api.parseSettings({}).classifier, { mode: "off" });
});

test("configured replies share generated-draft validation and normalization", () => {
  const definition = { id: "compare", description: "Compare alternatives", text: "Compare   the options." };
  assert.equal(api.parseSettings({ classes: [definition] }).classes[0].text, "Compare the options.");
  for (const text of ["<next>Example</next>", "\u001b[31munsafe", "@/file", "!run", "/login", "x".repeat(601)]) {
    assert.throws(() => api.parseSettings({ classes: [{ ...definition, text }] }));
  }
});

test("automatic suggestions are enabled by default and can be disabled independently", () => {
  assert.equal(api.parseSettings({}).autoSuggest, true);
  assert.equal(api.parseSettings({ enabled: true, autoSuggest: false }).autoSuggest, false);
  for (const autoSuggest of [null, "false", 0]) assert.throws(() => api.parseSettings({ autoSuggest }));
});

test("invalid config fails closed instead of reverting to a billable default", () => {
  for (const value of [null, [], { enabled: null }, { classifier: { provider: "typesafe", id: "jev-latest" } }, { classifier: { ...classifierConfig, endpoint: "file:///secret" } }, { classifier: { ...classifierConfig, endpoint: "http://public.example/v1/systemone" } }, { classifier: { ...classifierConfig, endpoint: "https://name:password@example.com/v1/systemone" } }, { classifier: { ...classifierConfig, apiKey: "" } }, { confidence: null }, { timeoutMs: 0 }, { maxContextChars: 1000000 }]) assert.throws(() => api.parseSettings(value));
});

test("init writes a complete private template with disabled networking and literal env reference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "nested", "next-prompt.json");
    assert.deepEqual(await api.initSettings(path), { backupPath: null });
    const raw = JSON.parse(await readFile(path, "utf8"));
    assert.equal(raw.enabled, false);
    assert.equal(raw.mode, "generate");
    assert.equal(raw.generator, undefined);
    assert.deepEqual(raw.classifier, classifierConfig);
    assert.equal(raw.confidence, 0.8);
    assert.equal((await api.loadSettings(path)).enabled, false);
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(dir, "nested")), ["next-prompt.json"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("init backs up exact bytes including malformed config before resetting to a disabled template", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    const original = Buffer.from([123, 34, 255, 0, 10]);
    await writeFile(path, original);
    const result = await api.initSettings(path);
    assert.ok(result.backupPath.startsWith(path + ".backup-"));
    assert.deepEqual(await readFile(result.backupPath), original);
    assert.deepEqual(await api.loadSettings(path), api.initialSettings());
    if (process.platform !== "win32") assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
    assert.equal((await readdir(dir)).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("repeated init creates distinct backups and never overwrites prior backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    await writeFile(path, "original");
    const first = await api.initSettings(path);
    const second = await api.initSettings(path);
    assert.notEqual(first.backupPath, second.backupPath);
    assert.equal(await readFile(first.backupPath, "utf8"), "original");
    assert.deepEqual(JSON.parse(await readFile(second.backupPath, "utf8")), api.initialSettings());
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("concurrent in-process init calls serialize replacement and preserve original contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    await writeFile(path, "original");
    const results = await Promise.all([api.initSettings(path), api.initSettings(path)]);
    const backups = await Promise.all(results.map((r: any) => readFile(r.backupPath, "utf8")));
    assert.equal(backups.filter((s: string) => s === "original").length, 1);
    assert.equal((await api.loadSettings(path)).enabled, false);
    assert.equal((await readdir(dir)).length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("init fails without removing an unreadable/non-file target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    await mkdir(path); await writeFile(join(path, "keep"), "untouched");
    await assert.rejects(api.initSettings(path));
    assert.equal(await readFile(join(path, "keep"), "utf8"), "untouched");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("failed backup creation leaves original bytes unchanged", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  const path = join(dir, "next-prompt.json");
  try {
    await writeFile(path, "original private config"); await chmod(dir, 0o500);
    await assert.rejects(api.initSettings(path));
    assert.equal(await readFile(path, "utf8"), "original private config");
    assert.deepEqual(await readdir(dir), ["next-prompt.json"]);
  } finally { await chmod(dir, 0o700); await rm(dir, { recursive: true, force: true }); }
});

test("configuration updates read the latest file and preserve unrelated settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    await api.saveSettings(path, api.parseSettings({ enabled: true, classifier: classifierConfig, timeoutMs: 5000 }));
    await Promise.all([api.updateSettings(path, { mode: "hybrid" }), api.updateSettings(path, { enabled: false })]);
    const saved = await api.loadSettings(path);
    assert.equal(saved.mode, "hybrid"); assert.equal(saved.generator, undefined);
    assert.equal(saved.timeoutMs, 5000); assert.equal(saved.enabled, false); assert.deepEqual(saved.classifier, classifierConfig);
    await writeFile(path, "{broken");
    await assert.rejects(api.updateSettings(path, { mode: "generate" }));
    assert.equal(await readFile(path, "utf8"), "{broken");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("missing file disables requests and malformed file remains an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    assert.equal((await api.loadSettings(path)).enabled, false);
    await writeFile(path, "{broken");
    await assert.rejects(api.loadSettings(path));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("settings save preserves env reference without embedding any environment value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "next-config-"));
  try {
    const path = join(dir, "next-prompt.json");
    const settings = api.parseSettings({ classifier: classifierConfig });
    await api.saveSettings(path, settings);
    assert.deepEqual(await api.loadSettings(path), settings);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("classes/count have simple defaults and validate configured replies", () => {
  assert.deepEqual(parseSettings({}).classes, []); assert.equal(parseSettings({}).suggestionCount, 1);
  assert.deepEqual(parseSettings({ classes: testClasses, suggestionCount: 3 }).classes, testClasses);
  for (const suggestionCount of [0, 4, 1.5, null, "2"]) assert.throws(() => parseSettings({ suggestionCount }));
  for (const classes of [null, {}, [testClasses[0], testClasses[0]], [{ ...testClasses[0], id: "none" }], [{ ...testClasses[0], id: "generate" }], [{ ...testClasses[0], text: "/login" }], [{ ...testClasses[0], description: "" }]]) assert.throws(() => parseSettings({ classes }));
});
