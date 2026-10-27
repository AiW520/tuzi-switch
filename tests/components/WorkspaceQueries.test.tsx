import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Mcp from "@/components/mcp/UnifiedMcpPanel";
import Skills from "@/components/skills/UnifiedSkillsPanel";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import { mcpApi } from "@/lib/api/mcp";
import { skillsApi } from "@/lib/api/skills";
import { sessionsApi } from "@/lib/api/sessions";

function mount(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("workspace query recovery", () => {
  it("retries failed session messages while retaining the selected session", async () => {
    vi.spyOn(sessionsApi, "list").mockResolvedValue([
      {
        providerId: "claude",
        sessionId: "synthetic",
        title: "Synthetic message retry",
        sourcePath: "/synthetic/session",
      },
    ]);
    const read = vi
      .spyOn(sessionsApi, "getMessages")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue([]);
    mount(<SessionManagerPage appId="claude" />);
    fireEvent.click(await screen.findByText("Synthetic message retry"));
    const alert = await screen.findByRole("alert");
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("heading", { name: "Synthetic message retry" }),
    ).toBeInTheDocument();
  });
  it("distinguishes failed MCP reads from an empty list and retries", async () => {
    const read = vi
      .spyOn(mcpApi, "getAllServers")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue({});
    mount(<Mcp onOpenChange={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(
      screen.queryByText("mcp.unifiedPanel.noServers"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    expect(
      await screen.findByText("mcp.unifiedPanel.noServers"),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("distinguishes failed installed skill reads and retries", async () => {
    const read = vi
      .spyOn(skillsApi, "getInstalled")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue([]);
    mount(<Skills currentApp="claude" onOpenDiscovery={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(screen.queryByText("skills.noInstalled")).not.toBeInTheDocument();
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    expect(await screen.findByText("skills.noInstalled")).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("recovers a failed session list without implying there are no sessions", async () => {
    const read = vi
      .spyOn(sessionsApi, "list")
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue([]);
    mount(<SessionManagerPage appId="claude" />);
    const alert = await screen.findByRole("alert");
    fireEvent.click(
      within(alert).getByRole("button", { name: "common.refresh" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });
});
