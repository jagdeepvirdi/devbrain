import 'dotenv/config'
import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Running Phase 28.3 (Templates) migrations...')

    // Create templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS templates (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id  TEXT        REFERENCES projects(id) ON DELETE CASCADE,
        type        TEXT        NOT NULL CHECK (type IN ('issue', 'runbook', 'document')),
        name        TEXT        NOT NULL,
        description TEXT        NOT NULL DEFAULT '',
        body        JSONB       NOT NULL,
        is_builtin  BOOLEAN     NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS templates_project_idx ON templates (project_id);
    `)

    // Seed default built-in templates
    const builtinTemplates = [
      {
        name: 'Bug Report',
        type: 'issue',
        description: 'Standard template for reporting bugs, including reproduction steps and basic testing checklist.',
        is_builtin: true,
        body: JSON.stringify({
          title: 'Bug: [Brief description of the issue]',
          description: '### Description\nBriefly describe the bug.\n\n### Steps to Reproduce\n1. Go to...\n2. Click on...\n3. See error...\n\n### Expected Behavior\nWhat should have happened?\n\n### Environment Details\n- OS:\n- Browser/Version:\n',
          tags: ['bug', 'triage'],
          steps: [
            'Reproduce the bug in the local dev environment',
            'Locate the failing component/route/file',
            'Write a failing test case',
            'Implement the fix and verify tests pass',
            'Validate the UI layout and responsiveness'
          ]
        })
      },
      {
        name: 'Investigation',
        type: 'issue',
        description: 'Template for technical investigations, troubleshooting, and diagnosing system issues.',
        is_builtin: true,
        body: JSON.stringify({
          title: 'Investigate: [Topic or symptom]',
          description: '### Symptom / Problem\nDescribe what is failing or behaving unexpectedly.\n\n### Hypothesis\nWhat do you suspect is the root cause?\n\n### Log Snippets / Context\n```\nPaste log contents here\n```\n',
          tags: ['investigation'],
          steps: [
            'Retrieve relevant database logs or server logs',
            'Check for recent changes or commits in the affected code paths',
            'Run local performance profile or isolation tests',
            'Document analysis results and propose remediation steps'
          ]
        })
      },
      {
        name: 'Deployment Runbook',
        type: 'runbook',
        description: 'Built-in steps for deploying updates, pulling latest changes, running tests, and starting services.',
        is_builtin: true,
        body: JSON.stringify({
          steps: [
            { instruction: 'Stash or discard any local working tree modifications', command: 'git stash' },
            { instruction: 'Pull the latest commits from the main repository branch', command: 'git pull origin main' },
            { instruction: 'Install any new library dependencies', command: 'npm install' },
            { instruction: 'Execute database schema migrations if pending', command: 'npm run migrate' },
            { instruction: 'Run the project build and typechecking', command: 'npm run build' },
            { instruction: 'Launch the server/application service', command: 'npm run start' }
          ]
        })
      },
      {
        name: 'Incident Postmortem',
        type: 'runbook',
        description: 'Runbook template for reviewing incidents, documenting timelines, and tracking action items.',
        is_builtin: true,
        body: JSON.stringify({
          steps: [
            { instruction: 'Define the Incident Summary (Start, End, Impact, Severity)' },
            { instruction: 'Construct a detailed chronological Timeline of events' },
            { instruction: 'Identify Root Cause analysis (Five Whys or trigger factors)' },
            { instruction: 'Determine Action Items to prevent recurrence and assign owners' },
            { instruction: 'Draft and publish the final postmortem report' }
          ]
        })
      }
    ]

    for (const t of builtinTemplates) {
      // Check if template already exists by name
      const { rows } = await client.query('SELECT id FROM templates WHERE name = $1 AND is_builtin = true', [t.name])
      if (rows.length === 0) {
        await client.query(`
          INSERT INTO templates (name, type, description, body, is_builtin)
          VALUES ($1, $2, $3, $4, $5)
        `, [t.name, t.type, t.description, t.body, t.is_builtin])
      }
    }

    await client.query('COMMIT')
    console.log('Migration complete.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', e)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
