import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const review = JSON.parse(
  await fs.readFile(".ai-review/review.json", "utf8")
);

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

const findings = [...review.findings]
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
  .filter(f => Number.isInteger(f.line) && f.line > 0)
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
