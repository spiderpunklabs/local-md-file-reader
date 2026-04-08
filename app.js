const sampleMarkdown = `# Markdown Reader

Drop a \`.md\` file onto this page or use the **Open Markdown File** button.

## Session Features

- A dark reading layout
- A left-side history rail after you open a real document
- Same-folder browsing when you open a folder
- Live source editing and preview updates

> Use **Open Folder** if you want the app to list sibling Markdown files.

\`\`\`js
function hello(name) {
  return \`Hello, \${name}\`;
}
\`\`\`
`;

const fileInput = document.querySelector("#file-input");
const folderInput = document.querySelector("#folder-input");
const sourceReload = document.querySelector("#source-reload");
const sourceToggle = document.querySelector("#source-toggle");
const railToggle = document.querySelector("#rail-toggle");
const dropzone = document.querySelector("#dropzone");
const markdownInput = document.querySelector("#markdown-input");
const preview = document.querySelector("#preview");
const viewer = document.querySelector(".viewer");
const dropFileName = document.querySelector("#drop-file-name");
const dropDocStats = document.querySelector("#drop-doc-stats");
const panelFileName = document.querySelector("#panel-file-name");
const panelDocStats = document.querySelector("#panel-doc-stats");
const renderStatus = document.querySelector("#render-status");
const appVersion = document.querySelector("#app-version");
const sourcePanel = document.querySelector(".panel-source");
const historyList = document.querySelector("#history-list");
const historyEmpty = document.querySelector("#history-empty");
const historyCount = document.querySelector("#history-count");
const historyClearButton = document.querySelector("#history-clear");
const historySectionToggle = document.querySelector("#history-section-toggle");
const historySectionBody = document.querySelector("#history-section-body");
const directoryList = document.querySelector("#directory-list");
const directoryEmpty = document.querySelector("#directory-empty");
const directoryLabel = document.querySelector("#directory-label");
const directorySectionToggle = document.querySelector("#directory-section-toggle");
const directorySectionBody = document.querySelector("#directory-section-body");

const state = {
  hasLoadedRealDocument: false,
  railOpen: false,
  sourceVisible: true,
  sections: {
    history: true,
    directory: true,
  },
  history: [],
  directoryFiles: [],
  currentDocument: {
    name: "sample.md",
    path: "",
    content: sampleMarkdown,
    file: null,
    historyId: null,
    directoryId: null,
    directoryKey: "",
  },
  nextHistoryId: 1,
  nextDirectoryId: 1,
};

