import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();
const DATA = path.join(ROOT, ".ai-review");
const CONFIG = JSON.parse(
  await fs.readFile(path.join(ROOT, ".github/ai-review/review-config.json"), "utf8")
);

let FEEDBACK = null;
try {
  FEEDBACK = JSON.parse(
    await fs.readFile(path.join(ROOT, ".github/ai-review/feedback.json"), "utf8")
  );
} catch {
  // 没有 feedback.json 时忽略，不阻塞审核。
}

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

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined
});

const instructions = `
你是一名资深的线上生产环境软件工程师，正在对 GitHub 拉取请求进行代码审查。

重要的语言要求：
- 所有输出字段（summary、title、body）必须使用简体中文书写。
- 即使 diff 或上下文是其他语言，也一律用简体中文回复。
- 技术术语、代码标识符、函数名可以保留英文。

从以下方面寻找真实、可执行的问题：
- 正确性与逻辑
- 安全性
- 并发/竞态条件
- 错误处理
- 数据完整性
- 性能
- 向后兼容性
- API/模式行为
- 测试/回归
- 可维护性（当其严重影响可靠性时）

不要挑剔格式或个人风格。
不要臆造需求。
不要在没有证据的情况下报告推测性问题。
不要重复已有的发现。

严重级别：
critical = 严重的安全/数据丢失/宕机/灾难性正确性风险
major = 可能存在的 bug/安全/回归/破坏性行为，应阻止合并
minor = 真实但影响有限的问题
suggestion = 有价值但不阻塞合入的改进

仅返回合法的 JSON：

{
  "decision": "APPROVE" | "COMMENT" | "REQUEST_CHANGES",
  "summary": "简体中文的简要评估",
  "findings": [
    {
      "severity": "critical" | "major" | "minor" | "suggestion",
      "path": "仓库内相对路径",
      "line": 123,
      "title": "简体中文的简短标题",
      "body": "多行 markdown，必须严格使用如下结构（简体中文）：**问题描述**：问题是什么。**影响**：为什么重要、影响谁/什么。**修复建议**：具体的修复方案。每个小节单独一行。"
    }
  ]
}

line 尽可能指向被修改的行；无法确定时使用 null。
`;

const input = `
PR 标题：
${pr.title || ""}

PR 描述：
${pr.body || "(无)"}

变更文件：
${changedFiles.join("\n")}

PR 差异：
${diff}

仓库上下文：
${context}
`;

const avoidRules = (FEEDBACK && Array.isArray(FEEDBACK.avoidRules) && FEEDBACK.avoidRules.length)
  ? `\n\n以下是从历史审核中沉淀的、不要再报告的问题类型（黑名单）：
${FEEDBACK.avoidRules.map(x => `- ${x}`).join("\n")}`
  : "";

const fewShot = (FEEDBACK && FEEDBACK.goodExample && FEEDBACK.badExample)
  ? `

作为参考，下面是一个高质量发现示例（应当模仿这种证据充分、定位明确、给出可执行修复的写法）：

${JSON.stringify(FEEDBACK.goodExample, null, 2)}

下面是一个低质量发现示例（这种写法被认为没有价值，绝不应当这样报告）：

${JSON.stringify(FEEDBACK.badExample, null, 2)}
`
  : "";

const systemPrompt = `
${instructions}

审查规则：
${CONFIG.reviewRules.map(x => `- ${x}`).join("\n")}
${avoidRules}
${fewShot}
`;

const response = await client.chat.completions.create({
  model: process.env.OPENAI_MODEL || "gpt-5.5",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: input }
  ],
  response_format: { type: "json_object" }
});

const usage = response.usage;
if (usage) {
  console.error(`[usage] prompt=${usage.prompt_tokens} cache_hit=${usage.prompt_cache_hit_tokens ?? 0} cache_miss=${usage.prompt_cache_miss_tokens ?? 0} hit_rate=${(((usage.prompt_cache_hit_tokens ?? 0) / usage.prompt_tokens) * 100).toFixed(1)}%`);
}

const text = (response.choices[0]?.message?.content || "").trim();

function extractJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`Model returned invalid JSON:\n${raw}`);
    }
    return JSON.parse(raw.slice(start, end + 1));
  }
}

let review;
try {
  review = extractJson(text);
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
