import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSettings, saveSettings } from "../src/config.ts";

const hasExpect = process.platform !== "win32" && spawnSync("expect", ["-v"], { stdio: "ignore" }).status === 0;
for (const scenario of [
  { mode: "generate", key: "tab", count: 1, manual: false },
  { mode: "generate", key: "right", count: 1, manual: false, fullscreen: true },
  { mode: "generate", key: "restore", count: 1, manual: false },
  { mode: "generate", key: "tab", count: 2, manual: false },
  { mode: "generate", key: "tab", count: 1, manual: true },
  { mode: "hybrid", key: "tab", count: 1, manual: false },
  { mode: "classifier", key: "tab", count: 1, manual: false },
] as const) {
  test(`Pi terminal: ${scenario.mode}, ${scenario.manual ? "manual" : "auto"}, ${scenario.key}, count ${scenario.count}`, { skip: !hasExpect, timeout: 20_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "next-ghost-tui-"));
    const requests: any[] = [];
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk; requests.push(JSON.parse(body));
      const choice = scenario.mode === "classifier" ? "custom" : "generate";
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ answers: { next: { type: "choice", choice, confidence: 0.95, probabilities: { [choice]: 0.95 } } } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      await writeFile(join(dir, "settings.json"), JSON.stringify({ showHardwareCursor: "fullscreen" in scenario }));
      const path = join(dir, "next-prompt.json"), resultPath = join(dir, "result.json"), debugPath = join(dir, "trace.jsonl");
      await saveSettings(path, parseSettings({ enabled: true, autoSuggest: !scenario.manual, mode: scenario.mode, suggestionCount: scenario.count, classes: scenario.mode === "classifier" ? [{ id: "custom", description: "The user wants the relevant tests run.", text: "运行相关测试，并修复发现的问题。" }] : [], classifier: { mode: "system-one", endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/systemone`, model: "fixture", apiKey: "fixture" } }));
      const piRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
      const project = fileURLToPath(new URL("..", import.meta.url));
      const args = [join(project, "tests/tui-runner.exp"), process.execPath, join(piRoot, "bundle/cli.js"), "--offline", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--no-session", "--no-tools", "--no-approve", "--extension", join(project, "tests/tui-provider.ts"), "--extension", join(project, "src/extension.ts"), "--model", "next-prompt-smoke/active", "--tui-mode", "fullscreen" in scenario ? "fullscreen" : "regular", "实现功能"];
      let output = "";
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn("expect", args, { cwd: dir, env: { ...process.env, TERM: "xterm-256color", PI_OFFLINE: "1", PI_CODING_AGENT_DIR: dir, NEXT_PROMPT_SMOKE_RESULT: resultPath, NEXT_PROMPT_SMOKE_COUNT: String(scenario.count), NEXT_PROMPT_SMOKE_KEY: scenario.key, NEXT_PROMPT_SMOKE_MANUAL: scenario.manual ? "1" : "0", NEXT_PROMPT_DEBUG_FILE: debugPath }, stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error("TUI timed out: " + output.slice(-3000))); }, 15_000);
        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); }); child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.on("error", error => { clearTimeout(timer); reject(error); }); child.on("exit", code => { clearTimeout(timer); resolve(code); });
      });
      assert.equal(code, 0, output.slice(-5000));
      const result = JSON.parse(await readFile(resultPath, "utf8"));
      assert.equal(result.editor, scenario.count === 2 ? "先比较可选方案。" : "运行相关测试，并修复发现的问题。");
      assert.equal(result.calls.length, scenario.manual ? 2 : 1); assert.ok(result.calls.every((model: string) => model === "active"));
      assert.ok(!JSON.stringify(result.messages.filter((message: any) => message.role === "assistant")).includes("<next>"));
      assert.equal(requests.length, scenario.mode === "generate" ? 0 : 1);
      if (scenario.mode === "hybrid") assert.deepEqual(requests[0].state.suggestions, ["运行相关测试，并修复发现的问题。"]);
      assert.equal(result.editorBeforeAcceptance, "");
      if (scenario.count === 1) {
        assert.ok(!output.includes("Tab to accept"));
        const rendered = stripVTControlCharacters(result.emptyRender.join("\n")).replace(/\u001b_pi:[^\u0007]*\u0007/gu, "");
        assert.ok(rendered.includes("运行相关测试，并修复发现的问题。"), "The empty editor's own render contains the inline suggestion");
        assert.match(result.emptyRender.join("\n"), /\u001b\[2m/);
      }
      if (scenario.key === "restore") assert.ok(output.includes("x"));
      assert.match(await readFile(debugPath, "utf8"), /preview-accepted/);
    } finally {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true });
    }
  });
}
