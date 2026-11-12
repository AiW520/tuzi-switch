import React, { useState, useSyncExternalStore } from "react";
import { collaboration } from "../../services/text-chat/collaboration";
import { localCodex } from "../../services/text-chat/local-codex";
import { getAssistantAccount } from "../../services/assistant-account";

export function CollaborationControls({ busy }: { busy: boolean }) {
  const state = useSyncExternalStore(
    collaboration.subscribe,
    collaboration.getSnapshot,
  );
  const codex = useSyncExternalStore(
    localCodex.subscribe,
    localCodex.getSnapshot,
  );
  const [message, setMessage] = useState("");
  const act = (action: () => Promise<unknown>) => {
    setMessage("");
    void action().catch((e) => setMessage((e as Error).message));
  };
  return (
    <div
      className="collaboration-controls"
      data-testid="collaboration-controls"
    >
      <div className="discussion-backend__row">
        <button
          type="button"
          disabled={state.connecting || (!state.id && busy)}
          onClick={() =>
            act(() =>
              state.id ? collaboration.disconnect() : collaboration.connect(),
            )
          }
        >
          {state.connecting
            ? "正在连接…"
            : state.id
              ? "断开画板协同"
              : "启用当前画板协同"}
        </button>
        <button
          type="button"
          disabled={codex.loadingCapabilities || busy}
          onClick={() => void localCodex.refreshCapabilities()}
        >
          {codex.loadingCapabilities ? "正在检查能力…" : "查看 Skill / MCP"}
        </button>
      </div>
      <small>
        {state.id
          ? "当前画板已连接。Codex 可读取选区和讨论；媒体生成和画布修改将在这里确认。"
          : "启用后可从本地 Codex 或当前讨论操作此画板。"}
      </small>
      {state.id && (
        <details>
          <summary>连接外部 Codex</summary>
          <p>
            把以下配置添加到 Codex 的 MCP
            配置，然后刷新连接。本应用须保持运行并启用画板协同。
          </p>
          <pre>{state.configuration}</pre>
          <button
            type="button"
            onClick={() =>
              act(async () => {
                const host = getAssistantAccount();
                if (host?.copyText) await host.copyText(state.configuration);
                else await navigator.clipboard.writeText(state.configuration);
                setMessage("连接配置已复制。");
              })
            }
          >
            复制连接配置
          </button>
        </details>
      )}
      {codex.capabilities && (
        <details open>
          <summary>
            可发现的能力 · {codex.capabilities.skills.length} 个 Skill ·{" "}
            {codex.capabilities.servers.length} 个 MCP
          </summary>
          <p>
            发现不等于执行成功。Skill 的脚本依赖和桌面专有工具需要实际运行验证。
          </p>
          <ul>
            {codex.capabilities.skills.map((s, i) => (
              <li key={`${s.path}-${i}`} title={`${s.description}\n${s.path}`}>
                {s.name}
                {s.enabled ? "" : "（已禁用）"}
              </li>
            ))}
          </ul>
          <ul>
            {codex.capabilities.servers.map((s) => (
              <li key={s.name}>
                {s.name} · {s.tools.length} 个工具 · {s.authStatus}
              </li>
            ))}
          </ul>
          {codex.capabilities.errors.map((e, i) => (
            <p role="alert" key={i}>
              {e}
            </p>
          ))}
        </details>
      )}
      {state.activities.length > 0 && (
        <details open>
          <summary>执行进度</summary>
          <ol>
            {state.activities.map((a) => (
              <li key={a.id}>
                {a.label} ·{" "}
                {a.status === "running"
                  ? "进行中"
                  : a.status === "completed"
                    ? "完成"
                    : a.status}
              </li>
            ))}
          </ol>
        </details>
      )}
      {state.pending && (
        <section
          className="collaboration-confirmation"
          role="alertdialog"
          aria-label={state.pending.title}
        >
          <strong>{state.pending.title}</strong>
          <pre>{state.pending.detail}</pre>
          <button type="button" onClick={() => state.pending?.decide(false)}>
            拒绝
          </button>
          <button type="button" onClick={() => state.pending?.decide(true)}>
            确认本次操作
          </button>
        </section>
      )}
      {(state.error || message) && (
        <p role="status">{state.error || message}</p>
      )}
    </div>
  );
}