const APP_VERSION = "20260408-reload-source-file";
const CONTROL_AND_SPACE_PATTERN = /[\u0000-\u001f\u007f\s]+/g;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/;
const INLINE_TOKEN_BASE = 0xf0000;
const INLINE_TOKEN_LIMIT = 0x10fffd;
const INLINE_CODE_PATTERN = /`([^`]+)`/g;
const INLINE_IMAGE_PATTERN =
  /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g;
const INLINE_LINK_PATTERN =
  /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g;
const INTERNAL_RENDER_TOKEN_PATTERN = /[\u{F0000}-\u{10FFFD}]/u;
const runtimeRoot = typeof window !== "undefined" ? window : globalThis;

runtimeRoot.__MARKDOWN_READER_VERSION = APP_VERSION;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(CONTROL_AND_SPACE_PATTERN, "").toLowerCase();
  if (!normalized || normalized.startsWith("//")) {
    return null;
  }

  if (
    normalized.startsWith("#") ||
    normalized.startsWith("?") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return raw;
  }

  if (normalized.startsWith("/")) {
    return raw;
  }

  if (!URL_SCHEME_PATTERN.test(normalized)) {
    return raw;
  }

  // `file:` is intentionally blocked. Opened Markdown is treated as untrusted input,
  // so the preview never gets to trigger local-file loads or navigations on the user's behalf.
  if (normalized.startsWith("http:") || normalized.startsWith("https:")) {
    return raw;
  }

  return null;
}

function createInlineTokenStore() {
  const tokens = [];

  return {
    write(html) {
      const codePoint = INLINE_TOKEN_BASE + tokens.length;
      if (codePoint > INLINE_TOKEN_LIMIT) {
        throw new Error("Too many inline tokens to render safely.");
      }

      const token = String.fromCodePoint(codePoint);
      tokens.push({ html, token });
      return token;
    },
    restore(value) {
      return tokens.reduceRight(
        (output, { html, token }) => output.split(token).join(html),
        value
      );
    },
  };
}

function applyInlineTextStyles(text) {
  let html = escapeHtml(text);

  html = html.replace(/(\*\*|__)(.*?)\1/g, "<strong>$2</strong>");
  html = html.replace(/(\*|_)(.*?)\1/g, "<em>$2</em>");
  html = html.replace(/~~(.*?)~~/g, "<del>$1</del>");

  return html;
}

function renderInlineText(text) {
  const tokenStore = createInlineTokenStore();
  const tokenized = text.replace(INLINE_CODE_PATTERN, (_, code) =>
    tokenStore.write(`<code>${escapeHtml(code)}</code>`)
  );

  return tokenStore.restore(applyInlineTextStyles(tokenized));
}

function renderInlineImage(alt, src, title) {
  const safeSrc = sanitizeUrl(src);
  if (!safeSrc) {
    return alt ? escapeHtml(alt) : "";
  }

  return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt)}"${
    title ? ` title="${escapeHtml(title)}"` : ""
  } />`;
}

function renderInlineLink(label, href, title) {
  const safeHref = sanitizeUrl(href);
  const labelHtml = renderInlineText(label);

  if (!safeHref) {
    return labelHtml;
  }

  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer"${
    title ? ` title="${escapeHtml(title)}"` : ""
  }>${labelHtml}</a>`;
}

function parseInline(text) {
  const tokenStore = createInlineTokenStore();

  let tokenized = text.replace(INLINE_CODE_PATTERN, (_, code) =>
    tokenStore.write(`<code>${escapeHtml(code)}</code>`)
  );

  tokenized = tokenized.replace(
    INLINE_IMAGE_PATTERN,
    (_, alt, src, title) => tokenStore.write(renderInlineImage(alt, src, title))
  );

  tokenized = tokenized.replace(
    INLINE_LINK_PATTERN,
    (_, label, href, title) => tokenStore.write(renderInlineLink(label, href, title))
  );

  return tokenStore.restore(applyInlineTextStyles(tokenized));
}

function hasInternalRenderTokens(html) {
  return INTERNAL_RENDER_TOKEN_PATTERN.test(html);
}

function setRenderStatus(message, state = "ready") {
  renderStatus.textContent = message;
  renderStatus.dataset.state = state;
}

function setAppVersion() {
  if (appVersion) {
    appVersion.textContent = `Build ${APP_VERSION}`;
  }

  if (document.body && document.body.dataset) {
    document.body.dataset.appVersion = APP_VERSION;
  }
}

function isTableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function parseTableRow(line) {
  const trimmed = line.trim();
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTable(lines, startIndex) {
  const headerLine = lines[startIndex];
  const dividerLine = lines[startIndex + 1];

  if (!headerLine || !dividerLine || !headerLine.includes("|") || !isTableSeparator(dividerLine)) {
    return null;
  }

  const headerCells = parseTableRow(headerLine);
  const columnCount = headerCells.length;
  const rows = [];
  let index = startIndex;

  while (index < lines.length && lines[index].includes("|")) {
    const row = parseTableRow(lines[index]);
    if (row.length !== columnCount) {
      break;
    }
    rows.push(row);
    index += 1;
  }

  if (rows.length < 2) {
    return null;
  }

  const bodyRows = rows.slice(2);
  const headerHtml = headerCells.map((cell) => `<th>${parseInline(cell)}</th>`).join("");
  const bodyHtml = bodyRows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${parseInline(cell)}</td>`).join("")}</tr>`
    )
    .join("");

  return {
    endIndex: index - 1,
    html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
  };
}

function parseMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let index = 0;

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }

    html.push(`<p>${parseInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      flushParagraph();
      const language = trimmed.slice(3).trim();
      const codeLines = [];
      index += 1;

      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }

      const className = language ? ` class="language-${escapeHtml(language)}"` : "";
      html.push(
        `<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`
      );
      index += 1;
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushParagraph();
      const [, hashes, content] = trimmed.match(/^(#{1,6})\s+(.*)$/);
      html.push(`<h${hashes.length}>${parseInline(content)}</h${hashes.length}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines = [];

      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }

      html.push(`<blockquote>${parseMarkdown(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      html.push("<hr />");
      index += 1;
      continue;
    }

    const table = parseTable(lines, index);
    if (table) {
      flushParagraph();
      html.push(table.html);
      index = table.endIndex + 1;
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-+*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      const items = [];

      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-+*]\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push(`<li>${parseInline(match[1])}</li>`);
        index += 1;
      }

      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      const items = [];

      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+\.\s+(.*)$/);
        if (!match) {
          break;
        }
        items.push(`<li>${parseInline(match[1])}</li>`);
        index += 1;
      }

      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    paragraph.push(trimmed);
    index += 1;
  }

  flushParagraph();
  return html.join("\n");
}

