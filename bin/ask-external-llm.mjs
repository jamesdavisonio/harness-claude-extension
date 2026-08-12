#!/usr/bin/env node
// llm-connector: call an external LLM from inside a harness, with optional
// config-driven role routing (the Claude-side equivalent of Pi's model-roles
// bindings — see bin/config.mjs for the format and search order).
//
// Usage:
//   node ask-external-llm.mjs [--reasoning] "prompt"            # direct (env-configured)
//   node ask-external-llm.mjs --role verify "prompt"            # role routing via config
//   node ask-external-llm.mjs --role plan --config path "prompt"
//
// Direct mode env:
//   LLM_BASE_URL         default https://api.deepseek.com/anthropic
//   LLM_MODEL            default deepseek-chat (deepseek-reasoner with --reasoning)
//   LLM_API_KEY          falls back to DEEPSEEK_API_KEY
//   LLM_THINKING_BUDGET  reasoning token budget, default 4096
//
// --reasoning returns the model's chain-of-thought ("## Reasoning" +
// "## Answer" sections) so a downstream LLM can see WHY, not just what.
// In role mode a binding with "reasoning": true does the same per-role.
//
// stdout = the model's output only. Diagnostics go to stderr, including
// pi-run-style "attempting"/"answered by" lines showing the real model used.

import { loadConfig, resolveRole } from "./config.mjs";

const DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_REASONING_MODEL = "deepseek-reasoner";
const MAX_TOKENS = 2048;
const DEFAULT_THINKING_BUDGET = 4096;

function parseArgs(argv) {
  const flags = { reasoning: false, role: null, config: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reasoning") flags.reasoning = true;
    else if (arg === "--role") flags.role = argv[++i];
    else if (arg === "--config") flags.config = argv[++i];
    else rest.push(arg);
  }
  return { flags, prompt: rest.join(" ").trim() };
}

function directModeBinding(withReasoning) {
  return {
    provider: "env",
    model:
      process.env.LLM_MODEL ?? (withReasoning ? DEFAULT_REASONING_MODEL : DEFAULT_MODEL),
    reasoning: false,
    baseUrl: (process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKeyEnv: "LLM_API_KEY or DEEPSEEK_API_KEY",
    apiKey: process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY,
  };
}

async function callModel(binding, prompt, withReasoning, thinkingBudget) {
  const request = {
    model: binding.model,
    // The thinking budget must fit inside max_tokens, so leave answer headroom.
    max_tokens: withReasoning ? thinkingBudget + MAX_TOKENS : MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  };
  if (withReasoning) {
    request.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  }

  const response = await fetch(`${binding.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": binding.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  const blocks = (await response.json()).content ?? [];
  const answer = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const reasoning = blocks
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n");

  if (!answer) throw new Error("response contained no text content");
  return { answer, reasoning };
}

const { flags, prompt } = parseArgs(process.argv.slice(2));
const thinkingBudget = Number(process.env.LLM_THINKING_BUDGET ?? DEFAULT_THINKING_BUDGET);

if (!prompt) {
  console.error('Usage: node ask-external-llm.mjs [--role <role>] [--reasoning] "<prompt>"');
  process.exit(1);
}

let bindings;
if (flags.role) {
  try {
    const { config, source } = loadConfig(flags.config);
    bindings = resolveRole(config, flags.role);
    console.error(`[llm-connector] config=${source} role=${flags.role} bindings=${bindings.length}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
} else {
  bindings = [directModeBinding(flags.reasoning)];
}

const failures = [];
for (const [index, binding] of bindings.entries()) {
  const label = `${binding.provider}/${binding.model}`;
  if (!binding.apiKey) {
    console.error(`[llm-connector] skipping ${label}: ${binding.apiKeyEnv} not set`);
    failures.push(`${label}: no API key (${binding.apiKeyEnv})`);
    continue;
  }

  const withReasoning = flags.reasoning || binding.reasoning;
  console.error(
    `[llm-connector] attempting ${label} (${index + 1}/${bindings.length}) endpoint=${binding.baseUrl} reasoning=${withReasoning ? "on" : "off"}`
  );

  try {
    const { answer, reasoning } = await callModel(binding, prompt, withReasoning, thinkingBudget);
    console.error(`[llm-connector] answered by ${label}`);
    if (withReasoning) {
      console.log(
        `## Reasoning (${binding.model})\n\n${reasoning || "(none returned)"}\n\n## Answer\n\n${answer}`
      );
    } else {
      console.log(answer);
    }
    process.exit(0);
  } catch (error) {
    console.error(`[llm-connector] ${label} failed: ${error.message}`);
    failures.push(`${label}: ${error.message}`);
  }
}

console.error(
  `[llm-connector] all models failed${flags.role ? ` for role "${flags.role}"` : ""}:`
);
for (const failure of failures) console.error(`  - ${failure}`);
process.exit(1);
