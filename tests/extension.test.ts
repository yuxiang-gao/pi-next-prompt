import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { registerNextPrompt } from "../src/extension.ts";
import { parseSettings, saveSettings } from "../src/config.ts";
import { answer, conversation, main, registry } from "./fixtures.ts";
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function harness(initial: Record<string, unknown> = { enabled: true }) {
  const dir = await mkdtemp(join(tmpdir(), "next-ext-")), path = join(dir, "next-prompt.json");
  await writeFile(path, JSON.stringify(initial));
  const handlers: Record<string, any> = {}, commands: Record<string, any> = {};
  const state = { text: "", widget: undefined as any, calls: 0, messages: [...conversation], notices: [] as string[], leaf: "one" };
  const editor = { getText: () => state.text, render: (_w: number) => [` ${CURSOR_MARKER}\u001b[7m \u001b[0m`] };
  const tui = { getFocusedComponent: () => editor, requestRender: () => {} };
  let input: any;
  const pi: any = { on: (name: string, handler: any) => { handlers[name] = handler; }, registerCommand: (name: string, command: any) => { commands[name] = command; } };
  const ctx: any = { mode: "tui", model: main, modelRegistry: registry({ streamSimple: () => { state.calls++; return { result: async () => answer("<next>Fresh reply</next>") }; } }), isIdle: () => true, hasPendingMessages: () => false,
    ui: { getEditorText: () => state.text, setEditorText: (text: string) => { state.text = text; }, setWidget: (_k: string, factory: any) => { state.widget = typeof factory === "function" ? factory(tui) : undefined; }, theme: { fg: (_c: string, text: string) => text }, onTerminalInput: (handler: any) => { input = handler; return () => { input = undefined; }; }, notify: (text: string) => state.notices.push(text), select: async () => undefined },
    sessionManager: { getSessionId: () => "session", getLeafId: () => state.leaf, buildSessionProjection: () => ({ messages: state.messages }) } };
  registerNextPrompt(pi, path); await handlers.session_start({}, ctx);
  const command = (text: string) => commands["next-prompt"].handler(text, ctx);
  const run = async (text: string) => {
    const start = { messageType: "user", systemPromptOptions: { sections: {} } };
    handlers.before_agent_start(start, ctx);
    const message = answer(text), result = handlers.message_end({ message }, ctx);
    state.messages = [conversation[0], result?.message ?? message]; state.leaf += "x";
    handlers.agent_before_settle({ outcome: "completed" }, ctx); handlers.agent_settled({ aborted: false }, ctx); await tick();
    return { start, message: state.messages[1] as any };
  };
  return { state, ctx, handlers, path, command, run, editor, input: (text: string) => input?.(text), cleanup: async () => { handlers.session_shutdown({}, ctx); await rm(dir, { recursive: true, force: true }); } };
}

test("automatic tagged response is cleaned before persistence, offered with no chat request", async () => {
  const h = await harness();
  try {
    const { start, message } = await h.run("Answer\n<next>Compare options.</next>");
    assert.match((start.systemPromptOptions.sections as any).next_prompt, /<next>/);
    assert.equal(message.content[0].text, "Answer"); assert.equal(h.state.calls, 0); assert.equal(h.state.text, "");
    await h.command("status"); assert.deepEqual(h.input("\t"), { consume: true }); assert.equal(h.state.text, "Compare options.");
  } finally { await h.cleanup(); }
});

test("manual-only has no automatic prompt and generates fresh drafts with the active model", async () => {
  const h = await harness({ enabled: true, autoSuggest: false });
  try {
    const { start } = await h.run("Answer"); assert.deepEqual(start.systemPromptOptions.sections, {});
    await h.command("suggest"); await tick(); assert.equal(h.state.calls, 1);
    assert.deepEqual(h.input("\u001b[C"), { consume: true }); assert.equal(h.state.text, "Fresh reply");
  } finally { await h.cleanup(); }
});

