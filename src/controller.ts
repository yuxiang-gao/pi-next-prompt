import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, TerminalInputHandler } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey } from "@earendil-works/pi-tui";
import type { Settings } from "./config.ts";
import { prepareContext, suggest, type CallEvent, type SuggestInput } from "./suggest.ts";
import { cleanMessage } from "./tags.ts";
import { Presentation, type Offer } from "./presentation.ts";
import { debug } from "./debug.ts";

interface Options {
  getSettings: () => Settings;
  run?: (input: SuggestInput) => Promise<string[] | null>;
  observe?: (event: CallEvent) => void;
  onOffered?: () => void;
  onAccepted?: () => void;
}

/** Conversation changes invalidate offers; editor changes only affect visibility. */
export class SuggestionController {
  private active: AbortController | undefined;
  private offer: Offer | undefined;
  private presentation: Presentation | undefined;
  private validOffer: (() => boolean) | undefined;
  private captured: string[] = [];
  private cleanup = false;
  private runRevision = -1;
  private promptDepth = 0;
  private outcome = "";
  private lastAttempt = "";
  private revision = 0;
  pending: Promise<void> = Promise.resolve();
  private options: Options;
  constructor(options: Options) { this.options = options; }

  cancel(): void {
    this.revision++;
    this.active?.abort(); this.active = undefined;
    this.offer = undefined; this.captured = []; this.validOffer = undefined;
    this.presentation?.dispose(); this.presentation = undefined;
    debug("offer-invalidated");
  }

  begin(cleanup: boolean): void { this.cancel(); this.runRevision = this.revision; this.cleanup = cleanup; this.outcome = ""; }
  capture(message: AssistantMessage): AssistantMessage | undefined {
    this.captured = [];
    if (!this.cleanup) return undefined;
    const result = cleanMessage(message, this.options.getSettings().suggestionCount);
    if (this.runRevision === this.revision) this.captured = result.suggestions;
    debug("tags-extracted", { count: result.suggestions.length, cleaned: Boolean(result.message) });
    return result.message;
  }
  finish(outcome: string): void { this.outcome = outcome; }
  setPromptActive(active: boolean): void {
    this.promptDepth = Math.max(0, this.promptDepth + (active ? 1 : -1));
    this.presentation?.refresh();
  }

  handleInput(data: string, ctx: ExtensionContext): ReturnType<TerminalInputHandler> {
    if (isKeyRelease(data)) return undefined;
    if (this.validOffer && !this.validOffer()) this.cancel();
    if (this.validOffer?.() && !this.promptDepth && this.presentation?.visible() && this.offer) {
      if (matchesKey(data, "tab") || matchesKey(data, "right")) {
        ctx.ui.setEditorText(this.offer.suggestions[this.offer.selected]);
        this.options.onAccepted?.(); debug("preview-accepted");
        this.presentation.refresh(); return { consume: true };
      }
      if (matchesKey(data, "escape")) {
        this.offer = undefined; this.presentation.dispose(); this.presentation = undefined;
        debug("preview-dismissed"); return { consume: true };
      }
      if (this.offer.suggestions.length > 1 && (matchesKey(data, "up") || matchesKey(data, "down"))) {
        this.offer.selected = (this.offer.selected + (matchesKey(data, "down") ? 1 : -1) + this.offer.suggestions.length) % this.offer.suggestions.length;
        this.presentation.refresh(); return { consume: true };
      }
    }
    const revision = this.revision;
    setTimeout(() => { if (revision === this.revision) this.presentation?.refresh(); }, 0);
    return undefined;
  }

  settle(event: { aborted: boolean }, ctx: ExtensionContext): void {
    if (event.aborted || this.outcome !== "completed") { this.cancel(); this.outcome = ""; return; }
    if (this.options.getSettings().autoSuggest && this.runRevision === this.revision) this.start(ctx, false);
  }
  trigger(ctx: ExtensionContext): boolean { return this.start(ctx, true); }

  private start(ctx: ExtensionContext, manual: boolean): boolean {
    const settings = this.options.getSettings();
    const unavailable = (reason: string, message: string) => { debug("controller-skip", { reason, manual }); if (manual) ctx.ui.notify(message, "info"); return false; };
    if (ctx.mode !== "tui" || !settings.enabled) return unavailable("disabled", "Enable suggestions with /next-prompt enable in an interactive terminal.");
    if (this.promptDepth || !ctx.isIdle() || ctx.hasPendingMessages()) return unavailable("busy", "Wait for the current task and dialogs to finish.");
    if (manual && ctx.ui.getEditorText() !== "") return unavailable("draft", "Keep the editor empty; your draft was left unchanged.");
    const messages = ctx.sessionManager.buildSessionProjection().messages;
    const final = messages.at(-1);
    if (!final || final.role !== "assistant" || final.stopReason !== "stop") return unavailable("no-successful-response", "Complete a successful conversation before requesting suggestions.");
    const context = prepareContext(messages, settings.maxContextChars);
    if (!context) return unavailable("no-context", "No conversation context is available.");
    const key = () => JSON.stringify([ctx.sessionManager.getSessionId(), ctx.sessionManager.getLeafId(), ctx.model?.provider, ctx.model?.id, this.options.getSettings(), prepareContext(ctx.sessionManager.buildSessionProjection().messages, settings.maxContextChars)?.messages]);
    const identity = key();
    if (!manual && this.lastAttempt === identity) return false;
    this.lastAttempt = identity;
    this.active?.abort(); this.presentation?.dispose(); this.presentation = undefined; this.offer = undefined;
    const active = new AbortController(); this.active = active;
    const valid = () => !active.signal.aborted && key() === identity && ctx.isIdle() && !ctx.hasPendingMessages();
    this.validOffer = valid;
    debug("controller-start", { manual, mode: settings.mode });
    this.pending = (async () => {
      try {
        const drafts = await (this.options.run ?? suggest)({ settings, context, drafts: this.captured, manual, registry: ctx.modelRegistry, model: ctx.model, signal: active.signal, observe: this.options.observe });
        if (this.active !== active || !valid()) { debug("controller-discard", { reason: "context-changed" }); return; }
        if (!drafts?.length) { debug("controller-empty"); if (manual) ctx.ui.notify("No useful suggestion found.", "info"); return; }
        this.offer = { suggestions: drafts, selected: 0 };
        this.presentation = new Presentation(ctx.ui, () => valid() && !this.promptDepth ? this.offer : undefined);
        this.presentation.refresh(); this.options.onOffered?.();
        debug("preview-offered", { count: drafts.length });
      } catch {
        if (!active.signal.aborted) ctx.ui.notify("Suggestion unavailable. Check /next-prompt status and the debug trace.", "warning");
      } finally { if (this.active === active) this.active = undefined; }
    })();
    return true;
  }
}
