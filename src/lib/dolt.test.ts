import { afterAll, describe, expect, it } from "bun:test";
import { closeDolt, doltQuery, getDolt } from "./dolt";

describe("dolt", () => {
  afterAll(async () => {
    await closeDolt();
  });

  it("connects to Dolt server", async () => {
    const rows = await doltQuery<{ val: number }>`SELECT 1 as val`;
    expect(rows[0].val).toBe(1);
  });

  it("creates operational tables without error", async () => {
    const { ensureOperationalTables } = await import("./dolt-schema");
    await ensureOperationalTables();
    const rows = await doltQuery<{ TABLE_NAME: string }>`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = 'autopilot'
        AND TABLE_NAME = 'agent_runs'
    `;
    expect(rows.length).toBe(1);
  });

  it("getDolt returns same instance on repeated calls", () => {
    const a = getDolt();
    const b = getDolt();
    expect(a).toBe(b);
  });
});
