#!/usr/bin/env node
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { connect, type SessionResource } from '@google/jules-sdk';

const execFileAsync = promisify(execFile);

interface Task {
  id: string;
  name?: string;
  repo: string;
  status: string;
  updatedAt: number;
}

function showHelp(): void {
  console.log(`
jules-sweeper - Automated Google Jules Task Cleanup Utility

Usage:
  jules-sweeper <owner/repo|all> [options]
  jules-sweeper [options] --repo <owner/repo|all>
  jules-sweeper [options] --all-repos

Options & Flags:
  <positional>       Target repository (owner/repo) or "all" to target all repositories.
  -r, --repo         Alternative named flag for target repository.
  -a, --all-repos    Target all connected Google Jules repositories.
  -s, --status       Task status to filter against (default: "completed").
                     Options: completed, failed, cancelled, all, etc.
  -h, --hours        Retention threshold in hours (default: 48).
                     Tasks older than this threshold will be selected for deletion.
      --dry-run      Preview candidate tasks for deletion without executing deletions.
      --help         Display this help message.

Environment Variables:
  JULES_API_KEY      Headless authentication token for @google/jules SDK & CLI operations.
`);
}

function parseRelativeTimeMs(timeStr: string): number {
  const now = Date.now();
  const match = timeStr.trim().match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return 0;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let mult = 1000;
  if (unit === 'minute') mult = 60 * 1000;
  else if (unit === 'hour') mult = 3600 * 1000;
  else if (unit === 'day') mult = 24 * 3600 * 1000;
  else if (unit === 'week') mult = 7 * 24 * 3600 * 1000;
  else if (unit === 'month') mult = 30 * 24 * 3600 * 1000;
  else if (unit === 'year') mult = 365 * 24 * 3600 * 1000;

  return now - num * mult;
}

function parseTextTable(output: string): Task[] {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const tasks: Task[] = [];

  for (const line of lines) {
    if (line.includes('ID') && line.includes('Status')) continue;

    const match = line.match(/^(\d{10,25})\s+(.+)$/);
    if (!match) continue;

    const id = match[1];
    const rest = match[2];

    const statusMatch = rest.match(/(Completed|In Progress|Failed|Cancelled|Active|Pending)\s*$/i);
    const status = statusMatch ? statusMatch[1].toLowerCase() : 'unknown';
    const beforeStatus = statusMatch ? rest.slice(0, statusMatch.index).trim() : rest;

    const timeMatch = beforeStatus.match(/(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\s*$/i);
    const relativeTimeStr = timeMatch ? timeMatch[1] : '';
    const updatedAtMs = relativeTimeStr ? parseRelativeTimeMs(relativeTimeStr) : 0;
    const beforeTime = timeMatch ? beforeStatus.slice(0, timeMatch.index).trim() : beforeStatus;

    const repoMatch = beforeTime.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:…|\.\.\.)?)\s*$/);
    const repo = repoMatch ? repoMatch[1] : 'unknown';
    const description = repoMatch ? beforeTime.slice(0, repoMatch.index).trim() : beforeTime;

    tasks.push({
      id,
      name: description,
      repo,
      status,
      updatedAt: updatedAtMs,
    });
  }

  return tasks;
}

