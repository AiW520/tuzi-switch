import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCodexConfigState } from "@/components/providers/forms/hooks/useCodexConfigState";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function initialData(route: string, envKey: string) {
  return {
    name: route,
    settingsConfig: {
      auth: {},
      env: { envKey },
      config: `model_provider = "${route}"

[model_providers.${route}]
name = "${route}"
base_url = "https://same.example/v1"
env_key = "${envKey}"
wire_api = "responses"
requires_openai_auth = false
`,
    },
  };
}

describe("useCodexConfigState", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("ignores a stale API key response after editing another provider", async () => {
    const providerAKey = deferred<string | null>();
    const providerBKey = deferred<string | null>();
    invokeMock.mockImplementation(
      (_command: string, payload: { envKey?: string }) => {
        if (payload.envKey === "PROVIDER_A_CODEX_API_KEY") {
          return providerAKey.promise;
        }
        if (payload.envKey === "PROVIDER_B_CODEX_API_KEY") {
          return providerBKey.promise;
        }
        return Promise.resolve(null);
      },
    );

    const { result, rerender } = renderHook(
      ({ data }) => useCodexConfigState({ initialData: data }),
      {
        initialProps: {
          data: initialData("provider_a", "PROVIDER_A_CODEX_API_KEY"),
        },
      },
    );

    rerender({
      data: initialData("provider_b", "PROVIDER_B_CODEX_API_KEY"),
    });

    await act(async () => {
      providerBKey.resolve("sk-provider-b");
      await providerBKey.promise;
    });
    await waitFor(() =>
      expect(result.current.codexApiKey).toBe("sk-provider-b"),
    );

    await act(async () => {
      providerAKey.resolve("sk-provider-a");
      await providerAKey.promise;
    });
    expect(result.current.codexApiKey).toBe("sk-provider-b");
    expect(result.current.codexEnvKey).toBe("PROVIDER_B_CODEX_API_KEY");
  });
});
