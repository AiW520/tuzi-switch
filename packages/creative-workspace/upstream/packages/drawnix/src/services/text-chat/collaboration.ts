import { getSelectedElements, Transforms } from "@plait/core";
import { PlaitHistoryBoard } from "@plait/core";
import type {
  CollaborationCall,
  CollaborationScope,
  CodexActivity,
  CodexApproval,
} from "../../../../../../src/collaboration-types";
import { getAssistantAccount } from "../assistant-account";
import {
  getCanvasBoardBinding,
  executeCanvasInsertion,
} from "../canvas-operations";
import { workspaceService } from "../workspace-service";
import { textChatRuntime } from "./runtime";
import { discussionDefaultModel } from "./discussion-ui";
import { externalSkillService } from "../external-skill-service";
import { taskQueueService } from "../task-queue";
import { kvStorageService } from "../kv-storage-service";
import { scrollToPointIfNeeded } from "../../utils/selection-utils";
import { resolveInvocationRoute } from "../../utils/settings-manager";
import { executeDiscussionPlan } from "./discussion";
import {
  validateDiscussionPlan,
  type DiscussionPlan,
  type DiscussionTarget,
} from "./discussion-plan";
import type { TextMessage } from "./conversation";
import { runOnce, validateChanges } from "./collaboration-core";
import { normalizeImageUrlForMultimodalInput } from "../../utils/gemini-api/message-utils";
import { setCollaborationLink } from "./collaboration-link";

const journal = {
  get: <T>(key: string) => kvStorageService.get<T>(key, { strict: true }),
  set: <T>(key: string, value: T) => kvStorageService.set(key, value, { durability: 'strict' }),
};

interface Confirmation {
  title: string;
  detail: string;
  decide: (allow: boolean) => void;
}
interface State {
  id?: string;
  scope?: CollaborationScope;
  connecting: boolean;
  configuration: string;
  error: string;
  pending?: Confirmation;
  activities: CodexActivity[];
}
let state: State = {
  connecting: false,
  configuration: "",
  error: "",
  activities: [],
};
const listeners = new Set<() => void>();
const emit = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((f) => f());
};
let writes: Promise<unknown> = Promise.resolve();
let generation = 0;
let controller = new AbortController();
const readNames = new Set([
  "workspace_read",
  "board_read",
  "selection_read",
  "asset_read",
  "discussion_read",
  "skills_list",
  "skills_read",
  "jobs_list",
  "job_get",
  "operation_get",
]);
const labels: Record<string, string> = {
  canvas_apply: "修改画布布局",
  canvas_insert_text: "插入文本",
  asset_import: "导入本地产物",
  media_submit: "生成媒体作品",
  job_cancel: "取消媒体任务",
  discussion_append: "记录创作结果",
};

