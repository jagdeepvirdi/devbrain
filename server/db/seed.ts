import { pool } from './pool.js'

// ── Projects ───────────────────────────────────────────────────────────────

const SEED_PROJECTS = [
  {
    name:        'PlayCru',
    short_name:  'playcru',
    description: 'Hyperlocal social sports app for Bangkok/SEA. Flutter/Firebase. Pickup games, ELO ratings, crew management across 6 sports.',
    color:       '#2ECC71',
    status:      'active',
    tech_stack:  ['Flutter', 'Firebase', 'Dart', 'Firestore', 'Cloud Functions', 'Riverpod'],
    type:        'mobile',
    repo_url:    null,
  },
  {
    name:        'WealthView Pro',
    short_name:  'quantcru',
    description: 'Fintech dashboard for Indian stock markets. Zerodha Kite API integration, algorithmic trading, LSTM prediction models, NSE/BSE tracking.',
    color:       '#F59E0B',
    status:      'active',
    tech_stack:  ['Python', 'React', 'Zerodha Kite API', 'PostgreSQL', 'LSTM', 'pandas'],
    type:        'fintech',
    repo_url:    null,
  },
  {
    name:        'Memex',
    short_name:  'memex',
    description: 'Personal knowledge OS. Auto-classifies notes, recipes, media, passwords from Google Keep, URLs, YouTube, Instagram. Ollama-powered.',
    color:       '#8B5CF6',
    status:      'active',
    tech_stack:  ['React', 'Node.js', 'PostgreSQL', 'Ollama', 'pgvector', 'Tailwind'],
    type:        'web',
    repo_url:    null,
  },
  {
    name:        'DevBrain',
    short_name:  'devbrain',
    description: 'Private developer knowledge base. Document Q&A via RAG, issue investigation, commands library, release notes, runbooks.',
    color:       '#6366F1',
    status:      'active',
    tech_stack:  ['React', 'Node.js', 'PostgreSQL', 'Ollama', 'pgvector', 'Tailwind'],
    type:        'tool',
    repo_url:    null,
  },
  {
    name:        'Music Player',
    short_name:  'musicplayer',
    description: 'Cross-platform music player for Linux and Windows. Built with Flutter Desktop. Project for nephew -- teaching and building together.',
    color:       '#EC4899',
    status:      'planning',
    tech_stack:  ['Flutter', 'Dart', 'just_audio', 'audioplayers'],
    type:        'desktop',
    repo_url:    null,
  },
  {
    name:        'FlowForge',
    short_name:  'flowforge',
    description: 'Database-driven data pipeline orchestrator. Configure pipelines via UI - DB procedures (PostgreSQL + Oracle), reports (Excel/PDF/CSV), email (Gmail + Microsoft 365 + SMTP), Google Drive smart attachments, cron scheduler. Originally internal office tool, being scrubbed and open-sourced on GitHub.',
    color:       '#F97316',
    status:      'active',
    tech_stack:  ['Python', 'Flask', 'React', 'PostgreSQL', 'Oracle', 'Gmail API', 'Microsoft Graph API', 'Google Drive API', 'APScheduler'],
    type:        'tool',   // 'integration' set by migration on migrated DBs; 'tool' is the base-schema fallback
    repo_url:    null,
  },
  {
    name:        'NT Billing Support',
    short_name:  'ntbilling',
    description: 'Office project - custom code layer built on top of telecom billing platform. Perl scripts and Oracle DB procedures for custom reports, data transformations, integrations, and automation. Local git only.',
    color:       '#94A3B8',
    status:      'active',
    tech_stack:  ['Perl', 'Oracle DB', 'PL/SQL', 'Shell/Bash'],
    type:        'tool',   // 'integration' set by migration on migrated DBs; 'tool' is the base-schema fallback
    repo_url:    null,
  },
] as const

// ── Seed commands per project ──────────────────────────────────────────────

type SeedCommand = {
  title:       string
  command:     string
  language:    string
  description: string
  tags:        string[]
  is_favorite: boolean
}

