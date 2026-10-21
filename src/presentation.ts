import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, renderFakeCursor, truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

const SOFT_CURSOR = "\x1b[7m \x1b[0m";
const FAKE_CURSOR = renderFakeCursor(" ");
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WIDGET = "next-prompt";
type Editor = { render(width: number): string[]; getText(): string };
type EditorTUI = TUI & { getFocusedComponent(): unknown };
export interface Offer { suggestions: string[]; selected: number }

/** Adapted from Spencer Boucher's pi-next-prompt; see THIRD_PARTY_NOTICES.md. */
export function ghostLine(line: string, text: string, width: number, dim: (text: string) => string): string | undefined {
  const soft = line.includes(FAKE_CURSOR) ? line.indexOf(FAKE_CURSOR) : line.indexOf(SOFT_CURSOR), hard = line.indexOf(CURSOR_MARKER);
  if (soft < 0 && hard < 0) return undefined;
  const [first, ...rest] = Array.from(graphemes.segment(text), part => part.segment);
  const body = soft >= 0 ? line.slice(0, soft) + renderFakeCursor(first ?? " ") + dim(rest.join("")) : line.slice(0, hard + CURSOR_MARKER.length) + dim(text);
  const clipped = truncateToWidth(body, Math.max(1, width - (line.match(/^ */u)?.[0].length ?? 0)), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** One render hook and one widget own presentation; neither changes editor text. */
export class Presentation {
  private tui: EditorTUI | undefined;
  private editor: Editor | undefined;
  private original: Editor["render"] | undefined;
  private hook: Editor["render"] | undefined;
  private own = false;
  private attached = false;
  private ui: ExtensionUIContext;
  private offer: () => Offer | undefined;
  constructor(ui: ExtensionUIContext, offer: () => Offer | undefined) { this.ui = ui; this.offer = offer; }

  private active(): Offer | undefined {
    if (!this.attached) return undefined;
    if (this.editor && this.tui?.getFocusedComponent() !== this.editor) return undefined;
    return this.ui.getEditorText() === "" ? this.offer() : undefined;
  }
  visible(): boolean { return Boolean(this.active()); }

  refresh(): void {
    if (!this.attached) {
      this.attached = true;
      this.ui.setWidget(WIDGET, tui => {
        this.tui = typeof (tui as Partial<EditorTUI>).getFocusedComponent === "function" ? tui as EditorTUI : undefined;
        return { render: width => this.renderWidget(width), invalidate: () => {} };
      }, { placement: "aboveEditor" });
    }
    this.attachEditor();
    this.tui?.requestRender();
  }

  private attachEditor(): void {
    if (!this.offer()) return;
    const focused = this.tui?.getFocusedComponent() as Partial<Editor> | null;
    if (!focused || typeof focused.getText !== "function" || typeof focused.render !== "function" || focused === this.editor) return;
    this.restore();
    const editor = focused as Editor, original = editor.render;
    this.editor = editor; this.original = original; this.own = Object.hasOwn(editor, "render");
    const hook = (width: number) => {
      const lines = original.call(editor, width);
      const offer = this.active();
      if (!offer || offer.suggestions.length !== 1 || editor.getText() !== "") return lines;
      const index = lines.findIndex(line => line.includes(CURSOR_MARKER) || line.includes(SOFT_CURSOR) || line.includes(FAKE_CURSOR));
      if (index < 0) return lines;
      const out = [...lines];
      out[index] = ghostLine(lines[index], offer.suggestions[0], width, text => this.ui.theme.fg("dim", text))!;
      return out;
    };
    this.hook = hook; editor.render = hook;
  }

  private renderWidget(width: number): string[] {
    this.attachEditor();
    const offer = this.active();
    if (!offer) return [];
    const { suggestions, selected } = offer;
    if (suggestions.length === 1) {
      const lines = this.original?.call(this.editor, width) ?? [];
      if (lines.some(line => line.includes(CURSOR_MARKER) || line.includes(SOFT_CURSOR) || line.includes(FAKE_CURSOR))) return [];
      return [truncateToWidth(this.ui.theme.fg("dim", suggestions[0]), width)];
    }
    return [truncateToWidth(this.ui.theme.fg("muted", `${selected + 1}/${suggestions.length} · ↑/↓ select · Tab/Right accept`), width), ...suggestions.map((text, index) => truncateToWidth(this.ui.theme.fg(index === selected ? "accent" : "muted", `${index === selected ? "›" : " "} ${text}`), width))];
  }

  private restore(): void {
    if (this.editor && this.editor.render === this.hook) {
      if (this.own) this.editor.render = this.original!;
      else delete (this.editor as Partial<Editor>).render;
    }
    this.editor = undefined; this.original = undefined; this.hook = undefined;
  }
  dispose(): void {
    this.restore();
    if (this.attached) this.ui.setWidget(WIDGET, undefined);
    this.attached = false; this.tui?.requestRender();
  }
}
