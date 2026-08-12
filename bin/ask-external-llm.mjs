#!/usr/bin/env node
// Minimal harness-connector PoC: one round-trip to an external LLM.
// Defaults target DeepSeek's Anthropic-compatible endpoint; every part is
// overridable via env so pointing at another provider (or a local model)
// is a config change, not a code change.
//
//   LLM_BASE_URL         default https://api.deepseek.com/anthropic
//   LLM_MODEL            default deepseek-chat (deepseek-reasoner with --reasoning)
//   LLM_API_KEY          falls back to DEEPSEEK_API_KEY
//   LLM_THINKING_BUDGET  reasoning token budget, default 4096
//
// Usage: node ask-external-llm.mjs [--reasoning] "your prompt here"
//   --reasoning: also return the model's chain-of-thought, so a downstream
//   LLM (or human) can see WHY it answered, not just what. Output becomes
//   "## Reasoning" + "## Answer" sections instead of the bare answer.
// stdout = the model's output only; diagnostics go to stderr.

const DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_REASONING_MODEL = "deepseek-reasoner";
const MAX_TOKENS = 2048;
const DEFAULT_THINKING_BUDGET = 4096;

const args = process.argv.slice(2);
const withReasoning = args.includes("--reasoning");
const prompt = args.filter((a) => a !== "--reasoning").join(" ").trim();

const thinkingBudget = Number(process.env.LLM_THINKING_BUDGET ?? DEFAULT_THINKING_BUDGET);
const baseUrl = (process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const model =
  process.env.LLM_MODEL ?? (withReasoning ? DEFAULT_REASONING_MODEL : DEFAULT_MODEL);
const apiKey = process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;

if (!apiKey) {
  console.error(
    "Error: no API key found. Set DEEPSEEK_API_KEY (or LLM_API_KEY) in your environment."
  );
  process.exit(1);
}

if (!prompt) {
  console.error('Usage: node ask-external-llm.mjs "<prompt>"');
  process.exit(1);
}

console.error(
  `[llm-connector] endpoint=${baseUrl} model=${model} reasoning=${withReasoning ? "on" : "off"}`
);

const request = {
  model,
  // The thinking budget must fit inside max_tokens, so leave answer headroom.
  max_tokens: withReasoning ? thinkingBudget + MAX_TOKENS : MAX_TOKENS,
  messages: [{ role: "user", content: prompt }],
};
if (withReasoning) {
  request.thinking = { type: "enabled", budget_tokens: thinkingBudget };
}

const response = await fetch(`${baseUrl}/v1/messages`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify(request),
});

if (!response.ok) {
  console.error(`Error: HTTP ${response.status} from ${baseUrl}`);
  console.error(await response.text());
  process.exit(1);
}

const data = await response.json();
const blocks = data.content ?? [];
const answer = blocks
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("\n");
const reasoning = blocks
  .filter((block) => block.type === "thinking")
  .map((block) => block.thinking)
  .join("\n");

if (!answer) {
  console.error("Error: response contained no text content. Raw response follows.");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

if (withReasoning) {
  console.log(`## Reasoning (${model})\n\n${reasoning || "(none returned)"}\n\n## Answer\n\n${answer}`);
} else {
  console.log(answer);
}