function binding(scope: CollaborationScope) {
  const b = getCanvasBoardBinding();
  if (
    !state.id ||
    state.scope?.boardId !== scope.boardId ||
    state.scope?.sessionId !== scope.sessionId ||
    b?.boardId !== scope.boardId ||
    workspaceService.getState().currentBoardId !== scope.boardId
  )
    throw new Error("协同画板已切换或断开，请返回原画板。");
  return b;
}
async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function snapshot(scope: CollaborationScope) {
  const b = binding(scope);
  const children = JSON.stringify(b.board.children);
  const revision = await digest(children);
  if (
    binding(scope).board !== b.board ||
    JSON.stringify(b.board.children) !== children
  )
    throw new Error("画板正在变化，请重新读取。");
  return { b, revision };
}
function element(e: any) {
  return {
    id: e.id,
    type: e.type,
    points: e.points,
    text:
      e.text?.children?.map((n: any) => n.text || "").join("") || e.name || "",
    media:
      typeof e.url === "string" ? { available: true, kind: e.type } : undefined,
  };
}
function currentSession(scope: CollaborationScope) {
  const session = textChatRuntime
    .getSnapshot()
    .sessions.find(
      (s) =>
        s.id === scope.sessionId && s.textChat.linkedBoardId === scope.boardId,
    );
  if (!session) throw new Error("关联讨论已不存在。");
  return session;
}
function jobs(scope: CollaborationScope) {
  return taskQueueService
    .getAllTasks()
    .filter(
      (t) =>
        t.params.conversationLink?.boardId === scope.boardId &&
        t.params.conversationLink?.sessionId === scope.sessionId,
    );
}
function jobSummary(task: ReturnType<typeof jobs>[number]) {
  const result = task.result;
  const url = (value: string | undefined) =>
    value && !value.startsWith("data:") && value.length <= 8192
      ? value
      : undefined;
  return {
    id: task.id,
    status: task.status,
    type: task.type,
    error: task.error,
    result: result && {
      url: url(result.url),
      urls: result.urls?.slice(0, 10).map(url).filter(Boolean),
      format: result.format,
      width: result.width,
      height: result.height,
      duration: result.duration,
      title: result.title?.slice(0, 1000),
      text: (result.chatResponse || result.lyricsText)?.slice(0, 12000),
    },
    operation: task.params.conversationLink?.runId,
  };
}
function confirm(title: string, detail: string): Promise<boolean> {
  if (state.pending) return Promise.reject(new Error("请先处理当前确认请求。"));
  return new Promise((resolve) => {
    const timer = setTimeout(() => decide(false), 105_000);
    const decide = (allow: boolean) => {
      clearTimeout(timer);
      if (state.pending?.decide === decide) emit({ pending: undefined });
      resolve(allow);
    };
    emit({ pending: { title, detail, decide } });
  });
}
function operationKey(scope: CollaborationScope, id: unknown) {
  if (typeof id !== "string" || !/^[\w.-]{1,160}$/.test(id))
    throw new Error("操作编号无效。");
  return `opentu-collaboration:${scope.sessionId}:${id}`;
}
async function read(call: CollaborationCall): Promise<unknown> {
  const { scope, name, arguments: a } = call;
  const b = binding(scope);
  switch (name) {
    case "workspace_read":
      return {
        boardId: scope.boardId,
        sessionId: scope.sessionId,
        name: workspaceService.getBoardMetadata(scope.boardId)?.name,
      };
    case "board_read": {
      const { revision } = await snapshot(scope);
      return {
        boardId: scope.boardId,
        revision,
        total: b.board.children.length,
        elements: b.board.children.slice(0, 300).map(element),
      };
    }
    case "selection_read":
      return {
        boardId: scope.boardId,
        elements: getSelectedElements(b.board).slice(0, 100).map(element),
      };
    case "asset_read": {
      const asset = b.board.children.find((e) => e.id === a.id);
      if (!asset || typeof asset.url !== "string")
        throw new Error("此画板中没有对应图片。");
      const value = await normalizeImageUrlForMultimodalInput(asset.url);
      binding(scope);
      const match = value.match(
        /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/,
      );
      if (!match || value.length > 8 * 1024 * 1024)
        throw new Error(
          "图片尚未缓存或超过读取上限，请先在画布打开或缩小图片。",
        );
      return { mimeType: match[1], imageData: match[2] };
    }
    case "discussion_read":
      return {
        sessionId: scope.sessionId,
        messages: currentSession(scope)
          .textChat.messages.slice(-30)
          .map((m) => ({
            role: m.role,
            content: m.content.slice(0, 12000),
            status: m.status,
          })),
      };
    case "skills_list":
      await externalSkillService.initialize();
      return externalSkillService.getAllExternalSkillsMeta();
    case "skills_read": {
      await externalSkillService.initialize();
      if (typeof a.id !== "string") throw new Error("Skill 编号无效。");
      const content = await externalSkillService.getSkillContentById(a.id);
      if (!content) throw new Error("Skill 不存在。");
      return {
        id: a.id,
        source: (await externalSkillService.getAllExternalSkillsMeta()).find(s => s.id === a.id)?.source,
        contentHash: await digest(content),
        content,
        compatibility:
          "OpenTU creative instructions. Referenced scripts/assets are not automatically exported; use available OpenTU tools or report missing dependencies.",
      };
    }
    case "jobs_list":
      return jobs(scope).slice(-100).map(jobSummary);
    case "job_get": {
      const task = jobs(scope).find((t) => t.id === a.id);
      if (!task) throw new Error("任务不属于此讨论。");
      return jobSummary(task);
    }
    case "operation_get":
      return (
        (await journal.get(operationKey(scope, a.operationId))) || {
          status: "not_found",
        }
      );
    default:
      throw new Error("未知读取操作。");
  }
}
async function write(call: CollaborationCall, epoch: number): Promise<unknown> {
  const { scope, name, arguments: a } = call;
  if (epoch !== generation) throw new Error("协同授权已改变，未执行。");
  if (Date.now() > call.expiresAt) throw new Error("操作请求已过期，未执行。");
  binding(scope);
  const key = operationKey(scope, a.operationId);
  const signature = await digest(JSON.stringify({ name, arguments: a }));
  const old = await journal.get(key);
  // Completed/uncertain retries never ask approval or issue the action again.
  if (old)
    return runOnce(journal, key, signature, async () => {
      throw new Error("已有操作不可重复执行");
    });
  let plan: DiscussionPlan | undefined;
  let summary = labels[name] || name;
  if (name === "media_submit") {
    const type = a.type as DiscussionTarget;
    if (
      !["image", "video", "audio"].includes(type) ||
      !Array.isArray(a.prompts) ||
      !a.prompts.length ||
      a.prompts.length > 10 ||
      a.prompts.some(
        (p) => typeof p !== "string" || !p.trim() || p.length > 50000,
      )
    )
      throw new Error("媒体类型或提示词无效。");
    const route = resolveInvocationRoute(type, null);
    if (!route.modelId || !route.apiKey)
      throw new Error("请先在创作配置中配置对应媒体模型。");
    const refs = getSelectedElements(binding(scope).board)
      .filter((e) => typeof e.url === "string" && e.type === "image")
      .slice(0, 6)
      .map((e) => e.url as string);
    plan = {
      version: 1,
      status: "ready",
      steps: a.prompts.map((prompt) => ({
        type,
        prompt: prompt as string,
        count: 1,
        model: route.modelId,
        modelRef: { modelId: route.modelId, profileId: route.profileId },
        referenceImages: refs,
      })),
    };
    validateDiscussionPlan(plan);
    summary = `使用 ${route.modelId} 生成 ${a.prompts.length} 个${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}作品，可能产生费用。\n${a.prompts.join("\n\n")}`;
  } else if (name === "canvas_apply") {
    validateChanges(a.changes, binding(scope).board.children);
    summary = `修改 ${(a.changes as unknown[]).length} 个元素的位置或尺寸。`;
  } else if (name === "canvas_insert_text" || name === "discussion_append") {
    const value = name === "canvas_insert_text" ? a.text : a.content;
    if (typeof value !== "string" || !value.trim() || value.length > 50000)
      throw new Error("文本内容无效。");
    summary = value;
  } else if (name === "asset_import") summary = `导入 ${String(a.path)}`;
  else if (name === "job_cancel") {
    if (!jobs(scope).some((t) => t.id === a.id))
      throw new Error("任务不属于此讨论。");
    summary = `停止等待任务 ${a.id}。上游已提交任务可能继续运行。`;
  } else throw new Error("未知写入操作。");
  if (!(await confirm(labels[name], summary)))
    throw new Error("用户未批准或确认已超时，未执行。");
  if (generation !== epoch || Date.now() > call.expiresAt)
    throw new Error("协同授权已改变或请求已过期。");
  binding(scope);
  if (["canvas_apply", "canvas_insert_text", "asset_import"].includes(name)) {
    if (a.revision !== (await snapshot(scope)).revision)
      throw new Error("画板已变化，未执行。请重新读取后提出修改。");
  }
  return runOnce(journal, key, signature, async () => {
    if (epoch !== generation || Date.now() > call.expiresAt)
      throw new Error("协同授权已改变或请求已过期。");
    const b = binding(scope);
    controller.signal.throwIfAborted();
    if (name === "canvas_apply") {
      const changes = validateChanges(a.changes, b.board.children);
      PlaitHistoryBoard.withNewBatch(b.board, () =>
        changes.forEach((change) =>
          Transforms.setNode(b.board, { points: change.points }, [
            b.board.children.findIndex((e) => e.id === change.id),
          ]),
        ),
      );
      await workspaceService.flushForAppUpdate();
      return {
        changed: changes.map((c) => c.id),
        revision: (await snapshot(scope)).revision,
      };
    }
    if (name === "canvas_insert_text" || name === "asset_import") {
      if (
        name === "asset_import" &&
        (typeof a.dataUrl !== "string" ||
          !/^data:image\/(png|jpeg|webp|gif);base64,/.test(a.dataUrl))
      )
        throw new Error("本地产物不可读。");
      const result = await executeCanvasInsertion({
        board: b.board,
        items: [
          {
            type: name === "asset_import" ? "image" : "text",
            content: String(name === "asset_import" ? a.dataUrl : a.text),
            waitForImageLoad: true,
          },
        ],
        scrollToResult: false,
        boardGuard: () =>
          generation === epoch &&
          getCanvasBoardBinding()?.boardId === scope.boardId &&
          getCanvasBoardBinding()?.board === b.board,
      });
      if (!result.success) throw new Error(result.error || "插入失败");
      await workspaceService.flushForAppUpdate();
      return result.data;
    }
    if (name === "discussion_append") {
      await textChatRuntime.appendCollaborationResult(scope.sessionId, {
        id: `collaboration-${a.operationId}`,
        role: "assistant",
        content: String(a.content),
        reasoning: "",
        createdAt: Date.now(),
        status: "complete",
        model: "Codex · OpenTU MCP",
      });
      return { recorded: true };
    }
    if (name === "job_cancel") {
      taskQueueService.cancelTask(String(a.id));
      return { cancellationRequested: true };
    }
    const taskIds: string[] = [];
    const message: TextMessage = {
      id: `collaboration-${a.operationId}`,
      role: "assistant",
      content: summary,
      reasoning: "",
      createdAt: Date.now(),
      status: "complete",
      model: "Codex · OpenTU MCP",
      discussion: {
        boardId: scope.boardId,
        runId: String(a.operationId),
        taskIds: [],
        submission: "not_started",
        plan,
      },
    };
    await textChatRuntime.appendCollaborationResult(scope.sessionId, message);
    await executeDiscussionPlan(
      {
        sessionId: scope.sessionId,
        messageId: message.id,
        link: message.discussion!,
        signal: controller.signal,
        onBeforeSubmit: async () => {
          binding(scope);
          message.discussion = {
            ...message.discussion!,
            submission: "started",
            plan: { ...plan!, status: "started" },
          };
          await textChatRuntime.appendCollaborationResult(scope.sessionId, {
            ...message,
          });
        },
        onTasks: async (ids) => {
          taskIds.splice(0, taskIds.length, ...ids);
          message.discussion = { ...message.discussion!, taskIds: [...ids] };
          await textChatRuntime.appendCollaborationResult(scope.sessionId, {
            ...message,
          });
        },
      },
      plan!,
      { waitForCompletion: false },
    );
    return { status: "queued", taskIds, operationId: a.operationId };
  });
}
async function handle(call: CollaborationCall) {
  binding(call.scope);
  if (readNames.has(call.name)) return read(call);
  if (call.name === "ui_focus_asset") {
    const b = binding(call.scope);
    const e = b.board.children.find((e) => e.id === call.arguments.id);
    if (!e?.points?.[0]) throw new Error("作品不在当前画板。");
    scrollToPointIfNeeded(b.board, e.points[0]);
    return { focused: e.id };
  }
  const epoch = generation;
  const action = writes.catch(() => {}).then(() => write(call, epoch));
  writes = action;
  return action;
}
export const collaboration = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async connect() {
    if (state.connecting || state.id) return;
    const native = getAssistantAccount()?.collaboration;
    if (!native) {
      emit({ error: "双向协同仅在新版兔子助手桌面端可用。" });
      return;
    }
    const epoch = ++generation;
    emit({ connecting: true, error: "" });
    try {
      const boardId = getCanvasBoardBinding()?.boardId;
      if (!boardId) throw new Error("请先打开画板。");
      const sessionId = await textChatRuntime.ensureDiscussion(
        boardId,
        discussionDefaultModel(),
      );
      if (getCanvasBoardBinding()?.boardId !== boardId)
        throw new Error("画板已切换，请重新连接。");
      const scope = { boardId, sessionId };
      if (epoch !== generation) throw new Error("协同连接已取消。");
      controller = new AbortController();
      const result = await native.start(scope, (call) => {
        if (epoch !== generation)
          return Promise.reject(new Error("协同连接已失效。"));
        return handle(call);
      });
      if (
        epoch !== generation ||
        getCanvasBoardBinding()?.boardId !== boardId ||
        workspaceService.getState().currentBoardId !== boardId
      ) {
        await native.stop(result.id);
        throw new Error("画板已切换或连接已取消，请重新连接。");
      }
      emit({ ...result, scope, connecting: false, activities: [] });
      setCollaborationLink({
        id: result.id,
        scope,
        activity: collaboration.activity,
        approval: collaboration.approval,
      });
    } catch (e) {
      if (epoch === generation)
        emit({ connecting: false, error: (e as Error).message });
    }
  },
  async disconnect() {
    const id = state.id;
    generation++;
    controller.abort();
    state.pending?.decide(false);
    setCollaborationLink(undefined);
    emit({
      id: undefined,
      scope: undefined,
      connecting: false,
      configuration: "",
      activities: [],
    });
    if (id) await getAssistantAccount()?.collaboration?.stop(id);
  },
  activity(value: CodexActivity) {
    emit({
      activities: [
        ...state.activities.filter((a) => a.id !== value.id),
        value,
      ].slice(-30),
    });
  },
  async approval(value: CodexApproval & { requestId: string }) {
    let allow = false;
    try {
      allow = await confirm(`Codex 请求：${value.kind}`, value.description);
    } catch {
      /* Busy means deny, never implicit approval. */
    }
    await getAssistantAccount()
      ?.localCodex?.approve?.(value.requestId, value.id, allow)
      .catch(() => {});
  },
  clearActivity() {
    emit({ activities: [] });
  },
};