async function fetchTasksViaSdk(apiKey: string): Promise<Task[]> {
  const client = connect({ apiKey });
  const sdkSessions = await client.sessions().all();
  const tasks: Task[] = [];

  for (const sess of sdkSessions) {
    const rawSess = sess as unknown as SessionResource & Record<string, unknown>;
    const rawId = String(rawSess.id || rawSess.name || '').replace(/^sessions\//, '');
    if (!rawId) continue;

    const status = String(rawSess.state || rawSess.status || 'unknown').toLowerCase();

    let updatedAt = 0;
    const timeVal = rawSess.updateTime || rawSess.createTime || rawSess.updatedAt || rawSess.createdAt;
    if (typeof timeVal === 'number') {
      updatedAt = timeVal;
    } else if (timeVal) {
      const parsed = Date.parse(String(timeVal));
      if (!isNaN(parsed)) updatedAt = parsed;
    }

    let repo = 'unknown';
    const sourceCtx = rawSess.sourceContext as { source?: string } | undefined;
    if (sourceCtx && typeof sourceCtx.source === 'string') {
      repo = sourceCtx.source.replace(/^sources\/github\//, '').replace(/^sources\//, '');
    }

    tasks.push({
      id: rawId,
      name: String(rawSess.title || rawSess.prompt || ''),
      repo,
      status,
      updatedAt,
    });
  }

  return tasks;
}

async function deleteTaskViaSdk(apiKey: string, taskId: string): Promise<void> {
  const client = connect({ apiKey });
  const resourceName = taskId.startsWith('sessions/') ? taskId : `sessions/${taskId}`;
  const clientWithApi = client as unknown as { apiClient: { request: (endpoint: string, options?: unknown) => Promise<unknown> } };
  await clientWithApi.apiClient.request(resourceName, { method: 'DELETE' });
}

async function runJulesCommand(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('jules', args, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    const execErr = err as { code?: string | number; stderr?: string; message?: string };
    const errText = String(execErr.stderr || execErr.message || err);

    const isNotFound =
      execErr.code === 'ENOENT' ||
      execErr.code === 127 ||
      errText.includes('not found') ||
      errText.includes('ENOENT') ||
      errText.includes('127');

    if (isNotFound) {
      try {
        const { stdout } = await execFileAsync('npx', ['-y', '@google/jules', ...args], {
          env: process.env,
          maxBuffer: 10 * 1024 * 1024,
        });
        return stdout;
      } catch (npxErr: unknown) {
        const subErr = npxErr as { stderr?: string; message?: string };
        throw new Error(subErr.stderr || subErr.message || String(npxErr));
      }
    }
    throw new Error(errText);
  }
}

async function fetchTasksViaCli(): Promise<Task[]> {
  const queryOutput = await runJulesCommand(['remote', 'list', '--session']);
  try {
    const rawParsed = JSON.parse(queryOutput);
    let items: Record<string, unknown>[] = [];
    if (Array.isArray(rawParsed)) {
      items = rawParsed;
    } else if (rawParsed && typeof rawParsed === 'object') {
      items = (rawParsed.tasks || rawParsed.sessions || [rawParsed]) as Record<string, unknown>[];
    }
    return items.map((item) => ({
      id: String(item.id || item.taskId || item.sessionId || '').replace(/^sessions\//, ''),
      name: String(item.name || item.title || ''),
      repo: String(item.repo || item.repository || 'unknown'),
      status: String(item.status || item.state || 'unknown').toLowerCase(),
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.parse(String(item.updatedAt || 0)) || 0,
    }));
  } catch {
    return parseTextTable(queryOutput);
  }
}

async function main(): Promise<void> {
  let parsedArgs;
  try {
    parsedArgs = parseArgs({
      options: {
        repo: { type: 'string', short: 'r' },
        'all-repos': { type: 'boolean', short: 'a', default: false },
        all: { type: 'boolean', default: false },
        status: { type: 'string', short: 's', default: 'completed' },
        hours: { type: 'string', short: 'h', default: '48' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: false,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FATAL] Error parsing CLI arguments: ${msg}`);
    showHelp();
    process.exit(1);
  }

  const { values, positionals } = parsedArgs;

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const positionalArg = positionals[0] as string | undefined;
  const repoFlag = values.repo as string | undefined;

  const isAllFlag = Boolean(values['all-repos']) || Boolean(values.all);
  const targetArg = (positionalArg || repoFlag || '').trim();
  const isAllRepos = isAllFlag || targetArg.toLowerCase() === 'all' || targetArg === '*';

  if (!isAllRepos && (!targetArg || targetArg === '')) {
    console.error('[FATAL] Missing required target repository. Provide positional argument <owner/repo>, --repo flag, or --all-repos.');
    showHelp();
    process.exit(1);
  }

  const hoursNum = parseFloat(values.hours as string);
  if (isNaN(hoursNum) || hoursNum < 0) {
    console.error(`[FATAL] Invalid --hours value: "${values.hours}". Must be a non-negative number.`);
    process.exit(1);
  }

  const targetStatus = (values.status as string).trim().toLowerCase();
  const isDryRun = Boolean(values['dry-run']);
  const apiKey = process.env.JULES_API_KEY;

  const now = Date.now();
  const cutoffMs = now - hoursNum * 3_600_000;
  const cutoffDateIso = new Date(cutoffMs).toISOString();

  console.log(`[INFO] jules-sweeper initialized`);
  console.log(`[INFO] Target Repository: ${isAllRepos ? 'ALL REPOSITORIES' : targetArg}`);
  console.log(`[INFO] Status Filter: ${targetStatus}`);
  console.log(`[INFO] Retention Threshold: ${hoursNum} hours (Cutoff: ${cutoffDateIso})`);
  console.log(`[INFO] Execution Engine: ${apiKey ? '@google/jules-sdk (Native TypeScript SDK)' : '@google/jules (CLI Fallback)'}`);
  console.log(`[INFO] Mode: ${isDryRun ? 'DRY-RUN (no deletions will be executed)' : 'LIVE (deletion mode)'}`);

  // Fetch tasks using SDK if API key is present, otherwise CLI fallback
  let tasks: Task[] = [];
  if (apiKey) {
    try {
      console.log(`[INFO] Querying remote tasks via @google/jules-sdk...`);
      tasks = await fetchTasksViaSdk(apiKey);
    } catch (sdkErr: unknown) {
      console.warn(`[WARN] SDK query failed: ${sdkErr instanceof Error ? sdkErr.message : String(sdkErr)}. Falling back to CLI query...`);
      tasks = await fetchTasksViaCli();
    }
  } else {
    console.log(`[INFO] Executing remote query via CLI: jules remote list --session`);
    tasks = await fetchTasksViaCli();
  }

  console.log(`[INFO] Total tasks fetched: ${tasks.length}`);

  // Filter candidate tasks
  const candidateTasks: { task: Task; id: string; repo: string; timestamp: number; dateIso: string; status: string }[] = [];

  for (const task of tasks) {
    if (!task.id) continue;

    const taskRepo = task.repo;
    const taskStatus = task.status.toLowerCase();
    const taskTimestamp = task.updatedAt;

    // Filter by repository if not targeting all repos
    if (!isAllRepos) {
      const repoNormalized = taskRepo.toLowerCase().replace(/[\.…]+$/, '');
      const targetNormalized = targetArg.toLowerCase();
      if (repoNormalized !== 'unknown' && !repoNormalized.startsWith(targetNormalized.slice(0, 10))) {
        continue;
      }
    }

    const matchesStatus = targetStatus === 'all' || taskStatus === targetStatus;
    const isStale = taskTimestamp > 0 && taskTimestamp < cutoffMs;

    if (matchesStatus && isStale) {
      candidateTasks.push({
        task,
        id: task.id,
        repo: taskRepo,
        timestamp: taskTimestamp,
        dateIso: new Date(taskTimestamp).toISOString(),
        status: taskStatus,
      });
    }
  }

  console.log(`[INFO] Matching candidate tasks for pruning: ${candidateTasks.length}`);

  if (candidateTasks.length === 0) {
    console.log('[INFO] No stale tasks match the retention and status criteria. Sweeper complete.');
    process.exit(0);
  }

  // Handle dry-run or live deletion
  if (isDryRun) {
    console.log('\n[DRY-RUN] Candidate tasks selected for deletion:');
    console.table(
      candidateTasks.map((c) => ({
        ID: c.id,
        Repository: c.repo,
        Status: c.status,
        UpdatedAt: c.dateIso,
      }))
    );
    console.log('\n[DRY-RUN] Preview finished. No tasks were deleted.');
  } else {
    console.log('\n[LIVE] Commencing task deletion...');
    let deletedCount = 0;
    let failedCount = 0;

    for (const candidate of candidateTasks) {
      console.log(`[LIVE] Deleting task ${candidate.id} (${candidate.repo !== 'unknown' ? `Repo: ${candidate.repo}, ` : ''}Status: ${candidate.status}, UpdatedAt: ${candidate.dateIso})...`);
      try {
        if (apiKey) {
          await deleteTaskViaSdk(apiKey, candidate.id);
        } else {
          await runJulesCommand(['remote', 'delete', candidate.id]);
        }
        console.log(`[SUCCESS] Task ${candidate.id} deleted successfully.`);
        deletedCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] Failed to delete task ${candidate.id}: ${msg}`);
        failedCount++;
      }
    }

    console.log(`\n[SUMMARY] Deletion complete. Successfully deleted: ${deletedCount}, Failed: ${failedCount}`);

    if (failedCount > 0) {
      console.error(`[WARNING] Some tasks failed to delete.`);
      process.exit(1);
    }
  }
}

main().catch((err: unknown) => {
  console.error(`[FATAL] Unhandled exception: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
