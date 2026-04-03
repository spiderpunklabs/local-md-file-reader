(() => {
  const app = window.__appTestHooks;

  if (!app) {
    throw new Error("App test hooks were not initialized.");
  }

  const ui = {
    runAll: document.querySelector("#run-all"),
    resetApp: document.querySelector("#reset-app"),
    scenarioList: document.querySelector("#scenario-list"),
    summaryTitle: document.querySelector("#summary-title"),
    summaryText: document.querySelector("#summary-text"),
    summaryPill: document.querySelector("#summary-pill"),
    fileInput: document.querySelector("#file-input"),
    folderInput: document.querySelector("#folder-input"),
    dropzone: document.querySelector("#dropzone"),
    markdownInput: document.querySelector("#markdown-input"),
    preview: document.querySelector("#preview"),
    viewer: document.querySelector(".viewer"),
    sourcePanel: document.querySelector(".panel-source"),
    railToggle: document.querySelector("#rail-toggle"),
    sourceToggle: document.querySelector("#source-toggle"),
    historySectionToggle: document.querySelector("#history-section-toggle"),
    historySectionBody: document.querySelector("#history-section-body"),
    historyList: document.querySelector("#history-list"),
    historyCount: document.querySelector("#history-count"),
    directorySectionToggle: document.querySelector("#directory-section-toggle"),
    directorySectionBody: document.querySelector("#directory-section-body"),
    directoryList: document.querySelector("#directory-list"),
    directoryLabel: document.querySelector("#directory-label"),
    panelFileName: document.querySelector("#panel-file-name"),
    panelDocStats: document.querySelector("#panel-doc-stats"),
    dropDocStats: document.querySelector("#drop-doc-stats"),
    dropFileName: document.querySelector("#drop-file-name"),
    renderStatus: document.querySelector("#render-status"),
  };

  const clickSpy = {
    file: 0,
    folder: 0,
  };

  const runButtons = new Map();
  const statusBadges = new Map();
  const detailBlocks = new Map();
  let suiteRunning = false;

  class HarnessFileReader {
    readAsText(file) {
      window.setTimeout(async () => {
        try {
          if (file && file.shouldFail) {
            if (typeof this.onerror === "function") {
              this.onerror(new Error("Could not read file"));
            }
            return;
          }

          let result = "";

          if (file && typeof file.__content === "string") {
            result = file.__content;
          } else if (file && typeof file.content === "string") {
            result = file.content;
          } else if (file && typeof file.text === "function") {
            result = await file.text();
          }

          this.result = result;

          if (typeof this.onload === "function") {
            this.onload({ target: this });
          }
        } catch (error) {
          if (typeof this.onerror === "function") {
            this.onerror(error);
          }
        }
      }, 0);
    }
  }

  window.FileReader = HarnessFileReader;
  ui.fileInput.click = () => {
    clickSpy.file += 1;
  };
  ui.folderInput.click = () => {
    clickSpy.folder += 1;
  };

  function createHarnessFile(name, content, options = {}) {
    return {
      name,
      __content: content,
      type: options.type || "text/markdown",
      webkitRelativePath: options.webkitRelativePath || "",
      shouldFail: Boolean(options.shouldFail),
    };
  }

  function readFileContent(file) {
    if (!file) {
      return "";
    }

    if (typeof file.__content === "string") {
      return file.__content;
    }

    if (typeof file.content === "string") {
      return file.content;
    }

    return "";
  }

  function setInputFiles(input, files) {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files,
    });
  }

  function clearInputFiles(input) {
    setInputFiles(input, []);
    input.value = "";
  }

  function tick(delay = 0) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, delay);
    });
  }

  async function waitFor(predicate, message, timeoutMs = 600) {
    const startedAt = window.performance.now();

    while (window.performance.now() - startedAt < timeoutMs) {
      if (predicate()) {
        return;
      }

      await tick(10);
    }

    throw new Error(message);
  }

  function formatValue(value) {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        `${message}\nExpected: ${formatValue(expected)}\nReceived: ${formatValue(actual)}`
      );
    }
  }

  function match(value, pattern, message) {
    if (!pattern.test(value)) {
      throw new Error(`${message}\nMissing pattern: ${pattern}\nReceived: ${formatValue(value)}`);
    }
  }

  function notMatch(value, pattern, message) {
    if (pattern.test(value)) {
      throw new Error(`${message}\nUnexpected match: ${pattern}\nReceived: ${formatValue(value)}`);
    }
  }

  function getAttributeValues(html, attribute) {
    const pattern = new RegExp(`\\b${attribute}="([^"]*)"`, "g");
    return Array.from(html.matchAll(pattern), (entry) => entry[1]);
  }

  function isSafeUrl(value) {
    const normalized = value.replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
    const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(normalized);

    return (
      normalized === "" ||
      normalized.startsWith("#") ||
      normalized.startsWith("/") ||
      normalized.startsWith("./") ||
      normalized.startsWith("../") ||
      normalized.startsWith("?") ||
      normalized.startsWith("http:") ||
      normalized.startsWith("https:") ||
      !hasScheme
    );
  }

  function collectUnsafeUrls(html) {
    const leaks = [];

    for (const attribute of ["href", "src"]) {
      for (const value of getAttributeValues(html, attribute)) {
        if (!isSafeUrl(value)) {
          leaks.push(`${attribute}=${JSON.stringify(value)}`);
        }
      }
    }

    return leaks;
  }

  function assertNoUnsafeUrls(html, message) {
    const leaks = collectUnsafeUrls(html);
    if (leaks.length > 0) {
      throw new Error(`${message}\n${leaks.join("\n")}`);
    }
  }

  function dispatchInputChange(input) {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function chooseFile(file) {
    setInputFiles(ui.fileInput, [file]);
    dispatchInputChange(ui.fileInput);
    await waitFor(
      () =>
        ui.panelFileName.textContent === file.name &&
        ui.markdownInput.value === readFileContent(file),
      `Timed out waiting for ${file.name} to load through the file input.`
    );
    clearInputFiles(ui.fileInput);
  }

  async function chooseFolder(files, expectedFile) {
    setInputFiles(ui.folderInput, files);
    dispatchInputChange(ui.folderInput);
    const targetFile = expectedFile || files[0];

    await waitFor(
      () =>
        ui.panelFileName.textContent === targetFile.name &&
        ui.markdownInput.value === readFileContent(targetFile),
      `Timed out waiting for ${targetFile.name} to load through the folder input.`
    );
    clearInputFiles(ui.folderInput);
  }

  function dispatchDropzoneEvent(name, files = []) {
    const event = new Event(name, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: { files },
    });
    ui.dropzone.dispatchEvent(event);
  }

  async function dropFiles(files, expectedFile) {
    dispatchDropzoneEvent("drop", files);
    const targetFile = expectedFile || files[0];

    await waitFor(
      () =>
        ui.panelFileName.textContent === targetFile.name &&
        ui.markdownInput.value === readFileContent(targetFile),
      `Timed out waiting for ${targetFile.name} to load through drag-and-drop.`
    );
  }

  function resetHarnessState() {
    clickSpy.file = 0;
    clickSpy.folder = 0;
    clearInputFiles(ui.fileInput);
    clearInputFiles(ui.folderInput);
    ui.dropzone.classList.remove("dragging");

    app.state.hasLoadedRealDocument = false;
    app.state.railOpen = false;
    app.state.sourceVisible = true;
    app.state.sections.history = true;
    app.state.sections.directory = true;
    app.state.history = [];
    app.state.directoryFiles = [];
    app.state.nextHistoryId = 1;
    app.state.nextDirectoryId = 1;
    app.state.currentDocument = {
      name: "sample.md",
      path: "",
      content: app.sampleMarkdown,
      historyId: null,
      directoryId: null,
      directoryKey: "",
    };

    app.loadMarkdown(app.sampleMarkdown, "sample.md", {
      path: "sample.md",
      history: false,
      directoryId: null,
      directoryKey: null,
    });
    app.state.hasLoadedRealDocument = false;
    app.state.railOpen = false;
    app.setSourceVisible(true);
    app.setSectionExpanded("history", true);
    app.setSectionExpanded("directory", true);
    app.setLoadedChrome();
    ui.renderStatus.textContent = "Rendered locally";
  }

  function formatError(error) {
    const value = error && error.stack ? error.stack : String(error);
    return value
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n");
  }

  const scenarios = [
    {
      id: "malicious-preview",
      name: "Malicious preview content stays inert",
      kind: "test",
      async run() {
        const maliciousMarkdown = [
          "# Attack Surface",
          '<script>alert(1)</script>',
          "",
          '<div onclick="alert(1)">x</div>',
          "",
          '[x](https://safe.test "title" onmouseover="alert(1))',
        ].join("\n");

        await chooseFile(createHarnessFile("evil<script>.md", maliciousMarkdown));

        const html = ui.preview.innerHTML;
        notMatch(html, /<script\b/i, "Preview should not contain live script tags.");
        notMatch(html, /<div onclick=/i, "Preview should not keep inline event handlers live.");
        match(
          html,
          /&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
          "Escaped script markup was not preserved in the preview."
        );
        match(
          html,
          /&lt;div onclick=&quot;alert\(1\)&quot;&gt;x&lt;\/div&gt;/,
          "Escaped raw HTML markup was not preserved in the preview."
        );
        notMatch(
          html,
          /<a href="https:\/\/safe\.test"/i,
          "Malformed attribute-like markdown should stay inert."
        );
        match(
          ui.historyList.innerHTML,
          /evil&lt;script&gt;\.md/,
          "History should escape HTML-like filenames from opened files."
        );
        equal(ui.historyCount.textContent, "1", "History count should increment after a file open.");
        equal(ui.renderStatus.textContent, "Rendered locally", "Preview status should return to rendered.");
      },
    },
    {
      id: "unsafe-urls",
      name: "Unsafe URL protocols are blocked",
      kind: "known-gap",
      run() {
        const cases = [
          "[x](javascript:alert(1))",
          "[x](JaVaScRiPt:alert(1))",
          "[x](java\u0000script:alert(1))",
          "[x](\u0001javascript:alert(1))",
          "[x](data:text/html,<svg/onload=1>)",
          "![x](data:image/svg+xml,<svg/onload=1>)",
          "[x](vbscript:msgbox(1))",
        ];

        const leaks = [];

        for (const markdown of cases) {
          const html = app.parseMarkdown(markdown);
          const unsafeValues = collectUnsafeUrls(html);

          unsafeValues.forEach((value) => {
            leaks.push(`${value} from ${JSON.stringify(markdown)}`);
          });
        }

        assert(
          leaks.length === 0,
          `Unsafe URLs remained live in rendered HTML.\n${leaks.join("\n")}`
        );
      },
    },
    {
      id: "file-folder-flows",
      name: "File-open and folder-open flows stay wired",
      kind: "test",
      async run() {
        document.querySelector("[data-action='open-file']").click();
        equal(clickSpy.file, 1, "Open-file buttons should proxy to the hidden file input.");

        await chooseFile(createHarnessFile("notes.md", "# Notes\n\nOne two"));

        equal(ui.panelFileName.textContent, "notes.md", "Single-file selection should load the document.");
        equal(ui.historyCount.textContent, "1", "Single-file selection should create one history entry.");
        assert(document.body.classList.contains("has-document"), "Loaded chrome should appear after a real file.");
        assert(document.body.classList.contains("rail-open"), "The rail should open after a real file.");

        document.querySelector("[data-action='open-folder']").click();
        equal(clickSpy.folder, 1, "Open-folder buttons should proxy to the hidden folder input.");

        const folderFiles = [
          createHarnessFile("notes.md", "# Notes from folder", {
            webkitRelativePath: "docs/notes.md",
          }),
          createHarnessFile("sibling.md", "# Sibling", {
            webkitRelativePath: "docs/sibling.md",
          }),
          createHarnessFile("cover.png", "binary", {
            webkitRelativePath: "docs/cover.png",
            type: "image/png",
          }),
        ];

        await chooseFolder(folderFiles, folderFiles[0]);

        equal(
          ui.markdownInput.value,
          "# Notes from folder",
          "Folder selection should load the matching current file when names line up."
        );
        equal(ui.directoryLabel.textContent, "docs", "Directory label should reflect the selected folder.");
        equal(
          ui.historyCount.textContent,
          "2",
          "Selecting a folder-backed path should preserve the earlier single-file entry."
        );
        match(
          ui.directoryList.textContent,
          /sibling\.md/,
          "Folder selection should render sibling markdown files in the rail."
        );
        notMatch(
          ui.directoryList.textContent,
          /cover\.png/,
          "Folder selection should filter non-markdown siblings out of the rail."
        );
      },
    },
    {
      id: "weird-filenames",
      name: "Weird filenames stay escaped in both rails",
      kind: "test",
      async run() {
        await chooseFile(createHarnessFile("<current>.md", "# current"));

        const weirdFiles = [
          createHarnessFile("<current>.md", "# current from folder", {
            webkitRelativePath: "odd/../../<current>.md",
          }),
          createHarnessFile("<other>.md", "# other", {
            webkitRelativePath: "odd/../../<other>.md",
          }),
          createHarnessFile("ALPHA.TXT", "Alpha", {
            webkitRelativePath: "odd/../../ALPHA.TXT",
          }),
          createHarnessFile("cover.png", "binary", {
            webkitRelativePath: "odd/../../cover.png",
            type: "image/png",
          }),
        ];

        await chooseFolder(weirdFiles, weirdFiles[0]);

        equal(ui.directoryLabel.textContent, "odd/../..", "Weird directory labels should render as text.");
        match(
          ui.historyList.innerHTML,
          /&lt;current&gt;\.md/,
          "History rail should escape HTML-like current filenames."
        );
        match(
          ui.historyList.innerHTML,
          /odd\/\.\.\/\.\.\/&lt;current&gt;\.md/,
          "History rail should escape HTML-like paths."
        );
        match(
          ui.directoryList.innerHTML,
          /&lt;other&gt;\.md/,
          "Directory rail should escape HTML-like sibling filenames."
        );
        match(
          ui.directoryList.innerHTML,
          /ALPHA\.TXT/,
          "TXT siblings should remain visible in the directory rail."
        );
        notMatch(
          ui.directoryList.innerHTML,
          /cover\.png/,
          "Non-markdown siblings should stay out of the directory rail."
        );
        notMatch(
          ui.directoryList.innerHTML,
          /<other>\.md/,
          "Directory rail should not inject raw HTML from sibling names."
        );
      },
    },
    {
      id: "drag-drop",
      name: "Drag-and-drop covers single files and folder-like drops",
      kind: "test",
      async run() {
        dispatchDropzoneEvent("dragenter");
        assert(ui.dropzone.classList.contains("dragging"), "Drag enter should mark the dropzone as dragging.");
        dispatchDropzoneEvent("dragover");
        assert(ui.dropzone.classList.contains("dragging"), "Drag over should keep the dragging state.");
        dispatchDropzoneEvent("dragleave");
        assert(!ui.dropzone.classList.contains("dragging"), "Drag leave should clear the dragging state.");

        const singleDrop = createHarnessFile("drag.md", "# Drag drop");
        dispatchDropzoneEvent("dragenter");
        await dropFiles([singleDrop], singleDrop);
        assert(!ui.dropzone.classList.contains("dragging"), "Drop should clear the dragging state.");
        equal(ui.panelFileName.textContent, "drag.md", "A single dropped markdown file should open directly.");
        equal(ui.historyCount.textContent, "1", "A single dropped file should create one history entry.");

        resetHarnessState();

        const multiDropFiles = [
          createHarnessFile("drop-one.md", "# one", {
            webkitRelativePath: "drops/drop-one.md",
          }),
          createHarnessFile("drop-two.md", "# two", {
            webkitRelativePath: "drops/drop-two.md",
          }),
          createHarnessFile("notes.txt", "three words here", {
            webkitRelativePath: "drops/notes.txt",
          }),
        ];

        dispatchDropzoneEvent("dragenter");
        await dropFiles(multiDropFiles, multiDropFiles[0]);

        equal(ui.directoryLabel.textContent, "drops", "Multi-file drops should reuse the folder-selection flow.");
        match(
          ui.directoryList.textContent,
          /drop-two\.md/,
          "Folder-like drops should list sibling markdown files in the directory rail."
        );
        match(
          ui.directoryList.textContent,
          /notes\.txt/,
          "Folder-like drops should retain markdown-like TXT siblings."
        );
      },
    },
    {
      id: "toggles-stats",
      name: "Rail, section, source, and stats toggles stay in sync",
      kind: "test",
      async run() {
        await chooseFile(createHarnessFile("toggle.md", "alpha beta\ngamma"));

        equal(ui.panelDocStats.textContent, "2 lines • 3 words", "Initial stats should reflect loaded file content.");

        ui.railToggle.click();
        assert(!document.body.classList.contains("rail-open"), "Rail toggle should close the navigator.");
        equal(ui.railToggle.getAttribute("aria-expanded"), "false", "Rail toggle aria state should close.");
        ui.railToggle.click();
        assert(document.body.classList.contains("rail-open"), "Rail toggle should reopen the navigator.");
        equal(ui.railToggle.getAttribute("aria-expanded"), "true", "Rail toggle aria state should reopen.");

        ui.historySectionToggle.click();
        assert(
          ui.historySectionBody.classList.contains("collapsed"),
          "History section toggle should collapse the section body."
        );
        equal(ui.historySectionToggle.textContent.trim(), "Expand", "History toggle label should switch to Expand.");
        ui.historySectionToggle.click();
        assert(
          !ui.historySectionBody.classList.contains("collapsed"),
          "History section toggle should reopen the section body."
        );

        ui.directorySectionToggle.click();
        assert(
          ui.directorySectionBody.classList.contains("collapsed"),
          "Directory section toggle should collapse the section body."
        );
        equal(
          ui.directorySectionToggle.textContent.trim(),
          "Expand",
          "Directory toggle label should switch to Expand."
        );
        ui.directorySectionToggle.click();
        assert(
          !ui.directorySectionBody.classList.contains("collapsed"),
          "Directory section toggle should reopen the section body."
        );

        ui.sourceToggle.click();
        assert(ui.sourcePanel.classList.contains("hidden"), "Source toggle should hide the source panel.");
        assert(ui.viewer.classList.contains("source-hidden"), "Viewer should stretch when the source panel is hidden.");
        equal(ui.sourceToggle.textContent.trim(), "Show Source", "Source toggle label should switch to Show Source.");
        ui.sourceToggle.click();
        assert(!ui.sourcePanel.classList.contains("hidden"), "Source panel should be visible after toggling back on.");
        assert(!ui.viewer.classList.contains("source-hidden"), "Viewer layout should reset when source is shown.");

        ui.markdownInput.value = "# title\nsecond line";
        ui.markdownInput.dispatchEvent(new Event("input", { bubbles: true }));

        equal(ui.panelDocStats.textContent, "2 lines • 4 words", "Panel stats should update after source edits.");
        equal(ui.dropDocStats.textContent, "2 lines • 4 words", "Dropzone stats should mirror panel stats after edits.");
        match(
          ui.preview.innerHTML,
          /^<h1>title<\/h1>/,
          "Preview should re-render immediately after source edits."
        );
        equal(
          app.state.history[0].content,
          "# title\nsecond line",
          "Edits should stay attached to the active history entry."
        );
      },
    },
    {
      id: "reset-history",
      name: "Reset restores the sample without erasing history",
      kind: "test",
      async run() {
        await chooseFile(createHarnessFile("first.md", "# First"));
        await chooseFile(createHarnessFile("second.md", "# Second"));

        ui.markdownInput.value = "# Second revised";
        ui.markdownInput.dispatchEvent(new Event("input", { bubbles: true }));

        equal(ui.historyCount.textContent, "2", "Two real documents should create two history entries before reset.");

        document.querySelector("[data-action='reset']").click();

        await waitFor(
          () =>
            ui.panelFileName.textContent === "sample.md" &&
            ui.renderStatus.textContent === "Sample restored",
          "Timed out waiting for reset to restore the sample document."
        );

        equal(ui.historyCount.textContent, "2", "Reset should not erase existing history entries.");
        equal(ui.directoryLabel.textContent, "Unavailable", "Reset should clear directory context.");
        notMatch(
          ui.historyList.textContent,
          /sample\.md/,
          "Reset should not create a new history row for the sample document."
        );
        match(
          ui.preview.innerHTML,
          /^<h1>Markdown Reader<\/h1>/,
          "Reset should restore the bundled sample preview."
        );

        const newestHistoryItem = ui.historyList.querySelector("[data-history-id]");
        assert(newestHistoryItem, "History should still render clickable items after reset.");
        newestHistoryItem.click();

        await waitFor(
          () => ui.panelFileName.textContent === "second.md",
          "Timed out waiting for a history item to reopen after reset."
        );

        equal(
          ui.markdownInput.value,
          "# Second revised",
          "History reopen should restore the edited document content after reset."
        );
        match(
          ui.preview.innerHTML,
          /^<h1>Second revised<\/h1>/,
          "Preview should reopen the edited history item after reset."
        );
      },
    },
  ];

  function renderScenarioRows() {
    const fragment = document.createDocumentFragment();

    scenarios.forEach((scenario) => {
      const item = document.createElement("li");
      item.className = "scenario-card";

      const topline = document.createElement("div");
      topline.className = "scenario-topline";

      const copy = document.createElement("div");
      const title = document.createElement("h2");
      title.textContent = scenario.name;
      const kind = document.createElement("p");
      kind.className = "scenario-kind";
      kind.textContent = scenario.kind === "known-gap" ? "Watchlist" : "Regression";
      copy.append(title, kind);

      const controls = document.createElement("div");
      controls.className = "scenario-controls";

      const badge = document.createElement("span");
      badge.className = "scenario-status";
      badge.textContent = "Idle";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost compact";
      button.textContent = "Run";
      button.addEventListener("click", () => {
        void runScenario(scenario);
      });

      controls.append(badge, button);
      topline.append(copy, controls);

      const detail = document.createElement("pre");
      detail.className = "scenario-detail";
      detail.textContent = "Not run yet.";

      item.append(topline, detail);
      fragment.append(item);

      runButtons.set(scenario.id, button);
      statusBadges.set(scenario.id, badge);
      detailBlocks.set(scenario.id, detail);
    });

    ui.scenarioList.replaceChildren(fragment);
  }

  function setScenarioState(id, status, detail) {
    const badge = statusBadges.get(id);
    const detailBlock = detailBlocks.get(id);

    if (!badge || !detailBlock) {
      return;
    }

    badge.className = `scenario-status ${status}`;
    badge.textContent = status.replace("-", " ");
    detailBlock.textContent = detail;
  }

  function updateSummary() {
    const counts = {
      pass: 0,
      fail: 0,
      "known-gap": 0,
      "gap-closed": 0,
      running: 0,
      idle: 0,
    };

    scenarios.forEach((scenario) => {
      const badge = statusBadges.get(scenario.id);
      const status =
        badge && badge.classList.length > 1 ? badge.classList.item(1) : "idle";
      counts[status] = (counts[status] || 0) + 1;
    });

    if (counts.running > 0) {
      ui.summaryTitle.textContent = "Running";
      ui.summaryText.textContent = `Running ${counts.running} scenario${counts.running === 1 ? "" : "s"}...`;
      ui.summaryPill.textContent = "Running";
      ui.summaryPill.className = "summary-pill running";
      return;
    }

    ui.summaryTitle.textContent = "Results";
    ui.summaryText.textContent =
      `${counts.pass} passed, ${counts.fail} failed, ` +
      `${counts["known-gap"]} known gaps, ${counts["gap-closed"]} gaps closed`;

    const overallStatus =
      counts.fail > 0 ? "fail" : counts["known-gap"] > 0 ? "watchlist" : "pass";

    ui.summaryPill.textContent =
      overallStatus === "pass"
        ? "Passing"
        : overallStatus === "watchlist"
          ? "Watchlist"
          : "Failing";
    ui.summaryPill.className = `summary-pill ${overallStatus}`;
  }

  function setButtonsDisabled(disabled) {
    ui.runAll.disabled = disabled;
    scenarios.forEach((scenario) => {
      const button = runButtons.get(scenario.id);
      if (button) {
        button.disabled = disabled;
      }
    });
  }

  async function runScenario(scenario) {
    if (suiteRunning) {
      return;
    }

    suiteRunning = true;
    setButtonsDisabled(true);
    setScenarioState(scenario.id, "running", "Running scenario...");
    updateSummary();
    resetHarnessState();

    try {
      await scenario.run();
      if (scenario.kind === "known-gap") {
        setScenarioState(
          scenario.id,
          "gap-closed",
          "Expected failure did not reproduce. This watchlist item may now be fixed."
        );
      } else {
        setScenarioState(scenario.id, "pass", "Scenario completed without regressions.");
      }
    } catch (error) {
      if (scenario.kind === "known-gap") {
        setScenarioState(
          scenario.id,
          "known-gap",
          `Known gap reproduced.\n${formatError(error)}`
        );
      } else {
        setScenarioState(scenario.id, "fail", formatError(error));
      }
    } finally {
      suiteRunning = false;
      setButtonsDisabled(false);
      updateSummary();
    }
  }

  async function runAllScenarios() {
    if (suiteRunning) {
      return;
    }

    suiteRunning = true;
    setButtonsDisabled(true);

    for (const scenario of scenarios) {
      setScenarioState(scenario.id, "running", "Running scenario...");
      updateSummary();
      resetHarnessState();

      try {
        await scenario.run();
        if (scenario.kind === "known-gap") {
          setScenarioState(
            scenario.id,
            "gap-closed",
            "Expected failure did not reproduce. This watchlist item may now be fixed."
          );
        } else {
          setScenarioState(scenario.id, "pass", "Scenario completed without regressions.");
        }
      } catch (error) {
        if (scenario.kind === "known-gap") {
          setScenarioState(
            scenario.id,
            "known-gap",
            `Known gap reproduced.\n${formatError(error)}`
          );
        } else {
          setScenarioState(scenario.id, "fail", formatError(error));
        }
      }
    }

    suiteRunning = false;
    setButtonsDisabled(false);
    updateSummary();
  }

  renderScenarioRows();
  resetHarnessState();
  updateSummary();

  ui.runAll.addEventListener("click", () => {
    void runAllScenarios();
  });

  ui.resetApp.addEventListener("click", () => {
    if (suiteRunning) {
      return;
    }

    resetHarnessState();
    ui.summaryTitle.textContent = "Ready";
    ui.summaryText.textContent = "App shell reset to the sample state.";
    ui.summaryPill.textContent = "Idle";
    ui.summaryPill.className = "summary-pill";
  });

  void runAllScenarios();
})();
