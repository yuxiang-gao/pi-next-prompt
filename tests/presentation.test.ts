import assert from "node:assert/strict";
import { test } from "node:test";
import { CURSOR_MARKER, visibleWidth, renderFakeCursor } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
const stripAnsi = (text: string) => stripVTControlCharacters(text).replace(/\u001b_pi:[^\u0007]*\u0007/gu, "");
import { ghostLine, Presentation } from "../src/presentation.ts";

test("ghost preserves cursor markers, clips wide text and keeps terminal width", () => {
  for (const line of [` ${CURSOR_MARKER}\u001b[7m \u001b[0m      `, ` ${CURSOR_MARKER}${renderFakeCursor(" ")}      `, ` ${CURSOR_MARKER}       `]) {
    const rendered = ghostLine(line, "你好 é😀 lengthy", 12, text => `\u001b[2m${text}\u001b[22m`)!;
    assert.ok(rendered.includes(CURSOR_MARKER)); assert.equal(visibleWidth(rendered), 12);
    assert.ok(rendered.includes("\u001b[2m"));
  }
  const soft = ghostLine(CURSOR_MARKER + renderFakeCursor(" "), "é😀", 10, text => `\u001b[2m${text}\u001b[22m`)!;
  assert.ok(soft.includes(renderFakeCursor("é")), "The complete first grapheme is the software cursor cell");
  assert.equal(ghostLine("no cursor", "test", 10, text => text), undefined);
});

test("decorates existing editor, conceals on draft/focus changes, and restores only its own hook", () => {
  let text = "", focused: any, offer: any = { suggestions: ["Compare options."], selected: 0 };
  const editor = { getText: () => text, render: (_w: number) => [` ${CURSOR_MARKER}\u001b[7m \u001b[0m         `] };
  focused = editor; const original = editor.render;
  const tui = { getFocusedComponent: () => focused, requestRender: () => {}, terminal: { columns: 40 } };
  let widget: any;
  const ui: any = { getEditorText: () => text, theme: { fg: (_c: string, value: string) => value }, setWidget: (_k: string, factory: any) => { widget = typeof factory === "function" ? factory(tui, ui.theme) : undefined; } };
  const p = new Presentation(ui, () => offer);
  p.refresh(); assert.ok(stripAnsi(editor.render(40)[0]).includes("Compare options."));
  assert.equal(text, ""); assert.deepEqual(widget.render(40), []);
  text = "draft"; assert.ok(!editor.render(40)[0].includes("Compare options."));
  text = ""; assert.ok(stripAnsi(editor.render(40)[0]).includes("Compare options."));
  focused = {}; assert.equal(p.visible(), false); assert.ok(!editor.render(40)[0].includes("Compare options."));
  focused = editor; offer = { suggestions: ["A", "B"], selected: 1 }; p.refresh();
  assert.ok(widget.render(40).join("\n").includes("2/2"));
  p.dispose(); assert.equal(editor.render, original);
  const second = new Presentation(ui, () => offer); second.refresh();
  const later = (_w: number) => ["another extension"]; editor.render = later;
  second.dispose(); assert.equal(editor.render, later);
});

test("a later wrapper cannot reactivate a disposed ghost renderer", () => {
  let widget: any;
  const editor = { getText: () => "", render: (_width: number) => [CURSOR_MARKER + " "] };
  const tui = { getFocusedComponent: () => editor, requestRender: () => {} };
  const ui: any = { getEditorText: () => "", theme: { fg: (_c: string, text: string) => text }, setWidget: (_key: string, factory: any) => { widget = typeof factory === "function" ? factory(tui) : undefined; } };
  const presentation = new Presentation(ui, () => ({ suggestions: ["OLD GHOST"], selected: 0 }));
  presentation.refresh();
  const wrapped = editor.render; editor.render = width => wrapped(width);
  presentation.dispose();
  assert.equal(widget, undefined); assert.ok(!editor.render(80)[0].includes("OLD GHOST"));
});

test("multiple suggestion header respects narrow terminal width", () => {
  let widget: any;
  const ui: any = { getEditorText: () => "", theme: { fg: (_c: string, text: string) => text }, setWidget: (_k: string, factory: any) => { widget = typeof factory === "function" ? factory({ requestRender() {} }) : undefined; } };
  const p = new Presentation(ui, () => ({ suggestions: ["A", "B"], selected: 0 }));
  p.refresh();
  assert.ok(widget.render(10).every((line: string) => visibleWidth(line) <= 10)); p.dispose();
});
