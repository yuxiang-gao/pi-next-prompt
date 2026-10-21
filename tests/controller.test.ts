import assert from "node:assert/strict";
import { test } from "node:test";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { SuggestionController } from "../src/controller.ts";
import { parseSettings } from "../src/config.ts";
import { answer, conversation, main, registry } from "./fixtures.ts";

function harness() {
  let resolve!: (value: string[] | null) => void;
  const work = new Promise<string[] | null>(done => { resolve = done; });
  const state = { editor: "", leaf: "one", idle: true, calls: 0, accepted: 0, widget: undefined as any, settings: parseSettings({ enabled: true }), input: undefined as any, signal: undefined as AbortSignal | undefined, notices: [] as string[] };
  const editor = { getText: () => state.editor, render: (_w: number) => [` ${CURSOR_MARKER}\u001b[7m \u001b[0m`] };
  const tui = { getFocusedComponent: () => editor, requestRender: () => {} };
  const ctx: any = { mode: "tui", model: main, modelRegistry: registry(), isIdle: () => state.idle, hasPendingMessages: () => false,
    ui: { getEditorText: () => state.editor, setEditorText: (text: string) => { state.editor = text; }, setWidget: (_k: string, factory: any) => { state.widget = typeof factory === "function" ? factory(tui) : undefined; }, notify: (text: string) => { state.notices.push(text); }, theme: { fg: (_c: string, text: string) => text } },
    sessionManager: { getSessionId: () => "session", getLeafId: () => state.leaf, buildSessionProjection: () => ({ messages: conversation }) } };
  let request: any;
  const controller = new SuggestionController({ getSettings: () => state.settings, run: input => { state.calls++; request = input; state.signal = input.signal; return work; }, onAccepted: () => { state.accepted++; } });
  const settle = () => { controller.begin(true); controller.finish("completed"); controller.settle({ aborted: false }, ctx); };
  return { controller, state, ctx, resolve, settle, editor, request: () => request };
}

test("typing hides and clearing restores even after acceptance without more requests", async () => {
  const h = harness(); h.settle(); h.resolve(["Compare options."]); await h.controller.pending;
  assert.equal(h.state.editor, ""); assert.deepEqual(h.state.widget.render(80), []);
  assert.equal(h.controller.handleInput("x", h.ctx), undefined); h.state.editor = "x";
  assert.equal(h.controller.handleInput("\t", h.ctx), undefined);
  h.state.editor = "";
  assert.deepEqual(h.controller.handleInput("\u001b[C", h.ctx), { consume: true });
  assert.equal(h.state.editor, "Compare options.");
  h.state.editor = "";
  assert.deepEqual(h.controller.handleInput("\t", h.ctx), { consume: true });
  assert.equal(h.state.calls, 1); assert.equal(h.state.accepted, 2);
});

test("multiple offers wrap selection and Escape dismisses permanently for that turn", async () => {
  const h = harness(); h.settle(); h.resolve(["First", "Second"]); await h.controller.pending;
  assert.deepEqual(h.controller.handleInput("\u001b[A", h.ctx), { consume: true });
  assert.deepEqual(h.controller.handleInput("\t", h.ctx), { consume: true }); assert.equal(h.state.editor, "Second");
  h.state.editor = ""; assert.deepEqual(h.controller.handleInput("\u001b", h.ctx), { consume: true });
  assert.equal(h.controller.handleInput("\t", h.ctx), undefined);
});

test("typing while work is pending allows a hidden result; context change rejects it", async () => {
  const h = harness(); h.settle(); h.controller.handleInput("x", h.ctx); h.state.editor = "draft";
  assert.equal(h.state.signal?.aborted, false);
  h.resolve(["Result"]); await h.controller.pending; assert.equal(h.state.editor, "draft");
  h.state.editor = ""; assert.deepEqual(h.controller.handleInput("\t", h.ctx), { consume: true });
  const stale = harness(); stale.settle(); stale.state.leaf = "two"; stale.resolve(["Stale"]); await stale.controller.pending;
  assert.equal(stale.controller.handleInput("\t", stale.ctx), undefined);
});

test("manual trigger respects selected mode and master/draft/busy guards", async () => {
  const h = harness(); h.state.settings = parseSettings({ enabled: true, mode: "classifier", autoSuggest: false });
  h.controller.settle({ aborted: false }, h.ctx); assert.equal(h.state.calls, 0);
  assert.equal(h.controller.trigger(h.ctx), true); h.resolve(null); await h.controller.pending;
  assert.equal(h.request().manual, true); assert.equal(h.request().settings.mode, "classifier");
  h.state.editor = "draft"; assert.equal(h.controller.trigger(h.ctx), false);
  h.state.editor = ""; h.state.idle = false; assert.equal(h.controller.trigger(h.ctx), false);
  h.state.idle = true; h.state.settings = parseSettings({}); assert.equal(h.controller.trigger(h.ctx), false);
});

test("cancel aborts work; dialogs only conceal; Enter never accepts", async () => {
  const pending = harness(); pending.settle(); pending.controller.cancel(); assert.equal(pending.state.signal?.aborted, true);
  pending.resolve(["Late"]); await pending.controller.pending; assert.equal(pending.controller.handleInput("\t", pending.ctx), undefined);
  const h = harness(); h.settle(); h.resolve(["Draft"]); await h.controller.pending;
  h.controller.setPromptActive(true); assert.equal(h.controller.handleInput("\t", h.ctx), undefined);
  h.controller.setPromptActive(false); assert.equal(h.controller.handleInput("\r", h.ctx), undefined); assert.equal(h.state.editor, "");
  assert.deepEqual(h.controller.handleInput("\t", h.ctx), { consume: true });
});

test("an aborted automatic run cannot retain a candidate for another settlement", () => {
  let calls = 0;
  const controller = new SuggestionController({ getSettings: () => parseSettings({ enabled: true }), run: async () => { calls++; return null; } });
  const ctx: any = { mode: "tui", model: main, modelRegistry: registry(), isIdle: () => true, hasPendingMessages: () => false, ui: { getEditorText: () => "", notify: () => {} }, sessionManager: { getSessionId: () => "one", getLeafId: () => "one", buildSessionProjection: () => ({ messages: conversation }) } };
  controller.begin(true); controller.capture(answer("Answer\n<next>Stale</next>")); controller.finish("completed");
  controller.settle({ aborted: true }, ctx);
  controller.settle({ aborted: false }, ctx);
  assert.equal(calls, 0);
});

test("same-leaf context edits invalidate a pending offer", async () => {
  let resolve!: (value: string[] | null) => void;
  let messages = [...conversation];
  const controller = new SuggestionController({ getSettings: () => parseSettings({ enabled: true }), run: () => new Promise(done => { resolve = done; }) });
  const ctx: any = { mode: "tui", model: main, modelRegistry: registry(), isIdle: () => true, hasPendingMessages: () => false, ui: { getEditorText: () => "", notify: () => {}, setWidget: () => { throw Error("must not offer stale content"); } }, sessionManager: { getSessionId: () => "one", getLeafId: () => "one", buildSessionProjection: () => ({ messages }) } };
  controller.begin(true); controller.finish("completed"); controller.settle({ aborted: false }, ctx);
  messages = [conversation[0], answer("Edited answer")]; resolve(["Stale"]); await controller.pending;
  assert.equal(controller.handleInput("\t", ctx), undefined);
});
