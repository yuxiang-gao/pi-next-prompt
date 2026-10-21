# Changelog

## 0.2.0

A fresh baseline for Pi Next Prompt, with one implementation and documentation set:

- Automatic suggestions come from trailing `<next>` lines in the active model's normal answer and are removed before assistant-message storage. No extra automatic chat-generation request.
- One suggestion appears as dim ghost text inside the empty editor. Tab or Right inserts it; typing hides it, clearing restores it, and Esc dismisses it. Nothing is auto-sent.
- Configurable count from one to three, with compact keyboard selection for multiple drafts.
- Generate, classifier and hybrid strategies. Jev selects user-defined reply classes and/or actual model drafts; no built-in domain classes.
- Explicit manual generation uses the active conversation model; manual classifier requests use only Jev.
- File-based configuration with private atomic saves, exact-byte init backups, enable/disable and mode commands. Old separate-generator settings are ignored with migration guidance.
- Bounded context, deadlines, cancellation, stale-result protection, private debug traces and separate extra-request usage.
- English/Chinese guides, architecture and configuration reference, local terminal tests, and MIT attribution for Spencer Boucher's reference project.
