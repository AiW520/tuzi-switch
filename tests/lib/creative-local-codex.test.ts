import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage?: (value: unknown) => void;
  },
}));
import { nativeLocalCodex } from "@/features/creative/localCodex";
const input = () => ({
  model: "synthetic",
  prompt: "hello",
  images: [],
  signal: new AbortController().signal,
  onUpdate: vi.fn(),
});
beforeEach(() => {
  mocks.invoke.mockReset();
});
afterEach(() => vi.useRealTimers());
describe("native Codex channel", () => {
  it('ends running activities on failure and ignores late events', async () => {
    let channel: any, fail!: (reason: string) => void;
    mocks.invoke.mockImplementation((command, args) => {
      if (command !== 'creative_codex_chat') return Promise.resolve();
      channel = args.onEvent;
      return new Promise((_resolve, reject) => { fail = reject; });
    });
    const onActivity = vi.fn();
    const pending = nativeLocalCodex.request({ ...input(), onActivity });
    channel.onmessage({ type:'activity', id:'compact', kind:'contextCompaction', label:'压缩上下文', status:'running' });
    fail('codex_provider_model_unavailable');
    await expect(pending).rejects.toThrow('当前供应商分组不支持');
    expect(onActivity).toHaveBeenLastCalledWith(expect.objectContaining({id:'compact',status:'failed'}));
    channel.onmessage({type:'activity',id:'compact',status:'running'});
    expect(onActivity).toHaveBeenCalledTimes(2);
  });
  it('routes tool events and approval requests without completing the reply', async () => {
    let channel: any;
    mocks.invoke.mockImplementation(async (_command, args) => { channel = args.onEvent; });
    const onActivity=vi.fn(),onApproval=vi.fn(),finished=vi.fn();
    const pending=nativeLocalCodex.request({...input(),onActivity,onApproval}).then(finished);
    channel.onmessage({type:'activity',id:'tool-1',kind:'mcpToolCall',label:'OpenTU',status:'running'});
    channel.onmessage({type:'approval',id:'approval-1',kind:'command',description:'synthetic command'});
    await Promise.resolve();
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({id:'tool-1'}));
    expect(onApproval).toHaveBeenCalledWith(expect.objectContaining({id:'approval-1',requestId:expect.any(String)}));
    expect(finished).not.toHaveBeenCalled();
    channel.onmessage({type:'complete',content:'actual result',reasoning:''});
    await pending;
    expect(finished).toHaveBeenCalledWith({content:'actual result',reasoning:''});
  });
  it("waits for explicit completion, delivers actual summary and final text", async () => {
    let channel: any;
    mocks.invoke.mockImplementation(async (_command, args) => {
      channel = args.onEvent;
    });
    const req = input();
    const pending = nativeLocalCodex.request(req);
    channel.onmessage({ type: "ready" });
    channel.onmessage({
      type: "delta",
      content: "partial",
      reasoning: "summary",
    });
    expect(req.onUpdate).toHaveBeenCalledWith({
      content: "partial",
      reasoning: "summary",
    });
    channel.onmessage({
      type: "complete",
      content: "final",
      reasoning: "summary",
    });
    await expect(pending).resolves.toEqual({
      content: "final",
      reasoning: "summary",
    });
  });
  it("re-sends cancellation if native registration arrives after abort", async () => {
    let channel: any;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "creative_codex_chat") channel = args.onEvent;
    });
    const controller = new AbortController();
    const pending = nativeLocalCodex.request({
      ...input(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    channel.onmessage({ type: "ready" });
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "creative_codex_cancel",
      ),
    ).toHaveLength(2);
  });
  it("never shows raw native errors or retries a rejected request", async () => {
    mocks.invoke.mockRejectedValue("SYNTHETIC_SECRET_ERROR");
    await expect(nativeLocalCodex.request(input())).rejects.toThrow(
      "本地 Codex 暂不可用",
    );
    expect(
      mocks.invoke.mock.calls.filter(
        ([command]) => command === "creative_codex_chat",
      ),
    ).toHaveLength(1);
  });
  it("bounds missing channel completion after command success", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(undefined);
    const promise = nativeLocalCodex.request(input());
    const failed = expect(promise).rejects.toThrow("连接已中断");
    await vi.advanceTimersByTimeAsync(30_100);
    await failed;
  });
});
