import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initSettings, parseSettings, updateSettings, type Settings } from "./config.ts";
import { SuggestionController } from "./controller.ts";
import { readiness } from "./onboarding.ts";
import { debug } from "./debug.ts";
import { SECTION, instruction } from "./tags.ts";
import type { CallEvent } from "./suggest.ts";

export function registerNextPrompt(pi: ExtensionAPI, configPath: string): void {
  let settings = parseSettings({}), invalid = false, welcome = false, migrated = false, configuring = false, generation = 0;
  let unsubscribe: (() => void) | undefined;
  let offered = 0, accepted = 0;
  const stats = { classifier: { calls: 0, failed: 0, input: 0, output: 0 }, generator: { calls: 0, failed: 0, input: 0, output: 0 } };
  const observe = (event: CallEvent) => {
    const row = stats[event.kind];
    if (event.phase === "start") row.calls++;
    else { if (event.status !== "stop") row.failed++; row.input += event.usage?.input ?? 0; row.output += event.usage?.output ?? 0; }
  };
  const controller = new SuggestionController({ getSettings: () => settings, observe, onOffered: () => { offered++; }, onAccepted: () => { accepted++; } });
  const guide = () => invalid ? "Invalid configuration. Fix JSON and run /next-prompt reload; the existing file was left unchanged." : readiness(settings);
  const reload = async (ctx: ExtensionContext) => {
    const mine = ++generation;
    controller.cancel(); settings = parseSettings({}); invalid = false;
    try {
      const raw = JSON.parse(await readFile(configPath, "utf8"));
      if (mine !== generation) return;
      settings = parseSettings(raw);
      if (raw.generator !== undefined && !migrated && ctx.mode === "tui") {
        migrated = true;
        ctx.ui.notify("The legacy generator setting is ignored. Suggestions use the active Pi model; saved config updates remove that obsolete field.", "info");
      }
    } catch (error) {
      if (mine === generation && (error as NodeJS.ErrnoException).code !== "ENOENT") { invalid = true; settings = parseSettings({}); }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    unsubscribe?.(); unsubscribe = undefined;
    const loading = reload(ctx);
    const mine = generation;
    await loading;
    if (mine !== generation) return;
    if (ctx.mode === "tui") {
      unsubscribe = ctx.ui.onTerminalInput(data => controller.handleInput(data, ctx));
      if (!welcome) { welcome = true; const hint = guide(); if (hint) ctx.ui.notify(hint, "info"); }
    }
  });
  pi.on("before_agent_start", (event, ctx) => {
    const inject = ctx.mode === "tui" && settings.enabled && settings.autoSuggest && settings.mode !== "classifier" && event.messageType === "user";
    controller.begin(inject);
    if (inject) event.systemPromptOptions.sections[SECTION] = instruction(settings.suggestionCount);
    else delete event.systemPromptOptions.sections[SECTION];
  });
  pi.on("message_end", event => {
    if (event.message.role !== "assistant") return;
    const message = controller.capture(event.message);
    return message ? { message } : undefined;
  });
  pi.on("agent_before_settle", event => { controller.finish(event.outcome); });
  pi.on("agent_settled", (event, ctx) => { if (!configuring) controller.settle(event, ctx); });
  const invalidate = () => { generation++; controller.cancel(); };
  pi.on("input", invalidate);
  pi.on("model_select", invalidate);
  pi.on("session_before_switch", invalidate);
  pi.on("session_before_tree", invalidate);
  pi.on("session_before_fork", invalidate);
  pi.on("session_before_compact", invalidate);
  pi.on("session_tree", invalidate);
  pi.on("session_compact", invalidate);
  pi.on("ui_prompt_start", () => { controller.setPromptActive(true); });
  pi.on("ui_prompt_end", () => { controller.setPromptActive(false); });
  pi.on("session_shutdown", () => { generation++; configuring = false; controller.cancel(); unsubscribe?.(); unsubscribe = undefined; });

  const commands = ["suggest", "enable", "disable", "mode", "init", "reload", "status"];
  pi.registerCommand("next-prompt", {
    description: "Next-message suggestions: suggest, enable, disable, mode, init, reload, status",
    getArgumentCompletions: prefix => (prefix.startsWith("mode ") ? ["generate", "hybrid", "classifier"].map(mode => `mode ${mode}`) : commands).filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui" || configuring) return;
      const [action = "status", ...rest] = args.trim().split(/\s+/u).filter(Boolean);
      const argument = rest.join(" ");
      if (action === "status") {
        ctx.ui.notify([`next-prompt: ${settings.enabled ? "on" : "off"} / ${settings.mode}; automatic ${settings.autoSuggest ? "on" : "off"}`,
          `Up to ${settings.suggestionCount} drafts; ${settings.classes.length} configured classes; ${offered} offers, ${accepted} acceptances`,
          ...(["generator", "classifier"] as const).map(kind => { const row = stats[kind]; return `${kind === "generator" ? "manual generation" : "Jev"}: ${row.calls} calls, ${row.failed} unsuccessful, reported input/output ${row.input}/${row.output}`; }), guide() ?? "Tab/Right accepts; typing hides; clearing restores."].join("\n"), "info");
        return;
      }
      if (action === "model") { ctx.ui.notify("Suggestions now use the active Pi model. Change it with /model; separate generator selection has been removed.", "info"); return; }
      if (!commands.includes(action)) { ctx.ui.notify("/next-prompt suggest | enable | disable | mode [generate|hybrid|classifier] | init | reload | status", "info"); return; }
      if (argument && action !== "mode") { ctx.ui.notify("This command takes no arguments.", "warning"); return; }
      if (action === "suggest") {
        if (settings.mode === "classifier" && !settings.classes.length) { ctx.ui.notify(readiness(settings)!, "info"); debug("suggest-skip", { reason: "no-classes" }); return; }
        controller.trigger(ctx); return;
      }
      configuring = true; const mine = generation;
      try {
        if (action === "mode") {
          const choices: Settings["mode"][] = ["generate", "hybrid", "classifier"];
          const choice = argument || await ctx.ui.select("Suggestion mode", choices);
          if (!choice || mine !== generation) return;
          if (!choices.includes(choice as Settings["mode"])) { ctx.ui.notify("Choose generate, hybrid or classifier.", "warning"); return; }
          controller.cancel(); settings = await updateSettings(configPath, { mode: choice as Settings["mode"] }); invalid = false;
        } else if (action === "enable" || action === "disable") {
          controller.cancel(); settings = await updateSettings(configPath, { enabled: action === "enable" }); invalid = false;
        } else if (action === "init") {
          controller.cancel(); const result = await initSettings(configPath); await reload(ctx);
          if (result.backupPath) ctx.ui.notify(`Previous configuration backup: ${result.backupPath.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")}`, "info");
        } else await reload(ctx);
        ctx.ui.notify(guide() ?? "Saved and ready. Finish a turn or run /next-prompt suggest; Tab/Right accepts, never auto-sent.", "info");
      } catch { ctx.ui.notify("Unable to update configuration. Check JSON and file permissions; init backs up an existing file before resetting it.", "error"); }
      finally { configuring = false; }
    },
  });
}

export default function nextPrompt(pi: ExtensionAPI): void { registerNextPrompt(pi, join(getAgentDir(), "next-prompt.json")); }
