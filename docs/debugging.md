# Debugging suggestions

Start with `/next-prompt status`: it reports the selected mode, master/automatic switches, class/count settings, offer/acceptance totals, and extra manual-generation/Jev requests. It preserves the offer. Counters live in memory and reset on extension reload; main-answer tokens already belong to Pi's normal usage and are not counted twice.

To trace decisions, start Pi with a writable file whose parent directory exists:

```sh
NEXT_PROMPT_DEBUG_FILE=/tmp/next-prompt-debug.jsonl pi
```

From another terminal:

```sh
tail -f /tmp/next-prompt-debug.jsonl
```

| Event | What it explains |
| --- | --- |
| `tags-extracted` | Number of valid drafts and whether assistant metadata was cleaned |
| `suggest-start` | Mode, manual/automatic origin and count |
| `request-start` / `request-finish` | Extra generation/classification timing, completion, timeout and reported usage |
| `generator-result` | Valid manual tags or incomplete/missing-tag output |
| `jev-http` / `jev-error` | HTTP status or stage: authentication, transport, HTTP, body, JSON, answer, usage |
| `jev-response` | Sanitized actual Jev choice, confidence and probabilities before validation |
| `classifier-decision` | Offered labels, threshold, scores, and why it accepted/rejected |
| `controller-skip` / `controller-discard` | Draft/busy/disabled/context conditions |
| `preview-offered` / `preview-accepted` / `preview-dismissed` | Offer lifecycle |

Example decision (timestamps/process IDs omitted):

```json
{"event":"classifier-decision","offered":["none","compare","generate"],"answer":{"type":"choice","choice":"compare","confidence":0.79,"probabilities":{"compare":0.79}},"threshold":0.8,"accepted":false,"reason":"low-confidence"}
```

There is no `generate` routing option when hybrid has no actual tagged drafts. A classifier without configured classes logs `no-classes`; an empty hybrid logs `no-candidates`. Neither makes an HTTP request.

A missing automatic suggestion can simply mean the model omitted tags. `/next-prompt suggest` explicitly generates fresh drafts in generate/hybrid; classifier only retries Jev. Automatic generation should show **zero additional chat-generation calls**. Manual requests can be billed even when cancelled or when usage is not returned.

Logs omit credentials, endpoint/model values, conversation/draft text, arbitrary error messages and raw response bodies. Unknown response labels are masked. New files use owner-only permissions where supported; existing files keep their permissions. An unwritable destination is ignored and never interrupts suggestions. Unset the environment variable and restart Pi to stop logging.

For rendering investigations, Pi's `PI_TUI_WRITE_LOG` can capture ANSI terminal output. That host log may contain private conversation text; keep it local. Verify stock/custom editors separately and include terminal size/mode when reporting a bug.
