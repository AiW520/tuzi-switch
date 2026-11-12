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
