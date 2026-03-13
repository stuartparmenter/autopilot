import { afterAll, describe, expect, it } from "bun:test";

// All dolt tests require a running Dolt server — skip when unavailable.
async function doltServerAvailable(): Promise<boolean> {
  try {
    const { doltQuery, closeDolt } = await import("./dolt");
    await doltQuery`SELECT 1`;
    await closeDolt();
    return true;
  } catch {
    return false;
  }
}

const hasServer = await doltServerAvailable();
const itDolt = hasServer ? it : it.skip;

describe("dolt", () => {
  afterAll(async () => {
    if (hasServer) {
      const { closeDolt } = await import("./dolt");
      await closeDolt();
    }
  });

  itDolt("connects to Dolt server", async () => {
    const { doltQuery } = await import("./dolt");
    const rows = await doltQuery<{ val: number }>`SELECT 1 as val`;
    expect(rows[0].val).toBe(1);
  });

  itDolt("creates operational tables without error", async () => {
    const { doltQuery, detectDoltConnection } = await import("./dolt");
    const { ensureOperationalTables } = await import("./dolt-schema");
    const conn = detectDoltConnection();
    await ensureOperationalTables();
    const rows = await doltQuery<{ TABLE_NAME: string }>`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ${conn.database}
        AND TABLE_NAME = 'agent_runs'
    `;
    expect(rows.length).toBe(1);
  });

  itDolt("getDolt returns same instance on repeated calls", async () => {
    const { getDolt } = await import("./dolt");
    const a = getDolt();
    const b = getDolt();
    expect(a).toBe(b);
  });
});
