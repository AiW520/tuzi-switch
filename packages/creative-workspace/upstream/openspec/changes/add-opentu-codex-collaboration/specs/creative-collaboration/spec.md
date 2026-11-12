## ADDED Requirements

### Requirement: Discover usable capabilities
The application SHALL distinguish configured capabilities from callable skills and MCP tools for the selected Codex runtime.

#### Scenario: A skill requires an unavailable host tool
- **WHEN** a skill depends on a desktop-only tool absent from the connected runtime
- **THEN** the UI reports the missing dependency and does not claim successful execution.

### Requirement: Execute bidirectional creative operations
The application SHALL expose scoped workspace, selection, media job, canvas and discussion operations through the same business layer used by its UI.

#### Scenario: An external Codex client arranges assets
- **WHEN** an authorized client submits an operation for a known board and revision
- **THEN** the application validates it, applies it through its business layer and returns an actual result visible on that board.

### Requirement: Preserve task identity and recover safely
The application SHALL bind discussions, Codex threads and media jobs to explicit workspace and board identities and persist operation identifiers before side effects.

#### Scenario: A paid submission response is lost
- **WHEN** a media request has an uncertain external outcome
- **THEN** the application reconciles status or reports uncertainty without automatically repeating the paid request.

#### Scenario: A board changes during execution
- **WHEN** a canvas write targets a stale revision or unavailable board
- **THEN** the application returns a conflict or unavailable status instead of writing to the current unrelated board.

### Requirement: Share skills without losing dependencies
The application SHALL preserve complete portable skill packages and expose application-specific workflows through compatible wrappers with explicit dependencies and provenance.

#### Scenario: Two sources use the same skill name
- **WHEN** the capability catalog discovers differing packages with the same display name
- **THEN** it retains distinct identities and does not silently overwrite either source.

### Requirement: Enforce task-scoped execution
The application SHALL check task grants for outputs and side effects, surface out-of-scope approval requests, and prevent recursive agent dispatch.

#### Scenario: Codex writes a discussion result
- **WHEN** OpenTU receives a result from a Codex-originated operation
- **THEN** it records the result without automatically starting another Codex turn.
