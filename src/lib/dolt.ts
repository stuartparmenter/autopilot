import { SQL } from "bun";

let db: SQL | null = null;

export function getDolt(port = 3307): SQL {
  if (!db) {
    db = new SQL({
      url: `mysql://root@127.0.0.1:${port}/autopilot`,
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
