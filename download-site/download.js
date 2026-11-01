/* Static acceptance page: no account credentials or application backend required. */
(() => {
  const grid = document.querySelector(".download-grid");
  const status = document.getElementById("syncPill");
  const warning = document.getElementById("commandError");
  const pending = [];
  const platforms = ["macos", "macos-x64", "windows", "linux"];

  function flush() {
    if (typeof window.umami?.track !== "function") return;
    while (pending.length) {
      try {
        const result = window.umami.track(
          "switch_download_click",
          pending.shift(),
        );
        if (result && typeof result.catch === "function")
          result.catch(() => {});
      } catch (_) {
        /* Optional telemetry must not interfere with downloads. */
      }
    }
  }
  window.addEventListener("load", flush);

  function track(event) {
    if (event.type === "auxclick" && event.button !== 1) return;
    const card = event.target.closest("a[data-platform]");
    if (!card) return;
    if (pending.length < 20)
      pending.push({
        platform: card.dataset.platform,
        version: card.dataset.version,
      });
    flush();
  }
  grid.addEventListener("click", track);
  grid.addEventListener("auxclick", track);

  try {
    const release = JSON.parse(
      document.getElementById("download-release").textContent,
    );
    const repository = "AiW520/tuzi-switch";
    if (
      release.repository !== repository ||
      !/^[a-f0-9]{40}$/.test(release.commit) ||
      !/^v\d+\.\d+\.\d+-test\.[a-f0-9]{8}$/.test(release.version) ||
      !Number.isSafeInteger(release.runId) ||
      release.runId <= 0 ||
      !Array.isArray(release.downloads) ||
      release.downloads.length !== platforms.length ||
      new Set(release.downloads.map((item) => item.id)).size !==
        platforms.length
    ) {
      throw new Error("测试构建信息不完整，请从仓库的 Actions 查看成功构建。");
    }
    const runUrl = `https://github.com/${repository}/actions/runs/${release.runId}`;
    const cards = release.downloads.map((item) => {
      if (
        !platforms.includes(item.id) ||
        !Number.isSafeInteger(item.artifactId) ||
        item.artifactId <= 0 ||
        typeof item.title !== "string" ||
        typeof item.subtitle !== "string"
      )
        throw new Error("安装包信息无效。");
      const card = document.createElement("a");
      card.className = "download-card embedded-switch-download-card is-desktop";
      card.dataset.platform = item.id;
      card.dataset.version = release.version;
      card.href = `${runUrl}/artifacts/${item.artifactId}`;
      card.target = "_blank";
      card.rel = "noreferrer";
      const top = document.createElement("div");
      top.className = "td-platform-top";
      const icon = document.getElementById(
        `icon-${item.id.startsWith("macos") ? "macos" : item.id === "windows" ? "windows" : "rpm"}`,
      );
      top.append(icon.content.cloneNode(true));
      const format = document.createElement("span");
      format.className = "td-file-type";
      format.textContent = "ZIP";
      top.append(format);
      card.append(top);
      for (const [className, text] of [
        ["embedded-switch-dl-title", item.title],
        ["embedded-switch-dl-sub", item.subtitle],
        ["td-download-action", "获取测试安装包 ↗"],
      ]) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        card.append(span);
      }
      return card;
    });
    grid.replaceChildren(...cards);
    status.textContent = `${release.version} · 测试构建`;
    status.classList.remove("is-stale");
    document.getElementById("buildInfo").textContent =
      `源码 ${release.commit.slice(0, 8)} · 构建 #${release.runId}`;
    document.getElementById("readmeLink").href = runUrl;
    document.getElementById("githubSourceLink").href =
      `https://github.com/${repository}/tree/${release.commit}`;
  } catch (error) {
    grid.replaceChildren();
    status.textContent = "测试构建信息不可用";
    warning.textContent = error.message;
    warning.hidden = false;
    document.getElementById("readmeLink").href =
      "https://github.com/AiW520/tuzi-switch/actions/workflows/acceptance-build.yml";
  }
})();
