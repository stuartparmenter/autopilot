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

describe("Dashboard WebSocket", () => {
  test("accepts websocket upgrade on /ws", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const server = dashboard.start();
    const port = server.port;

    try {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      const opened = await new Promise<boolean>((resolve) => {
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 2000);
      });
      expect(opened).toBe(true);
      ws.close();
    } finally {
      dashboard.stop();
    }
  });

  test("broadcast sends to connected clients", async () => {
    const dashboard = createDashboard({ port: 0, projectPath: "/tmp" });
    const server = dashboard.start();
    const port = server.port;

    try {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      const received = new Promise<string>((resolve) => {
        ws.onmessage = (e) => resolve(e.data as string);
      });

      dashboard.broadcast({ type: "test", data: { hello: "world" } });

      const msg = await received;
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("test");
      expect(parsed.data.hello).toBe("world");

      ws.close();
    } finally {
      dashboard.stop();
    }
  });
});
