/** Testable operation journal: record intent before effects and never replay uncertain writes. */
export interface OperationRecord {
  signature: string;
  status: "started" | "complete" | "uncertain";
  result?: unknown;
  error?: string;
}
export interface Journal {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}
export async function runOnce(
  store: Journal,
  key: string,
  signature: string,
  execute: () => Promise<unknown>,
) {
  const old = await store.get<OperationRecord>(key);
  if (old) {
    if (old.signature !== signature)
      throw new Error("同一操作编号不能用于不同请求。");
    if (old.status === "complete") return old.result;
    throw new Error(
      "此操作已有提交记录，结果待核实。请查询任务或画布，不要重复提交。",
    );
  }
  await store.set(key, {
    signature,
    status: "started",
  } satisfies OperationRecord);
  try {
    const result = await execute();
    await store.set(key, {
      signature,
      status: "complete",
      result,
    } satisfies OperationRecord);
    return result;
  } catch (error) {
    await store
      .set(key, {
        signature,
        status: "uncertain",
        error: error instanceof Error ? error.message : "操作中断",
      } satisfies OperationRecord)
      .catch(() => {});
    throw error;
  }
}
export function validateChanges(
  value: unknown,
  elements: ReadonlyArray<{ id: string; points?: unknown }>,
) {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw new Error("每次修改 1–100 个元素。");
  const ids = new Set<string>();
  return value.map((change) => {
    if (
      !change ||
      typeof change.id !== "string" ||
      ids.has(change.id) ||
      !elements.some((e) => e.id === change.id && Array.isArray(e.points)) ||
      !Array.isArray(change.points) ||
      change.points.length !== 2 ||
      change.points.some(
        (p: unknown) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some(
            (n) =>
              typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e6,
          ),
      ) ||
      change.points[1][0] <= change.points[0][0] ||
      change.points[1][1] <= change.points[0][1]
    )
      throw new Error("元素或目标尺寸无效，请重新读取画板。");
    ids.add(change.id);
    return {
      id: change.id as string,
      points: change.points as [number, number][],
    };
  });
}
