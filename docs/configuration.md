# Configuration

The saved source of truth is `<agent-dir>/next-prompt.json`, usually `~/.pi/agent/next-prompt.json`. `PI_CODING_AGENT_DIR` changes the agent directory. Commands save/apply immediately; manual file edits require `/next-prompt reload`. Missing or malformed config disables suggestions.

```json
{
  "enabled": true,
  "autoSuggest": true,
  "mode": "generate",
  "suggestionCount": 1,
  "classes": [],
  "classifier": { "mode": "off" },
  "confidence": 0.8,
  "timeoutMs": 10000,
  "maxContextChars": 8000
}
```

The [init example](../examples/next-prompt.example.json) includes a dormant System One connection template and starts disabled. `init` preserves exact existing bytes, including invalid JSON, in a unique adjacent `.backup-<timestamp>-<uuid>` before replacing the file. Backup failure leaves the original intact. Config/backups use owner-only permissions where supported; keep them outside version control. Backups are not automatically removed.

## Reply classes

Classifier/hybrid classes are entirely user-defined:

```json
{
  "mode": "classifier",
  "suggestionCount": 2,
  "classes": [
    {
      "id": "compare",
      "description": "The assistant offered alternatives but has not explained their tradeoffs.",
      "text": "Compare the tradeoffs before I choose."
    },
    {
      "id": "try-prototype",
      "description": "The proposed change would benefit from trying a small prototype first.",
      "text": "Build a small prototype so I can try it."
    }
  ]
}
```

`description` tells Jev when an option fits. `text` supplies the reply draft in your preferred language; whitespace is normalized using the same validation as generated drafts. No regex filtering, translation or built-in test option is applied. IDs are unique lowercase letters/digits/hyphens, start with a letter, at most 64 characters. `none`, `generate`, `constructor`, and `prototype` are reserved IDs (the example uses `try-prototype`).

Each classification removes the selected class before choosing again. Selection stops at count, exhaustion, `none` or low confidence. Hybrid also offers internal `generate` when actual model drafts exist; selecting it uses those drafts to fill remaining slots, without a generation call. Jev receives the actual drafts in `state.suggestions`. Empty hybrid candidates skip classification. Duplicates are omitted; count is an upper bound.

## System One / Jev

Supply this connection for classifier/hybrid:

```json
{
  "classifier": {
    "mode": "system-one",
    "endpoint": "https://api.typesafe.ai/v1/systemone",
    "model": "jev-latest",
    "apiKey": "$TYPESAFE_API_KEY"
  }
}
```

Set the environment variable **before starting Pi**. Keys can be literal values, `$ENV_NAME` or `${ENV_NAME}`; no shell evaluation occurs. HTTP uses Bearer authentication and the TypeSafe `model`, `state`, `questions.next` choice protocol, not an OpenAI chat request. Responses need `answers.next.choice`, `confidence` and `probabilities`; optional usage uses `input_tokens`/`output_tokens`.

Use a complete HTTPS URL. HTTP is allowed only on loopback; embedded credentials, queries, fragments and redirects are rejected. Response bodies are capped at 64 KiB. There are no automatic retries. Errors and low confidence do not fall back to chat generation. Jev cost is unknown without price metadata; unknown is not free.

## Fields

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch for automatic/manual work |
| `autoSuggest` | `true` | Automatic tags/offering; false means manual-only, with no automatic instruction or Jev work |
| `mode` | `generate` | `generate`, `classifier`, or `hybrid` |
| `suggestionCount` | `1` | Integer 1–3; maximum distinct drafts |
| `classes` | `[]` | Configured `{ id, description, text }` replies |
| `classifier` | `{ "mode": "off" }` | Off or a System One connection |
| `confidence` | `0.8` | 0.5–1; both Jev confidence and chosen probability must meet it; no effect on generation |
| `timeoutMs` | `10000` | 100–60000, per manual-generation/classification request |
| `maxContextChars` | `8000` | 1000–16000; bounded recent user/assistant text for manual generation/Jev |

Manual generation gets 256 output tokens per requested draft (maximum 768). Drafts are limited to 600 characters; empty/duplicate drafts, controls, fenced code and leading `!`, `/` or `@` are rejected. Automatic suggestions share those checks but use the main response's normal token budget.

Legacy `generator` input is ignored, never used to select another model, and omitted on config save. Use Pi's `/model` for both the answering model and explicit manual suggestions. No config migration resets active settings.

## Privacy and lifetime

Automatic generation is part of your existing model request. Manual generation and Jev see bounded projected user/assistant text; tools, images and thinking are excluded. Text can still contain sensitive information, so review the selected providers' data handling.

Offers are kept only in memory and tied to session/branch/model/config. They survive typing and acceptance but expire on submission, context changes, reload or disable. Tagged metadata is stripped before assistant storage; session reopening does not recover old drafts. A manual request can generate fresh ones from the restored conversation.
