import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const review = JSON.parse(
  await fs.readFile(".ai-review/review.json", "utf8")
);
const files = JSON.parse(
  await fs.readFile(".ai-review/files.json", "utf8")
);
const fullDiff = await fs.readFile(".ai-review/pr.diff", "utf8");

const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const headSha = process.env.HEAD_SHA;

function ghApi(method, endpoint, body) {
  const args = [
    "api", "--method", method,
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2026-03-10",
    endpoint
  ];

  if (body !== undefined) {
    args.push("--input", "-");
    return execFileSync("gh", args, {
      input: JSON.stringify(body),
      encoding: "utf8"
    });
  }

  return execFileSync("gh", args, { encoding: "utf8" });
}

const rank = { critical: 4, major: 3, minor: 2, suggestion: 1 };

function changedLines(patch) {
  const lines = new Set();
  let right = null;
  for (const line of String(patch || "").split("\n")) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      right = Number(hunk[1]);
    } else if (right !== null && line.startsWith("+")) {
      if (!line.startsWith("+++")) lines.add(right++);
    } else if (right !== null && line.startsWith("-")) {
      // Removed lines do not exist on the PR head and cannot receive RIGHT comments.
    } else if (right !== null && !line.startsWith("\\")) {
      right += 1;
    }
  }
  return lines;
}

function changedLinesByPath(unifiedDiff) {
  const result = new Map();
  let file = null;
  let right = null;
  for (const line of String(unifiedDiff).split("\n")) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      file = header[2];
      if (!result.has(file)) result.set(file, new Set());
      right = null;
    } else if (hunk && file) {
      right = Number(hunk[1]);
    } else if (file && right !== null && line.startsWith("+")) {
      if (!line.startsWith("+++")) result.get(file).add(right++);
    } else if (file && right !== null && line.startsWith("-")) {
      // Removed lines do not exist on the PR head.
    } else if (file && right !== null && !line.startsWith("\\")) {
      right += 1;
    }
  }
  return result;
}

const diffLineMap = changedLinesByPath(fullDiff);
const changedLineMap = new Map(files.map(file => {
  const fromPatch = changedLines(file.patch);
  const fromDiff = diffLineMap.get(file.filename) || new Set();
  return [file.filename, new Set([...fromPatch, ...fromDiff])];
}));

const findings = [...(Array.isArray(review.findings) ? review.findings : [])]
  .filter(f => f?.path && f?.body)
  .sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));

const blocking = findings.some(
  f => f.severity === "critical" || f.severity === "major"
);

let summary = `## 🤖 AI Code Review\n\n${review.summary || "Review completed."}\n\n`;

if (!findings.length) {
  summary += "### Result\n\nNo actionable findings were identified.\n";
} else {
  summary += `### Findings (${findings.length})\n\n`;
  for (const f of findings) {
    const location = f.line ? `${f.path}:${f.line}` : f.path;
    summary += `- **${f.severity.toUpperCase()}** \`${location}\` — ${f.title || "Issue"}\n`;
  }
}

summary += `\n### Decision\n\n**${blocking ? "REQUEST_CHANGES" : (review.decision || "COMMENT")}**\n`;
summary += `\n> AI review is advisory; human review remains required.\n`;

ghApi(
  "POST",
  `/repos/${repo}/issues/${prNumber}/comments`,
  { body: summary }
);

const inline = findings
  .filter(f => Number.isInteger(f.line) && changedLineMap.get(f.path)?.has(f.line))
  .slice(0, 50)
  .map(f => ({
    path: f.path,
    line: f.line,
    side: "RIGHT",
    body: `**${String(f.severity).toUpperCase()} — ${f.title || "Finding"}**\n\n${f.body}`
  }));

if (inline.length) {
  ghApi(
    "POST",
    `/repos/${repo}/pulls/${prNumber}/reviews`,
    {
      commit_id: headSha,
      event: "COMMENT",
      body: "Inline findings from the AI review.",
      comments: inline
    }
  );
}

console.log(`Published ${findings.length} findings.`);
