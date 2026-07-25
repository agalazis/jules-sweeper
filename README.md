# jules-sweeper

`jules-sweeper` is a lightweight, containerized CLI utility built with Node.js 22 and the official **`@google/jules-sdk`**. It identifies and prunes stale tasks from Google Jules repositories based on retention hours and status criteria.

## Features

- **Pure TypeScript SDK**: Powered 100% natively by `@google/jules-sdk`. Zero CLI spawning, zero binary compatibility overhead, and zero third-party shell execution.
- **Native Node.js 22 Execution**: Runs `.ts` files natively using Node.js 22 type-stripping (`--experimental-strip-types`). No build or transpilation step (`tsc`/`esbuild`) required.
- **Flexible Retention Window**: Configurable retention threshold in hours (`--hours`, default: `48`).
- **Status Filtering**: Filter candidate tasks by status (`completed`, `failed`, `cancelled`, or `all`).
- **All Repositories Support**: Target a single repository (`owner/repo`) or all connected repositories (`all` / `--all-repos`).
- **Safe Previews**: Includes `--dry-run` mode to preview candidate deletions before mutating state.
- **Ultra-Minimal Docker Container**: Lightweight Alpine Linux container packaging using `@google/jules-sdk`.

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

## Environment Variables

- `JULES_API_KEY`: Required. Headless authentication token for Google Jules API operations.

## Local Development

```bash
# Typecheck TypeScript source
npm run typecheck

# Run locally using Node 22 native type-stripping
JULES_API_KEY="$JULES_API_KEY" npm start -- owner/repo --dry-run
JULES_API_KEY="$JULES_API_KEY" npm start -- --all-repos --dry-run
```

## License

MIT
