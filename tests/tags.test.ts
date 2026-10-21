import assert from "node:assert/strict";
import { test } from "node:test";
import { extractNext, cleanMessage, instruction, normalizeDraft } from "../src/tags.ts";
import { answer } from "./fixtures.ts";

test("extracts only trailing metadata, deduplicates and caps suggestions", () => {
  assert.deepEqual(extractNext("Done.\n\n<next>Use SQLite.</next>\n<next>Use   SQLite.</next>\n<next>Compare first.</next>", 2), { text: "Done.", suggestions: ["Use SQLite.", "Compare first."], found: true });
  assert.deepEqual(extractNext("<next>First</next>\n<next>Second</next>", 1).suggestions, ["First"]);
});

test("preserves inline prose, quoted examples, fenced code and nontrailing tags", () => {
  for (const text of ["<next>example</next> is how tags look.", "Use <next>example</next> tags.", "> <next>Example</next>", "```xml\n<next>Example</next>\n```", "~~~xml\n<next>Example</next>\n~~~", "<next>Example</next>\nHere is the explanation."]) {
    assert.deepEqual(extractNext(text, 3), { text, suggestions: [], found: false });
  }
});

test("cleans invalid metadata without accepting commands, controls, partial or nested tags", () => {
  for (const tag of ["<next></next>", "<next>/login</next>", "<next>bad\u001b[31m</next>", "<next>unfinished", "<next>bad<next>nested</next></next>", `<next>${"x".repeat(601)}</next>`]) {
    const result = extractNext(`Answer\n${tag}`, 3);
    assert.equal(result.text, "Answer"); assert.deepEqual(result.suggestions, []);
  }
  assert.equal(normalizeDraft("!run"), null);
});

test("cleans split text blocks while retaining unrelated content and metadata", () => {
  const message: ReturnType<typeof answer> = { ...answer(), content: [{ type: "text", text: "Answer\n<ne" }, { type: "text", text: "xt>Compare first.</next>" }, { type: "thinking", thinking: "private" }] };
  const result = cleanMessage(message, 3);
  assert.deepEqual(result.suggestions, ["Compare first."]);
  assert.equal(result.message!.content[0].type, "text");
  assert.equal((result.message!.content[0] as any).text, "Answer");
  assert.equal((result.message!.content[1] as any).text, "");
  assert.deepEqual(result.message!.content[2], message.content[2]);
  assert.equal(result.message!.usage, message.usage);
  assert.equal(cleanMessage(answer("No tags"), 1).message, undefined);
});

test("instruction asks for configured count, replies to questions, and trailing tags", () => {
  assert.match(instruction(3), /3/); assert.match(instruction(3), /<next>/);
  assert.match(instruction(1), /questions/i);
});

test("indented Markdown code is not trailing suggestion metadata", () => {
  for (const text of ["Example:\n\n    <next>Keep as code</next>", "Example:\n\n\t<next>Keep as code</next>"]) {
    assert.deepEqual(extractNext(text, 1), { text, suggestions: [], found: false });
  }
});


test("a fake closing fence with prose does not make an example into metadata", () => {
  const text = "```xml\nExample\n``` not a closing fence\n<next>Still code</next>";
  assert.deepEqual(extractNext(text, 1), { text, suggestions: [], found: false });
});

test("manual/automatic parser handles CRLF and keeps answer blocks intact", () => {
  const message = answer("Answer\r\n\r\n<next>First</next>\r\n<next>Second</next>\r\n");
  const result = cleanMessage(message, 2);
  assert.equal((result.message!.content[0] as any).text, "Answer");
  assert.deepEqual(result.suggestions, ["First", "Second"]);
});
