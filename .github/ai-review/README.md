# AI PR Review

## Setup

Create this repository secret:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Name:

`OPENAI_API_KEY`

Optional repository variable:

`OPENAI_MODEL`

Example:

`gpt-5.5`

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
