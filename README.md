# jules-sweeper

`jules-sweeper` is a lightweight, containerized CLI utility engineered to identify and prune stale tasks from target Google Jules repositories. It automates repository maintenance in CI/CD environments or scheduled cron jobs by filtering tasks against a configurable hour-based retention window and status criteria.

## Features

- **Native Node.js 22 TypeScript**: Runs `.ts` files natively using Node.js 22 `--experimental-strip-types`. Zero transpilation steps (`tsc`, `esbuild`, or `babel`) required.
- **Zero Runtime Dependencies**: Built entirely using Node.js standard libraries (`node:util`, `node:child_process`).
- **Flexible Retention Window**: Configurable retention threshold in hours (`--hours`, default: `48`).
- **Status Filtering**: Filter candidate tasks by status (`completed`, `failed`, `cancelled`, or `all`).
- **Safe Previews**: Includes `--dry-run` mode to preview candidate deletions before mutating state.
- **Docker Ready**: Pre-packaged Docker image based on `node:22-alpine` with system-level `git`, `curl`, and global `@google/jules`.

## Usage

### Command Line Interface

```bash
jules-sweeper <owner/repo> [options]
```

### Options & Flags

| Flag | Short | Type | Default | Description |
| --- | --- | --- | --- | --- |
| `<positional>` | — | string | Required | Target Google Jules repository in `owner/repo` format. |
| `--repo` | `-r` | string | Required | Alternative named flag for target repository. |
| `--status` | `-s` | string | `completed` | Task status to filter against (`completed`, `failed`, `cancelled`, or `all`). |
| `--hours` | `-h` | number | `48` | Retention threshold in hours. Tasks older than this are selected for deletion. |
| `--dry-run` | — | boolean | `false` | When present, previews candidate tasks without issuing deletion commands. |
| `--help` | — | boolean | — | Display help information. |

### Environment & Authentication

- `JULES_API_KEY`: Headless authentication token passed into the execution environment to authorize `@google/jules` CLI operations without interactive browser authentication.

## Development

```bash
# Typecheck TypeScript source
npm run typecheck

# Run locally using Node 22 native type-stripping
npm start -- owner/repo --dry-run
```

## License

MIT
