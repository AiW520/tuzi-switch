import { useCallback, useEffect, useState } from "react";
import { Languages, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { codexLocaleApi, type CodexLocaleStatus } from "@/lib/api";

export function CodexLocaleSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CodexLocaleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStatus(await codexLocaleApi.getStatus());
    } catch (error) {
      console.error("Failed to detect Codex locale status:", error);
      setStatus(null);
      setLoadError(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = async (enabled: boolean) => {
    setSaving(true);
    try {
      const next = await codexLocaleApi.setSimplifiedChinese(enabled);
      setStatus(next);
      toast.success(
        enabled
          ? t("settings.codexLocale.enabledToast")
          : t("settings.codexLocale.restoredToast"),
      );
    } catch (error) {
      console.error("Failed to update Codex locale:", error);
      toast.error(
        t("settings.codexLocale.failedToast", { error: String(error) }),
      );
    } finally {
      setSaving(false);
    }
  };

  const unavailable = status === null || saving || loadError !== null;
  const customOverride =
    status?.localeOverride && !status.chineseEnabled
      ? status.localeOverride
      : null;

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Languages className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {t("settings.codexLocale.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("settings.codexLocale.description")}
            </p>
          </div>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs ${
              status?.chineseEnabled
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : loadError
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {status?.chineseEnabled
              ? t("settings.codexLocale.enabled")
              : loadError
                ? t("settings.codexLocale.readFailed")
                : customOverride
                  ? t("settings.codexLocale.customOverride", {
                      locale: customOverride,
                    })
                  : t("settings.codexLocale.notEnabled")}
          </span>
        )}
      </div>

      {!loading && (
        <div className="rounded-lg bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          {loadError ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t("settings.codexLocale.readFailedDetail", {
                  error: loadError,
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => void refresh()}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {t("settings.codexLocale.retry")}
              </Button>
            </div>
          ) : !status?.installed ? (
            t("settings.codexLocale.installationUnknown")
          ) : !status.chineseResourcesAvailable ? (
            t("settings.codexLocale.resourcesMissing", {
              version: status.version ?? "-",
            })
          ) : (
            t("settings.codexLocale.ready", {
              version: status.version ?? "-",
            })
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={unavailable || status?.chineseEnabled}
          onClick={() => void apply(true)}
        >
          {saving && !status?.chineseEnabled ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Languages className="mr-2 h-4 w-4" />
          )}
          {t("settings.codexLocale.enable")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || !status?.chineseEnabled}
          onClick={() => void apply(false)}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          {t("settings.codexLocale.restore")}
        </Button>
      </div>

      {status?.restartRequired && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("settings.codexLocale.restartHint")}
        </p>
      )}
    </section>
  );
}