const PLAYCRU_COMMANDS: SeedCommand[] = [
  {
    title:       'Deploy Cloud Functions',
    command:     'firebase deploy --only functions --project playcru-dev',
    language:    'bash',
    description: 'Deploy all Cloud Functions to asia-southeast1 (playcru-dev project).',
    tags:        ['firebase', 'deploy', 'functions'],
    is_favorite: true,
  },
  {
    title:       'Start Firebase Emulators',
    command:     'firebase emulators:start --only firestore,functions --project playcru-dev',
    language:    'bash',
    description: 'Start Firestore + Functions emulators for local dev against playcru-sg database.',
    tags:        ['firebase', 'emulator', 'local'],
    is_favorite: true,
  },
  {
    title:       'Flutter Build Android Release',
    command:     'flutter build apk --release --flavor production',
    language:    'bash',
    description: 'Build a release APK with the production flavor.',
    tags:        ['flutter', 'android', 'build'],
    is_favorite: false,
  },
  {
    title:       'Flutter Run with Firebase Project',
    command:     'flutter run --dart-define=FIREBASE_PROJECT=playcru-dev',
    language:    'bash',
    description: 'Run the app in debug mode targeting the playcru-dev Firebase project.',
    tags:        ['flutter', 'run', 'firebase'],
    is_favorite: false,
  },
  {
    title:       'View Firestore Indexes',
    command:     'firebase firestore:indexes --project playcru-dev',
    language:    'bash',
    description: 'List all deployed Firestore composite indexes for playcru-dev.',
    tags:        ['firebase', 'firestore', 'indexes'],
    is_favorite: false,
  },
  {
    title:       'Deploy Firestore Rules',
    command:     'firebase deploy --only firestore:rules --project playcru-dev',
    language:    'bash',
    description: 'Deploy updated Firestore security rules only.',
    tags:        ['firebase', 'firestore', 'rules', 'deploy'],
    is_favorite: false,
  },
  {
    title:       'Flutter Clean',
    command:     'flutter clean && flutter pub get',
    language:    'bash',
    description: 'Clean build cache and reinstall dependencies. Use when builds behave unexpectedly.',
    tags:        ['flutter', 'clean', 'troubleshoot'],
    is_favorite: false,
  },
]

const QUANTCRU_COMMANDS: SeedCommand[] = [
  {
    title:       'Kite API — Fetch OHLC Historical Data',
    command:     'kite.historical_data(instrument_token, from_date, to_date, interval="day")',
    language:    'python',
    description: 'Fetch OHLC candlestick data for a given instrument token and date range.',
    tags:        ['kite', 'historical', 'ohlc'],
    is_favorite: true,
  },
  {
    title:       'Kite API — Fetch Holdings',
    command:     'kite.holdings()',
    language:    'python',
    description: 'Returns the list of equity holdings in the demat account.',
    tags:        ['kite', 'holdings', 'portfolio'],
    is_favorite: false,
  },
  {
    title:       'Kite API — Place Market Order',
    command:     'kite.place_order(\n    tradingsymbol="INFY",\n    exchange="NSE",\n    transaction_type="BUY",\n    quantity=1,\n    order_type="MARKET",\n    product="CNC"\n)',
    language:    'python',
    description: 'Place a CNC (delivery) market buy order on NSE. Change tradingsymbol, quantity, transaction_type as needed.',
    tags:        ['kite', 'order', 'trading'],
    is_favorite: false,
  },
  {
    title:       'Run Backtest — Momentum Strategy',
    command:     'python backtest.py --strategy momentum --symbol RELIANCE --from 2023-01-01',
    language:    'bash',
    description: 'Run the momentum strategy backtest for RELIANCE from 2023-01-01 to today.',
    tags:        ['backtest', 'momentum', 'reliance'],
    is_favorite: true,
  },
  {
    title:       'Start Kite WebSocket Ticker',
    command:     'python kite_ticker.py --tokens 738561 895745',
    language:    'bash',
    description: 'Start the Kite WebSocket feed for the given instrument tokens (INFY=738561, RELIANCE=895745).',
    tags:        ['kite', 'websocket', 'live', 'ticker'],
    is_favorite: false,
  },
]