function updateStats(content) {
  const lineCount = content ? content.split(/\r?\n/).length : 0;
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const stats = `${lineCount} lines • ${wordCount} words`;

  dropDocStats.textContent = stats;
  panelDocStats.textContent = stats;
}

function applyRenderedHtml(markdown, html) {
  updateStats(markdown);

  if (hasInternalRenderTokens(html)) {
    preview.innerHTML = `<pre>${escapeHtml(markdown)}</pre>`;
    setRenderStatus("Render issue detected", "error");
    console.error("Unresolved internal render tokens reached the preview.", {
      appVersion: APP_VERSION,
    });
    return false;
  }

  preview.innerHTML = html;
  setRenderStatus("Rendered locally", "ready");
  return true;
}

function render(markdown) {
  applyRenderedHtml(markdown, parseMarkdown(markdown));
}

function setLoadedChrome() {
  document.body.classList.toggle("has-document", state.hasLoadedRealDocument);
  document.body.classList.toggle("rail-open", state.hasLoadedRealDocument && state.railOpen);
  railToggle.setAttribute("aria-expanded", String(state.hasLoadedRealDocument && state.railOpen));
}

function setReloadAvailability() {
  if (!sourceReload) {
    return;
  }

  sourceReload.disabled = !state.currentDocument.file;
}

function setRailOpen(open) {
  state.railOpen = open;
  railToggle.setAttribute("aria-expanded", String(state.hasLoadedRealDocument && state.railOpen));
  setLoadedChrome();
}

function setSourceVisible(visible) {
  state.sourceVisible = visible;
  sourcePanel.classList.toggle("hidden", !visible);
  viewer.classList.toggle("source-hidden", !visible);
  sourceToggle.textContent = visible ? "Hide Source" : "Show Source";
  sourceToggle.setAttribute("aria-expanded", String(visible));
}

function setSectionExpanded(section, expanded) {
  state.sections[section] = expanded;

  if (section === "history") {
    historySectionBody.classList.toggle("collapsed", !expanded);
    historySectionToggle.textContent = expanded ? "Collapse" : "Expand";
    historySectionToggle.setAttribute("aria-expanded", String(expanded));
    return;
  }

  directorySectionBody.classList.toggle("collapsed", !expanded);
  directorySectionToggle.textContent = expanded ? "Collapse" : "Expand";
  directorySectionToggle.setAttribute("aria-expanded", String(expanded));
}

function updateDocumentMeta(name) {
  dropFileName.textContent = name;
  panelFileName.textContent = name;
}

