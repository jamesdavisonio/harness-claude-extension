---
name: ask-deepseek
description: Send a prompt to DeepSeek (an external LLM) and return its answer into this conversation. Use when the user asks for DeepSeek's take, a second opinion from another model, or invokes /llm-connector:ask-deepseek.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/ask-external-llm.mjs" *)
---

# Ask DeepSeek

Relay a prompt to DeepSeek and bring its answer back into the conversation.

## Steps

1. Take the user's question (the skill arguments, or ask if empty) and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ask-external-llm.mjs" "<the user's question>"
```

   Add `--reasoning` before the question when the user wants to see DeepSeek's chain-of-thought, when the answer will be handed to another model as a second opinion, or for judgment/verification questions where the WHY matters as much as the answer. This switches to the `deepseek-v4-pro` model and returns `## Reasoning` + `## Answer` sections.

2. Present stdout to the user, clearly attributed as **DeepSeek's answer** — do not blend it with your own opinion. If the user wants your view too, give it separately and labeled.

3. On error:
   - Missing key → tell the user to `export DEEPSEEK_API_KEY=sk-...` and retry.
   - HTTP error → show the status and body verbatim; do not retry more than once.

## Notes

- The script prints the answer on stdout; the `[llm-connector]` line on stderr shows which endpoint/model was actually called.
- Advanced: `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` env vars redirect the call to any Anthropic-compatible endpoint (other providers, local models).
