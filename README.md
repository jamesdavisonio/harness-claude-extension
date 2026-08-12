# llm-connector

Proof-of-concept harness connector: call an external LLM (DeepSeek) from inside Claude Code. One skill, one zero-dependency Node script, no proxy, no router.

This is step 1 of the multi-LLM orchestration build plan: prove that a Claude Code extension can make a single call out to one external model and get the answer back.

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- A DeepSeek API key: `export DEEPSEEK_API_KEY=sk-...`

## Install (from any Claude Code chat)

```
/plugin marketplace add jamesdavisonio/harness-claude-extension
/plugin install llm-connector@harness-claude-extension
```

Then ask:

```
/llm-connector:ask-deepseek What do you think of X?
```

To pick up new versions later: `/plugin marketplace update harness-claude-extension`

## Local development

```bash
# Direct script test (no Claude involved):
node bin/ask-external-llm.mjs "Say hello in one sentence."

# Run Claude with the local checkout loaded, no install:
claude --plugin-dir /path/to/harness-claude-extension
```

## Role routing (config file)

Instead of naming a model, name a **role** — the config decides which model family answers, with ordered fallback (first entry preferred; missing-key entries skipped; HTTP failures fall through to the next entry in the same role):

```
/llm-connector:ask-llm ask the verify role: is this migration safe?
```

```bash
node bin/ask-external-llm.mjs --role verify "Is this migration safe?"
```

Config search order: `--config <path>` > `LLM_CONNECTOR_CONFIG` > `./.llm-connector.json` > `~/.llm-connector.json` > built-in default (DeepSeek only). Copy [templates/llm-connector.example.json](templates/llm-connector.example.json) to get started. Roles follow the deciding-vs-doing split: `plan`/`verify` bind reasoning models (`"reasoning": true` returns chain-of-thought), `build`/`fast` bind cheap executors, `test` exists so the test author can be a different family than the implementer.

Any Anthropic-compatible endpoint is a provider — add one with a `baseUrl` + `apiKeyEnv` and reference it from any role.

## How it works

- `skills/ask-deepseek/SKILL.md` — the skill Claude loads; it shells out to the bundled script via `${CLAUDE_PLUGIN_ROOT}`.
- `bin/ask-external-llm.mjs` — POSTs to DeepSeek's Anthropic-compatible endpoint (`https://api.deepseek.com/anthropic/v1/messages`) and prints the answer.

Everything is overridable via env, so any Anthropic-compatible endpoint (including a local model server) is a config change:

| Variable | Default |
|---|---|
| `LLM_BASE_URL` | `https://api.deepseek.com/anthropic` |
| `LLM_MODEL` | `deepseek-chat` |
| `LLM_API_KEY` | falls back to `DEEPSEEK_API_KEY` |

## Why the Anthropic-compatible endpoint

Phase 2 of the plan runs a full headless Claude Code subagent on a different LLM via `ANTHROPIC_BASE_URL` + `ANTHROPIC_MODEL`. This PoC exercises the exact same API shape, so a working round-trip here validates both phases.
