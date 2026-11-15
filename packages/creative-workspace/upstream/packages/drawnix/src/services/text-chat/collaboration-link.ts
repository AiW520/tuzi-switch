import type {
  CollaborationScope,
  CodexActivity,
  CodexApproval,
} from "../../../../../../src/collaboration-types";
/** Lightweight execution context; importing Codex routing must not initialize the canvas runtime. */
interface Link {
  id: string;
  scope: CollaborationScope;
  activity: (event: CodexActivity) => void;
  approval: (event: CodexApproval & { requestId: string }) => Promise<void>;
}
let link: Link | undefined;
export const getCollaborationLink = () => link;
export const setCollaborationLink = (value: Link | undefined) => {
  link = value;
};

// Keep collapsed discussion notifications independent of the canvas operation runtime.
let pending: { scope: CollaborationScope; title: string } | undefined;
const listeners = new Set<() => void>();
export const getCollaborationPending = (boardId: string | null) =>
  pending?.scope.boardId === boardId ? pending : undefined;
export const subscribeCollaborationPending = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const setCollaborationPending = (value: typeof pending) => {
  if (pending?.scope.boardId === value?.scope.boardId &&
      pending?.scope.sessionId === value?.scope.sessionId &&
      pending?.title === value?.title) return;
  pending = value;
  listeners.forEach(listener => listener());
};
