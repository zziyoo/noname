# AI PR Review

## Setup

Create this repository secret:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Name:

`OPENAI_API_KEY`

Value:

`sk-...` (OpenAI API key, or any OpenAI-compatible provider key)

Optional repository variables:

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_MODEL` | `gpt-5.5` | Model name, e.g. `deepseek-v4-flash`, `deepseek-chat` |
| `OPENAI_BASE_URL` | *(empty)* | Provider base URL, e.g. `https://api.deepseek.com` |
| `OPENAI_SECRET_NAME` | `OPENAI_API_KEY` | Name of the secret that holds the API key |

### DeepSeek example

Secret: `OPENAI_API_KEY` = DeepSeek API key.

Variables:

- `OPENAI_MODEL` = `deepseek-chat`
- `OPENAI_BASE_URL` = `https://api.deepseek.com`

The reviewer script uses the Chat Completions API, so any
OpenAI-compatible provider (OpenAI, DeepSeek, ...) works.

## Security model

This workflow uses `pull_request_target` so fork PRs can use the repository secret.

It is safe here because:
- the workflow checks out only the trusted default branch
- it never checks out the PR head
- it never runs PR scripts
- PR code is treated as untrusted text/diff
- the GitHub token has only contents:read and pull-requests:write

Do not change this workflow to execute files from the PR head while keeping `pull_request_target`.

## Review policy

Edit `review-config.json` to change:
- context limits
- review rules
- temperature (`0` is recommended for stable reviews)

The reviewer reads PR source through GitHub's API at the PR head SHA. It does not
checkout or run PR code. It includes changed source files plus related files found
through relative `import`/`require` references and nearby source files. It does not
use arbitrary files from the workflow repository's default branch.

Each review has two model calls: candidate discovery, then evidence verification.
Only findings that point to a visible, newly added PR line are published.

### Feedback loop

Use `feedback.json` for curated feedback rather than accumulating every old review:

- `avoidRules`: concise patterns that must not be reported again
- `goodExample`: one representative finding with sufficient evidence
- `badExample`: one representative false positive to avoid

Keep this file small. Merge duplicate rules and remove obsolete ones; it is part of
the static prompt prefix and is therefore cache-friendly, but should not become a log.

The AI does not automatically approve or merge PRs.

## Manual review of PRs in other repositories

The workflow also supports `workflow_dispatch`:

`Actions -> AI PR Review -> Run workflow`

Inputs:

- `repo`: `owner/repo` of the PR (default `libnoname/noname`)
- `pr_number`: PR number to review

The result is printed in the run log and uploaded as the
`ai-review-result` artifact. Comments are NOT posted on the
target repository, because the workflow token only has
permissions inside this repository.