function getParentPath(path) {
  const parts = path.split("/");
  if (parts.length <= 1) {
    return "";
  }
  parts.pop();
  return parts.join("/");
}

function formatDirectoryLabel(directoryKey) {
  return directoryKey || "Selected folder";
}

function isMarkdownLike(fileName) {
  return /\.(md|markdown|mdown|mkd|txt)$/i.test(fileName);
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsText(file);
  });
}

function addHistoryEntry(entry) {
  const historyKey = entry.path || entry.name;
  const existingIndex = state.history.findIndex((item) => item.key === historyKey);

  if (existingIndex >= 0) {
    const existing = state.history.splice(existingIndex, 1)[0];
    existing.name = entry.name;
    existing.path = entry.path;
    existing.directoryKey = entry.directoryKey;
    existing.content = entry.content;
    existing.file = entry.file || existing.file || null;
    state.history.unshift(existing);
    return existing.id;
  }

  const historyEntry = {
    id: `history-${state.nextHistoryId++}`,
    key: historyKey,
    name: entry.name,
    path: entry.path,
    directoryKey: entry.directoryKey,
    content: entry.content,
    file: entry.file || null,
  };

  state.history.unshift(historyEntry);
  return historyEntry.id;
}

function canCreateSidebarNodes(container) {
  return typeof document.createElement === "function" && typeof container.appendChild === "function";
}

function clearSidebarContainer(container) {
  if (typeof container.replaceChildren === "function") {
    container.replaceChildren();
    return;
  }

  container.textContent = "";
}

