import { resolve } from "node:path";
import { Hono } from "hono";
import { getRecentRuns, getTotalCost } from "./dashboard-data";

export interface DashboardConfig {
  port: number;
  projectPath: string;
  runsDir?: string;
}

export interface Dashboard {
  app: Hono;
  start(): ReturnType<typeof Bun.serve>;
  stop(): void;
  broadcast(event: { type: string; data: unknown }): void;
}

export function createDashboard(config: DashboardConfig): Dashboard {
  const app = new Hono();
  const clients = new Set<{ send(data: string): void }>();
  let server: ReturnType<typeof Bun.serve> | null = null;

  app.get("/", (c) => {
    return c.html(renderPage());
  });

  app.get("/api/health", (c) => {
    return c.json({ status: "ok" });
  });

  app.get("/api/state", (c) => {
    const runsDir = config.runsDir ?? resolve(import.meta.dir, "../runs");
    const runs = getRecentRuns(runsDir);
    const totalCost = getTotalCost(runs);
    const latestDirection = runs[0]?.directionTitle ?? null;

    return c.json({
      overview: { totalCost, latestDirection },
      runs,
      epics: "Beads integration pending",
      tasks: "Beads integration pending",
    });
  });

  function start() {
    server = Bun.serve<undefined>({
      port: config.port,
      fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          if (srv.upgrade(req)) return undefined as unknown as Response;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return app.fetch(req);
      },
      websocket: {
        open(ws) {
          clients.add(ws);
        },
        close(ws) {
          clients.delete(ws);
        },
        message() {
          // Client messages not used — dashboard is push-only
        },
      },
    });
    return server;
  }

  function stop() {
    server?.stop();
  }

  function broadcast(event: { type: string; data: unknown }) {
    const msg = JSON.stringify(event);
    for (const client of clients) {
      client.send(msg);
    }
  }

  return { app, start, stop, broadcast };
}

function renderPage(): string {
  // Security note: This dashboard is localhost-only. All data originates from
  // trusted internal sources (beads, gk, runs/). Plain text values use
  // textContent; server-rendered HTML tables (runsHtml) are built from trusted
  // internal metrics.json/summary.json files only — no user-supplied content.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ap3 Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 24px; }
    .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; }
    .status.connected { background: #3fb950; }
    .status.disconnected { background: #f85149; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card h2 { font-size: 1rem; font-weight: 500; color: #8b949e; margin-bottom: 12px; }
    .stat { font-size: 2rem; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; font-size: 0.85rem; }
    .level { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 500; }
    .level-vision { background: #1f6feb33; color: #58a6ff; }
    .level-strategy { background: #8957e533; color: #bc8cff; }
    .level-epic { background: #3fb95033; color: #3fb950; }
    .level-task { background: #d2992233; color: #d29922; }
    #runs-table { margin-top: 8px; }
  </style>
</head>
<body>
  <h1><span class="status disconnected" id="ws-status"></span>ap3 Dashboard</h1>

  <div class="grid">
    <div class="card">
      <h2>Total Cost</h2>
      <div class="stat" id="total-cost">$0.00</div>
    </div>
    <div class="card">
      <h2>Latest Direction</h2>
      <div id="latest-direction">&#8212;</div>
    </div>
    <div class="card">
      <h2>Epics</h2>
      <div id="epics">Beads integration pending</div>
    </div>
    <div class="card">
      <h2>Tasks</h2>
      <div id="tasks">Beads integration pending</div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Runs</h2>
    <div id="runs-table">Loading...</div>
  </div>

  <script>
    const wsStatus = document.getElementById('ws-status');
    const totalCost = document.getElementById('total-cost');
    const latestDirection = document.getElementById('latest-direction');
    const runsTable = document.getElementById('runs-table');

    function connect() {
      const ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onopen = function() { wsStatus.className = 'status connected'; };
      ws.onclose = function() {
        wsStatus.className = 'status disconnected';
        setTimeout(connect, 3000);
      };
      ws.onmessage = function(e) {
        const event = JSON.parse(e.data);
        if (event.type === 'state') updateState(event.data);
      };
    }

    function updateState(state) {
      if (state.overview) {
        totalCost.textContent = '$' + (state.overview.totalCost || 0).toFixed(2);
        latestDirection.textContent = state.overview.latestDirection || '\\u2014';
      }
      if (state.runs && Array.isArray(state.runs)) {
        // Build table from trusted internal run data using DOM methods
        while (runsTable.firstChild) runsTable.removeChild(runsTable.firstChild);
        if (state.runs.length === 0) {
          runsTable.textContent = 'No runs yet';
          return;
        }
        var table = document.createElement('table');
        var thead = document.createElement('thead');
        var headerRow = document.createElement('tr');
        ['Level', 'Direction', 'Cost', 'Duration'].forEach(function(text) {
          var th = document.createElement('th');
          th.textContent = text;
          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        state.runs.forEach(function(run) {
          var tr = document.createElement('tr');
          var tdLevel = document.createElement('td');
          var span = document.createElement('span');
          span.className = 'level level-' + (run.level || 'unknown');
          span.textContent = run.level || 'unknown';
          tdLevel.appendChild(span);
          tr.appendChild(tdLevel);
          var tdDir = document.createElement('td');
          tdDir.textContent = run.directionTitle || '\\u2014';
          tr.appendChild(tdDir);
          var tdCost = document.createElement('td');
          tdCost.textContent = '$' + (run.costUsd || 0).toFixed(4);
          tr.appendChild(tdCost);
          var tdDur = document.createElement('td');
          tdDur.textContent = ((run.durationMs || 0) / 1000).toFixed(1) + 's';
          tr.appendChild(tdDur);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        runsTable.appendChild(table);
      }
    }

    fetch('/api/state')
      .then(function(r) { return r.json(); })
      .then(updateState)
      .catch(function() {});

    connect();
  </script>
</body>
</html>`;
}