const MUSICPLAYER_COMMANDS: SeedCommand[] = [
  {
    title:       'Run on Linux',
    command:     'flutter run -d linux',
    language:    'bash',
    description: 'Launch the music player on Linux desktop in debug mode.',
    tags:        ['flutter', 'linux', 'run'],
    is_favorite: false,
  },
  {
    title:       'Run on Windows',
    command:     'flutter run -d windows',
    language:    'bash',
    description: 'Launch the music player on Windows desktop in debug mode.',
    tags:        ['flutter', 'windows', 'run'],
    is_favorite: true,
  },
  {
    title:       'Build Linux Release',
    command:     'flutter build linux --release',
    language:    'bash',
    description: 'Build a release binary for Linux.',
    tags:        ['flutter', 'linux', 'build'],
    is_favorite: false,
  },
  {
    title:       'Build Windows Release',
    command:     'flutter build windows --release',
    language:    'bash',
    description: 'Build a release binary for Windows.',
    tags:        ['flutter', 'windows', 'build'],
    is_favorite: false,
  },
  {
    title:       'Add just_audio Package',
    command:     'flutter pub add just_audio',
    language:    'bash',
    description: 'Add the just_audio package for cross-platform audio playback.',
    tags:        ['flutter', 'pub', 'audio'],
    is_favorite: false,
  },
]

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

// ── Seed runbooks per project ──────────────────────────────────────────────

type Step = {
  order:       number
  instruction: string
  command?:    string
  note?:       string
}

type SeedRunbook = {
  title: string
  steps: Step[]
  tags:  string[]
}

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

const NTBILLING_RUNBOOKS: SeedRunbook[] = [
  {
    title: 'Investigate slow Perl billing script',
    tags:  ['perl', 'performance', 'oracle'],
    steps: [
      { order: 1,  instruction: 'Add Time::HiRes timing around each major section', note: 'use Time::HiRes qw(time); my $t0 = time(); # section; printf "Section took %.2fs\\n", time() - $t0;' },
      { order: 2,  instruction: 'Run on a small dataset (1000 records) and note timing per section' },
      { order: 3,  instruction: 'Identify the slowest section' },
      { order: 4,  instruction: 'Run DBI_TRACE=2 and look for repeated identical SQL -- means no bind variables, fix immediately', command: 'DBI_TRACE=2 perl {script_name}.pl 2>&1 | grep -E "SQL|execute|fetch"' },
      { order: 5,  instruction: 'Check if the slowest section does row-by-row operations -> convert to execute_array bulk operations' },
      { order: 6,  instruction: 'Check if queries use bind variables -> use prepare() outside the loop, execute() inside' },
      { order: 7,  instruction: 'Check if Perl fetches large datasets just to count or sum -> move aggregation into Oracle SQL' },
      { order: 8,  instruction: 'Check AutoCommit setting -- should be 0 with explicit commits' },
      { order: 9,  instruction: 'Test on the same 1000 records and compare output with original' },
      { order: 10, instruction: 'Run on full dataset and log before/after timing in DevBrain' },
    ],
  },
  {
    title: 'Investigate failed nightly batch',
    tags:  ['perl', 'oracle', 'batch', 'debug'],
    steps: [
      { order: 1,  instruction: 'Check cron log for exit code',                                                         command: 'grep CRON /var/log/syslog | grep {script_name}' },
      { order: 2,  instruction: 'Check script output log for the last 100 lines',                                        command: 'tail -100 /logs/{script_name}.log' },
      { order: 3,  instruction: 'Look for ORA-, DBI Error, or die in log output',                                        command: 'grep -i "ORA-\\|DBI Error\\|die\\|failed" /logs/{script_name}.log | tail -30' },
      { order: 4,  instruction: 'Check Oracle alert log for ORA- errors at the same timestamp' },
      { order: 5,  instruction: 'Check if partial data was written -- run a row count query against the target table' },
      { order: 6,  instruction: 'If partial write -> rollback using the saved rollback command for this script' },
      { order: 7,  instruction: 'Identify root cause: Oracle connection? Data quality? Logic bug?' },
      { order: 8,  instruction: 'Fix and test on a subset first',                                                        command: 'perl {script_name}.pl --limit 100' },
      { order: 9,  instruction: 'Re-run the failed batch manually',                                                      command: 'time perl {script_name}.pl --period {period}' },
      { order: 10, instruction: 'Add error handling to prevent silent failures in future runs' },
      { order: 11, instruction: 'Log resolution in DevBrain issue' },
    ],
  },
  {
    title: 'Modernize Perl script for performance',
    tags:  ['perl', 'oracle', 'performance', 'refactor'],
    steps: [
      { order: 1,  instruction: 'Record current runtime',                                                command: 'time perl {script_name}.pl' },
      { order: 2,  instruction: 'Find all DBI->do() calls inside loops -> convert to prepare() + execute() with bind vars' },
      { order: 3,  instruction: 'Find all fetchrow_hashref() loops -> convert to fetchall_arrayref({}, 1000) bulk fetch' },
      { order: 4,  instruction: 'Find bulk INSERT/UPDATE opportunities -> use execute_array()' },
      { order: 5,  instruction: 'Set AutoCommit=0 and wrap in eval{} with rollback on error' },
      { order: 6,  instruction: 'Move COUNT/SUM/GROUP BY logic from Perl into Oracle SQL' },
      { order: 7,  instruction: 'Add Log::Log4perl to replace raw print statements' },
      { order: 8,  instruction: 'Move hardcoded values to a %config hash or ENV vars' },
      { order: 9,  instruction: 'Test on 1000 records and verify output matches original' },
      { order: 10, instruction: 'Benchmark the improvement',                                             command: 'time perl original.pl; time perl {script_name}.pl' },
      { order: 11, instruction: 'Commit',                                                                command: 'git commit -m "perf: bulk ops - Xmin to Ymin"' },
      { order: 12, instruction: 'Log the improvement in DevBrain release notes' },
    ],
  },
]

