import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import { useTranslation } from "react-i18next";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { ProviderConnectionBar } from "./ProviderConnectionBar";

export function ProviderConnectionControls({
  appId,
  providers,
  currentProviderId,
  routeEnabled,
  onOpenSettings,
}: {
  appId: AppId;
  providers: Record<string, Provider>;
  currentProviderId: string;
  routeEnabled: boolean;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const proxy = useProxyStatus();
  const ready =
    !proxy.isLoading &&
    !proxy.isTakeoverLoading &&
    !!proxy.status &&
    !!proxy.takeoverStatus &&
    !proxy.error;
  const routed = !!proxy.takeoverStatus?.[appId];
  const mode = ready ? (routed ? "route" : "direct") : "unknown";
  const target = proxy.status?.active_targets?.find(
    (target) => target.app_type === appId,
  );
  const currentName = providers[currentProviderId]?.name;
  const status = !ready
    ? t(proxy.error ? "connectionMode.failed" : "connectionMode.loading")
    : routed
      ? !proxy.isRunning
        ? t("connectionMode.stopped")
        : target
          ? t("connectionMode.routed", { name: target.provider_name })
          : t("connectionMode.routeReady")
      : currentName
        ? t("connectionMode.directActive", { name: currentName })
        : t("connectionMode.noProvider");

  return (
    <ProviderConnectionBar
      mode={mode}
      status={status}
      busy={proxy.isPending}
      unavailable={!ready}
      onOpenSettings={onOpenSettings}
      onChange={(next) => {
        if (next === "route" && routed && !proxy.isRunning) {
          void proxy.startProxyServer().catch(() => {});
          return;
        }
        if ((next === "route") === routed) return;
        if (next === "route" && !routeEnabled) {
          onOpenSettings();
          return;
        }
        // Native command owns backup, restore and startup. Keep its error handling.
        void proxy
          .setTakeoverForApp({ appType: appId, enabled: next === "route" })
          .catch(() => {});
      }}
    />
  );
}
