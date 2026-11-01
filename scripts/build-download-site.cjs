const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REPOSITORY = "AiW520/tuzi-switch";
const definitions = [
  ["macos", "macos-arm64", "macOS · Apple Silicon", "M 系列芯片 · 含 .dmg"],
  ["macos-x64", "macos-x64", "macOS · Intel", "Intel 芯片 · 含 .dmg"],
  ["windows", "windows-x64", "Windows", "x86_64 · 含 .exe / .msi"],
  ["linux", "linux-x64", "Linux", "x86_64 · 含 AppImage / DEB / RPM"],
];

function createMetadata({
  repository,
  version,
  commit,
  run,
  artifacts,
  allowInProgress = false,
}) {
  if (
    repository !== REPOSITORY ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !/^[a-f0-9]{40}$/.test(commit)
  ) {
    throw new Error("Invalid test repository, version or commit");
  }
  if (
    !Number.isSafeInteger(run.id) ||
    run.id <= 0 ||
    run.head_sha !== commit ||
    run.repository?.full_name !== repository ||
    !(
      (run.status === "completed" && run.conclusion === "success") ||
      (allowInProgress && run.status === "in_progress")
    )
  )
    throw new Error("Build identity or result mismatch");
  const downloads = definitions.map(([id, target, title, subtitle]) => {
    const matches = artifacts.filter(
      (item) => item.name === `tuzi-assistant-${target}-${commit}`,
    );
    const artifact = matches[0];
    if (
      matches.length !== 1 ||
      artifact.expired ||
      !Number.isSafeInteger(artifact.id) ||
      artifact.id <= 0 ||
      (artifact.workflow_run?.head_sha &&
        artifact.workflow_run.head_sha !== commit)
    ) {
      throw new Error(
        `Missing, expired, duplicated or mismatched installer artifact: ${target}`,
      );
    }
    return { id, title, subtitle, artifactId: artifact.id };
  });
  return {
    schemaVersion: 1,
    repository,
    commit,
    runId: run.id,
    version: `v${version}-test.${commit.slice(0, 8)}`,
    downloads,
  };
}

async function build() {
  const repository = process.env.GITHUB_REPOSITORY || REPOSITORY;
  const commit = process.env.DOWNLOAD_SITE_COMMIT || process.env.GITHUB_SHA;
  const runId = process.env.DOWNLOAD_SITE_RUN_ID || process.env.GITHUB_RUN_ID;
  if (
    repository !== REPOSITORY ||
    !/^\d+$/.test(runId || "") ||
    !/^[a-f0-9]{40}$/.test(commit || "")
  ) {
    throw new Error("Explicit test repository, run ID and commit are required");
  }
  async function get(endpoint) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/${endpoint}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub metadata request failed (${response.status})`);
    return response.json();
  }
  const [run, artifacts] = await Promise.all([
    get(`actions/runs/${runId}`),
    get(`actions/runs/${runId}/artifacts?per_page=100`),
  ]);
  const root = path.resolve(__dirname, "..");
  const version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const metadata = createMetadata({
    repository,
    version,
    commit,
    run,
    artifacts: artifacts.artifacts,
    allowInProgress: process.env.GITHUB_RUN_ID === String(run.id),
  });
  const output = path.join(root, "dist/download-site");
  fs.mkdirSync(output, { recursive: true });
  const template = fs.readFileSync(
    path.join(root, "download-site/index.html"),
    "utf8",
  );
  const json = JSON.stringify(metadata).replaceAll("<", "\\u003c");
  if (!template.includes("<!-- DOWNLOAD_RELEASE -->"))
    throw new Error("Missing release metadata slot");
  fs.writeFileSync(
    path.join(output, "index.html"),
    template.replace(
      "<!-- DOWNLOAD_RELEASE -->",
      `<script type="application/json" id="download-release">${json}</script>`,
    ),
  );
  fs.copyFileSync(
    path.join(root, "download-site/download.js"),
    path.join(output, "download.js"),
  );
  fs.writeFileSync(
    path.join(output, "build.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "README.txt"),
    "兔子助手测试下载页\n解压后直接打开 index.html。按钮下载对应构建的 ZIP，需要登录 GitHub。安装包内含 manifest.json 和 SHA-256。\n测试包未做正式开发者签名及公证。Actions 产物保留 30 天。正式站点未变更。\n",
  );
  for (const file of ["LICENSE", "NOTICE.md"]) {
    fs.copyFileSync(
      path.join(root, "download-site", file),
      path.join(output, file),
    );
  }
  const files = [
    "index.html",
    "download.js",
    "build.json",
    "README.txt",
    "LICENSE",
    "NOTICE.md",
  ];
  fs.writeFileSync(
    path.join(output, "SHA256SUMS.txt"),
    files
      .map(
        (file) =>
          `${crypto
            .createHash("sha256")
            .update(fs.readFileSync(path.join(output, file)))
            .digest("hex")}  ${file}\n`,
      )
      .join(""),
  );
  console.log(`Built ${output} for ${repository}@${commit} (run ${runId})`);
}

module.exports = { createMetadata };
if (require.main === module)
  build().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
