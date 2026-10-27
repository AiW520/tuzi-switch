// Synthetic provider workspace. No real IPC, filesystem or external requests.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Toaster, toast } from "sonner";
import { Plus } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";
import { TuziSidebar } from "@/components/shell/TuziSidebar";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { ProviderConnectionControls } from "@/components/providers/ProviderConnectionControls";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/types";
import i18n from "@/i18n";
import "@/index.css";
import "@/components/shell/workspace-pages.css";
void i18n.changeLanguage("zh");
const params = new URLSearchParams(location.search);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const providers: Provider[] = [
  "coding",
  "codex coding",
  "图片测试",
  "tuzi codex",
].map((name, index) => ({
  id: `synthetic-${index}`,
  name,
  icon: index === 2 ? "image" : undefined,
  settingsConfig: {
    auth: { OPENAI_API_KEY: "sk-SYNTHETIC_PREVIEW_ONLY" },
    config: `model_provider = "synthetic"\n[model_providers.synthetic]\nbase_url = "https://synthetic.example/${index === 2 ? "coding" : "v1"}"\nwire_api = "responses"`,
  },
}));
let currentId = "synthetic-2";
let routed =
  params.get("scenario") === "route" || params.get("scenario") === "stopped";
let running = params.get("scenario") !== "stopped" && routed;
mockWindows("main");
mockIPC(
  async (command, args) => {
    if (command === "set_window_theme") return;
    if (command === "get_proxy_status") {
      if (params.get("scenario") === "error")
        throw new Error("SYNTHETIC_FAILURE");
      return {
        running,
        address: "127.0.0.1",
        port: 15721,
        active_targets:
          running && routed
            ? [
                {
                  app_type: "codex",
                  provider_id: currentId,
                  provider_name: providers.find((p) => p.id === currentId)
                    ?.name,
                },
              ]
            : [],
      };
    }
    if (command === "get_proxy_takeover_status")
      return { codex: routed, claude: false, gemini: false };
    if (command === "set_proxy_takeover_for_app") {
      routed = !!(args as { enabled?: boolean } | undefined)?.enabled;
      running ||= routed;
      return;
    }
    if (command === "start_proxy_server") {
      running = true;
      return { address: "127.0.0.1", port: 15721 };
    }
    if (command === "get_provider_health") return null;
    throw new Error(`Synthetic preview rejects IPC: ${command}`);
  },
  { shouldMockEvents: true },
);

const notice = () =>
  toast.info("这是合成供应商主页预览，该入口的实际业务请在桌面版验收。");
function Canvas() {
  const proxy = useProxyStatus();
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState(currentId);
  const left = collapsed ? 68 : 228;
  return (
    <div
      className="tuzi-shell h-screen flex flex-col bg-background text-foreground"
      style={{ paddingTop: 52 }}
    >
      <Toaster />
      <TuziSidebar
        activeApp="codex"
        currentView="providers"
        visibleApps={{
          claude: true,
          "claude-desktop": true,
          codex: true,
          gemini: true,
          opencode: true,
          openclaw: true,
          hermes: true,
        }}
        topOffset={0}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        onSwitchApp={notice}
        onNavigate={notice}
        onOpenSettings={notice}
      />
      <header
        className="workspace-header fixed top-0 h-[52px] border-b border-border bg-background flex items-center justify-between px-6"
        style={{ left, width: `calc(100% - ${left}px)` }}
      >
        <div className="flex items-center gap-3">
          <ProviderIcon icon="openai" name="Codex" size={20} />
          <strong className="text-base">Codex</strong>
          <span className="text-xs text-muted-foreground">供应商</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="添加供应商"
          onClick={notice}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </header>
      <main
        className="workspace-view flex flex-1 flex-col min-h-0"
        data-view="providers"
        style={{ marginLeft: left }}
      >
        <div className="flex flex-col min-h-0 flex-1 px-6">
          <ProviderConnectionControls
            appId="codex"
            currentProviderId={selected}
            providers={Object.fromEntries(providers.map((p) => [p.id, p]))}
            routeEnabled
            onOpenSettings={notice}
          />
          <div className="overflow-y-auto min-h-0 flex-1 pb-6 px-1">
            <div className="provider-list flex flex-col gap-2 mt-3">
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  appId="codex"
                  isCurrent={selected === provider.id}
                  isProxyRunning={proxy.isRunning}
                  isProxyTakeover={
                    proxy.isRunning && !!proxy.takeoverStatus?.codex
                  }
                  onSwitch={(next) => {
                    currentId = next.id;
                    setSelected(next.id);
                    void client.invalidateQueries({
                      queryKey: ["proxyStatus"],
                    });
                  }}
                  onEdit={notice}
                  onDelete={notice}
                  onDuplicate={notice}
                  onConfigureUsage={notice}
                  onOpenWebsite={notice}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
function Preview() {
  const [width, setWidth] = useState(1000);
  const [theme, setTheme] = useState("light");
  const [scenario, setScenario] = useState("direct");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <strong>供应商主页 · 合成数据</strong>
        <select
          aria-label="宽度"
          value={width}
          onChange={(e) => setWidth(+e.target.value)}
        >
          {[900, 1000, 1280].map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <select
          aria-label="主题"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
        <select
          aria-label="连接场景"
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
        >
          <option value="direct">直连</option>
          <option value="route">路由</option>
          <option value="stopped">路由停止</option>
          <option value="error">状态读取失败</option>
        </select>
        <span>可切换供应商、直连/路由、折叠侧栏，并查看聚合说明。</span>
      </div>
      <iframe
        title="供应商主页画布"
        src={`ui04.html?canvas=1&theme=${theme}&scenario=${scenario}`}
        style={{
          width,
          height: 760,
          border: "1px solid #888",
          display: "block",
        }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  params.has("canvas") ? (
    <QueryClientProvider client={client}>
      <ThemeProvider
        defaultTheme={params.get("theme") === "dark" ? "dark" : "light"}
        storageKey={`ui04-${params.get("theme")}`}
      >
        <Canvas />
      </ThemeProvider>
    </QueryClientProvider>
  ) : (
    <Preview />
  ),
);
