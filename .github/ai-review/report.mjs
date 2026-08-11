import fs from "node:fs/promises";

const review = JSON.parse(
  await fs.readFile(".ai-review/review.json", "utf8")
);

const rank = { critical: 4, major: 3, minor: 2, suggestion: 1 };
const findings = [...review.findings]
  .filter(f => f?.path || f?.title || f?.body)
  .sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));

const sevIcon = {
  critical: "🔴 CRITICAL",
  major: "🟠 MAJOR",
  minor: "🟡 MINOR",
  suggestion: "🔵 SUGGESTION"
};

const lines = [];
lines.push("## 🤖 AI Code Review");
lines.push("");
lines.push(`**Decision**: \`${review.decision || "COMMENT"}\``);
lines.push("");
lines.push(`**Summary**: ${review.summary || "Review completed."}`);
lines.push("");

if (!findings.length) {
  lines.push("未发现需要处理的问题。");
} else {
  lines.push(`**Findings (${findings.length})**`);
  lines.push("");
  findings.forEach((f, i) => {
    const sev = sevIcon[f.severity] || String(f.severity || "?").toUpperCase();
    const loc = f.line ? `${f.path || "?"}:${f.line}` : (f.path || "?");
    lines.push(`### ${i + 1}. ${sev} — ${f.title || "Finding"}`);
    lines.push("");
    lines.push(`**位置**: \`${loc}\``);
    lines.push("");
    lines.push(f.body || "");
    lines.push("");
  });
}

lines.push("---");
lines.push("> AI review is advisory; human review remains required.");

console.log(lines.join("\n"));
