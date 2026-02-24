import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, escapeHtml, formatDuration } from "./server";
import { AppState } from "./state";

describe("formatDuration", () => {
  test("returns seconds only for values under 60", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  test("returns 0s for zero seconds", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  test("returns minutes and seconds for values 60–3599", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  test("returns exactly 1m 0s at 60 seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
  });

  test("returns hours and minutes for values >= 3600", () => {
    expect(formatDuration(3665)).toBe("1h 1m");
  });

  test("returns hours and minutes (omitting seconds) for large values", () => {
    expect(formatDuration(7200)).toBe("2h 0m");
  });
});

describe("escapeHtml", () => {
  test("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes less-than", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes greater-than", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  test("escapes double quote", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  test("single quote is intentionally NOT escaped", () => {
    expect(escapeHtml("it's fine")).toBe("it's fine");
  });

  test("escapes all four entities in one string", () => {
    expect(escapeHtml('<a href="x">a & b</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;",
    );
  });
});

describe("auth", () => {
  const TOKEN = "test-secret-token";

  test("without authToken: GET / returns 200 (backwards compatible)", async () => {
    const state = new AppState();
    const app = createApp(state);
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  test("without authToken: GET /api/status returns 200", async () => {
    const state = new AppState();
    const app = createApp(state);
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
  });

  test("with authToken: GET / without cookie returns 401 with login form", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/");
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("Dashboard Token");
    expect(body).toContain("/auth/login");
  });

  test("with authToken: GET /api/status without auth returns 401 JSON", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/api/status");
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Unauthorized");
  });

  test("with authToken: GET /partials/agents without auth returns 401 JSON", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/partials/agents");
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Unauthorized");
  });

  test("with authToken: GET /api/status with valid Bearer token returns 200", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/api/status", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  test("with authToken: GET / with valid cookie returns 200 dashboard", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/", {
      headers: { Cookie: `autopilot_token=${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("claude-autopilot");
    expect(body).toContain("htmx");
  });

  test("with authToken: POST /auth/login with correct token sets cookie and redirects", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(TOKEN)}`,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("autopilot_token=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  test("with authToken: POST /auth/login with wrong token returns 401 with error", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=wrong-token",
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("Invalid token");
  });

  test("with authToken: POST /auth/logout clears cookie and redirects", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `autopilot_token=${TOKEN}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain("autopilot_token=");
    expect(setCookie).toContain("Max-Age=0");
  });

  test("with authToken: dashboard shows Logout button", async () => {
    const state = new AppState();
    const app = createApp(state, { authToken: TOKEN });
    const res = await app.request("/", {
      headers: { Cookie: `autopilot_token=${TOKEN}` },
    });
    const body = await res.text();
    expect(body).toContain("/auth/logout");
    expect(body).toContain("Logout");
  });

  test("without authToken: dashboard does not show Logout button", async () => {
    const state = new AppState();
    const app = createApp(state);
    const res = await app.request("/");
    const body = await res.text();
    expect(body).not.toContain("/auth/logout");
  });
});

describe("routes", () => {
  let state: AppState;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    state = new AppState();
    app = createApp(state);
  });

  test("GET / returns 200 HTML with title", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("claude-autopilot");
  });

  test("GET /api/status returns JSON with expected keys", async () => {
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toHaveProperty("paused");
    expect(json).toHaveProperty("agents");
    expect(json).toHaveProperty("history");
    expect(json).toHaveProperty("queue");
    expect(json).toHaveProperty("auditor");
    expect(json).toHaveProperty("startedAt");
  });

  test("POST /api/pause toggles paused state", async () => {
    expect(state.isPaused()).toBe(false);
    const res = await app.request("/api/pause", { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { paused: boolean };
    expect(json.paused).toBe(true);
    expect(state.isPaused()).toBe(true);
  });

  test("GET /partials/agents with empty state shows 'No agents running'", async () => {
    const res = await app.request("/partials/agents");
    const body = await res.text();
    expect(body).toContain("No agents running");
  });

  test("GET /partials/agents with an agent shows its issue ID", async () => {
    state.addAgent("test-id", "ENG-42", "Fix the thing");
    const res = await app.request("/partials/agents");
    const body = await res.text();
    expect(body).toContain("ENG-42");
  });

  test("GET /partials/history with empty state shows 'No completed agents yet'", async () => {
    const res = await app.request("/partials/history");
    const body = await res.text();
    expect(body).toContain("No completed agents yet");
  });

  test("GET /partials/activity/:id for unknown ID returns 'Agent not found'", async () => {
    const res = await app.request("/partials/activity/unknown-id");
    const body = await res.text();
    expect(body).toContain("Agent not found");
  });
});
