import { describe, expect, test } from "bun:test";
import { createDashboard } from "./dashboard";

describe("Dashboard", () => {
  test("creates a Hono app", () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    expect(dashboard.app).toBeDefined();
  });

  test("GET / returns HTML", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const res = await dashboard.app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("GET /api/health returns ok", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const res = await dashboard.app.request("/api/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
