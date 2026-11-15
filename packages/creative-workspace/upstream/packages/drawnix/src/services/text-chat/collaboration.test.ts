import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const m = vi.hoisted(() => ({
  handler: undefined as any,
  scope: { boardId: "board-1", sessionId: "discussion-1" },
  board: {
    children: [
      {
        id: "image-1",
        type: "image",
        points: [
          [0, 0],
          [10, 10],
        ],
        url: "data:image/png;base64,AAAA",
      },
    ],
  } as any,
  current: "board-1",
  save: vi.fn(),
  apply: vi.fn(),
  media: vi.fn(),
  journal: new Map<string, unknown>(),
  confirmCount: 0,
}));
vi.mock("../assistant-account", () => ({
  getAssistantAccount: () => ({
    collaboration: {
      start: async (scope: any, handler: any) => {
        m.scope = scope;
        m.handler = handler;
        return { id: "bridge-1", configuration: "synthetic config" };
      },
      stop: async () => {},
    },
  }),
}));
vi.mock("../canvas-operations", () => ({
  getCanvasBoardBinding: () => ({ boardId: m.current, board: m.board }),
  executeCanvasInsertion: vi.fn(async () => ({
    success: true,
    data: { insertedCount: 1 },
  })),
}));
vi.mock("../workspace-service", () => ({
  workspaceService: {
    getState: () => ({ currentBoardId: m.current }),
    getBoardMetadata: () => ({ name: "Synthetic board" }),
    flushForAppUpdate: async () => {},
  },
}));
vi.mock("./runtime", () => ({
  textChatRuntime: {
    ensureDiscussion: async () => m.scope.sessionId,
    getSnapshot: () => ({
      sessions: [
        {
          id: m.scope.sessionId,
          textChat: { linkedBoardId: m.scope.boardId, messages: [] },
        },
      ],
    }),
    appendCollaborationResult: (...args: any[]) => m.save(...args),
  },
}));
vi.mock("./discussion-ui", () => ({ discussionDefaultModel: () => null }));
vi.mock("../external-skill-service", () => ({
  externalSkillService: {
    initialize: async () => {},
    getAllExternalSkillsMeta: async () => [{id:'skill-1',name:'Synthetic skill',source:'synthetic-package'}],
    getSkillContentById: async (id: string) => id === 'skill-1' ? 'Synthetic instructions' : null,
  },
}));
vi.mock("../task-queue", () => ({
  taskQueueService: { getAllTasks: () => [], cancelTask: vi.fn() },
}));
vi.mock("../kv-storage-service", () => ({
  kvStorageService: {
    get: async (k: string) => m.journal.get(k) || null,
    set: async (k: string, v: unknown) => {
      m.journal.set(k, structuredClone(v));
    },
  },
}));
vi.mock("../../utils/selection-utils", () => ({
  scrollToPointIfNeeded: vi.fn(),
}));
vi.mock("../../utils/settings-manager", () => ({
  resolveInvocationRoute: () => ({
    modelId: "synthetic-image",
    profileId: "synthetic-provider",
    apiKey: "synthetic-only",
  }),
}));
vi.mock("./discussion", () => ({
  executeDiscussionPlan: async (req: any, plan: any, options: any) => {
    m.media(plan, options);
    await req.onBeforeSubmit();
    await req.onTasks(["job-1"]);
  },
}));
vi.mock("@plait/core", () => ({
  getSelectedElements: () => m.board.children,
  Transforms: {
    setNode: (board: any, patch: any, [index]: number[]) => {
      m.apply(patch);
      board.children[index] = { ...board.children[index], ...patch };
    },
  },
  PlaitHistoryBoard: { withNewBatch: (_b: any, fn: any) => fn() },
}));
vi.mock("../../utils/gemini-api/message-utils", () => ({
  normalizeImageUrlForMultimodalInput: async (url: string) => url,
}));
import { collaboration } from "./collaboration";
import { getCollaborationPending } from "./collaboration-link";
let unsubscribe: () => void;
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  m.current = "board-1";
  m.board.children = [
    {
      id: "image-1",
      type: "image",
      points: [
        [0, 0],
        [10, 10],
      ],
      url: "data:image/png;base64,AAAA",
    },
  ];
  m.journal.clear();
  m.media.mockClear();
  m.apply.mockClear();
  m.save.mockReset().mockResolvedValue(undefined);
  m.confirmCount = 0;
  await collaboration.connect();
  unsubscribe = collaboration.subscribe(() => {
    const p = collaboration.getSnapshot().pending;
    if (p) {
      m.confirmCount++;
      queueMicrotask(() => p.decide(true));
    }
  });
});
afterEach(async () => {
  unsubscribe();
  await collaboration.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const call = (name: string, args: Record<string, unknown> = {}) =>
  m.handler({
    id: "call",
    scope: m.scope,
    name,
    arguments: args,
    expiresAt: Date.now() + 110000,
  });
describe("OpenTU collaboration business operations", () => {
  it("clears the collapsed notice on timeout without writing a result", async () => {
    unsubscribe();
    unsubscribe = () => {};
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const result = call('discussion_append', { operationId: 'timeout-notice', content: 'Synthetic timeout' });
    const rejected = expect(result).rejects.toThrow('超时');
    await vi.waitFor(() => expect(getCollaborationPending('board-1')).toBeDefined());
    await vi.advanceTimersByTimeAsync(105_000);
    await rejected;
    expect(getCollaborationPending('board-1')).toBeUndefined();
    expect(m.save).not.toHaveBeenCalled();
  });
  it("notifies the scoped collapsed strip and clears the notice on rejection", async () => {
    unsubscribe();
    unsubscribe = () => {};
    const result = call('discussion_append', { operationId: 'notice', content: 'Synthetic result' });
    const rejected = expect(result).rejects.toThrow('未批准');
    await vi.waitFor(() => expect(getCollaborationPending('board-1')?.title).toBe('记录创作结果'));
    expect(getCollaborationPending('board-2')).toBeUndefined();
    collaboration.getSnapshot().pending!.decide(false);
    await rejected;
    expect(getCollaborationPending('board-1')).toBeUndefined();
    expect(m.save).not.toHaveBeenCalled();
  });
  it('reads asynchronous Skill metadata with its source and content fingerprint', async () => {
    expect(await call('skills_read', {id:'skill-1'})).toMatchObject({source:'synthetic-package',content:'Synthetic instructions',contentHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  });
  it("binds reads to the authorized board", async () => {
    expect(await call("workspace_read")).toMatchObject({ boardId: "board-1" });
    m.current = "board-2";
    await expect(call("board_read")).rejects.toThrow("已切换");
  });
  it("requires the current revision and never partially edits a rejected batch", async () => {
    const snapshot = await call("board_read");
    m.board.children[0].points = [
      [3, 3],
      [13, 13],
    ];
    await expect(
      call("canvas_apply", {
        operationId: "write-1",
        revision: snapshot.revision,
        changes: [
          {
            id: "image-1",
            points: [
              [1, 1],
              [11, 11],
            ],
          },
        ],
      }),
    ).rejects.toThrow("画板已变化");
    expect(m.apply).not.toHaveBeenCalled();
  });
  it("queues a confirmed media plan only once and returns job IDs without waiting for generation", async () => {
    const args = {
      operationId: "media-1",
      type: "image",
      prompts: ["A single blue poster"],
    };
    expect(await call("media_submit", args)).toMatchObject({
      status: "queued",
      taskIds: ["job-1"],
    });
    expect(await call("media_submit", args)).toMatchObject({
      taskIds: ["job-1"],
    });
    expect(m.media).toHaveBeenCalledTimes(1);
    expect(m.media.mock.calls[0][1]).toEqual({ waitForCompletion: false });
    expect(m.confirmCount).toBe(1);
  });
  it("rejects expired queued operations without showing confirmation", async () => {
    await expect(
      m.handler({
        id: "call",
        scope: m.scope,
        name: "discussion_append",
        arguments: { operationId: "expired", content: "x" },
        expiresAt: 0,
      }),
    ).rejects.toThrow("过期");
    expect(m.confirmCount).toBe(0);
    expect(m.save).not.toHaveBeenCalled();
  });
  it("does not write when the user denies confirmation", async () => {
    unsubscribe();
    unsubscribe = collaboration.subscribe(() => {
      const p = collaboration.getSnapshot().pending;
      if (p) queueMicrotask(() => p.decide(false));
    });
    await expect(
      call("media_submit", {
        operationId: "denied",
        type: "image",
        prompts: ["A poster"],
      }),
    ).rejects.toThrow("未批准");
    expect(m.media).not.toHaveBeenCalled();
    expect(m.journal.size).toBe(0);
  });
  it("returns actual image content for a selected board asset", async () => {
    expect(await call("asset_read", { id: "image-1" })).toEqual({
      mimeType: "image/png",
      imageData: "AAAA",
    });
    await expect(
      call("asset_read", { id: "other-board-image" }),
    ).rejects.toThrow("没有对应图片");
  });
  it("revokes an old handler even after reconnecting to the same board", async () => {
    const old = m.handler;
    await collaboration.disconnect();
    await collaboration.connect();
    await expect(
      old({
        id: "old",
        scope: m.scope,
        name: "discussion_append",
        arguments: { operationId: "old", content: "stale" },
        expiresAt: Date.now() + 110000,
      }),
    ).rejects.toThrow("失效");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("revokes pending and queued writes when the connection closes", async () => {
    unsubscribe();
    unsubscribe = () => {};
    const first = call("discussion_append", {
      operationId: "first",
      content: "first",
    });
    const second = call("discussion_append", {
      operationId: "second",
      content: "second",
    });
    const outcomes = Promise.allSettled([first, second]);
    await vi.waitFor(() =>
      expect(collaboration.getSnapshot().pending).toBeDefined(),
    );
    await collaboration.disconnect();
    expect((await outcomes).every((r) => r.status === "rejected")).toBe(true);
    expect(getCollaborationPending('board-1')).toBeUndefined();
    expect(m.save).not.toHaveBeenCalled();
  });
});
