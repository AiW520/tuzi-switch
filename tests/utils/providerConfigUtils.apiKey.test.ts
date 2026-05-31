import { describe, expect, it } from "vitest";
import {
  getApiKeyFromConfig,
  hasApiKeyField,
  setApiKeyInConfig,
} from "@/utils/providerConfigUtils";

describe("providerConfigUtils api key handling", () => {
  it("reads and writes Codex API key from env.CODEX_API_KEY", () => {
    const input = JSON.stringify({
      env: { CODEX_API_KEY: "abc123" },
      config: { model: "gpt-5.5" },
    });

    expect(getApiKeyFromConfig(input, "codex")).toBe("abc123");
    expect(hasApiKeyField(input, "codex")).toBe(true);

    const updated = setApiKeyInConfig(input, "new-key", {
      appType: "codex",
    });
    const parsed = JSON.parse(updated);

    expect(parsed.env.CODEX_API_KEY).toBe("new-key");
  });

  it("keeps Gemini API key in env.GEMINI_API_KEY", () => {
    const input = JSON.stringify({
      env: {
        GOOGLE_GEMINI_BASE_URL: "https://api.tu-zi.com",
        GEMINI_API_KEY: "old-key",
      },
      config: {},
    });

    expect(getApiKeyFromConfig(input, "gemini")).toBe("old-key");
    expect(hasApiKeyField(input, "gemini")).toBe(true);

    const updated = setApiKeyInConfig(input, "new-key", {
      appType: "gemini",
    });
    const parsed = JSON.parse(updated);

    expect(parsed.env.GEMINI_API_KEY).toBe("new-key");
  });
});
