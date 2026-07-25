# jules-sweeper

`jules-sweeper` is a lightweight, containerized CLI utility engineered to identify and prune stale tasks from target Google Jules repositories. It automates repository maintenance in CI/CD environments or scheduled cron jobs by filtering tasks against a configurable hour-based retention window and status criteria.

## Features

- **Native Node.js 22 TypeScript**: Runs `.ts` files natively using Node.js 22 `--experimental-strip-types`. Zero transpilation steps (`tsc`, `esbuild`, or `babel`) required.
- **Zero Runtime Dependencies**: Built entirely using Node.js standard libraries (`node:util`, `node:child_process`).
- **Flexible Retention Window**: Configurable retention threshold in hours (`--hours`, default: `48`).
- **Status Filtering**: Filter candidate tasks by status (`completed`, `failed`, `cancelled`, or `all`).
- **All Repositories Support**: Target a single repository (`owner/repo`) or all repositories (`all` / `--all-repos`).
- **Safe Previews**: Includes `--dry-run` mode to preview candidate deletions before mutating state.
- **Docker Ready**: Pre-packaged Docker image based on `node:22-alpine` with system-level `git`, `curl`, and global `@google/jules`.

## Quick Start (Docker Container)

Run directly using the GitHub Container Registry image:

```bash
# Clean up a single repository
docker run --rm \
  -e JULES_API_KEY="$JULES_API_KEY" \
  ghcr.io/agalazis/jules-sweeper:latest owner/repo --status completed --hours 48 --dry-run

# Clean up all repositories
docker run --rm \
  -e JULES_API_KEY="$JULES_API_KEY" \
  ghcr.io/agalazis/jules-sweeper:latest --all-repos --hours 24 --dry-run
```

## Options & Flags

| Flag | Short | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `<positional>` | — | string | Required* | Target Google Jules repository in `owner/repo` format, or `all` for all repositories. |
| `--repo` | `-r` | string | — | Alternative named flag for target repository. |
| `--all-repos` | `-a` | boolean | `false` | Target all connected Google Jules repositories across your account. |
| `--status` | `-s` | string | `completed` | Task status to filter against (`completed`, `failed`, `cancelled`, or `all`). |
| `--hours` | `-h` | number | `48` | Retention threshold in hours. Tasks older than this are selected for deletion. |
| `--dry-run` | — | boolean | `false` | When present, previews candidate tasks without issuing deletion commands. |
| `--help` | — | boolean | — | Display help information. |

## Environment & Authentication

- `JULES_API_KEY`: Headless authentication token passed into the execution environment to authorize `@google/jules` CLI operations without interactive browser authentication.

## Local Development

```bash
# Typecheck TypeScript source
npm run typecheck

# Run locally using Node 22 native type-stripping
npm start -- owner/repo --dry-run
npm start -- --all-repos --dry-run
```

## License

MIT
