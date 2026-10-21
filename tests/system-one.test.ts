import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as systemOne from "../src/system-one.ts";
const api = systemOne as Record<string, any>;
const config = { mode: "system-one", endpoint: "https://api.typesafe.ai/v1/systemone", model: "jev-latest", apiKey: "test-key" };
const question = { state: { messages: [{ role: "user", text: "Run tests" }] }, questions: { next: { type: "choice", instructions: "Choose next step", criteria: { none: "No next step", tests: "Run tests" } } } };
const response = { model: "jev-latest", answers: { next: { type: "choice", choice: "tests", confidence: 0.95, probabilities: { tests: 0.95, none: 0.05 } } }, usage: { input_tokens: 100, output_tokens: 5 } };

test("resolves env references only at request time, without running commands", () => {
  assert.equal(api.resolveApiKey("$TEST_KEY", { TEST_KEY: "resolved" }), "resolved");
  assert.equal(api.resolveApiKey("${TEST_KEY}", { TEST_KEY: "resolved" }), "resolved");
  assert.equal(api.resolveApiKey("literal", {}), "literal");
  assert.throws(() => api.resolveApiKey("$MISSING", {}), /not set/);
  assert.throws(() => api.resolveApiKey("$TEST_KEY", { TEST_KEY: "bad\nheader" }));
});

test("posts TypeSafe wire format with Bearer key and native usage, independent of Pi registry", async () => {
  let request: any;
  const result = await api.classifySystemOne(config, question, new AbortController().signal, {
    fetch: async (url: string, init: RequestInit) => { request = { url, ...init }; return Response.json(response); }, env: {},
  });
  assert.equal(request.url, config.endpoint);
  assert.equal(request.method, "POST");
  assert.equal(request.redirect, "error");
  assert.equal(request.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(request.body), { model: config.model, ...question });
  assert.equal(result.answers.next.choice, "tests");
  assert.equal(result.usage.input, 100);
  assert.equal(result.usage.output, 5);
  assert.equal(result.usage.cost, undefined);
});

test("fails closed on HTTP or malformed answers without leaking key/body", async () => {
  const secret = "secret-key-do-not-log";
  for (const body of [new Response(secret, { status: 401 }), Response.json({}), Response.json({ ...response, answers: { next: { type: "choice", choice: "tests", confidence: "high", probabilities: {} } } }), new Response("not json")]) {
    await assert.rejects(api.classifySystemOne({ ...config, apiKey: secret }, question, new AbortController().signal, { fetch: async () => body }), (error: Error) => !error.message.includes(secret));
  }
});

test("missing env key and pre-aborted requests never call fetch", async () => {
  let calls = 0;
  const deps = { env: {}, fetch: async () => { calls++; return Response.json(response); } };
  await assert.rejects(api.classifySystemOne({ ...config, apiKey: "$MISSING" }, question, new AbortController().signal, deps));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.classifySystemOne(config, question, controller.signal, deps));
  assert.equal(calls, 0);
});

test("oversized responses are rejected before JSON parsing", async () => {
  await assert.rejects(api.classifySystemOne(config, question, new AbortController().signal, { fetch: async () => new Response("x".repeat(65537)) }), /exceeds limit/);
});

test("real redirect responses never forward credentials to a second request", async () => {
  let targetCalls = 0;
  const server = createServer((req, res) => {
    if (req.url === "/target") { targetCalls++; res.end(JSON.stringify(response)); }
    else { res.writeHead(307, { Location: "/target" }); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    await assert.rejects(api.classifySystemOne({ ...config, endpoint: "http://127.0.0.1:" + port + "/redirect" }, question, new AbortController().signal));
    assert.equal(targetCalls, 0);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("loopback integration uses a real HTTP server", async () => {
  let received: any;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    received = { auth: req.headers.authorization, url: req.url, body: JSON.parse(body) };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(response));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const result = await api.classifySystemOne({ ...config, endpoint: `http://127.0.0.1:${port}/v1/systemone` }, question, new AbortController().signal);
    assert.equal(result.answers.next.choice, "tests");
    assert.equal(received.auth, "Bearer test-key");
    assert.equal(received.url, "/v1/systemone");
    assert.equal(received.body.model, "jev-latest");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
