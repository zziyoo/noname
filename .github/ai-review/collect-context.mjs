import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, ".ai-review");
const CONFIG = JSON.parse(
  await fs.readFile(path.join(ROOT, ".github/ai-review/review-config.json"), "utf8")
);
const pr = JSON.parse(await fs.readFile(path.join(DATA, "pr.json"), "utf8"));
const files = JSON.parse(await fs.readFile(path.join(DATA, "files.json"), "utf8"));
const token = process.env.GH_TOKEN;
const headRepo = pr.head?.repo?.full_name || pr.headRepository?.nameWithOwner || process.env.TARGET_REPO;
const headSha = pr.head?.sha || pr.headRefOid;

if (!token || !headRepo || !headSha) {
  throw new Error("Missing GitHub token, PR head repository, or PR head SHA.");
}

const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".mp3", ".m4a", ".wav", ".ogg", ".flac", ".mp4", ".webm", ".zip",
  ".woff", ".woff2", ".ttf", ".eot", ".pdf"
]);
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json"]);
const sourceCache = new Map();

function encodeRepoPath(file) {
  return file.split("/").map(encodeURIComponent).join("/");
}

function isSourceFile(file) {
  return sourceExtensions.has(path.posix.extname(file).toLowerCase());
}

function isBinaryFile(file) {
  return binaryExtensions.has(path.posix.extname(file).toLowerCase());
}

async function github(endpoint, accept = "application/vnd.github+json") {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10"
    }
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  }

  return accept === "application/vnd.github.raw" ? response.text() : response.json();
}

async function fetchSource(file) {
  if (sourceCache.has(file)) return sourceCache.get(file);
  if (!isSourceFile(file) || isBinaryFile(file)) {
    sourceCache.set(file, null);
    return null;
  }

  const content = await github(
    `/repos/${headRepo}/contents/${encodeRepoPath(file)}?ref=${encodeURIComponent(headSha)}`,
    "application/vnd.github.raw"
  );
  if (!content || content.includes("\0")) {
    sourceCache.set(file, null);
    return null;
  }

  const source = {
    path: file,
    raw: content.slice(0, CONFIG.maxFetchedFileChars),
    lineCount: content.split("\n").length,
    truncated: content.length > CONFIG.maxFetchedFileChars
  };
  sourceCache.set(file, source);
  return source;
}

function extractRelativeImports(file, content) {
  const specs = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]?.startsWith(".")) specs.add(match[1]);
    }
  }

  const directory = path.posix.dirname(file);
  return [...specs].flatMap(spec => {
    const base = path.posix.normalize(path.posix.join(directory, spec));
    if (path.posix.extname(base)) return [base];
    return [
      base,
      ...[".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json"].map(ext => `${base}${ext}`),
      ...["index.js", "index.mjs", "index.ts", "index.tsx", "index.json"].map(index => path.posix.join(base, index))
    ];
  });
}

async function siblingFiles(directory) {
  const entries = await github(
    `/repos/${headRepo}/contents/${encodeRepoPath(directory)}?ref=${encodeURIComponent(headSha)}`
  );
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry.type === "file" && isSourceFile(entry.path))
    .map(entry => entry.path);
}

const changed = [];
for (const file of files) {
  if (changed.length >= CONFIG.maxChangedFileContents) break;
  if (!file.filename || file.status === "removed") continue;
  const source = await fetchSource(file.filename);
  if (source) {
    changed.push({
      path: source.path,
      content: source.raw,
      lineCount: source.lineCount,
      truncated: source.truncated,
      status: file.status || "modified"
    });
  }
}

const changedPaths = new Set(changed.map(file => file.path));
const related = [];
const relatedPaths = new Set();

async function addRelated(file, reason) {
  if (related.length >= CONFIG.maxRelatedFiles || changedPaths.has(file) || relatedPaths.has(file)) return;
  const source = await fetchSource(file);
  if (!source) return;
  relatedPaths.add(file);
  related.push({
    path: source.path,
    content: source.raw,
    lineCount: source.lineCount,
    truncated: source.truncated,
    reason
  });
}

for (const file of changed) {
  for (const candidate of extractRelativeImports(file.path, file.content)) {
    if (related.length >= CONFIG.maxRelatedFiles) break;
    await addRelated(candidate, `由 ${file.path} 的相对 import/require 引用`);
  }
}

for (const file of changed) {
  if (related.length >= CONFIG.maxRelatedFiles) break;
  const siblings = await siblingFiles(path.posix.dirname(file.path));
  let added = 0;
  for (const sibling of siblings) {
    if (added >= (CONFIG.maxSiblingFilesPerChanged || 0) || related.length >= CONFIG.maxRelatedFiles) break;
    const before = related.length;
    await addRelated(sibling, `与 ${file.path} 位于同一目录`);
    if (related.length > before) added += 1;
  }
}

const snapshot = {
  repository: headRepo,
  headSha,
  baseSha: pr.base?.sha || pr.baseRefOid || null,
  changed,
  related
};

await fs.writeFile(path.join(DATA, "context.json"), JSON.stringify(snapshot, null, 2));
console.log(`Collected ${changed.length} changed files and ${related.length} related files from ${headRepo}@${headSha}.`);
