/** Local terminal fixture: no cloud credentials or paid requests. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
  const calls: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let editorBeforeAcceptance: string | undefined;
  let emptyRender: string[] = [];
  let captureRender: ((width: number) => string[]) | undefined;
  const suggestions = ["运行相关测试，并修复发现的问题。", "先比较可选方案。"];
  pi.registerProvider("next-prompt-smoke", {
    api: "next-prompt-smoke-api", baseUrl: "https://invalid.test", apiKey: "fixture",
    models: [{ id: "active", name: "Active fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 2048, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      calls.push(model.id);
      const system = context.messages.filter(message => message.role === "system").map(message => (typeof message.content === "string" ? message.content : "") + "\n" + Object.values(message.sections ?? {}).join("\n")).join("\n");
      const manual = system.includes("suggestion-only");
      const count = Number(process.env.NEXT_PROMPT_SMOKE_COUNT ?? 1);
      const tags = suggestions.slice(0, count).map(text => `<next>${text}</next>`).join("\n");
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], stopReason: "pending", timestamp: Date.now(), usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        message.content = [{ type: "text", text: manual ? tags : "功能已经实现。" + (system.includes("<next>") ? `\n${tags}` : "") }];
        message.stopReason = "stop"; stream.push({ type: "done", reason: "stop", message }); stream.end();
      });
      return stream;
    },
  });
  pi.on("session_start", (_event, ctx) => {
    const unsubscribe = ctx.ui.onTerminalInput(data => {
      if (data === "\t" || data === "\u001b[C") {
        editorBeforeAcceptance = ctx.ui.getEditorText();
        emptyRender = captureRender?.(80) ?? [];
      }
      return undefined;
    });
    ctx.ui.setWidget("smoke-probe", tui => {
      captureRender = width => {
        const focused = (tui as unknown as { getFocusedComponent(): { render(width: number): string[] } | null }).getFocusedComponent();
        return focused?.render(width) ?? [];
      };
      return { render: () => [], invalidate: () => {} };
    });
    timer = setInterval(() => {
      const editor = ctx.ui.getEditorText();
      const expected = process.env.NEXT_PROMPT_SMOKE_COUNT === "2" ? suggestions[1] : suggestions[0];
      if (editor !== expected) return;
      const messages = ctx.sessionManager.buildSessionProjection().messages;
      writeFileSync(process.env.NEXT_PROMPT_SMOKE_RESULT!, JSON.stringify({ editor, editorBeforeAcceptance, emptyRender, calls, model: ctx.model?.id, messages, config: JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!, "next-prompt.json"), "utf8")) }));
      clearInterval(timer); unsubscribe(); ctx.shutdown();
    }, 25);
  });
  pi.on("session_shutdown", () => { clearInterval(timer); });
}
