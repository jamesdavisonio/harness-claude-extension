#!/usr/bin/env node
// Minimal harness-connector PoC: one round-trip to an external LLM.
// Defaults target DeepSeek's Anthropic-compatible endpoint; every part is
// overridable via env so pointing at another provider (or a local model)
// is a config change, not a code change.
//
//   LLM_BASE_URL  default https://api.deepseek.com/anthropic
//   LLM_MODEL     default deepseek-chat
//   LLM_API_KEY   falls back to DEEPSEEK_API_KEY
//
// Usage: node ask-external-llm.mjs "your prompt here"
// stdout = the model's answer only; diagnostics go to stderr.

const DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";
const DEFAULT_MODEL = "deepseek-chat";
const MAX_TOKENS = 2048;

const baseUrl = (process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const model = process.env.LLM_MODEL ?? DEFAULT_MODEL;
const apiKey = process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;

const prompt = process.argv.slice(2).join(" ").trim();

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

console.error(`[llm-connector] endpoint=${baseUrl} model=${model}`);

const response = await fetch(`${baseUrl}/v1/messages`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  }),
});

if (!response.ok) {
  console.error(`Error: HTTP ${response.status} from ${baseUrl}`);
  console.error(await response.text());
  process.exit(1);
}

const data = await response.json();
const answer = (data.content ?? [])
  .filter((block) => block.type === "text")
  .map((block) => block.text)
  .join("\n");

if (!answer) {
  console.error("Error: response contained no text content. Raw response follows.");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(answer);
