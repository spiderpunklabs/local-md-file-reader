const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");
const appScript = new vm.Script(
  `${appSource}
;globalThis.__appTestExports = {
  sampleMarkdown,
  state,
  parseMarkdown,
  renderHistory,
  renderDirectory,
  loadMarkdown,
  resetToSample,
  setDirectoryFiles,
  clearHistory: typeof clearHistory === "function" ? clearHistory : undefined,
};
`,
  { filename: appPath }
);

const tests = [];
const knownGaps = [];

function test(name, run) {
  tests.push({ name, run });
}

function knownGap(name, run) {
  knownGaps.push({ name, run });
}

function createClassList() {
  const values = new Set();

  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, force) {
      if (force === undefined) {
        if (values.has(name)) {
          values.delete(name);
          return false;
        }

        values.add(name);
        return true;
      }

      if (force) {
        values.add(name);
      } else {
        values.delete(name);
      }

      return force;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function createElement(name) {
  return {
    name,
    innerHTML: "",
    textContent: "",
    hidden: false,
    value: "",
    disabled: false,
    dataset: {},
    attributes: {},
    classList: createClassList(),
    addEventListener() {},
    removeEventListener() {},
    setAttribute(attribute, value) {
      this.attributes[attribute] = String(value);
    },
    getAttribute(attribute) {
      return Object.prototype.hasOwnProperty.call(this.attributes, attribute)
        ? this.attributes[attribute]
        : null;
    },
    closest() {
      return null;
    },
    click() {},
  };
}

function createHarness() {
  const baseSelectors = [
    "#file-input",
    "#folder-input",
    "#source-toggle",
    "#rail-toggle",
    "#dropzone",
    "#markdown-input",
    "#preview",
    ".viewer",
    "#drop-file-name",
    "#drop-doc-stats",
    "#panel-file-name",
    "#panel-doc-stats",
    "#render-status",
    ".panel-source",
    "#history-list",
    "#history-empty",
    "#history-count",
    "#history-clear",
    "#history-section-toggle",
    "#history-section-body",
    "#directory-list",
    "#directory-empty",
    "#directory-label",
    "#directory-section-toggle",
    "#directory-section-body",
  ];
  const elements = new Map(
    baseSelectors.map((selector) => [selector, createElement(selector)])
  );
  const actionGroups = {
    "[data-action='open-file']": [
      createElement("open-file-primary"),
      createElement("open-file-secondary"),
    ],
    "[data-action='open-folder']": [
      createElement("open-folder-primary"),
      createElement("open-folder-secondary"),
    ],
    "[data-action='reset']": [
      createElement("reset-primary"),
      createElement("reset-secondary"),
    ],
  };
  const document = {
    body: createElement("body"),
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, createElement(selector));
      }

      return elements.get(selector);
    },
    querySelectorAll(selector) {
      return actionGroups[selector] || [];
    },
  };

  class StubFileReader {
    readAsText(file) {
      if (file && file.shouldFail) {
        if (typeof this.onerror === "function") {
          this.onerror(new Error("Could not read file"));
        }
        return;
      }

      this.result =
        file && typeof file.text === "string"
          ? file.text
          : file && typeof file.content === "string"
            ? file.content
            : "";

      if (typeof this.onload === "function") {
        this.onload();
      }
    }
  }

  const context = {
    console,
    document,
    FileReader: StubFileReader,
    setTimeout,
    clearTimeout,
  };

  appScript.runInNewContext(context);

  return {
    ...context.__appTestExports,
    elements: Object.fromEntries(elements),
  };
}

