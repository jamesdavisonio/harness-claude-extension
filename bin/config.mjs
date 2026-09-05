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
import { join, resolve } from "node:path";

// apiKeyEnv may only name API-key-shaped variables. This is what stops a
// config from exfiltrating arbitrary env vars (AWS_SECRET_ACCESS_KEY,
// GITHUB_TOKEN, DATABASE_URL, ...) as an x-api-key header.
const API_KEY_ENV_PATTERN = /^[A-Z][A-Z0-9_]*API_KEY$/;

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

// The cwd config is the one file a checked-out repo controls, so it is the
// only untrusted source: it may rebind roles/models, but resolveRole refuses
// to let it introduce new endpoint hosts or override the codex command.
export function findConfigPath(explicitPath) {
  const homeConfig = join(homedir(), ".llm-connector.json");
  const candidates = [
    { path: explicitPath, trusted: true },
    { path: process.env.LLM_CONNECTOR_CONFIG, trusted: true },
    { path: join(process.cwd(), ".llm-connector.json"), trusted: false },
    { path: homeConfig, trusted: true },
  ].filter((candidate) => candidate.path);
  const found = candidates.find((candidate) => existsSync(candidate.path)) ?? null;
  if (found && !found.trusted && resolve(found.path) === resolve(homeConfig)) {
    return { ...found, trusted: true };
  }
  return found;
}

export function loadConfig(explicitPath) {
  const found = findConfigPath(explicitPath);
  if (!found) {
    return { config: DEFAULT_CONFIG, source: "built-in default", trusted: true };
  }
  let config;
  try {
    config = JSON.parse(readFileSync(found.path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse config at ${found.path}: ${error.message}`);
  }
  return { config, source: found.path, trusted: found.trusted };
}

// Origins (scheme + host + port) the user has personally vouched for: the
// built-in default plus whatever ~/.llm-connector.json declares. A
// project-local (untrusted) config may only point at these — matching on
// origin rather than host also blocks an https→http downgrade.
function trustedOrigins() {
  const origins = new Set();
  const collect = (cfg) => {
    for (const provider of Object.values(cfg?.providers ?? {})) {
      if (!provider?.baseUrl) continue;
      try {
        origins.add(new URL(provider.baseUrl).origin);
      } catch {
        // Malformed trusted entries fail loudly when actually resolved.
      }
    }
  };
  collect(DEFAULT_CONFIG);
  const homeConfig = join(homedir(), ".llm-connector.json");
  if (existsSync(homeConfig)) {
    try {
      collect(JSON.parse(readFileSync(homeConfig, "utf8")));
    } catch {
      // Unparseable home config contributes nothing.
    }
  }
  return origins;
}

// Returns the role's bindings joined with their provider details, in fallback
// order. Throws on unknown roles/providers so config typos fail loudly.
export function resolveRole(config, role, { trusted = true } = {}) {
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
      let url;
      try {
        url = new URL(provider.baseUrl);
      } catch {
        throw new Error(`Provider "${binding.provider}" baseUrl is not a valid URL`);
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error(`Provider "${binding.provider}" baseUrl must be http(s)`);
      }
      if (!API_KEY_ENV_PATTERN.test(provider.apiKeyEnv)) {
        throw new Error(
          `Provider "${binding.provider}" apiKeyEnv "${provider.apiKeyEnv}" is not an ` +
            `API-key-shaped name (${API_KEY_ENV_PATTERN}); refusing to read it`
        );
      }
      if (!trusted && !trustedOrigins().has(url.origin)) {
        throw new Error(
          `Project-local config points provider "${binding.provider}" at "${url.origin}", ` +
            `which is not declared in ~/.llm-connector.json. Add the provider there ` +
            `(or pass --config) to trust the endpoint.`
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
      if (!trusted && provider.command !== undefined) {
        throw new Error(
          `Project-local config may not override the codex command for provider ` +
            `"${binding.provider}". Move the provider to ~/.llm-connector.json.`
        );
      }
      return { ...base, command: provider.command ?? "codex" };
    }
    throw new Error(
      `Provider "${binding.provider}" has unknown type "${type}" (expected "anthropic" or "codex-cli")`
    );
  });
}
