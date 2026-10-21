# 1. Tagged suggestions and conversation-owned offers

Status: accepted by the user, 2026-10-21.

Automatic suggestions come from `<next>` lines in the active model's normal answer. A named system-prompt section requests them; message finalization extracts drafts and removes generated metadata before session storage. This avoids an additional automatic generation request and a separate model picker. Manual `suggest` may make one explicit suggestion-only call to that same active model, outside the transcript.

Keep generate/classifier/hybrid modes and user-defined classes. Hybrid evaluates actual drafts with Jev, not hypothetical future generation. Classifier never calls a chat generator. Existing Jev confidence and fail-closed behavior remain; adopting the reference project's fail-open behavior was not requested.

An offer belongs to the conversation, not an editor revision. Typing/paste/history conceal it; clearing restores it without another call, including after acceptance. Submission, explicit dismissal or context changes invalidate it. One actual draft is ghost text; several use a compact selector. Rendering decorates the existing editor rather than replacing it.

Consequences: tags may be briefly visible during streaming, models can omit them, offers are not restored from disk, and cursor-less custom editors need a fallback line. Parser, lifecycle, context ownership and terminal behavior require regression coverage. Reference-project attribution and MIT notice accompany adapted rendering code.
