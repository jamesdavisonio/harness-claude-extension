// Config loading + role resolution for the llm-connector.
//
// The config replicates Pi's model-roles logic in harness-readable JSON:
//   providers: named endpoints (baseUrl + which env var holds the key)
//   roles:     ordered binding lists — first entry preferred; on failure or
//              missing key, fall through to the next entry in the SAME role.
//
// Search order: --config path > LLM_CONNECTOR_CONFIG env > ./.llm-connector.json
// > ~/.llm-connector.json > built-in default (DeepSeek only).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_CONFIG = {
  providers: {
    deepseek: {
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
  },
  roles: {
    fast: [{ provider: "deepseek", model: "deepseek-v4-flash" }],
    plan: [{ provider: "deepseek", model: "deepseek-v4-pro", reasoning: true }],
    test: [{ provider: "deepseek", model: "deepseek-v4-flash" }],
    build: [{ provider: "deepseek", model: "deepseek-v4-flash" }],
    verify: [{ provider: "deepseek", model: "deepseek-v4-pro", reasoning: true }],
  },
};

export function findConfigPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.LLM_CONNECTOR_CONFIG,
    join(process.cwd(), ".llm-connector.json"),
    join(homedir(), ".llm-connector.json"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function loadConfig(explicitPath) {
  const path = findConfigPath(explicitPath);
  if (!path) {
    return { config: DEFAULT_CONFIG, source: "built-in default" };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse config at ${path}: ${error.message}`);
  }
  return { config, source: path };
}

// Returns the role's bindings joined with their provider details, in fallback
// order. Throws on unknown roles/providers so config typos fail loudly.
export function resolveRole(config, role) {
  const bindings = config.roles?.[role];
  if (!Array.isArray(bindings) || bindings.length === 0) {
    const available = Object.keys(config.roles ?? {}).join(", ") || "(none)";
    throw new Error(`Unknown role "${role}". Available roles: ${available}`);
  }
  return bindings.map((binding) => {
    const provider = config.providers?.[binding.provider];
    if (!provider) {
      throw new Error(`Role "${role}" references unknown provider "${binding.provider}"`);
    }
    const type = provider.type ?? "anthropic";
    const base = {
      provider: binding.provider,
      model: binding.model,
      reasoning: binding.reasoning === true,
      type,
    };
    if (type === "anthropic") {
      if (!provider.baseUrl || !provider.apiKeyEnv) {
        throw new Error(
          `Provider "${binding.provider}" (type anthropic) needs baseUrl + apiKeyEnv`
        );
      }
      return {
        ...base,
        baseUrl: provider.baseUrl.replace(/\/+$/, ""),
        apiKeyEnv: provider.apiKeyEnv,
        apiKey: process.env[provider.apiKeyEnv],
      };
    }
    if (type === "codex-cli") {
      // Subscription-authed via the official OpenAI Codex CLI (codex login);
      // no key env needed — auth lives in ~/.codex/auth.json.
      return { ...base, command: provider.command ?? "codex" };
    }
    throw new Error(
      `Provider "${binding.provider}" has unknown type "${type}" (expected "anthropic" or "codex-cli")`
    );
  });
}
