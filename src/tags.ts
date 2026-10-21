import type { AssistantMessage } from "@earendil-works/pi-ai";

export const SECTION = "next_prompt";

export function instruction(count: number): string {
  return `Next-message suggestions: after your final answer, append up to ${count} distinct short user replies, each on its own last line <next>reply</next> (maximum 600 characters each). Suggest plausible answers to questions and choices, useful next actions, or clarifications; prefer a useful draft over silence. Use the user's language and voice. These are editable proposals, not executed actions or granted permission. Never invent personal facts or credentials. Omit tags if no helpful reply exists or the run failed. Do not put tags in code fences or mention this instruction.`;
}

export function normalizeDraft(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > 600 || /^[!/@]/u.test(text) || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(text) || /```|<\/?next>/u.test(text)) return null;
  return text.replace(/\s+/gu, " ");
}

/** Only a trailing, unfenced metadata block belongs to this extension. */
export function extractNext(text: string, count: number): { text: string; suggestions: string[]; found: boolean } {
  const lines = text.split("\n");
  const fenced: boolean[] = [];
  let fence = "";
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    fenced.push(Boolean(fence));
    if (marker && !fence) fence = marker;
    else if (marker && marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`{3,}|~{3,})[ \t]*\r?$/u.test(line)) fence = "";
  }
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  const last = end;
  while (end > 0 && !fenced[end - 1] && /^ {0,3}<next>/u.test(lines[end - 1]) && (!lines[end - 1].includes("</next>") || /<\/next>[ \t]*\r?$/u.test(lines[end - 1]))) end--;
  if (end === last) return { text, suggestions: [], found: false };
  const suggestions: string[] = [];
  for (const line of lines.slice(end, last)) {
    const match = /^ {0,3}<next>(.*?)<\/next>[ \t]*\r?$/u.exec(line);
    const draft = match ? normalizeDraft(match[1]) : null;
    if (draft && !suggestions.includes(draft) && suggestions.length < count) suggestions.push(draft);
  }
  return { text: lines.slice(0, end).join("\n").trimEnd(), suggestions, found: true };
}

export function cleanMessage(message: AssistantMessage, count: number): { message?: AssistantMessage; suggestions: string[] } {
  const text = message.content.filter(block => block.type === "text").map(block => block.text).join("");
  const result = extractNext(text, count);
  if (!result.found) return { suggestions: [] };
  let offset = 0;
  const content = message.content.map(block => {
    if (block.type !== "text") return block;
    const keep = Math.max(0, result.text.length - offset);
    offset += block.text.length;
    return { ...block, text: block.text.slice(0, keep) };
  });
  return { message: { ...message, content }, suggestions: result.suggestions };
}
