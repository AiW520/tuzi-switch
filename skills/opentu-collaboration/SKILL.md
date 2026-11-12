---
name: opentu-collaboration
description: Collaborate on an OpenTU creative board through its MCP tools, using the connected discussion, creative skills, media queue, and canvas. Use when the user asks to create, inspect, or edit work in OpenTU.
---

Use the `opentu` MCP connection provided by the running desktop application. If unavailable, direct the user to enable current-board collaboration in OpenTU's discussion and add the displayed MCP configuration to Codex. Never edit OpenTU storage files to simulate an operation.

Read `workspace_read` to identify the authorized board, discussion, and `outputDirectory`, then read the relevant discussion, board, or selection. `asset_read` returns image content for an element on this board. A connection grants access only to that board; switching boards requires a new connection.

For OpenTU creative skills, use `skills_list` and `skills_read`. Their instructions are reusable, but referenced scripts and assets are not automatically installed. Use available tools or identify the missing dependency. Do not claim that reading a skill executed its dependencies.

Submit media prompts through `media_submit`; OpenTU displays the actual configured model, prompts, and cost confirmation. The returned IDs are queued jobs. Use `jobs_list` or `job_get` to report their actual status and results. Avoid claiming completion from a queued response.

Before `canvas_apply`, `canvas_insert_text`, or `asset_import`, read `board_read` and supply its revision. A stale revision means no edit was authorized against the current board: read again and reconsider the change. Import supports PNG, JPEG, WebP, and GIF files in the discussion output directory, using a relative path.

Use a unique `operationId` for each intended mutation. Keep it unchanged on transport retries. On timeout or reconnection, query `operation_get` and the media jobs before retrying. An uncertain operation must be reconciled with the user; generating a new operation ID can duplicate costs or edits.

OpenTU requests confirmation for mutations. Do not bypass a refusal by writing storage or resubmitting under another ID. Use `discussion_append` to record a result without starting another agent turn, and `ui_focus_asset` to show a known element. Report actual changes, outstanding jobs, and dependencies that prevented completion.
