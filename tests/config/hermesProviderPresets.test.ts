import { describe, expect, it } from "vitest";
import { hermesProviderPresets } from "@/config/hermesProviderPresets";

describe("Hermes provider presets", () => {
  it("should expose the expected presets", () => {
    expect(hermesProviderPresets.map((item) => item.name)).toEqual([
      "codex-tuzi",
      "codex-coding",
      "codex-gaccode",
      "claude-tuzi",
      "claude-gaccode",
      "OpenRouter",
      "DeepSeek",
      "Together AI",
      "Nous Research",
      "Zhipu GLM",
      "Zhipu GLM en",
      "Bailian",
      "Bailian For Coding",
      "Kimi",
      "Kimi For Coding",
      "StepFun",
      "ModelScope",
      "KAT-Coder",
      "Longcat",
      "BaiLing",
      "AiHubMix",
      "E-FlowCode",
      "TheRouter",
      "Novita AI",
      "Nvidia",
      "PIPELLM",
      "Xiaomi MiMo",
      "Xiaomi MiMo Token Plan (China)",
    ]);
  });

  it("should configure codex presets with Codex Responses mode", () => {
    const preset = hermesProviderPresets.find((item) => item.name === "codex-gaccode");
    expect(preset).toBeDefined();
    expect(preset?.settingsConfig.name).toBe("codex-gaccode");
    expect(preset?.settingsConfig.base_url).toBe("https://gaccode.com/code/v1");
    expect(preset?.settingsConfig.api_mode).toBe("codex_responses");
  });

  it("should configure claude presets with Anthropic Messages mode", () => {
    const preset = hermesProviderPresets.find(
      (item) => item.name === "claude-gaccode",
    );
    expect(preset).toBeDefined();
    expect(preset?.settingsConfig.name).toBe("claude-gaccode");
    expect(preset?.settingsConfig.base_url).toBe("https://gaccode.com/claudecode");
    expect(preset?.settingsConfig.api_mode).toBe("anthropic_messages");
  });
});
