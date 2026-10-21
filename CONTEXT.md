# Pi Next Prompt

An interactive Pi extension that proposes the user's next message without sending it.

- **Draft:** validated reply text, at most 600 characters. The configured count is 1–3.
- **Tagged draft:** a trailing `<next>…</next>` line supplied by the active conversation model. Generated metadata is removed before assistant-message storage.
- **Class:** user-configured ID, description (meaning for Jev), and exact reply text. No built-in domain classes.
- **Offer:** conversation-owned in-memory drafts plus selected index. Typing hides it; clearing restores it. Submission, dismissal or context invalidation ends it.
- **Presentation:** ghost text for one actual draft, compact selector for several. It never changes editor contents until Tab/Right acceptance.
- **Generate:** automatic tags are offered directly; manual requests make one suggestion-only call to the active model.
- **Classifier:** Jev selects configured classes; no chat generation.
- **Hybrid:** Jev chooses configured replies, available actual tagged drafts, or none. Manual requests generate drafts once before classification.

Start at `src/extension.ts`. Tag policy/cleanup lives in `src/tags.ts`, mode evaluation in `src/suggest.ts`, offer lifetime in `src/controller.ts`, and terminal rendering in `src/presentation.ts`. Configuration persistence, TypeSafe HTTP and private debug traces remain separate existing modules.

Run `npm run check`. See `docs/development.md` for architecture/testing and the two READMEs for user behavior. Preserve draft safety, finalized transcript cleanup, bounded requests, no automatic extra chat generation, and no model switching. Keep changes small and test state/parsing behavior rather than introducing generic strategy frameworks.
