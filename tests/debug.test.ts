import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseSettings } from "../src/config.ts";
import { SuggestionController } from "../src/controller.ts";
import { prepareContext, suggest } from "../src/suggest.ts";
import { classifySystemOne } from "../src/system-one.ts";
import { answer, classifier, conversation, main, registry, testClasses } from "./fixtures.ts";

async function withTrace(run: (path: string, rows: () => Record<string, any>[]) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "next-prompt-debug-"));
  const path = join(directory, "trace.jsonl");
  const previous = process.env.NEXT_PROMPT_DEBUG_FILE;
  process.env.NEXT_PROMPT_DEBUG_FILE = path;
  try {
    await run(path, () => readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PROMPT_DEBUG_FILE;
    else process.env.NEXT_PROMPT_DEBUG_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

const decision = (choice: string, confidence = 0.95, probability = confidence) => ({
  stopReason: "stop" as const,
  answers: { next: { type: "choice" as const, choice, confidence, probabilities: { [choice]: probability } } },
});
const context = () => prepareContext(conversation, 8000)!;
const input = () => ({
  settings: parseSettings({ enabled: true, mode: "hybrid", classifier, classes: testClasses }),
  model: main, registry: registry(), context: context(), drafts: ["Compare options."], signal: new AbortController().signal,
});
const question = {
  state: { messages: [{ role: "user", text: "PRIVATE CONVERSATION" }] },
  questions: { next: { type: "choice" as const, instructions: "Choose", criteria: { none: "Leave empty", tests: "Run tests" } } },
};

// These exercise the real routing/HTTP boundaries, rather than an injected logger.
test("debug records Jev decisions before confidence filtering without conversation text", async () => {
  await withTrace(async (_path, rows) => {
    for (const [choice, confidence, probability, reason] of [
      ["none", 0.95, 0.95, "none"],
      ["tests", 0.79, 0.95, "low-confidence"],
      ["tests", 0.95, 0.79, "low-probability"],
      ["tests", 0.95, 0.95, "accepted"],
    ] as const) {
      const output = await suggest({ ...input(), classify: async () => decision(choice, confidence, probability) });
      assert.equal(output !== null, reason === "accepted");
      const row = rows().findLast(row => row.event === "classifier-decision")!;
      assert.ok(row, "a classifier-decision trace should be written");
      assert.equal(row.reason, reason);
      assert.equal(row.answer.choice, choice);
      assert.equal(row.answer.confidence, confidence);
      assert.equal(row.answer.probabilities[choice], probability);
      assert.equal(row.threshold, 0.8);
      assert.deepEqual(row.offered, ["none", "tests", "generate"]);
      assert.equal(row.accepted, reason === "accepted");
      assert.ok(Number.isFinite(Date.parse(row.time)));
    }
    const trace = JSON.stringify(rows());
    assert.ok(!trace.includes("实现这个功能"));
    assert.ok(!trace.includes(classifier.apiKey));
    assert.ok(!trace.includes(classifier.endpoint));
  });
});

test("debug explains classifier requests skipped without a template", async () => {
  await withTrace(async (_path, rows) => {
    const request = input();
    request.settings = parseSettings({ enabled: true, mode: "classifier", classifier });
    assert.equal(await suggest({ ...request, classify: async () => { throw Error("must not call"); } }), null);
    assert.ok(rows().some(row => row.event === "suggest-skip" && row.reason === "no-classes"));
  });
});

test("debug captures HTTP status and malformed Jev answers without raw payloads", async () => {
  await withTrace(async (_path, rows) => {
    const config = { ...classifier, apiKey: "PRIVATE KEY" };
    for (const response of [
      new Response("PRIVATE RESPONSE", { status: 401 }),
      Response.json({ answers: { next: { type: "choice", choice: "PRIVATE KEY", confidence: "PRIVATE RESPONSE", probabilities: { "PRIVATE KEY": 1 } } } }),
      new Response("PRIVATE RESPONSE"),
    ]) {
      await assert.rejects(classifySystemOne(config, question, new AbortController().signal, { fetch: async () => response }));
    }
    assert.ok(rows().some(row => row.event === "jev-http" && row.status === 401));
    assert.deepEqual(rows().filter(row => row.event === "jev-error").map(row => row.stage), ["http", "answer", "json"]);
    const trace = JSON.stringify(rows());
    for (const secret of ["PRIVATE KEY", "PRIVATE RESPONSE", "PRIVATE CONVERSATION", classifier.endpoint]) assert.ok(!trace.includes(secret));
    if (process.platform !== "win32") assert.equal(statSync(process.env.NEXT_PROMPT_DEBUG_FILE!).mode & 0o777, 0o600);
  });
});

test("debug prints the Jev answer returned by the HTTP adapter", async () => {
  await withTrace(async (_path, rows) => {
    const result = await classifySystemOne(classifier, question, new AbortController().signal, {
      fetch: async () => Response.json({ answers: decision("tests").answers, usage: { input_tokens: 100, output_tokens: 5 } }),
    });
    const row = rows().find(row => row.event === "jev-response")!;
    assert.ok(row, "the Jev response should be recorded before validation");
    assert.deepEqual(row.answer, result.answers.next);
  });
});

test("debug explains manual generation rejection without storing generated text", async () => {
  await withTrace(async (_path, rows) => {
    const request = input(); request.settings = parseSettings({ enabled: true });
    assert.equal(await suggest({ ...request, manual: true, registry: registry({ streamSimple: () => ({ result: async () => answer("PRIVATE OUTPUT", "length") }) }) }), null);
    assert.ok(rows().some(row => row.event === "generator-result" && row.reason === "incomplete"));
    assert.ok(!JSON.stringify(rows()).includes("PRIVATE OUTPUT"));
  });
});

test("debug explains controller skips and selected-mode manual requests", async () => {
  await withTrace(async (_path, rows) => {
    let draft = "PRIVATE DRAFT";
    const controller = new SuggestionController({ getSettings: () => input().settings, run: async () => null });
    const ctx = {
      mode: "tui", model: main, modelRegistry: registry(), isIdle: () => true, hasPendingMessages: () => false,
      ui: { getEditorText: () => draft, notify: () => {}, setStatus: () => {} },
      sessionManager: { buildSessionProjection: () => ({ messages: conversation }), getSessionId: () => "session", getLeafId: () => "leaf" },
    } as unknown as ExtensionContext;
    assert.equal(controller.trigger(ctx), false);
    assert.ok(rows().some(row => row.event === "controller-skip" && row.reason === "draft"));
    draft = "";
    assert.equal(controller.trigger(ctx), true); await controller.pending;
    const start = rows().find(row => row.event === "controller-start")!;
    assert.equal(start.mode, "hybrid");
    assert.equal(start.manual, true);
    assert.ok(!JSON.stringify(rows()).includes("PRIVATE DRAFT"));
  });
});

test("debug distinguishes a classifier timeout from a completed decision", async () => {
  await withTrace(async (_path, rows) => {
    const request = input(); request.settings = { ...request.settings, timeoutMs: 100 };
    await assert.rejects(suggest({ ...request, classify: () => new Promise(() => {}) }), /timed out/);
    assert.ok(rows().some(row => row.event === "request-finish" && row.kind === "classifier" && row.status === "timeout"));
    assert.ok(!rows().some(row => row.event === "classifier-decision"));
  });
});

test("debug is opt-in and an unwritable destination cannot break suggestions", async () => {
  await withTrace(async (path) => {
    delete process.env.NEXT_PROMPT_DEBUG_FILE;
    assert.ok(await suggest({ ...input(), classify: async () => decision("tests") }));
    assert.equal(existsSync(path), false);
    process.env.NEXT_PROMPT_DEBUG_FILE = join(path, "missing-parent", "trace.jsonl");
    assert.ok(await suggest({ ...input(), classify: async () => decision("tests") }));
    assert.equal(existsSync(path), false);
  });
});
