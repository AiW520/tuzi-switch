import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";

describe("Claude provider presets", () => {
  it("should include the expected presets", () => {
    expect(providerPresets.map((p) => p.name)).toEqual([
      "兔子线路",
      "gaccode",
      "Claude Official",
      "Gemini Native",
      "DeepSeek",
      "Zhipu GLM",
      "Zhipu GLM en",
      "Baidu Qianfan Coding Plan",
      "Bailian",
      "Bailian For Coding",
      "Kimi",
      "Kimi For Coding",
      "StepFun",
      "StepFun en",
      "ModelScope",
      "KAT-Coder",
      "Longcat",
      "BaiLing",
      "AiHubMix",
      "RelaxyCode",
      "E-FlowCode",
      "OpenRouter",
      "TheRouter",
      "Novita AI",
      "GitHub Copilot",
      "Codex",
      "Nvidia",
      "PIPELLM",
      "Xiaomi MiMo",
      "Xiaomi MiMo Token Plan (China)",
      "AWS Bedrock (AKSK)",
      "AWS Bedrock (API Key)",
    ]);
  });

  it("should configure rabbit route for Claude", () => {
    const preset = providerPresets.find((p) => p.name === "兔子线路");
    expect(preset).toBeDefined();
    expect(preset?.apiKeyUrl).toBe("https://api.tu-zi.com");
    expect(preset?.endpointCandidates).toEqual(["https://api.tu-zi.com"]);
    expect((preset?.settingsConfig as any).env.ANTHROPIC_BASE_URL).toBe(
      "https://api.tu-zi.com",
    );
  });

  it("should configure gaccode for Claude", () => {
    const preset = providerPresets.find((p) => p.name === "gaccode");
    expect(preset).toBeDefined();
    expect(preset?.apiKeyUrl).toBe("https://store.tu-zi.com/cat/1");
    expect(preset?.endpointCandidates).toEqual([
      "https://gaccode.com/claudecode",
    ]);
    expect((preset?.settingsConfig as any).env.ANTHROPIC_BASE_URL).toBe(
      "https://gaccode.com/claudecode",
    );
  });
});
