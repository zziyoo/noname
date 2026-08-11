import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();
const DATA = path.join(ROOT, ".ai-review");
const CONFIG = JSON.parse(
  await fs.readFile(path.join(ROOT, ".github/ai-review/review-config.json"), "utf8")
);

const pr = JSON.parse(await fs.readFile(path.join(DATA, "pr.json"), "utf8"));
const files = JSON.parse(await fs.readFile(path.join(DATA, "files.json"), "utf8"));
const diff = (await fs.readFile(path.join(DATA, "pr.diff"), "utf8"))
  .slice(0, CONFIG.maxDiffChars);

const changedFiles = files.map(f => f.filename).filter(Boolean);

const repoFileList = (await fs.readFile(
  path.join(DATA, "repo-files.txt"), "utf8"
)).split("\n").filter(Boolean);

const changedSet = new Set(changedFiles);
const relatedFiles = repoFileList
  .filter(f => !changedSet.has(f))
  .filter(f => !f.startsWith(".git/") && !f.startsWith(".ai-review/"))
  .slice(0, CONFIG.maxRelatedFiles);

let context = "";
for (const file of relatedFiles) {
  try {
    const content = await fs.readFile(path.join(ROOT, file), "utf8");
    context += `\n\n===== ${file} =====\n${content.slice(0, CONFIG.maxRelatedFileChars)}`;
  } catch {
    // Ignore unreadable/binary files.
  }
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const instructions = `
You are a senior production software engineer performing a GitHub pull request review.

Find real, actionable problems in:
- correctness and logic
- security
- concurrency/race conditions
- error handling
- data integrity
- performance
- backwards compatibility
- API/schema behavior
- tests/regressions
- maintainability when it materially affects reliability

Do not nitpick formatting or personal style.
Do not invent requirements.
Do not report speculative issues without evidence.
Do not duplicate findings.

Severity:
critical = severe security/data-loss/outage/catastrophic correctness risk
major = likely bug/security/regression/breaking behavior that should block merge
minor = real but limited-impact issue
suggestion = worthwhile non-blocking improvement

Return ONLY valid JSON:

{
  "decision": "APPROVE" | "COMMENT" | "REQUEST_CHANGES",
  "summary": "short assessment",
  "findings": [
    {
      "severity": "critical" | "major" | "minor" | "suggestion",
      "path": "repo-relative-path",
      "line": 123,
      "title": "short title",
      "body": "explanation and concrete fix"
    }
  ]
}

line must refer to a changed line when possible. Use null if you cannot identify one confidently.
`;

const input = `
PR TITLE:
${pr.title || ""}

PR BODY:
${pr.body || "(none)"}

CHANGED FILES:
${changedFiles.join("\n")}

PR DIFF:
${diff}

REPOSITORY CONTEXT:
${context}

REVIEW RULES:
${CONFIG.reviewRules.map(x => `- ${x}`).join("\n")}
`;

const response = await client.responses.create({
  model: process.env.OPENAI_MODEL || "gpt-5.5",
  instructions,
  input
});

const text = response.output_text.trim();

let review;
try {
  review = JSON.parse(text);
} catch {
  throw new Error(`Model returned invalid JSON:\n${text}`);
}

if (!review || !Array.isArray(review.findings)) {
  throw new Error("Invalid review structure.");
}

await fs.writeFile(
  path.join(DATA, "review.json"),
  JSON.stringify(review, null, 2)
);

console.log(JSON.stringify(review, null, 2));
