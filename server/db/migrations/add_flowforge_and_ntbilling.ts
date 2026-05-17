/**
 * Migration: add_flowforge_and_ntbilling
 *
 * Run from D:\Project\devbrain\server:
 *   npx tsx db/migrations/add_flowforge_and_ntbilling.ts
 *
 * Idempotent — safe to run more than once.
 * Uses its own pg.Pool so it does not need JWT_SECRET or other server env vars.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

// ── Load .env (minimal — only DATABASE_URL is required) ──────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

try {
  const raw = readFileSync(resolve(__dirname, '../../.env'), 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {
  // no .env — rely on environment
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('[!!] DATABASE_URL is not set')
  process.exit(1)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = {
  order:        number
  instruction:  string
  command?:     string
  note?:        string
}

type SeedCommand = {
  title:        string
  command:      string
  language:     string
  description:  string
  tags:         string[]
  is_favorite:  boolean
}

type SeedRunbook = {
  title:  string
  steps:  Step[]
  tags:   string[]
}

// ── FlowForge ─────────────────────────────────────────────────────────────────

const FLOWFORGE_PROJECT = {
  name:             'FlowForge',
  short_name:       'flowforge',
  description:      'Database-driven data pipeline orchestrator. Configure pipelines via UI - DB procedures (PostgreSQL + Oracle), reports (Excel/PDF/CSV), email (Gmail + Microsoft 365 + SMTP), Google Drive smart attachments, cron scheduler. Originally internal office tool, being scrubbed and open-sourced on GitHub.',
  color:            '#F97316',
  status:           'active',
  tech_stack:       ['Python', 'Flask', 'React', 'PostgreSQL', 'Oracle', 'Gmail API', 'Microsoft Graph API', 'Google Drive API', 'APScheduler'],
  type:             'tool',
  kind:             'personal',
  git_type:         'github',
  repo_path:        'D:\\Project\\flowforge',
  claude_code_safe: true,
}

const FLOWFORGE_COMMANDS: SeedCommand[] = [
  {
    title:       'Run a pipeline immediately',
    command:     'flowforge run {pipeline_name}',
    language:    'bash',
    description: 'Trigger an immediate execution of the named pipeline, bypassing its schedule.',
    tags:        ['flowforge', 'pipeline', 'run'],
    is_favorite: true,
  },
  {
    title:       'List all pipelines with status',
    command:     'flowforge list',
    language:    'bash',
    description: 'Show all pipelines with their enabled status, last run time, and last run result.',
    tags:        ['flowforge', 'pipeline'],
    is_favorite: false,
  },
  {
    title:       'Validate pipeline without running',
    command:     'flowforge validate {pipeline_name}',
    language:    'bash',
    description: 'Validate a pipeline config and all its step configs without executing anything.',
    tags:        ['flowforge', 'debug'],
    is_favorite: false,
  },
  {
    title:       'Start the scheduler daemon',
    command:     'flowforge schedule start',
    language:    'bash',
    description: 'Start the APScheduler daemon that triggers pipelines on their cron schedules.',
    tags:        ['flowforge', 'scheduler'],
    is_favorite: false,
  },
  {
    title:       'Test a DB connection',
    command:     'flowforge connections test {connection_name}',
    language:    'bash',
    description: 'Test a named database connection (PostgreSQL or Oracle) and report latency.',
    tags:        ['flowforge', 'database', 'debug'],
    is_favorite: false,
  },
  {
    title:       'Run single step only (debug)',
    command:     'flowforge run {pipeline_name} --step "{step_name}"',
    language:    'bash',
    description: 'Execute a single named step in isolation. Useful for debugging without re-running the whole pipeline.',
    tags:        ['flowforge', 'debug'],
    is_favorite: false,
  },
  {
    title:       'Export pipeline as YAML',
    command:     'flowforge export {pipeline_name}',
    language:    'bash',
    description: 'Export the pipeline config as a YAML file for backup or version control.',
    tags:        ['flowforge', 'pipeline'],
    is_favorite: false,
  },
  {
    title:       'View last N run logs',
    command:     'flowforge logs {pipeline_name} --last 10',
    language:    'bash',
    description: 'Stream the logs from the last 10 runs of the pipeline to stdout.',
    tags:        ['flowforge', 'logs'],
    is_favorite: false,
  },
]

const FLOWFORGE_RUNBOOKS: SeedRunbook[] = [
  {
    title: 'Debug a failed FlowForge pipeline',
    tags:  ['flowforge', 'debug', 'pipeline'],
    steps: [
      { order: 1,  instruction: 'Check recent run logs',                                                                 command: 'flowforge logs {pipeline_name} --last 5' },
      { order: 2,  instruction: 'Open FlowForge UI -> Run History' },
      { order: 3,  instruction: 'Click the failed run -> expand the failed step logs' },
      { order: 4,  instruction: 'Identify error type: DB / email / file / auth?' },
      { order: 5,  instruction: 'If DB error -> test the connection',                                                    command: 'flowforge connections test {connection_name}' },
      { order: 6,  instruction: 'If email error -> check provider credentials in Settings -> Email Configs' },
      { order: 7,  instruction: 'If file error -> verify output/ directory exists and has write permission' },
      { order: 8,  instruction: 'If auth error -> re-run OAuth setup in Settings -> Integrations' },
      { order: 9,  instruction: 'Apply the fix' },
      { order: 10, instruction: 'Re-run the pipeline',                                                                   command: 'flowforge run {pipeline_name}' },
      { order: 11, instruction: 'Confirm success in Run History' },
      { order: 12, instruction: 'Add resolution note in DevBrain issue' },
    ],
  },
  {
    title: 'Add a new pipeline in FlowForge',
    tags:  ['flowforge', 'pipeline', 'setup'],
    steps: [
      { order: 1,  instruction: 'Open FlowForge UI -> Pipeline Builder -> New Pipeline' },
      { order: 2,  instruction: 'Set name, description, and enabled toggle' },
      { order: 3,  instruction: 'Set schedule using the visual cron builder' },
      { order: 4,  instruction: 'Add steps in order: db_procedure (connection + procedure + params), report (pick or create config), email (pick or create config), drive_upload (only if report is large)', note: 'Each step type has its own config form in the UI' },
      { order: 5,  instruction: 'Add an on_failure step: email alert to admin' },
      { order: 6,  instruction: 'Set on_error per step: stop or continue based on dependency' },
      { order: 7,  instruction: 'Click Save + Validate' },
      { order: 8,  instruction: 'Run manual test: click Run Now -> watch Run History' },
      { order: 9,  instruction: 'Enable schedule only after the manual test passes' },
      { order: 10, instruction: 'Document the pipeline in DevBrain' },
    ],
  },
]

// ── NT Billing Support ────────────────────────────────────────────────────────

const NTBILLING_PROJECT = {
  name:             'NT Billing Support',
  short_name:       'ntbilling',
  description:      'Office project - custom code layer built on top of telecom billing platform. Perl scripts and Oracle DB procedures for custom reports, data transformations, integrations, and automation. Local git only.',
  color:            '#94A3B8',
  status:           'active',
  tech_stack:       ['Perl', 'Oracle DB', 'PL/SQL', 'Shell/Bash'],
  type:             'integration',
  kind:             'office',
  git_type:         'local-git',
  repo_path:        'D:\\Work\\NTBilling',
  claude_code_safe: true,
}

const NTBILLING_COMMANDS: SeedCommand[] = [
  {
    title:       'Run Perl script with timing',
    command:     'time perl {script_name}.pl --period {period}',
    language:    'bash',
    description: 'Run a billing Perl script and report wall-clock execution time on completion.',
    tags:        ['perl', 'billing', 'run'],
    is_favorite: true,
  },
  {
    title:       'Run with DBI trace (shows all SQL)',
    command:     'DBI_TRACE=2 perl {script_name}.pl 2>&1 | grep -E "SQL|execute|fetch"',
    language:    'bash',
    description: 'Run with DBI level-2 trace to see every SQL statement, execute call, and fetch. Piped through grep to reduce noise.',
    tags:        ['perl', 'debug', 'oracle'],
    is_favorite: false,
  },
  {
    title:       'Test Oracle DB connection',
    command:     "perl -MDBI -e \"my $dbh = DBI->connect($ENV{ORACLE_DSN}, $ENV{ORACLE_USER}, $ENV{ORACLE_PASS}); print 'Connection OK\\n';\"",
    language:    'bash',
    description: 'One-liner to verify the Oracle connection using standard env vars, without running a full script.',
    tags:        ['oracle', 'connection', 'debug'],
    is_favorite: false,
  },
  {
    title:       'Run SQLPlus script',
    command:     'sqlplus $ORACLE_USER/$ORACLE_PASS@$ORACLE_SID @{script_name}.sql',
    language:    'bash',
    description: 'Execute a .sql file directly via SQLPlus using connection credentials from env vars.',
    tags:        ['oracle', 'sqlplus'],
    is_favorite: false,
  },
  {
    title:       'Check script log for errors',
    command:     'grep -i "error\\|die\\|failed\\|ORA-" {script_name}.log | tail -30',
    language:    'bash',
    description: 'Scan the script log for Perl die calls, ORA- Oracle errors, and any error/failed keywords.',
    tags:        ['perl', 'debug', 'logs'],
    is_favorite: false,
  },
  {
    title:       'Count records processed',
    command:     'grep -E "Processed|Inserted|Updated" {script_name}.log | tail -20',
    language:    'bash',
    description: 'Tail the log for record count lines to verify expected volume was processed.',
    tags:        ['perl', 'logs'],
    is_favorite: false,
  },
  {
    title:       'Oracle - find long running queries',
    command:     [
      'SELECT sql_text,',
      '       ROUND(elapsed_time/1000000, 2) AS elapsed_secs,',
      '       executions,',
      '       ROUND(elapsed_time/1000000/NULLIF(executions,0), 2) AS avg_secs',
      'FROM   v$sql',
      'WHERE  elapsed_time > 10000000',
      'ORDER  BY elapsed_time DESC',
      'FETCH  FIRST 20 ROWS ONLY;',
    ].join('\n'),
    language:    'sql',
    description: 'Find queries with total elapsed time > 10 seconds from v$sql. Run in SQLPlus or DBeaver.',
    tags:        ['oracle', 'performance'],
    is_favorite: false,
  },
  {
    title:       'Oracle - check bind variable usage',
    command:     [
      'SELECT sql_text, version_count, executions',
      'FROM   v$sqlarea',
      'WHERE  version_count > 10',
      'ORDER  BY version_count DESC;',
    ].join('\n'),
    language:    'sql',
    description: 'High version_count means SQL is NOT using bind variables - each literal creates a new cursor. Fix immediately.',
    tags:        ['oracle', 'performance', 'bind-variables'],
    is_favorite: false,
  },
]

const NTBILLING_RUNBOOKS: SeedRunbook[] = [
  {
    title: 'Investigate slow Perl billing script',
    tags:  ['perl', 'performance', 'oracle'],
    steps: [
      { order: 1,  instruction: 'Add Time::HiRes timing around each major section', note: 'use Time::HiRes qw(time); my $t0 = time(); # section; printf "Section took %.2fs\\n", time() - $t0;' },
      { order: 2,  instruction: 'Run on a small dataset (1000 records) and note timing per section' },
      { order: 3,  instruction: 'Identify the slowest section' },
      { order: 4,  instruction: 'Run DBI_TRACE=2 and look for repeated identical SQL — means no bind variables, fix immediately', command: 'DBI_TRACE=2 perl {script_name}.pl 2>&1 | grep -E "SQL|execute|fetch"' },
      { order: 5,  instruction: 'Check if the slowest section does row-by-row operations -> convert to execute_array bulk operations' },
      { order: 6,  instruction: 'Check if queries use bind variables -> use prepare() outside the loop, execute() inside' },
      { order: 7,  instruction: 'Check if Perl fetches large datasets just to count or sum -> move aggregation into Oracle SQL' },
      { order: 8,  instruction: 'Check AutoCommit setting — should be 0 with explicit commits' },
      { order: 9,  instruction: 'Test on the same 1000 records and compare output with original' },
      { order: 10, instruction: 'Run on full dataset and log before/after timing in DevBrain' },
    ],
  },
  {
    title: 'Investigate failed nightly batch',
    tags:  ['perl', 'oracle', 'batch', 'debug'],
    steps: [
      { order: 1,  instruction: 'Check cron log for exit code',                                                                    command: 'grep CRON /var/log/syslog | grep {script_name}' },
      { order: 2,  instruction: 'Check script output log for the last 100 lines',                                                  command: 'tail -100 /logs/{script_name}.log' },
      { order: 3,  instruction: 'Look for ORA-, DBI Error, or die in log output',                                                  command: 'grep -i "ORA-\\|DBI Error\\|die\\|failed" /logs/{script_name}.log | tail -30' },
      { order: 4,  instruction: 'Check Oracle alert log for ORA- errors at the same timestamp' },
      { order: 5,  instruction: 'Check if partial data was written — run a row count query against the target table' },
      { order: 6,  instruction: 'If partial write -> rollback using the saved rollback command for this script' },
      { order: 7,  instruction: 'Identify root cause: Oracle connection? Data quality? Logic bug?' },
      { order: 8,  instruction: 'Fix and test on a subset first',                                                                  command: 'perl {script_name}.pl --limit 100' },
      { order: 9,  instruction: 'Re-run the failed batch manually',                                                                command: 'time perl {script_name}.pl --period {period}' },
      { order: 10, instruction: 'Add error handling to prevent silent failures in future runs' },
      { order: 11, instruction: 'Log resolution in DevBrain issue' },
    ],
  },
  {
    title: 'Modernize Perl script for performance',
    tags:  ['perl', 'oracle', 'performance', 'refactor'],
    steps: [
      { order: 1,  instruction: 'Record current runtime',                                                                           command: 'time perl {script_name}.pl' },
      { order: 2,  instruction: 'Find all DBI->do() calls inside loops -> convert to prepare() + execute() with bind vars' },
      { order: 3,  instruction: 'Find all fetchrow_hashref() loops -> convert to fetchall_arrayref({}, 1000) bulk fetch' },
      { order: 4,  instruction: 'Find bulk INSERT/UPDATE opportunities -> use execute_array()' },
      { order: 5,  instruction: 'Set AutoCommit=0 and wrap in eval{} with rollback on error' },
      { order: 6,  instruction: 'Move COUNT/SUM/GROUP BY logic from Perl into Oracle SQL' },
      { order: 7,  instruction: 'Add Log::Log4perl to replace raw print statements' },
      { order: 8,  instruction: 'Move hardcoded values to a %config hash or ENV vars' },
      { order: 9,  instruction: 'Test on 1000 records and verify output matches original' },
      { order: 10, instruction: 'Benchmark the improvement',                                                                        command: 'time perl original.pl; time perl {script_name}.pl' },
      { order: 11, instruction: 'Commit',                                                                                           command: 'git commit -m "perf: bulk ops - Xmin to Ymin"' },
      { order: 12, instruction: 'Log the improvement in DevBrain release notes' },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertCommands(
  client: pg.PoolClient,
  projectId: string,
  commands: SeedCommand[]
): Promise<void> {
  for (const cmd of commands) {
    await client.query(
      `INSERT INTO commands (project_id, title, command, language, description, tags, is_favorite)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [projectId, cmd.title, cmd.command, cmd.language, cmd.description, cmd.tags, cmd.is_favorite]
    )
    console.log(`        + command : ${cmd.title}`)
  }
}

async function insertRunbooks(
  client: pg.PoolClient,
  projectId: string,
  runbooks: SeedRunbook[]
): Promise<void> {
  for (const rb of runbooks) {
    await client.query(
      `INSERT INTO runbooks (project_id, title, steps, tags)
       VALUES ($1, $2, $3, $4)`,
      [projectId, rb.title, JSON.stringify(rb.steps), rb.tags]
    )
    console.log(`        + runbook : ${rb.title}`)
  }
}

// ── Migration ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // ── Step 1: add new columns ───────────────────────────────────────────────
    console.log('\n[1/5] Adding new columns to projects...')
    await client.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS kind             TEXT    NOT NULL DEFAULT 'personal',
        ADD COLUMN IF NOT EXISTS git_type         TEXT,
        ADD COLUMN IF NOT EXISTS repo_path        TEXT,
        ADD COLUMN IF NOT EXISTS claude_code_safe BOOLEAN NOT NULL DEFAULT false
    `)
    console.log('      kind, git_type, repo_path, claude_code_safe — done')

    // ── Step 2: extend type CHECK to include 'integration' ────────────────────
    console.log('\n[2/5] Extending type CHECK constraint...')

    // pg stores IN(...) as ANY(ARRAY[...]), so search for 'integration' to detect
    // whether the constraint has already been extended.
    const { rows: alreadyExtended } = await client.query<{ conname: string }>(`
      SELECT conname
      FROM   pg_constraint
      WHERE  conrelid = 'projects'::regclass
        AND  contype  = 'c'
        AND  pg_get_constraintdef(oid) LIKE '%integration%'
    `)

    if (alreadyExtended.length > 0) {
      console.log(`      [SKIP] constraint already includes 'integration'`)
    } else {
      // Find the type constraint by looking for CHECK defs that reference the type column
      const { rows: typeCons } = await client.query<{ conname: string }>(`
        SELECT conname
        FROM   pg_constraint
        WHERE  conrelid = 'projects'::regclass
          AND  contype  = 'c'
          AND  pg_get_constraintdef(oid) LIKE '%type%'
      `)
      for (const { conname } of typeCons) {
        await client.query(`ALTER TABLE projects DROP CONSTRAINT "${conname}"`)
        console.log(`      Dropped: ${conname}`)
      }
      await client.query(`
        ALTER TABLE projects ADD CONSTRAINT projects_type_check
          CHECK (type IN ('mobile', 'web', 'desktop', 'fintech', 'tool', 'integration'))
      `)
      console.log("      Added projects_type_check with 'integration'")
    }

    // ── Step 3: FlowForge ─────────────────────────────────────────────────────
    console.log('\n[3/5] FlowForge...')
    const { rows: ffRows } = await client.query<{ id: string }>(
      'SELECT id FROM projects WHERE short_name = $1', ['flowforge']
    )

    if (ffRows.length > 0) {
      console.log(`      [SKIP] already exists (id=${ffRows[0].id})`)
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO projects
           (name, short_name, description, color, status, tech_stack,
            type, kind, git_type, repo_path, claude_code_safe)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          FLOWFORGE_PROJECT.name,        FLOWFORGE_PROJECT.short_name,
          FLOWFORGE_PROJECT.description, FLOWFORGE_PROJECT.color,
          FLOWFORGE_PROJECT.status,      FLOWFORGE_PROJECT.tech_stack,
          FLOWFORGE_PROJECT.type,        FLOWFORGE_PROJECT.kind,
          FLOWFORGE_PROJECT.git_type,    FLOWFORGE_PROJECT.repo_path,
          FLOWFORGE_PROJECT.claude_code_safe,
        ]
      )
      const ffId = rows[0].id
      console.log(`      Inserted FlowForge id=${ffId}`)
      await insertCommands(client, ffId, FLOWFORGE_COMMANDS)
      await insertRunbooks(client, ffId, FLOWFORGE_RUNBOOKS)
    }

    // ── Step 4: NT Billing Support ────────────────────────────────────────────
    console.log('\n[4/5] NT Billing Support...')
    const { rows: ntRows } = await client.query<{ id: string }>(
      'SELECT id FROM projects WHERE short_name = $1', ['ntbilling']
    )

    if (ntRows.length > 0) {
      console.log(`      [SKIP] already exists (id=${ntRows[0].id})`)
    } else {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO projects
           (name, short_name, description, color, status, tech_stack,
            type, kind, git_type, repo_path, claude_code_safe)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          NTBILLING_PROJECT.name,        NTBILLING_PROJECT.short_name,
          NTBILLING_PROJECT.description, NTBILLING_PROJECT.color,
          NTBILLING_PROJECT.status,      NTBILLING_PROJECT.tech_stack,
          NTBILLING_PROJECT.type,        NTBILLING_PROJECT.kind,
          NTBILLING_PROJECT.git_type,    NTBILLING_PROJECT.repo_path,
          NTBILLING_PROJECT.claude_code_safe,
        ]
      )
      const ntId = rows[0].id
      console.log(`      Inserted NT Billing Support id=${ntId}`)
      await insertCommands(client, ntId, NTBILLING_COMMANDS)
      await insertRunbooks(client, ntId, NTBILLING_RUNBOOKS)
    }

    // ── Step 5: commit ────────────────────────────────────────────────────────
    await client.query('COMMIT')
    console.log('\n[5/5] COMMIT — migration complete.\n')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n[!!] ROLLBACK — migration failed:', (err as Error).message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(() => process.exit(1))
