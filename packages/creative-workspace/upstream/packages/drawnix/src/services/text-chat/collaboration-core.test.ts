import { describe, it, expect, vi } from "vitest";
import { runOnce, validateChanges, type Journal } from "./collaboration-core";

function store(): Journal {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (data.get(key) as T) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
  };
}
describe("collaboration operation journal", () => {
  it("returns the previous result without repeating a paid operation", async () => {
    const db = store();
    const submit = vi.fn(async () => ({ taskIds: ["actual-job"] }));
    await runOnce(db, "operation", "signature", submit);
    expect(await runOnce(db, "operation", "signature", submit)).toEqual({
      taskIds: ["actual-job"],
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("does not retry an uncertain submission after reconnect", async () => {
    const db = store();
    const submit = vi.fn(async () => {
      throw new Error("response lost after submission");
    });
    await expect(runOnce(db, "operation", "signature", submit)).rejects.toThrow(
      "response lost",
    );
    await expect(runOnce(db, "operation", "signature", submit)).rejects.toThrow(
      "待核实",
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("rejects reused operation identities with changed content", async () => {
    const db = store();
    await runOnce(db, "operation", "first", async () => true);
    const mutate = vi.fn();
    await expect(runOnce(db, "operation", "second", mutate)).rejects.toThrow(
      "不同请求",
    );
    expect(mutate).not.toHaveBeenCalled();
  });
  it("does not execute when durable intent cannot be saved", async () => {
    const db = store();
    db.set = async () => {
      throw new Error("disk full");
    };
    const mutate = vi.fn();
    await expect(runOnce(db, "operation", "first", mutate)).rejects.toThrow(
      "disk full",
    );
    expect(mutate).not.toHaveBeenCalled();
  });
  it("treats persisted in-flight intents as uncertain after a crash", async () => {
    const db = store();
    await db.set("operation", { signature: "first", status: "started" });
    const mutate = vi.fn();
    await expect(runOnce(db, "operation", "first", mutate)).rejects.toThrow(
      "待核实",
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});
describe("canvas batch validation", () => {
  const elements = [
    {
      id: "a",
      points: [
        [0, 0],
        [10, 10],
      ],
    },
  ];
  it("rejects a whole batch when any element is missing", () => {
    expect(() =>
      validateChanges(
        [
          {
            id: "a",
            points: [
              [1, 1],
              [11, 11],
            ],
          },
          {
            id: "other-board",
            points: [
              [0, 0],
              [10, 10],
            ],
          },
        ],
        elements,
      ),
    ).toThrow();
  });
  it("rejects non-finite coordinates, inverted bounds and duplicate ids", () => {
    for (const points of [
      [
        [0, 0],
        [Infinity, 2],
      ],
      [
        [3, 3],
        [2, 2],
      ],
      [
        [0, 0],
        [0, 1],
      ],
    ])
      expect(() => validateChanges([{ id: "a", points }], elements)).toThrow();
    const change = {
      id: "a",
      points: [
        [0, 0],
        [2, 2],
      ],
    };
    expect(() => validateChanges([change, change], elements)).toThrow();
  });
  it("accepts bounded position and dimension changes", () => {
    expect(
      validateChanges(
        [
          {
            id: "a",
            points: [
              [-10, -10],
              [20, 30],
            ],
          },
        ],
        elements,
      ),
    ).toEqual([
      {
        id: "a",
        points: [
          [-10, -10],
          [20, 30],
        ],
      },
    ]);
  });
});
