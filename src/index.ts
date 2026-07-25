#!/usr/bin/env node
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

interface Task {
  id?: string;
  name?: string;
  sessionId?: string;
  taskId?: string;
  status?: string;
  state?: string;
  updatedAt?: string | number;
  updated_at?: string | number;
  updateTime?: string | number;
  createdAt?: string | number;
  created_at?: string | number;
  createTime?: string | number;
  [key: string]: unknown;
}

function showHelp(): void {
  console.log(`
jules-sweeper - Automated Google Jules Task Cleanup Utility

Usage:
  jules-sweeper <owner/repo> [options]
  jules-sweeper [options] --repo <owner/repo>

Options & Flags:
  <positional>       Target Google Jules repository in owner/repo format.
  -r, --repo         Alternative named flag for target repository.
  -s, --status       Task status to filter against (default: "completed").
                     Options: completed, failed, cancelled, all, etc.
  -h, --hours        Retention threshold in hours (default: 48).
                     Tasks older than this threshold will be selected for deletion.
      --dry-run      Preview candidate tasks for deletion without executing deletions.
      --help         Display this help message.

Environment Variables:
  JULES_API_KEY      Headless authentication token for @google/jules CLI operations.
`);
}

function getTaskId(task: Task): string | null {
  const id = task.id || task.taskId || task.sessionId || task.name;
  if (typeof id === 'string' && id.trim().length > 0) {
    return id.trim();
  }
  return null;
}

function getTaskStatus(task: Task): string {
  const status = task.status || task.state || 'unknown';
  return String(status).toLowerCase();
}

function getTaskTimestamp(task: Task): number {
  const rawTime =
    task.updatedAt ??
    task.updated_at ??
    task.updateTime ??
    task.createdAt ??
    task.created_at ??
    task.createTime;

  if (rawTime === undefined || rawTime === null) {
    return 0;
  }

  if (typeof rawTime === 'number') {
    return rawTime;
  }

  const parsed = Date.parse(String(rawTime));
  return isNaN(parsed) ? 0 : parsed;
}

async function runJulesCommand(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('jules', args, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    // Fallback to executing via npx if 'jules' global binary is not found directly
    const execErr = err as { code?: string; stderr?: string; message?: string };
    if (execErr.code === 'ENOENT') {
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
    throw new Error(execErr.stderr || execErr.message || String(err));
  }
}

async function main(): Promise<void> {
  let parsedArgs;
  try {
    parsedArgs = parseArgs({
      options: {
        repo: { type: 'string', short: 'r' },
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

  const targetRepo = (positionals[0] || values.repo) as string | undefined;

  if (!targetRepo || targetRepo.trim() === '') {
    console.error('[FATAL] Missing required target repository. Provide positional argument <owner/repo> or --repo flag.');
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
  const now = Date.now();
  const cutoffMs = now - hoursNum * 3_600_000;
  const cutoffDateIso = new Date(cutoffMs).toISOString();

  console.log(`[INFO] jules-sweeper initialized`);
  console.log(`[INFO] Target Repository: ${targetRepo}`);
  console.log(`[INFO] Status Filter: ${targetStatus}`);
  console.log(`[INFO] Retention Threshold: ${hoursNum} hours (Cutoff: ${cutoffDateIso})`);
  console.log(`[INFO] Mode: ${isDryRun ? 'DRY-RUN (no deletions will be executed)' : 'LIVE (deletion mode)'}`);

  // Query remote tasks
  console.log(`[INFO] Executing remote query: jules remote list --repo ${targetRepo} --json`);
  let queryOutput: string;
  try {
    queryOutput = await runJulesCommand(['remote', 'list', '--repo', targetRepo, '--json']);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FATAL] Failed to list remote tasks: ${msg}`);
    process.exit(1);
  }

  let tasks: Task[] = [];
  try {
    const rawParsed = JSON.parse(queryOutput);
    if (Array.isArray(rawParsed)) {
      tasks = rawParsed;
    } else if (rawParsed && typeof rawParsed === 'object') {
      if (Array.isArray(rawParsed.tasks)) {
        tasks = rawParsed.tasks;
      } else if (Array.isArray(rawParsed.sessions)) {
        tasks = rawParsed.sessions;
      } else {
        tasks = [rawParsed];
      }
    }
  } catch (err: unknown) {
    console.error(`[FATAL] Failed to parse JSON response from jules remote list: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`Raw output received: ${queryOutput}`);
    process.exit(1);
  }

  console.log(`[INFO] Total tasks fetched: ${tasks.length}`);

  // Filter tasks
  const candidateTasks: { task: Task; id: string; timestamp: number; dateIso: string; status: string }[] = [];

  for (const task of tasks) {
    const taskId = getTaskId(task);
    if (!taskId) continue;

    const taskStatus = getTaskStatus(task);
    const taskTimestamp = getTaskTimestamp(task);

    const matchesStatus = targetStatus === 'all' || taskStatus === targetStatus;
    const isStale = taskTimestamp > 0 && taskTimestamp < cutoffMs;

    if (matchesStatus && isStale) {
      candidateTasks.push({
        task,
        id: taskId,
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
      console.log(`[LIVE] Deleting task ${candidate.id} (Status: ${candidate.status}, UpdatedAt: ${candidate.dateIso})...`);
      try {
        await runJulesCommand(['remote', 'delete', candidate.id]);
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
