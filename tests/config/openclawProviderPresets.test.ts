import { describe, expect, it } from "vitest";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";

describe("OpenClaw provider presets", () => {
  it("should expose the rabbit presets in the provider catalog", () => {
    expect(openclawProviderPresets.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "codex-tuzi",
        "codex-coding",
        "codex-gaccode",
        "claude-tuzi",
        "claude-gaccode",
      ]),
    );
  });

  it("should configure codex-tuzi preset", () => {
    const preset = openclawProviderPresets.find(
      (item) => item.name === "codex-tuzi",
    );
    expect(preset).toBeDefined();
    expect(preset?.settingsConfig.baseUrl).toBe("https://api.tu-zi.com/v1");
  });

  it("should configure claude-gaccode preset", () => {
    const preset = openclawProviderPresets.find(
      (item) => item.name === "claude-gaccode",
    );
    expect(preset).toBeDefined();
    expect(preset?.settingsConfig.api).toBe("anthropic-messages");
    expect(preset?.settingsConfig.baseUrl).toBe(
      "https://gaccode.com/claudecode",
    );
  });

  it("should support provider-specific credential links", () => {
    expect(
      openclawProviderPresets.find((item) => item.name === "OpenRouter")
        ?.apiKeyUrl,
    ).toBe("https://openrouter.ai/keys");
    expect(
      openclawProviderPresets.find((item) => item.name === "AWS Bedrock")
        ?.apiKeyUrl,
    ).toBeUndefined();
  });
});
