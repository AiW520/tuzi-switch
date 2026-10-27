import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, RotateCcw, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  agentsApi,
  agentTemplate,
  type AgentTool,
  type AgentChange,
} from "@/lib/api/agents";
import { WorkspaceScope } from "@/components/shell/WorkspaceScope";
import { WorkspaceQueryError } from "@/components/common/WorkspaceQueryError";
import type { WorkspaceTool } from "@/config/workspace";
import type { AppId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AgentsPanelProps {
  origin: WorkspaceTool;
  target: AppId | null;
  onTargetChange: (tool: AppId) => void;
}
export function AgentsPanel({
  origin,
  target,
  onTargetChange,
}: AgentsPanelProps) {
  const { t } = useTranslation();
  const tool = target === "claude" || target === "opencode" ? target : null;
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <WorkspaceScope
        feature="agents"
        origin={origin}
        target={tool}
        onTargetChange={onTargetChange}
      />
      {tool ? (
        <AgentFiles key={tool} tool={tool} />
      ) : (
        <p className="px-6 text-sm text-muted-foreground">
          {t("navigation.chooseTarget")}
        </p>
      )}
    </div>
  );
}

function AgentFiles({ tool }: { tool: AgentTool }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["agents", tool];
  const query = useQuery({
    queryKey,
    queryFn: () => agentsApi.read(tool),
    retry: false,
    gcTime: 0,
  });
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{
    id: string;
    content: string;
    revision: string;
    existing: boolean;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    id?: string;
    revision: string;
    kind: "delete" | "restore";
  } | null>(null);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mutation = useMutation({
    mutationFn: (change: AgentChange | "restore") =>
      change === "restore"
        ? agentsApi.restore(tool, confirm!.revision)
        : agentsApi.write(tool, change),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      setEditor(null);
      setConfirm(null);
      setError(undefined);
    },
    onError: () => setError(t("agents.failed")),
    onSettled: () => {
      pending.current = false;
    },
  });
  const run = (change: AgentChange | "restore") => {
    if (pending.current) return;
    pending.current = true;
    mutation.mutate(change);
  };
  const ready = !!query.data && !query.error && !mutation.isPending;
  const save = () => {
    if (!editor || mutation.isPending) return;
    const id = editor.id.trim();
    if (
      !id ||
      !id.endsWith(".md") ||
      (!editor.existing && query.data?.files.some((file) => file.id === id))
    ) {
      setError(t("agents.filenameInvalid"));
      return;
    }
    if (!editor.content.trim()) {
      setError(t("agents.contentRequired"));
      return;
    }
    run({ id, content: editor.content, revision: editor.revision });
  };
  const files = (query.data?.files ?? []).filter((file) =>
    file.id.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="px-6 flex flex-col flex-1 min-h-0 gap-3">
      <p className="text-xs text-muted-foreground">{t("agents.scope")}</p>
      {query.data && (
        <p className="text-xs text-muted-foreground break-all">
          {query.data.path}
        </p>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            aria-label={t("agents.search")}
            placeholder={t("agents.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => {
            setError(undefined);
            void query.refetch();
          }}
        >
          <RefreshCw className="h-4 w-4" />
          {t("common.refresh")}
        </Button>
        <Button
          variant="outline"
          disabled={!ready || !query.data?.canRestore}
          onClick={() => {
            setError(undefined);
            setConfirm({ kind: "restore", revision: query.data!.revision });
          }}
        >
          <RotateCcw className="h-4 w-4" />
          {t("agents.restore")}
        </Button>
        <Button
          disabled={!ready}
          onClick={() => {
            setError(undefined);
            setEditor({
              id: "",
              content: agentTemplate(tool),
              revision: query.data!.revision,
              existing: false,
            });
          }}
        >
          <Plus className="h-4 w-4" />
          {t("agents.add")}
        </Button>
      </div>
      {error && !editor && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {query.error ? (
        <WorkspaceQueryError onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-6">
          {files.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">
              {t(search ? "agents.noMatch" : "agents.empty")}
            </p>
          ) : (
            files.map((file) => (
              <div
                key={file.id}
                className="rounded-xl border border-border bg-card p-4 flex flex-wrap items-center gap-3"
              >
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium break-all">{file.id}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      file.validationError
                        ? "agents.invalidFile"
                        : "agents.nativeFile",
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!ready}
                  onClick={() => {
                    setError(undefined);
                    setEditor({
                      ...file,
                      revision: query.data!.revision,
                      existing: true,
                    });
                  }}
                >
                  {t("common.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!ready}
                  onClick={() => {
                    setError(undefined);
                    setConfirm({
                      kind: "delete",
                      id: file.id,
                      revision: query.data!.revision,
                    });
                  }}
                >
                  {t("common.delete")}
                </Button>
              </div>
            ))
          )}
        </div>
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            setEditor(null);
            setError(undefined);
          }
        }}
      >
        <DialogContent
          className="max-w-3xl max-h-[85vh] flex flex-col"
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(editor?.existing ? "agents.edit" : "agents.add")}
            </DialogTitle>
            <DialogDescription>{t("agents.editorHint")}</DialogDescription>
          </DialogHeader>
          {editor && (
            <>
              <label className="space-y-1 text-sm">
                {t("agents.filename")}
                <Input
                  aria-label={t("agents.filename")}
                  value={editor.id}
                  disabled={editor.existing || mutation.isPending}
                  onChange={(e) => setEditor({ ...editor, id: e.target.value })}
                  placeholder="code-reviewer.md"
                />
              </label>
              <label className="flex flex-col gap-1 min-h-0 flex-1 text-sm">
                {t("agents.content")}
                <Textarea
                  aria-label={t("agents.content")}
                  className="font-mono text-xs min-h-[240px] flex-1 resize-y"
                  value={editor.content}
                  disabled={mutation.isPending}
                  onChange={(e) =>
                    setEditor({ ...editor, content: e.target.value })
                  }
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 shrink-0">
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setEditor(null);
                    setError(undefined);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button disabled={mutation.isPending} onClick={save}>
                  {t(mutation.isPending ? "common.saving" : "common.save")}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        isOpen={!!confirm}
        title={t(
          confirm?.kind === "delete" ? "agents.deleteTitle" : "agents.restore",
        )}
        message={
          t(
            confirm?.kind === "delete"
              ? "agents.deleteHint"
              : "agents.restoreHint",
            { id: confirm?.id },
          ) + (error ? `\n\n${error}` : "")
        }
        variant={confirm?.kind === "delete" ? "destructive" : "info"}
        onCancel={() => {
          if (!mutation.isPending) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm && !mutation.isPending)
            run(
              confirm.kind === "restore"
                ? "restore"
                : {
                    id: confirm.id!,
                    content: null,
                    revision: confirm.revision,
                  },
            );
        }}
      />
    </div>
  );
}