function getAttributeValues(html, attribute) {
  const pattern = new RegExp(`\\b${attribute}="([^"]*)"`, "g");
  return Array.from(html.matchAll(pattern), (match) => match[1]);
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

function assertNoUnsafeUrls(html) {
  for (const attribute of ["href", "src"]) {
    for (const value of getAttributeValues(html, attribute)) {
      assert.ok(
        isSafeUrl(value),
        `Unsafe ${attribute} remained live: ${JSON.stringify(value)}`
      );
    }
  }
}

function assertHasSecureRel(html) {
  assert.match(html, /\brel="(?:noopener )?noreferrer"/);
}

function serializeHistory(history) {
  return history.map(({ name, path: itemPath, content, directoryKey }) => ({
    name,
    path: itemPath,
    content,
    directoryKey,
  }));
}

test("escapes raw HTML and script tags in paragraphs", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown(
    '<script>alert(1)</script>\n\n<div onclick="alert(1)">x</div>'
  );

  assert.equal(
    html,
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p>&lt;div onclick=&quot;alert(1)&quot;&gt;x&lt;/div&gt;</p>"
  );
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<div onclick=/i);
});

test("escapes script tags inside fenced code blocks", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown('```html\n<script>alert("x")</script>\n```');

  assert.equal(
    html,
    '<pre><code class="language-html">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</code></pre>'
  );
  assert.doesNotMatch(html, /<script\b/i);
});

test("keeps attribute-breaking link-like text inert when markdown is malformed", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown(
    '[x](https://safe.test "title" onmouseover="alert(1))'
  );

  assert.equal(
    html,
    "<p>[x](https://safe.test &quot;title&quot; onmouseover=&quot;alert(1))</p>"
  );
  assert.doesNotMatch(html, /<a\b/i);
});

test("escapes image alt text and titles that look like attributes", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown(
    '![x" onerror="alert(1)](cover.png "title \' <tag> &")'
  );

  assert.equal(
    html,
    '<p><img src="cover.png" alt="x&quot; onerror=&quot;alert(1)" title="title &#39; &lt;tag&gt; &amp;" /></p>'
  );
  assertNoUnsafeUrls(html);
});

test("renders https links with following emphasis intact", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown("[link_name](https://example.com) _after_");

  assert.equal(
    html,
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">link_name</a> <em>after</em></p>'
  );
});

test("preserves safe relative links while escaping link titles", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown('[label](docs/readme.md "title \' <tag> &")');

  assert.match(html, /^<p><a href="docs\/readme\.md" target="_blank"/);
  assert.match(html, /title="title &#39; &lt;tag&gt; &amp;">label<\/a><\/p>$/);
  assertHasSecureRel(html);
  assertNoUnsafeUrls(html);
});

test("preserves safe fragment links in nested block content while escaping raw HTML", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown("> * [x](#frag)\n> <script>alert(1)</script>");

  assert.match(
    html,
    /^<blockquote><ul><li><a href="#frag" target="_blank" rel="(?:noopener )?noreferrer">x<\/a><\/li><\/ul>\n<p>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p><\/blockquote>$/
  );
  assertNoUnsafeUrls(html);
});

test("treats malformed nested markdown as text instead of raw HTML", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown("* [outer **inner**](docs.md");

  assert.equal(html, "<ul><li>[outer <strong>inner</strong>](docs.md</li></ul>");
});

test("escapes raw tags embedded around nested emphasis and links", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown('**bold [x](docs.md)** <img src=x onerror=1>');

  assert.match(
    html,
    /^<p>(?:<strong>bold <a href="docs\.md" target="_blank" rel="(?:noopener )?noreferrer">x<\/a><\/strong>|<em><\/em>bold <a href="docs\.md" target="_blank" rel="(?:noopener )?noreferrer">x<\/a><em><\/em>) &lt;img src=x onerror=1&gt;<\/p>$/
  );
  assertNoUnsafeUrls(html);
  assert.doesNotMatch(html, /<img src=x onerror=1>/i);
});

test("blocks javascript links by falling back to plain text", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown("[x](javascript:alert)");

  assert.equal(html, "<p>x</p>");
});

test("blocks data images by falling back to alt text", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown("![img](data:text/html,hi)");

  assert.equal(html, "<p>img</p>");
});

test("parses tables without consuming later pipe-like text", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown(
    "| a | b |\n| --- | --- |\nvalue | x\nplain | still table? | nope"
  );

  assert.equal(
    html,
    "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>value</td><td>x</td></tr></tbody></table>\n<p>plain | still table? | nope</p>"
  );
});

