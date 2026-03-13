import { SQL } from "bun";

let db: SQL | null = null;

export interface DoltConnectionInfo {
  host: string;
  port: number;
  database: string;
  user: string;
}

let cachedConn: DoltConnectionInfo | null = null;

/**
 * Detect Dolt connection info from `bd dolt show --json`.
 * Always re-detects to handle Dolt port changes on restart.
 * Only rebuilds the SQL pool if connection details actually changed.
 */
export function detectDoltConnection(): DoltConnectionInfo {
  const result = Bun.spawnSync(["bd", "dolt", "show", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 0) {
    const info = JSON.parse(result.stdout.toString()) as {
      host?: string;
      port?: number;
      database?: string;
      user?: string;
    };
    const conn: DoltConnectionInfo = {
      host: info.host ?? "127.0.0.1",
      port: info.port ?? 3307,
      database: info.database ?? "autopilot",
      user: info.user ?? "root",
    };

    // If port/host changed, invalidate the pool so getDolt() rebuilds it
    if (
      cachedConn &&
      (cachedConn.port !== conn.port || cachedConn.host !== conn.host)
    ) {
      if (db) {
        db.close().catch(() => {});
        db = null;
      }
    }

    cachedConn = conn;
    return conn;
  }
  // Fall back to cached if bd fails (e.g. during startup race)
  if (cachedConn) return cachedConn;
  throw new Error(
    `bd dolt show failed: ${result.stderr.toString().trim() || "unknown error"}`,
  );
}

/**
 * Invalidate cached connection and close existing pool.
 * Next call to getDolt() will re-detect the port.
 */
export async function reconnectDolt(): Promise<void> {
  if (db) {
    try {
      await db.close();
    } catch {
      // already closed
    }
    db = null;
  }
  cachedConn = null;
}

export function getDolt(): SQL {
  if (!db) {
    const conn = detectDoltConnection();
    db = new SQL({
      url: `mysql://${conn.user}@${conn.host}:${conn.port}/${conn.database}`,
      max: 10,
    });
  }
  return db;
}

export async function doltQuery<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const d = getDolt();
  return d<T[]>(strings, ...values);
}

export async function doltExec(sql: string): Promise<void> {
  const d = getDolt();
  // Use unsafe for DDL statements that cannot be parameterized
  await d.unsafe(sql);
}

export async function closeDolt(): Promise<void> {
  if (db) {
    await db.close();
    db = null;
  }
}
