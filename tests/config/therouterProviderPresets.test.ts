import { describe, expect, it } from "vitest";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";

describe("Provider presets", () => {
  it("provides the requested Codex presets with OpenAI-compatible endpoints", () => {
    expect(codexProviderPresets.map((item) => item.name)).toEqual([
      "兔子线路",
      "codex订阅",
      "gaccode",
      "OpenAI Official",
      "Azure OpenAI",
      "AiHubMix",
      "RelaxyCode",
      "E-FlowCode",
      "PIPELLM",
      "OpenRouter",
      "TheRouter",
    ]);

    const expectedPresets = [
      {
        name: "兔子线路",
        provider: "tuzi",
        baseUrl: "https://api.tu-zi.com/v1",
        model: "gpt-5.5",
      },
      {
        name: "codex订阅",
        provider: "codex",
        baseUrl: "https://api.tu-zi.com/coding",
        model: "gpt-5.5",
      },
      {
        name: "gaccode",
        provider: "gac",
        baseUrl: "https://gaccode.com/codex/v1",
        model: "gpt-5.5",
      },
    ];

    expectedPresets.forEach(({ name, provider, baseUrl, model }) => {
      const preset = codexProviderPresets.find((item) => item.name === name);

      expect(preset).toBeDefined();
      expect(preset?.websiteUrl).toBe("");
      expect(preset?.apiKeyUrl).toBe(
        name === "兔子线路"
          ? "https://api.tu-zi.com"
          : name === "codex订阅"
            ? "https://store.tu-zi.com/cat/11"
            : "https://store.tu-zi.com/cat/1",
      );
      expect(preset?.category).toBe("aggregator");
      expect(preset?.endpointCandidates).toEqual([baseUrl]);
      expect(preset?.auth).toEqual({});
      expect(preset?.config).toContain(`model_provider = "${provider}"`);
      expect(preset?.config).toContain(`model = "${model}"`);
      expect(preset?.config).toContain(`base_url = "${baseUrl}"`);
      expect(preset?.config).toContain('wire_api = "responses"');
      expect(preset?.config).toContain("disable_response_storage = true");
    });
  });

  it("uses the requested Gemini rabbit route preset", () => {
    const preset = geminiProviderPresets.find((item) => item.name === "兔子线路");

    expect(preset).toBeDefined();
    expect(preset?.websiteUrl).toBe("");
    expect(preset?.apiKeyUrl).toBe("https://api.tu-zi.com");
    expect(preset?.category).toBe("aggregator");
    expect(preset?.endpointCandidates).toEqual(["https://api.tu-zi.com"]);
    expect(preset?.baseURL).toBe("https://api.tu-zi.com");
    expect(preset?.model).toBe("gemini-3.1-pro");

    const env = (preset?.settingsConfig as { env: Record<string, string> }).env;
    expect(env.GOOGLE_GEMINI_BASE_URL).toBe("https://api.tu-zi.com");
    expect(env.GEMINI_MODEL).toBe("gemini-3.1-pro");
  });
});
