// Synthetic IPC for browser QA; never starts Codex or connects to real media.
import type {
  CollaborationCall,
  CollaborationScope,
} from "../../packages/creative-workspace/src/collaboration-types";
let current:
  | {
      scope: CollaborationScope;
      onCall: { onmessage: (call: CollaborationCall) => void };
    }
  | undefined;
const replies = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const fixture = {
  async call(name: string, args: Record<string, unknown> = {}) {
    if (!current) throw new Error("Synthetic bridge is disconnected");
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      replies.set(id, { resolve, reject });
      current!.onCall.onmessage({
        id,
        scope: current!.scope,
        name,
        arguments: args,
        expiresAt: Date.now() + 110000,
      });
    });
  },
};
(window as any).__collaborationFixture = fixture;
export async function collaborationPreviewIPC(command: string, args: any) {
  if (command === "creative_collaboration_start") {
    current = args;
    return {
      id: "synthetic-collaboration",
      configuration: '[mcp_servers.opentu]\ncommand = "SYNTHETIC ONLY"',
    };
  }
  if (command === "creative_collaboration_stop") {
    current = undefined;
    return;
  }
  const pending = replies.get(args.id);
  replies.delete(args.id);
  if (args.error) pending?.reject(new Error(args.error));
  else pending?.resolve(args.result);
}