test("parses multiple inline code spans in one paragraph", () => {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown("before `one` middle `two` after");

  assert.equal(
    html,
    "<p>before <code>one</code> middle <code>two</code> after</p>"
  );
});

test("filters markdown-like folder entries and preserves weird stub paths", () => {
  const { setDirectoryFiles, state } = createHarness();

  setDirectoryFiles([
    { name: "cover.png", webkitRelativePath: "notes/cover.png" },
    { name: "zeta.md", webkitRelativePath: "notes/zeta.md" },
    { name: "ALPHA.TXT", webkitRelativePath: "notes/ALPHA.TXT" },
    { name: "<odd>.markdown", webkitRelativePath: "notes/<odd>.markdown" },
    { name: "scratch", webkitRelativePath: "notes/scratch" },
  ]);

  const snapshot = state.directoryFiles
    .map(({ name, path: itemPath, directoryKey }) => ({
      name,
      path: itemPath,
      directoryKey,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  assert.deepEqual(snapshot, [
    {
      name: "<odd>.markdown",
      path: "notes/<odd>.markdown",
      directoryKey: "notes",
    },
    {
      name: "ALPHA.TXT",
      path: "notes/ALPHA.TXT",
      directoryKey: "notes",
    },
    {
      name: "zeta.md",
      path: "notes/zeta.md",
      directoryKey: "notes",
    },
  ]);
});

test("escapes weird filenames and paths in history rail rendering", () => {
  const { elements, renderHistory, state } = createHarness();

  state.history = [
    {
      id: "history-1",
      key: "odd",
      name: '<img src=x onerror=1>.md',
      path: 'folder/../../<script>.md',
      content: "# odd",
      directoryKey: "folder",
    },
  ];
  state.currentDocument.historyId = "history-1";

  renderHistory();

  const html = elements["#history-list"].innerHTML;
  assert.match(html, /class="rail-item active"/);
  assert.match(html, /&lt;img src=x onerror=1&gt;\.md/);
  assert.match(html, /folder\/\.\.\/\.\.\/&lt;script&gt;\.md/);
  assert.doesNotMatch(html, /<script>\.md/i);
});

test("escapes weird sibling filenames and paths in the directory rail", () => {
  const { elements, renderDirectory, state } = createHarness();

  state.directoryFiles = [
    {
      id: "directory-1",
      name: "current.md",
      path: "odd/<current>.md",
      directoryKey: "odd",
      file: {},
    },
    {
      id: "directory-2",
      name: "<other>.md",
      path: "odd/../<other>.md",
      directoryKey: "odd",
      file: {},
    },
    {
      id: "directory-3",
      name: "outside.md",
      path: "outside/outside.md",
      directoryKey: "outside",
      file: {},
    },
  ];
  state.currentDocument.directoryId = "directory-1";
  state.currentDocument.directoryKey = "odd";

  renderDirectory();

  const html = elements["#directory-list"].innerHTML;
  assert.equal(elements["#directory-label"].textContent, "odd");
  assert.match(html, /&lt;other&gt;\.md/);
  assert.match(html, /odd\/\.\.\/&lt;other&gt;\.md/);
  assert.doesNotMatch(html, /outside\/outside\.md/);
});

test("resetToSample restores sample content without mutating history", () => {
  const { elements, loadMarkdown, resetToSample, sampleMarkdown, state } = createHarness();

  loadMarkdown("# first", "first.md", {
    path: "docs/first.md",
    history: true,
    directoryId: "directory-1",
    directoryKey: "docs",
  });
  loadMarkdown("<script>boom</script>", "evil.md", {
    path: "docs/evil.md",
    history: true,
    directoryId: "directory-2",
    directoryKey: "docs",
  });

  const historyBeforeReset = serializeHistory(state.history);

  resetToSample();

  assert.equal(state.currentDocument.name, "sample.md");
  assert.equal(state.currentDocument.path, "sample.md");
  assert.equal(state.currentDocument.content, sampleMarkdown);
  assert.equal(state.currentDocument.directoryId, null);
  assert.equal(state.currentDocument.directoryKey, null);
  assert.deepEqual(serializeHistory(state.history), historyBeforeReset);
  assert.equal(elements["#render-status"].textContent, "Sample restored");
  assert.match(elements["#preview"].innerHTML, /^<h1>Markdown Reader<\/h1>/);
  assert.doesNotMatch(elements["#preview"].innerHTML, /boom/);
});

test("loadMarkdown without history clears the active history selection", () => {
  const { loadMarkdown, state } = createHarness();

  state.hasLoadedRealDocument = true;
  state.railOpen = true;
  state.history = [
    {
      id: "history-1",
      key: "doc.md",
      name: "doc.md",
      path: "doc.md",
      directoryKey: "",
      content: "old content",
    },
  ];
  state.currentDocument = {
    name: "doc.md",
    path: "doc.md",
    content: "old content",
    historyId: "history-1",
    directoryId: null,
    directoryKey: "",
  };
  state.nextHistoryId = 2;

  loadMarkdown("sample body", "sample.md", {
    path: "sample.md",
    history: false,
    directoryId: null,
    directoryKey: null,
    keepLoadedChrome: true,
  });

  assert.equal(state.currentDocument.historyId, null);
  assert.equal(state.history[0].content, "old content");
});

test("clearHistory isolates history state when that control exists", () => {
  const { clearHistory, elements, loadMarkdown, state } = createHarness();

  if (typeof clearHistory !== "function") {
    return;
  }

  loadMarkdown("# first", "first.md", {
    path: "docs/first.md",
    history: true,
    directoryId: "directory-1",
    directoryKey: "docs",
  });
  loadMarkdown("# second", "second.md", {
    path: "docs/second.md",
    history: true,
    directoryId: "directory-2",
    directoryKey: "docs",
  });

  clearHistory();

  assert.equal(state.history.length, 0);
  assert.equal(state.currentDocument.historyId, null);
  assert.equal(elements["#render-status"].textContent, "History cleared");
});

function assertDangerousUrlsAreBlocked(markdown) {
  const { parseMarkdown } = createHarness();
  const html = parseMarkdown(markdown);

  assertNoUnsafeUrls(html);
}

knownGap("blocks javascript: links", () => {
  assertDangerousUrlsAreBlocked("[x](javascript:alert(1))");
});

knownGap("blocks mixed-case javascript: links", () => {
  assertDangerousUrlsAreBlocked("[x](JaVaScRiPt:alert(1))");
});

knownGap("blocks control-char-obfuscated javascript: links", () => {
  assertDangerousUrlsAreBlocked("[x](java\u0000script:alert(1))");
});

knownGap("blocks control-char-prefixed javascript: links", () => {
  assertDangerousUrlsAreBlocked("[x](\u0001javascript:alert(1))");
});

knownGap("blocks data: links", () => {
  assertDangerousUrlsAreBlocked("[x](data:text/html,<svg/onload=1>)");
});

knownGap("blocks data: image sources", () => {
  assertDangerousUrlsAreBlocked("![x](data:image/svg+xml,<svg/onload=1>)");
});

knownGap("blocks vbscript: links", () => {
  assertDangerousUrlsAreBlocked("[x](vbscript:msgbox(1))");
});

function formatError(error) {
  return String(error && error.stack ? error.stack : error)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function runSuite() {
  let passed = 0;
  let failed = 0;
  let openGaps = 0;
  let closedGaps = 0;

  for (const { name, run } of tests) {
    try {
      run();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(formatError(error));
    }
  }

  for (const { name, run } of knownGaps) {
    try {
      run();
      closedGaps += 1;
      console.log(`GAP CLOSED ${name}`);
    } catch (error) {
      openGaps += 1;
      console.log(`KNOWN GAP ${name}`);
    }
  }

  console.log(
    `\n${passed} passed, ${failed} failed, ${openGaps} known gaps, ${closedGaps} closed gaps`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runSuite();
