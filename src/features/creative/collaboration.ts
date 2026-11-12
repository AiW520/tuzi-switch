import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  CollaborationBridge,
  CollaborationCall,
} from "../../../packages/creative-workspace/src/collaboration-types";

export const nativeCollaboration: CollaborationBridge = {
  async start(scope, handle) {
    const onCall = new Channel<CollaborationCall>();
    onCall.onmessage = (call) => {
      void Promise.resolve()
        .then(() => handle(call))
        .then(
          (result) =>
            invoke("creative_collaboration_reply", {
              id: call.id,
              result,
              error: null,
            }),
          (error) =>
            invoke("creative_collaboration_reply", {
              id: call.id,
              result: null,
              error: error instanceof Error ? error.message : "操作失败",
            }),
        )
        .catch(() => {});
    };
    return invoke("creative_collaboration_start", { scope, onCall });
  },
  stop: (id) => invoke("creative_collaboration_stop", { id }),
};