function createRailItemButton({ idAttribute, idValue, title, path, active = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = active ? "rail-item active" : "rail-item";
  button.setAttribute(idAttribute, idValue);

  const titleNode = document.createElement("span");
  titleNode.className = "rail-item-title";
  titleNode.textContent = title;

  const pathNode = document.createElement("span");
  pathNode.className = "rail-item-path";
  pathNode.textContent = path;

  button.appendChild(titleNode);
  button.appendChild(pathNode);
  return button;
}

function serializeRailItemButton({ idAttribute, idValue, title, path, active = false }) {
  return `<button type="button" class="rail-item${active ? " active" : ""}" ${idAttribute}="${escapeHtml(
    idValue
  )}"><span class="rail-item-title">${escapeHtml(title)}</span><span class="rail-item-path">${escapeHtml(
    path
  )}</span></button>`;
}

function renderSidebarItems(container, items) {
  if (canCreateSidebarNodes(container)) {
    clearSidebarContainer(container);
    items.forEach((item) => {
      container.appendChild(createRailItemButton(item));
    });
    return;
  }

  container.innerHTML = items.map((item) => serializeRailItemButton(item)).join("");
}

function renderHistory() {
  historyCount.textContent = String(state.history.length);
  historyEmpty.hidden = state.history.length > 0;
  historyClearButton.disabled = state.history.length === 0;

  renderSidebarItems(
    historyList,
    state.history.map((item) => ({
      idAttribute: "data-history-id",
      idValue: item.id,
      title: item.name,
      path: item.path || "Opened from single file",
      active: item.id === state.currentDocument.historyId,
    }))
  );
}

function clearHistory() {
  if (!state.history.length) {
    return;
  }

  state.history = [];
  state.nextHistoryId = 1;
  state.currentDocument.historyId = null;
  setRenderStatus("History cleared", "ready");
  updateSidebar();
}

function renderDirectory() {
  const hasDirectoryContext = state.directoryFiles.length > 0 && state.currentDocument.directoryKey !== null;
  const siblings = hasDirectoryContext
    ? state.directoryFiles.filter(
        (item) =>
          item.directoryKey === state.currentDocument.directoryKey &&
          item.id !== state.currentDocument.directoryId
      )
    : [];

  directoryLabel.textContent = hasDirectoryContext
    ? formatDirectoryLabel(state.currentDocument.directoryKey)
    : "Unavailable";

  if (!hasDirectoryContext) {
    directoryEmpty.hidden = false;
    directoryEmpty.textContent =
      "Use Open Folder to browse sibling files. A plain file picker cannot list nearby files by itself.";
    renderSidebarItems(directoryList, []);
    return;
  }

  if (!siblings.length) {
    directoryEmpty.hidden = false;
    directoryEmpty.textContent = "No other Markdown files were found in this folder.";
    renderSidebarItems(directoryList, []);
    return;
  }

  directoryEmpty.hidden = true;
  renderSidebarItems(
    directoryList,
    siblings.map((item) => ({
      idAttribute: "data-directory-id",
      idValue: item.id,
      title: item.name,
      path: item.path,
    }))
  );
}

function updateSidebar() {
  renderHistory();
  renderDirectory();
}

function loadMarkdown(content, name, options = {}) {
  const {
    path = name,
    history = false,
    file = null,
    directoryId = null,
    directoryKey = null,
    keepLoadedChrome = false,
  } = options;
  const historyId = history ? addHistoryEntry({ name, path, directoryKey, content, file }) : null;

  markdownInput.value = content;
  updateDocumentMeta(name);
  render(content);

  state.currentDocument = {
    name,
    path,
    content,
    file,
    historyId,
    directoryId,
    directoryKey,
  };

  if (history) {
    state.hasLoadedRealDocument = true;
    state.railOpen = true;
  } else if (keepLoadedChrome) {
    state.hasLoadedRealDocument = state.hasLoadedRealDocument || keepLoadedChrome;
  }

  setLoadedChrome();
  setReloadAvailability();
  updateSidebar();
}

function openHistoryItem(historyId) {
  const item = state.history.find((entry) => entry.id === historyId);
  if (!item) {
    return;
  }

  const matchingDirectory = state.directoryFiles.find((entry) => entry.path === item.path);
  const file = item.file || (matchingDirectory ? matchingDirectory.file : null);

  loadMarkdown(item.content, item.name, {
    path: item.path,
    history: true,
    file,
    directoryId: matchingDirectory ? matchingDirectory.id : null,
    directoryKey: item.directoryKey ?? null,
  });
}

async function openDirectoryItem(directoryId) {
  const item = state.directoryFiles.find((entry) => entry.id === directoryId);
  if (!item) {
    return;
  }

  setRenderStatus("Loading file", "loading");

  try {
    const content = await readFileText(item.file);
    loadMarkdown(content, item.name, {
      path: item.path,
      history: true,
      file: item.file,
      directoryId: item.id,
      directoryKey: item.directoryKey,
    });
  } catch {
    setRenderStatus("Could not read file", "error");
  }
}

async function handlePlainFile(file) {
  if (!file) {
    return;
  }

  setRenderStatus("Loading file", "loading");

  try {
    const content = await readFileText(file);
    const matchingDirectory =
      state.directoryFiles.filter((item) => item.name === file.name).length === 1
        ? state.directoryFiles.find((item) => item.name === file.name)
        : null;

    loadMarkdown(content, file.name, {
      path: matchingDirectory ? matchingDirectory.path : file.name,
      history: true,
      file,
      directoryId: matchingDirectory ? matchingDirectory.id : null,
      directoryKey: matchingDirectory ? matchingDirectory.directoryKey : null,
    });
  } catch {
    setRenderStatus("Could not read file", "error");
  }
}

function setDirectoryFiles(files) {
  state.directoryFiles = files
    .filter((file) => isMarkdownLike(file.name))
    .map((file) => {
      const path = file.webkitRelativePath || file.name;
      return {
        id: `directory-${state.nextDirectoryId++}`,
        file,
        name: file.name,
        path,
        directoryKey: getParentPath(path),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function handleFolderSelection(files) {
  setDirectoryFiles(Array.from(files));

  if (!state.directoryFiles.length) {
    directoryLabel.textContent = "Unavailable";
    directoryEmpty.hidden = false;
    directoryEmpty.textContent = "No Markdown files were found in the selected folder.";
    renderSidebarItems(directoryList, []);
    return;
  }

  const currentPath = state.currentDocument.path;
  const matchingCurrent = state.directoryFiles.find((item) => item.path === currentPath);
  const matchingName =
    state.directoryFiles.filter((item) => item.name === state.currentDocument.name).length === 1
      ? state.directoryFiles.find((item) => item.name === state.currentDocument.name)
      : null;
  const initialItem = matchingCurrent || matchingName || state.directoryFiles[0];

  await openDirectoryItem(initialItem.id);
}

function resetToSample() {
  loadMarkdown(sampleMarkdown, "sample.md", {
    path: "sample.md",
    history: false,
    file: null,
    directoryId: null,
    directoryKey: null,
    keepLoadedChrome: state.hasLoadedRealDocument,
  });
  setRenderStatus("Sample restored", "ready");
}

async function reloadSource() {
  const file = state.currentDocument.file;
  if (!file) {
    return false;
  }

  setRenderStatus("Loading file", "loading");

  try {
    const content = await readFileText(file);
    markdownInput.value = content;
    state.currentDocument.content = content;
    render(content);

    const activeHistory = state.history.find((item) => item.id === state.currentDocument.historyId);
    if (activeHistory) {
      activeHistory.content = content;
      activeHistory.file = file;
    }

    setRenderStatus("Source reloaded", "ready");
    return true;
  } catch {
    setRenderStatus("Could not read file", "error");
    return false;
  }
}

document.querySelectorAll("[data-action='open-file']").forEach((button) => {
  button.addEventListener("click", () => fileInput.click());
});

document.querySelectorAll("[data-action='open-folder']").forEach((button) => {
  button.addEventListener("click", () => folderInput.click());
});

document.querySelectorAll("[data-action='reset']").forEach((button) => {
  button.addEventListener("click", () => resetToSample());
});

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await handlePlainFile(file);
  fileInput.value = "";
});

folderInput.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  await handleFolderSelection(files);
  folderInput.value = "";
});

markdownInput.addEventListener("input", (event) => {
  const content = event.target.value;
  state.currentDocument.content = content;
  render(content);

  const activeHistory = state.history.find((item) => item.id === state.currentDocument.historyId);
  if (activeHistory) {
    activeHistory.content = content;
  }
});

if (sourceReload) {
  sourceReload.addEventListener("click", () => {
    reloadSource();
  });
}

sourceToggle.addEventListener("click", () => {
  setSourceVisible(!state.sourceVisible);
});

railToggle.addEventListener("click", () => {
  if (!state.hasLoadedRealDocument) {
    return;
  }

  setRailOpen(!state.railOpen);
});

historySectionToggle.addEventListener("click", () => {
  setSectionExpanded("history", !state.sections.history);
});

historyClearButton.addEventListener("click", () => {
  clearHistory();
});

directorySectionToggle.addEventListener("click", () => {
  setSectionExpanded("directory", !state.sections.directory);
});

historyList.addEventListener("click", (event) => {
  const target = event.target.closest("[data-history-id]");
  if (!target) {
    return;
  }

  openHistoryItem(target.dataset.historyId);
});

directoryList.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-directory-id]");
  if (!target) {
    return;
  }

  await openDirectoryItem(target.dataset.directoryId);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
});

["dragleave", "dragend", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
});

dropzone.addEventListener("drop", async (event) => {
  const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
    isMarkdownLike(file.name)
  );

  if (files.length > 1) {
    await handleFolderSelection(files);
    return;
  }

  await handlePlainFile(files[0]);
});

setAppVersion();
loadMarkdown(sampleMarkdown, "sample.md", {
  path: "sample.md",
  history: false,
  file: null,
  directoryId: null,
  directoryKey: null,
});
setSourceVisible(true);
setSectionExpanded("history", true);
setSectionExpanded("directory", true);
setRailOpen(false);
