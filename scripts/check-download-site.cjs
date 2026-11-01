const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMetadata } = require("./build-download-site.cjs");
const commit = "a".repeat(40);
function fixture() {
  return {
    repository: "AiW520/tuzi-switch",
    version: "1.4.2",
    commit,
    run: {
      id: 123,
      head_sha: commit,
      repository: { full_name: "AiW520/tuzi-switch" },
      status: "completed",
      conclusion: "success",
    },
    artifacts: ["macos-arm64", "macos-x64", "windows-x64", "linux-x64"].map(
      (target, i) => ({
        id: i + 100,
        name: `tuzi-assistant-${target}-${commit}`,
        expired: false,
        workflow_run: { head_sha: commit },
      }),
    ),
  };
}

test("builds four platform groups tied to exactly one run and source commit", () => {
  const metadata = createMetadata(fixture());
  assert.equal(metadata.version, "v1.4.2-test.aaaaaaaa");
  assert.deepEqual(
    metadata.downloads.map((item) => item.artifactId),
    [100, 101, 102, 103],
  );
  assert.deepEqual(
    metadata.downloads.map((item) => item.id),
    ["macos", "macos-x64", "windows", "linux"],
  );
});
test("rejects failed, unfinished and different-source builds", () => {
  for (const change of [
    (run) => {
      run.conclusion = "failure";
    },
    (run) => {
      run.status = "in_progress";
    },
    (run) => {
      run.head_sha = "b".repeat(40);
    },
    (run) => {
      run.repository.full_name = "tuziapi/tuzi-switch";
    },
  ]) {
    const data = fixture();
    change(data.run);
    assert.throws(() => createMetadata(data));
  }
});
test("permits the current workflow after prerequisite installer jobs complete", () => {
  const data = fixture();
  data.run.status = "in_progress";
  data.run.conclusion = null;
  data.allowInProgress = true;
  assert.equal(createMetadata(data).runId, 123);
});
test("rejects missing, duplicated, expired and cross-source installers", () => {
  for (const change of [
    (a) => a.pop(),
    (a) => a.push(a[0]),
    (a) => {
      a[1].expired = true;
    },
    (a) => {
      a[1].workflow_run.head_sha = "b".repeat(40);
    },
    (a) => {
      a[1].id = -1;
    },
  ]) {
    const data = fixture();
    change(data.artifacts);
    assert.throws(() => createMetadata(data));
  }
});
test("never accepts production repository configuration or unsafe version text", () => {
  for (const change of [
    (d) => {
      d.repository = "tuziapi/tuzi-switch";
    },
    (d) => {
      d.version = "<script>";
    },
    (d) => {
      d.commit = "main";
    },
  ]) {
    const data = fixture();
    change(data);
    assert.throws(() => createMetadata(data));
  }
});
