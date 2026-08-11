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
| `OPENAI_MODEL` | `gpt-5.5` | Model name, e.g. `deepseek-chat`, `deepseek-reasoner` |
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
- ignored paths

The AI does not automatically approve or merge PRs.
