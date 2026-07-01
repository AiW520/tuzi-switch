import { describe, expect, it } from "vitest";
import { providerPresets } from "@/config/claudeProviderPresets";

describe("Claude provider presets", () => {
  it("should keep the requested presets first", () => {
    expect(providerPresets.slice(0, 2).map((p) => p.name)).toEqual([
      "兔子线路",
      "gaccode",
    ]);
  });

  it("should configure rabbit route for Claude", () => {
    const preset = providerPresets.find((p) => p.name === "兔子线路");
    expect(preset).toBeDefined();
    expect(preset?.apiKeyUrl).toBe("https://api.tu-zi.com");
    expect(preset?.endpointCandidates).toEqual(["https://apius.tu-zi.com"]);
    expect((preset?.settingsConfig as any).env.ANTHROPIC_BASE_URL).toBe(
      "https://apius.tu-zi.com",
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
