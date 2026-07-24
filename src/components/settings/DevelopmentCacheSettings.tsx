import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  FolderSearch,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi, type DevCacheScanResult } from "@/lib/api/settings";
import type { DevelopmentCacheSettings as CacheSettings } from "@/types";

interface DevelopmentCacheSettingsProps {
  value?: CacheSettings;
  onChange: (value: CacheSettings) => Promise<unknown> | void;
}

const DEFAULT_VALUE: CacheSettings = {
  enabled: false,
  retentionHours: 24,
  routeTemp: true,
  routeNode: true,
  routePython: true,
  cleanupOnSessionEnd: true,
  globalMode: false,
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function DevelopmentCacheSettings({
  value,
  onChange,
}: DevelopmentCacheSettingsProps) {
  const { t } = useTranslation();
  const config = useMemo(() => ({ ...DEFAULT_VALUE, ...value }), [value]);
  const [rootDraft, setRootDraft] = useState(config.rootDir ?? "");
  const [scan, setScan] = useState<DevCacheScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [showCleanConfirm, setShowCleanConfirm] = useState(false);
  const [showGlobalConfirm, setShowGlobalConfirm] = useState(false);

  useEffect(() => setRootDraft(config.rootDir ?? ""), [config.rootDir]);

  const update = async (updates: Partial<CacheSettings>) => {
    const next = { ...config, ...updates };
    if (!next.enabled) {
      next.globalMode = false;
    }
    if (next.enabled && !next.rootDir?.trim()) {
      toast.error(t("settings.advanced.devCache.rootRequired"));
      return;
    }
    if (next.rootDir?.trim()) {
      try {
        await settingsApi.validateDevCacheRoot(next.rootDir);
      } catch (error) {
        toast.error(String(error));
        return;
      }
    }
    const saved = await onChange(next);
    if (saved !== false) {
      setScan(null);
      if (next.globalMode) {
        try {
          const status = await settingsApi.getDevCacheGlobalStatus();
          if (!status.applied || status.hasConflict) {
            toast.error(
              status.warnings[0] ??
                t("settings.advanced.devCache.globalStatusConflict"),
            );
          }
        } catch (error) {
          toast.error(String(error));
        }
      }
    }
  };

  const browse = async () => {
    const selected = await settingsApi.pickDirectory(config.rootDir);
    if (selected) await update({ rootDir: selected });
  };

  const runScan = async () => {
    setIsScanning(true);
    try {
      setScan(await settingsApi.scanDevCache());
    } catch (error) {
      toast.error(t("settings.advanced.devCache.scanFailed", { error }));
    } finally {
      setIsScanning(false);
    }
  };

  const clean = async (includeShared: boolean) => {
    setIsCleaning(true);
    try {
      const result = await settingsApi.cleanDevCache(includeShared);
      toast.success(
        t("settings.advanced.devCache.cleanSuccess", {
          size: formatBytes(result.removedBytes),
        }),
      );
      await runScan();
    } catch (error) {
      toast.error(t("settings.advanced.devCache.cleanFailed", { error }));
    } finally {
      setIsCleaning(false);
      setShowCleanConfirm(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label>{t("settings.advanced.devCache.enabled")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.advanced.devCache.enabledDescription")}
          </p>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => void update({ enabled })}
        />
      </div>

      <div className="space-y-2">
        <Label>{t("settings.advanced.devCache.root")}</Label>
        <div className="flex gap-2">
          <Input
            value={rootDraft}
            placeholder={t("settings.advanced.devCache.rootPlaceholder")}
            onChange={(event) => setRootDraft(event.target.value)}
            onBlur={() => void update({ rootDir: rootDraft || undefined })}
          />
          <Button variant="outline" size="icon" onClick={() => void browse()}>
            <FolderSearch className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.advanced.devCache.rootHint")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ["routeTemp", "temp"],
            ["routeNode", "node"],
            ["routePython", "python"],
            ["cleanupOnSessionEnd", "cleanupOnEnd"],
          ] as const
        ).map(([key, label]) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-lg border p-3"
          >
            <Label>{t(`settings.advanced.devCache.${label}`)}</Label>
            <Switch
              checked={config[key]}
              disabled={!config.enabled}
              onCheckedChange={(checked) => void update({ [key]: checked })}
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label>{t("settings.advanced.devCache.globalMode")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.advanced.devCache.globalModeDescription")}
            </p>
          </div>
          <Switch
            checked={config.globalMode}
            disabled={!config.enabled}
            onCheckedChange={(checked) => {
              if (checked) {
                setShowGlobalConfirm(true);
              } else {
                void update({ globalMode: false });
              }
            }}
          />
        </div>
        {config.globalMode ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            {t("settings.advanced.devCache.globalModeRestartHint")}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>{t("settings.advanced.devCache.retention")}</Label>
        <Input
          type="number"
          min={1}
          max={720}
          className="max-w-36"
          value={config.retentionHours}
          onChange={(event) =>
            void update({
              retentionHours: Math.min(
                720,
                Math.max(1, Number(event.target.value) || 24),
              ),
            })
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void runScan()}
          disabled={isScanning}
        >
          {isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("settings.advanced.devCache.scan")}
        </Button>
        <Button
          variant="outline"
          disabled={!config.rootDir}
          onClick={() => void settingsApi.openDevCacheDirectory()}
        >
          <FolderOpen className="h-4 w-4" />
          {t("settings.advanced.devCache.open")}
        </Button>
        <Button
          variant="destructive"
          disabled={!scan?.exists || isCleaning}
          onClick={() => setShowCleanConfirm(true)}
        >
          {isCleaning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          {t("settings.advanced.devCache.clean")}
        </Button>
      </div>

      {scan ? (
        <div className="rounded-lg bg-muted/50 p-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <p>
              {t("settings.advanced.devCache.total")}:{" "}
              <b>{formatBytes(scan.sizeBytes)}</b>
            </p>
            <p>
              {t("settings.advanced.devCache.files")}: <b>{scan.fileCount}</b>
            </p>
            <p>
              {t("settings.advanced.devCache.expired")}:{" "}
              <b>{scan.expiredSessionCount}</b>
            </p>
          </div>
          {scan.warnings.length > 0 ? (
            <p className="mt-3 text-xs text-amber-600">
              {t("settings.advanced.devCache.warningCount", {
                count: scan.warnings.length,
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={showCleanConfirm}
        title={t("settings.advanced.devCache.cleanConfirmTitle")}
        message={t("settings.advanced.devCache.cleanConfirmMessage", {
          size: formatBytes(scan?.sizeBytes ?? 0),
        })}
        confirmText={t("settings.advanced.devCache.clean")}
        checkboxLabel={t("settings.advanced.devCache.includeShared")}
        onConfirm={(includeShared) => void clean(includeShared)}
        onCancel={() => setShowCleanConfirm(false)}
      />
      <ConfirmDialog
        isOpen={showGlobalConfirm}
        title={t("settings.advanced.devCache.globalConfirmTitle")}
        message={t("settings.advanced.devCache.globalConfirmMessage")}
        confirmText={t("settings.advanced.devCache.globalConfirmAction")}
        variant="info"
        onConfirm={() => {
          setShowGlobalConfirm(false);
          void update({ globalMode: true });
        }}
        onCancel={() => setShowGlobalConfirm(false)}
      />
    </div>
  );
}
