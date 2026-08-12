---
name: ask-llm
description: Route a prompt to an external LLM chosen by ROLE (plan, test, build, verify, fast) from the user's .llm-connector.json config, with ordered model fallback. Use when the user names a role ("ask the verify model", "get a plan-level second opinion") or wants config-driven multi-LLM routing rather than one hardcoded model.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/ask-external-llm.mjs" *)
---

# Ask an external LLM by role

Route a prompt through the connector's role bindings — the config decides which model family answers, not the caller.

## Steps

1. Pick the role. If the user named one, use it; otherwise map the task: judgment/trade-offs → `plan`, reviewing/judging work → `verify`, producing output from a clear spec → `build`, cheap classification/summarisation → `fast`.

2. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/ask-external-llm.mjs" --role <role> "<the prompt>"
```

3. Check stderr for the `answered by <provider>/<model>` line and attribute the answer to that model when presenting it. Roles configured with `reasoning: true` return `## Reasoning` + `## Answer` sections — preserve both; the reasoning is the part a downstream model (or the user) needs to judge where the answer came from.

4. On error:
   - `Unknown role` → show the available roles from the error message.
   - `all models failed` → show the per-binding failure list verbatim; suggest checking API keys or the config. Do not retry in a loop.

## Config

Search order: `--config <path>` > `LLM_CONNECTOR_CONFIG` > `./.llm-connector.json` > `~/.llm-connector.json` > built-in default (DeepSeek only). To customize, copy `templates/llm-connector.example.json` from the plugin root and edit — providers are any Anthropic-compatible endpoint (baseUrl + apiKeyEnv), roles are ordered fallback lists.