// ── Seed runners ───────────────────────────────────────────────────────────

async function seedProjects(): Promise<Record<string, string>> {
  const shortNameToId: Record<string, string> = {}

  for (const p of SEED_PROJECTS) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO projects (name, short_name, description, color, status, tech_stack, type, repo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (short_name) DO UPDATE
         SET name        = EXCLUDED.name,
             description = EXCLUDED.description,
             color       = EXCLUDED.color,
             status      = EXCLUDED.status,
             tech_stack  = EXCLUDED.tech_stack,
             type        = EXCLUDED.type,
             repo_url    = EXCLUDED.repo_url
       RETURNING id`,
      [p.name, p.short_name, p.description, p.color, p.status, p.tech_stack, p.type, p.repo_url]
    )
    shortNameToId[p.short_name] = rows[0].id
  }

  return shortNameToId
}

async function seedCommands(
  projectId: string,
  commands: SeedCommand[]
): Promise<void> {
  for (const c of commands) {
    await pool.query(
      `INSERT INTO commands (project_id, title, command, language, description, tags, is_favorite)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [projectId, c.title, c.command, c.language, c.description, c.tags, c.is_favorite]
    )
  }
}

async function seedRunbooks(
  projectId: string,
  runbooks: SeedRunbook[]
): Promise<void> {
  for (const rb of runbooks) {
    await pool.query(
      `INSERT INTO runbooks (project_id, title, steps, tags)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [projectId, rb.title, JSON.stringify(rb.steps), rb.tags]
    )
  }
}

export async function runSeed(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM projects')
  const count = parseInt(rows[0].count, 10)

  if (count > 0) {
    console.log(`  seed: ${count} projects already exist — skipping`)
    return
  }

  console.log('  seed: seeding projects, commands, and runbooks...')

  const ids = await seedProjects()

  await Promise.all([
    seedCommands(ids.playcru,     PLAYCRU_COMMANDS),
    seedCommands(ids.quantcru,    QUANTCRU_COMMANDS),
    seedCommands(ids.musicplayer, MUSICPLAYER_COMMANDS),
    seedCommands(ids.flowforge,   FLOWFORGE_COMMANDS),
    seedCommands(ids.ntbilling,   NTBILLING_COMMANDS),
    seedRunbooks(ids.flowforge,   FLOWFORGE_RUNBOOKS),
    seedRunbooks(ids.ntbilling,   NTBILLING_RUNBOOKS),
  ])

  const commandCount =
    PLAYCRU_COMMANDS.length +
    QUANTCRU_COMMANDS.length +
    MUSICPLAYER_COMMANDS.length +
    FLOWFORGE_COMMANDS.length +
    NTBILLING_COMMANDS.length

  const runbookCount =
    FLOWFORGE_RUNBOOKS.length +
    NTBILLING_RUNBOOKS.length

  console.log(
    `  seed: inserted ${SEED_PROJECTS.length} projects,`,
    `${commandCount} commands,`,
    `${runbookCount} runbooks`
  )
}