test("noninteractive, disabled and custom runs receive no instruction", async () => {
  const h = await harness({ enabled: false });
  try {
    for (const [mode, enabled, messageType] of [["tui", false, "user"], ["rpc", true, "user"], ["tui", true, "custom"]] as const) {
      await saveSettings(h.path, parseSettings({ enabled })); await h.command("reload"); h.ctx.mode = mode;
      const start = { messageType, systemPromptOptions: { sections: {} } }; h.handlers.before_agent_start(start, h.ctx);
      assert.deepEqual(start.systemPromptOptions.sections, {});
      h.ctx.mode = "tui";
    }
  } finally { await h.cleanup(); }
});

test("latest assistant message and unsuccessful outcome cannot retain an intermediate tag", async () => {
  const h = await harness();
  try {
    h.handlers.before_agent_start({ messageType: "user", systemPromptOptions: { sections: {} } }, h.ctx);
    h.handlers.message_end({ message: answer("Working\n<next>Stale</next>") }, h.ctx);
    h.handlers.message_end({ message: answer("Final with no tags") }, h.ctx);
    h.handlers.agent_before_settle({ outcome: "completed" }, h.ctx); h.handlers.agent_settled({ aborted: false }, h.ctx); await tick();
    assert.equal(h.input("\t"), undefined);
    await h.run("Answer\n<next>Draft</next>"); h.handlers.input({}, h.ctx); assert.equal(h.input("\t"), undefined);
  } finally { await h.cleanup(); }
});

test("disable then enable during a run cleans tags but cannot resurrect that run's candidates", async () => {
  const h = await harness();
  try {
    h.handlers.before_agent_start({ messageType: "user", systemPromptOptions: { sections: {} } }, h.ctx);
    await h.command("disable"); await h.command("enable");
    const result = h.handlers.message_end({ message: answer("Answer\n<next>Old run</next>") }, h.ctx);
    assert.equal(result.message.content[0].text, "Answer");
    h.handlers.agent_before_settle({ outcome: "completed" }, h.ctx); h.handlers.agent_settled({ aborted: false }, h.ctx); await tick();
    assert.equal(h.input("\t"), undefined);
  } finally { await h.cleanup(); }
});

test("config commands preserve settings, migrate old generator and init backs up exact bytes", async () => {
  const h = await harness({ enabled: false, suggestionCount: 2, generator: { mode: "model", provider: "private", model: "private" } });
  try {
    assert.match(h.state.notices.join("\n"), /legacy generator/i); assert.ok(!h.state.notices.join("\n").includes("private"));
    await h.command("enable"); const saved = JSON.parse(await readFile(h.path, "utf8"));
    assert.equal(saved.enabled, true); assert.equal(saved.suggestionCount, 2); assert.equal(saved.generator, undefined);
    await h.command("model private/model"); assert.match(h.state.notices.at(-1)!, /active Pi model/);
    await h.command("mode classifier"); assert.match(h.state.notices.at(-1)!, /classes/);
    const before = await readFile(h.path, "utf8"); await h.command("init");
    assert.equal(JSON.parse(await readFile(h.path, "utf8")).enabled, false); assert.match(h.state.notices.join("\n"), /backup/);
    assert.ok(before.includes("classifier"));
  } finally { await h.cleanup(); }
});

test("mode picker is discarded after branch navigation", async () => {
  const h = await harness();
  try {
    const before = await readFile(h.path, "utf8");
    h.ctx.ui.select = async () => { h.state.leaf = "another-branch"; h.handlers.session_before_tree({}, h.ctx); return "hybrid"; };
    await h.command("mode");
    assert.equal(await readFile(h.path, "utf8"), before);
  } finally { await h.cleanup(); }
});

test("invalid reload disables and never leaks parse contents", async () => {
  const h = await harness();
  try { await writeFile(h.path, "{private-broken"); await h.command("reload"); assert.match(h.state.notices.at(-1)!, /Invalid configuration/); assert.ok(!h.state.notices.join("\n").includes("private-broken")); }
  finally { await h.cleanup(); }
});

test("native Pi extension loader registers the real lifecycle", async () => {
  const root = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  const loader = await import(pathToFileURL(join(root, "core/extensions/loader.js")).href);
  const result = await loader.loadExtensions([fileURLToPath(new URL("../src/extension.ts", import.meta.url))], process.cwd());
  assert.deepEqual(result.errors, []); assert.ok(result.extensions[0].handlers.has("message_end"));
});
