import { describe, expect, it } from "vitest";
import { openclawProviderPresets } from "@/config/openclawProviderPresets";

describe("OpenClaw provider presets", () => {
  it("should expose the expected presets", () => {
    expect(openclawProviderPresets.map((item) => item.name)).toEqual([
      "codex-tuzi",
      "codex-coding",
      "codex-gaccode",
      "claude-tuzi",
      "claude-gaccode",
      "DeepSeek",
      "Zhipu GLM",
      "Zhipu GLM en",
      "Qwen Coder",
      "Kimi k2.6",
      "Kimi For Coding",
      "StepFun",
      "StepFun en",
      "KAT-Coder",
      "Longcat",
      "BaiLing",
      "Xiaomi MiMo",
      "Xiaomi MiMo Token Plan (China)",
      "AiHubMix",
      "OpenRouter",
      "TheRouter",
      "ModelScope",
      "Novita AI",
      "Nvidia",
      "PIPELLM",
      "E-FlowCode",
      "AWS Bedrock",
    ]);
  });

  it("should configure codex-tuzi preset", () => {
    const preset = openclawProviderPresets.find((item) => item.name === "codex-tuzi");
    expect(preset).toBeDefined();
    expect(preset?.settingsConfig.baseUrl).toBe("https://api.tu-zi.com/v1");
  });

  it("should configure claude-gaccode preset", () => {
    const preset = openclawProviderPresets.find(
      (item) => item.name === "claude-gaccode",
    );
    expect(preset).toBeDefined();
    expect(preset?.settingsConfig.api).toBe("anthropic-messages");
    expect(preset?.settingsConfig.baseUrl).toBe("https://gaccode.com/claudecode");
  });

  it("should expose apiKeyUrl for tuzi presets", () => {
    const tuziPresets = openclawProviderPresets.filter(
      (item) =>
        item.name.startsWith("codex-") || item.name.startsWith("claude-"),
    );
    expect(tuziPresets.every((item) => Boolean(item.apiKeyUrl))).toBe(true);
  });
});
