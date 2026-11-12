import type { CreativeCodexModel } from "../../../../../../src/bridge-types";
import { getAssistantAccount } from "../assistant-account";
import type { TextChatRequest } from "./request";
import { readTextAttachment } from "./attachments";
import { normalizeImageUrlForMultimodalInput } from "../../utils/gemini-api/message-utils";
import { getCollaborationLink } from './collaboration-link';
import type { CodexCapabilityCatalog } from '../../../../../../src/collaboration-types';

export type CodexSelection = {
  model: string;
  effort?: string;
  connectionId: number;
  collaborationId?: string;
};
type State = {
  enabled: boolean;
  connecting: boolean;
  models: CreativeCodexModel[];
  model: string;
  effort?: string;
  error: string;
  running: number;
  capabilities?: CodexCapabilityCatalog;
  loadingCapabilities?: boolean;
};
const initial: State = {
  enabled: false,
  connecting: false,
  models: [],
  model: "",
  error: "",
  running: 0,
};
let state: State = initial;
let epoch = 0;
const listeners = new Set<() => void>();
const active = new Set<AbortController>();
const update = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
export const localCodex = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async connect() {
    if (state.connecting || state.running) return;
    const generation = ++epoch;
    update({ connecting: true, error: "" });
    try {
      const bridge = getAssistantAccount()?.localCodex;
      if (!bridge) throw new Error("本地 Codex 连接仅在兔子助手桌面端可用。");
      const result = await bridge.probe();
      if (generation !== epoch) return;
      const model =
        result.models.find((m) => m.id === state.model) ||
        result.models.find((m) => m.id === result.defaultModel) ||
        result.models[0];
      if (!model) throw new Error("本地 Codex 没有可用文本模型。");
      update({
        enabled: true,
        connecting: false,
        models: result.models,
        model: model.id,
        effort: model.defaultEffort || undefined,
      });
    } catch (error) {
      if (generation === epoch)
        update({ connecting: false, error: (error as Error).message });
    }
  },
  disconnect() {
    epoch++;
    active.forEach((c) => c.abort());
    update({ enabled: false, connecting: false, error: "" });
  },
  async refreshCapabilities() {
    const bridge=getAssistantAccount()?.localCodex;
    if(!bridge?.capabilities||state.loadingCapabilities)return;
    update({loadingCapabilities:true});
    try {update({capabilities:await bridge.capabilities()});}
    catch(e){update({capabilities:{skills:[],servers:[],errors:[(e as Error).message]}});}
    finally{update({loadingCapabilities:false});}
  },
  select(modelId: string) {
    if (state.running) return;
    const model = state.models.find((m) => m.id === modelId);
    if (model)
      update({
        model: model.id,
        effort: model.defaultEffort || undefined,
        error: "",
      });
  },
  setEffort(effort: string) {
    if (
      !state.running &&
      state.models.find((m) => m.id === state.model)?.efforts.includes(effort)
    )
      update({ effort });
  },
  selection(): CodexSelection | undefined {
    if (!state.enabled) return undefined;
    if (state.connecting) throw new Error("正在连接 Codex，请稍候。");
    if (state.error) throw new Error(state.error);
    return { model: state.model, effort: state.effort, connectionId: epoch, collaborationId:getCollaborationLink()?.id };
  },
};

export async function requestCodexDiscussion(request: TextChatRequest) {
  const selected = request.codex;
  const bridge = getAssistantAccount()?.localCodex;
  if (!selected || !bridge)
    throw new Error("本地 Codex 连接不可用，请重新连接。");
  if (!state.enabled || selected.connectionId !== epoch)
    throw new DOMException("Codex 连接已切换，本次未发送。", "AbortError");
  request.signal.throwIfAborted();
  const controller = new AbortController();
  const stop = () => controller.abort();
  request.signal.addEventListener("abort", stop, { once: true });
  active.add(controller);
  update({ running: active.size });
  let submitted = false;
  try {
    const collaboration=getCollaborationLink();
    if(selected.collaborationId && (collaboration?.id!==selected.collaborationId || collaboration?.scope.sessionId!==request.sessionId))
      throw new Error('这段讨论不属于当前协同画板，请断开协同或回到关联讨论。');
    const images: string[] = [];
    const turns: { role: string; content: string; imageCount: number }[] = [];
    for (const turn of request.turns) {
      const documents: string[] = [];
      const turnImages = [...(turn.images || [])];
      for (const ref of turn.attachments || []) {
        const attachment = await readTextAttachment(ref);
        if (attachment.sessionId !== request.sessionId)
          throw new Error("附件不属于当前会话。");
        if (ref.kind === "image" && attachment.dataUrl)
          turnImages.push(attachment.dataUrl);
        else documents.push(`[附件：${ref.name}]\n${attachment.text || ""}`);
      }
      for (const url of turnImages) {
        const image = await normalizeImageUrlForMultimodalInput(url);
        if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(image))
          throw new Error(
            "这张参考图尚未保存为可读取的本地图片，请重新上传后讨论。",
          );
        images.push(image);
      }
      controller.signal.throwIfAborted();
      turns.push({
        role: turn.role,
        content: [turn.content, ...documents].join("\n"),
        imageCount: turnImages.length,
      });
    }
    if (
      images.length > 6 ||
      images.reduce((n, image) => n + image.length, 0) > 16 * 1024 ** 2
    )
      throw new Error("图片引用过多，请减少到 6 张以内。");
    const prompt =
      (selected.collaborationId ? '请结合会话上下文完成最后的创作请求。可以使用 Skill 和 MCP；画布与媒体操作使用 opentu 工具，实际执行结果用普通文字回复。\n' : "请根据下面的会话上下文回复最后一个用户请求。图片按各轮 imageCount 的顺序附在本条消息中。返回 JSON：content 是答复；next 是待用户确认的生成计划，普通讨论请返回空数组。\n") +
      JSON.stringify(turns);
    if (prompt.length > 800000)
      throw new Error("对话上下文过长，请新建讨论或缩短内容。");
    submitted = true;
    const result = await bridge.request({
      model: selected.model,
      effort: selected.effort,
      prompt,
      images,
      collaborationId: selected.collaborationId,
      sessionId: request.sessionId,
      userPrompt: selected.collaborationId ? JSON.stringify(turns.filter(t=>t.role!=='system').slice(-1)) : undefined,
      onActivity: collaboration?.activity,
      onApproval: value => { void collaboration?.approval(value); },
      signal: controller.signal,
      onUpdate: request.onUpdate,
    });
    return { ...result, finishReason: "stop" };
  } catch (error) {
    if (submitted && !controller.signal.aborted && state.enabled)
      update({ error: (error as Error).message });
    throw error;
  } finally {
    request.signal.removeEventListener("abort", stop);
    active.delete(controller);
    update({ running: active.size });
  }
}
