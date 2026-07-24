import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexLocaleSettings } from "@/components/settings/CodexLocaleSettings";

const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: vi.fn(),
  },
}));

describe("CodexLocaleSettings", () => {
  it("enables the official Simplified Chinese locale and shows restart guidance", async () => {
    render(<CodexLocaleSettings />);

    const enable = await screen.findByRole("button", {
      name: "settings.codexLocale.enable",
    });
    fireEvent.click(enable);

    await screen.findByText("settings.codexLocale.enabled");
    expect(
      screen.getByText("settings.codexLocale.restartHint"),
    ).toBeInTheDocument();
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledTimes(1));
  });
});
