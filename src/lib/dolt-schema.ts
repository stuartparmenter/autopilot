import { doltExec } from "./dolt";

export async function ensureOperationalTables(): Promise<void> {
  await doltExec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id VARCHAR(128) PRIMARY KEY,
      agent_type VARCHAR(64) NOT NULL,
      persona VARCHAR(64),
      skill VARCHAR(64),
      bead_id VARCHAR(64),
      status VARCHAR(32) NOT NULL DEFAULT 'running',
      cost_usd FLOAT DEFAULT 0,
      duration_ms INT DEFAULT 0,
      num_turns INT DEFAULT 0,
      error TEXT,
      exit_reason VARCHAR(64),
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL
    )
  `);

  await doltExec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id VARCHAR(128) PRIMARY KEY,
      agent_id VARCHAR(128) NOT NULL,
      type VARCHAR(32) NOT NULL,
      summary TEXT,
      is_subagent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_agent (agent_id),
      INDEX idx_created (created_at)
    )
  `);

  await doltExec(`
    CREATE TABLE IF NOT EXISTS planning_sessions (
      id VARCHAR(128) PRIMARY KEY,
      findings_count INT DEFAULT 0,
      rejections INT DEFAULT 0,
      cost_usd FLOAT DEFAULT 0,
      summary TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await doltExec(`
    CREATE TABLE IF NOT EXISTS budget_snapshots (
      id VARCHAR(128) PRIMARY KEY,
      daily_usd FLOAT DEFAULT 0,
      monthly_usd FLOAT DEFAULT 0,
      snapshot_date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_date (snapshot_date)
    )
  `);

  await doltExec(`
    CREATE TABLE IF NOT EXISTS state_transitions (
      id VARCHAR(128) PRIMARY KEY,
      bead_id VARCHAR(64) NOT NULL,
      from_state VARCHAR(32),
      to_state VARCHAR(32) NOT NULL,
      agent_id VARCHAR(128),
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bead (bead_id),
      INDEX idx_created (created_at)
    )
  `);

  await doltExec(`
    CREATE TABLE IF NOT EXISTS conversation_log (
      id VARCHAR(128) PRIMARY KEY,
      agent_id VARCHAR(128) NOT NULL,
      messages JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_agent (agent_id)
    )
  `);
}
