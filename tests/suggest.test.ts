import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareContext, suggest } from "../src/suggest.ts";
import { parseSettings } from "../src/config.ts";
import { answer, classifier, conversation, main, registry, testClasses } from "./fixtures.ts";

const decision = (choice: string, confidence = 0.95) => ({ stopReason: "stop" as const, answers: { next: { type: "choice" as const, choice, confidence, probabilities: { [choice]: confidence } } } });
const input = (extra: Record<string, any> = {}) => ({ settings: parseSettings({ enabled: true }), model: main, registry: registry(), context: prepareContext(conversation, 8000)!, drafts: ["Compare options."], manual: false, signal: new AbortController().signal, ...extra });

test("context is bounded, excludes private blocks, and anchors the latest user", () => {
  const messages = [{ role: "system", content: "SECRET" }, conversation[0], ...Array.from({ length: 20 }, () => answer("x".repeat(5000))), { role: "toolResult", content: "SECRET" }];
  const result = prepareContext(messages, 1000)!;
  assert.equal(result.messages[0].role, "user");
  assert.ok(result.messages.length <= 8);
  assert.ok(result.messages.reduce((sum, m) => sum + m.text.length, 0) <= 1000);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
  assert.equal(prepareContext([], 1000), null);
});

test("automatic generate returns tags without discovering or calling any model", async () => {
  const result = await suggest(input({ registry: registry({ getAvailable: () => { throw Error("no discovery"); }, streamSimple: () => { throw Error("no request"); } }) }));
  assert.deepEqual(result, ["Compare options."]);
});

test("manual generation uses the active model, no tools, tags, and one request", async () => {
  let call: any, calls = 0;
  const result = await suggest(input({ manual: true, settings: parseSettings({ enabled: true, suggestionCount: 2, generator: { mode: "model", provider: "unused", model: "unused" } }), registry: registry({ streamSimple: (model: any, context: any, options: any) => {
    calls++; call = { model, context, options }; return { result: async () => answer("<next>Use SQLite.</next>\n<next>Compare first.</next>") };
  } }) }));
  assert.deepEqual(result, ["Use SQLite.", "Compare first."]); assert.equal(calls, 1);
  assert.equal(call.model, main); assert.equal(call.context.tools, undefined);
  assert.match(call.context.systemPrompt, /<next>/); assert.equal(call.options.maxTokens, 512);
});

test("classifier uses configured meanings with no chat generation even manually", async () => {
  let criteria: any;
  const result = await suggest(input({ manual: true, settings: parseSettings({ enabled: true, mode: "classifier", classifier, classes: testClasses }), classify: async (_c: any, context: any) => { criteria = context.questions.next.criteria; return decision("tests"); }, registry: registry({ streamSimple: () => { throw Error("no generation"); } }) }));
  assert.deepEqual(result, [testClasses[0].text]); assert.equal(criteria.tests, testClasses[0].description); assert.equal(criteria.generate, undefined);
});

test("hybrid sees actual drafts and selects them without another generation call", async () => {
  let state: any;
  const result = await suggest(input({ settings: parseSettings({ enabled: true, mode: "hybrid", classifier }), classify: async (_c: any, context: any) => { state = context.state; return decision("generate"); }, registry: registry({ streamSimple: () => { throw Error("no generation"); } }) }));
  assert.deepEqual(result, ["Compare options."]); assert.deepEqual(state.suggestions, ["Compare options."]);
});

test("empty classifier/hybrid skip Jev and missing/uncertain decisions stay empty", async () => {
  for (const mode of ["classifier", "hybrid"] as const) {
    assert.equal(await suggest(input({ drafts: [], settings: parseSettings({ enabled: true, mode, classifier }), classify: async () => { throw Error("no request"); } })), null);
  }
  for (const choice of ["none", "unknown", "tests"]) {
    assert.equal(await suggest(input({ settings: parseSettings({ enabled: true, mode: "hybrid", classifier, classes: testClasses }), classify: async () => decision(choice, choice === "tests" ? 0.5 : 0.95) })), null);
  }
});

test("multiple classes are removed before the next selection and duplicates are omitted", async () => {
  const classes = [...testClasses, { id: "compare", description: "Compare alternatives", text: "Compare first." }];
  const choices = ["tests", "compare"]; const offered: string[][] = [];
  const result = await suggest(input({ settings: parseSettings({ enabled: true, mode: "classifier", classifier, classes, suggestionCount: 3 }), classify: async (_c: any, context: any) => { offered.push(Object.keys(context.questions.next.criteria)); return decision(choices.shift()!); } }));
  assert.deepEqual(result, classes.map(c => c.text)); assert.deepEqual(offered, [["none", "tests", "compare"], ["none", "compare"]]);
});

test("manual malformed/unfinished output is discarded and deadline bounds an uncooperative call", async () => {
  for (const response of [answer("plain text"), answer("<next>Run tests.</next>", "length"), answer("<next>/login</next>")]) {
    assert.equal(await suggest(input({ manual: true, registry: registry({ streamSimple: () => ({ result: async () => response }) }) })), null);
  }
  await assert.rejects(suggest(input({ manual: true, settings: parseSettings({ enabled: true, timeoutMs: 100 }), registry: registry({ streamSimple: () => ({ result: () => new Promise(() => {}) }) }) })), /timed out/);
});

test("disabled/pre-aborted requests do not call a model", async () => {
  const controller = new AbortController(); controller.abort();
  for (const extra of [{ settings: parseSettings({}) }, { signal: controller.signal }]) assert.equal(await suggest(input({ manual: true, ...extra })), null);
});

test("hybrid selects a configured reply and then fills remaining slots from actual tags", async () => {
  const choices = ["tests", "generate"];
  const result = await suggest({ settings: parseSettings({ enabled: true, mode: "hybrid", classifier, classes: testClasses, suggestionCount: 3 }), model: main, registry: registry({ streamSimple: () => { throw Error("no extra generation"); } }), context: prepareContext(conversation, 8000)!, drafts: [testClasses[0].text, "Compare first.", "Use SQLite."], signal: new AbortController().signal, classify: async () => {
    const choice = choices.shift()!; return { stopReason: "stop", answers: { next: { type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } } } };
  } });
  assert.deepEqual(result, [testClasses[0].text, "Compare first.", "Use SQLite."]);
});
