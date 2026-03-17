import { resolve } from "node:path";
import { Hono } from "hono";
import { getRecentRuns, getTotalCost } from "./dashboard-data";
import { DashboardState } from "./dashboard-state";

export interface DashboardConfig {
  port: number;
  projectPath: string;
  runsDir?: string;
}

export interface Dashboard {
  app: Hono;
  state: DashboardState;
  start(): ReturnType<typeof Bun.serve>;
  stop(): void;
  broadcast(event: { type: string; data: unknown }): void;
}

export function createDashboard(config: DashboardConfig): Dashboard {
  const app = new Hono();
  const state = new DashboardState();
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
          ws.send(
            JSON.stringify({
              type: "snapshot",
              data: state.getSnapshot(),
            }),
          );
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

  return { app, state, start, stop, broadcast };
}

function renderPage(): string {
  // Security note: localhost-only dashboard. All data from trusted internal
  // sources. DOM built with createElement/textContent — no innerHTML.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ap3 Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1117; color: #e1e4e8; display: flex; flex-direction: column; }
    #header { height: 32px; min-height: 32px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; padding: 0 12px; gap: 12px; font-size: 13px; }
    #header .logo { font-weight: 600; color: #58a6ff; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .status-dot.running { background: #3fb950; }
    .status-dot.waiting { background: #d29922; }
    .status-dot.idle { background: #484f58; }
    .level-badge { padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; }
    .level-vision { background: #1f6feb33; color: #58a6ff; }
    .level-strategy { background: #8957e533; color: #bc8cff; }
    .level-epic { background: #3fb95033; color: #3fb950; }
    .level-task { background: #d2992233; color: #d29922; }
    .body { flex: 1; display: flex; overflow: hidden; }
    #sidebar { width: 180px; min-width: 180px; background: #0d1117; border-right: 1px solid #30363d; overflow-y: auto; padding: 4px 0; }
    .sidebar-group { padding: 4px 10px; color: #8b949e; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }
    .sidebar-group:first-child { margin-top: 0; }
    .agent-entry { padding: 6px 10px; cursor: pointer; border-left: 2px solid transparent; }
    .agent-entry:hover { background: #161b22; }
    .agent-entry.selected { background: #1f6feb18; border-left-color: #58a6ff; }
    .agent-entry .agent-name { font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 4px; }
    .agent-entry .agent-meta { font-size: 10px; color: #8b949e; margin-top: 2px; }
    .agent-entry .agent-last { font-size: 10px; color: #6e7681; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .agent-name .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
    .dot.running { background: #3fb950; }
    .dot.done { background: #484f58; }
    .dot.error { background: #f85149; }
    .name-planner { color: #58a6ff; }
    .name-executor { color: #3fb950; }
    #main-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
    #main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
    #main-header { padding: 6px 12px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 30px; flex-shrink: 0; }
    #main-header .agent-label { font-weight: 600; }
    #main-header .meta { color: #8b949e; font-size: 11px; }
    .activity-stream { flex: 1; overflow-y: auto; padding: 8px 12px; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 12px; line-height: 1.6; }
    .activity-line { white-space: pre-wrap; word-break: break-word; }
    .activity-line.tool_use { color: #8b949e; }
    .activity-line.text { color: #e1e4e8; }
    .activity-line.result { color: #3fb950; }
    .activity-line.error { color: #f85149; }
    .activity-line.status { color: #8b949e; }
    .activity-line.progress { color: #8b949e; }
    .activity-line.subagent { padding-left: 16px; }
    .subagent-label { color: #bc8cff; font-weight: 500; }
    .subagent-splits { flex: 1; display: flex; gap: 1px; background: #30363d; overflow: hidden; min-height: 0; }
    .subagent-panel { flex: 1; background: #0d1117; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
    .subagent-header { padding: 4px 8px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 6px; font-size: 11px; }
    .subagent-header .sub-name { font-weight: 500; color: #bc8cff; }
    .subagent-header .meta { color: #8b949e; font-size: 10px; }
    .parent-section { padding: 6px 12px; border-bottom: 1px solid #21262d; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 11px; color: #8b949e; max-height: 120px; overflow-y: auto; flex-shrink: 0; }
    .empty-state { flex: 1; display: flex; align-items: center; justify-content: center; color: #484f58; font-size: 14px; }
  </style>
</head>
<body>
  <div id="header">
    <span class="logo">ap3</span>
    <span><span class="status-dot idle" id="status-dot"></span><span id="status-text">idle</span></span>
    <span class="level-badge" id="level-badge" style="display:none"></span>
    <span id="running-count" style="color:#8b949e; margin-left:auto;"></span>
  </div>
  <div class="body">
    <aside id="sidebar"></aside>
    <div id="main-panel">
      <div id="main-header"></div>
      <div id="main-content" class="empty-state">Select an agent to view activity</div>
    </div>
  </div>
  <script>
    var agents = {};
    var selectedAgent = null;

    function connect() {
      var ws = new WebSocket('ws://' + location.host + '/ws');
      ws.onopen = function() {};
      ws.onclose = function() { setTimeout(connect, 3000); };
      ws.onmessage = function(e) {
        var event = JSON.parse(e.data);
        switch (event.type) {
          case 'snapshot': handleSnapshot(event.data); break;
          case 'agent:start': handleAgentStart(event.data); break;
          case 'agent:end': handleAgentEnd(event.data); break;
          case 'activity': handleActivity(event.data); break;
          case 'orchestrator:status': handleOrchestratorStatus(event.data); break;
        }
      };
    }

    function handleSnapshot(data) {
      if (data.status) handleOrchestratorStatus(data);
      if (data.agents) {
        data.agents.forEach(function(a) {
          agents[a.agentId] = { info: a, entries: data.recentActivities[a.agentId] || [] };
        });
      }
      renderSidebar();
      if (!selectedAgent && Object.keys(agents).length > 0) {
        var running = Object.keys(agents).filter(function(id) { return agents[id].info.state === 'running'; });
        if (running.length > 0) selectAgent(running[0]);
      }
    }

    function handleAgentStart(data) {
      agents[data.agentId] = {
        info: { agentId: data.agentId, agentLabel: data.agentLabel, agentType: data.agentType, state: 'running', startedAt: Date.now(), subagents: [] },
        entries: [],
        toolUses: 0
      };
      renderSidebar();
      if (!selectedAgent) selectAgent(data.agentId);
    }

    function handleAgentEnd(data) {
      var agent = agents[data.agentId];
      if (!agent) return;
      agent.info.state = data.result === 'success' ? 'done' : 'error';
      agent.info.endedAt = Date.now();
      agent.info.costUsd = data.costUsd;
      agent.info.durationMs = data.durationMs;
      renderSidebar();
      if (selectedAgent === data.agentId) renderMainPanel();
    }

    function handleActivity(data) {
      var agent = agents[data.agentId];
      if (!agent) return;
      agent.entries.push(data.entry);
      if (agent.entries.length > 2000) agent.entries.splice(0, agent.entries.length - 2000);
      if (data.entry.type === 'tool_use') agent.toolUses = (agent.toolUses || 0) + 1;
      if (data.entry.isSubagent && data.entry.subagentName) {
        if (agent.info.subagents.indexOf(data.entry.subagentName) === -1) {
          agent.info.subagents.push(data.entry.subagentName);
        }
      }
      updateSidebarEntry(data.agentId);
      if (selectedAgent === data.agentId) appendActivity(data.entry);
    }

    function handleOrchestratorStatus(data) {
      var dot = document.getElementById('status-dot');
      var text = document.getElementById('status-text');
      var badge = document.getElementById('level-badge');
      var status = data.status || 'idle';
      dot.className = 'status-dot ' + status;
      text.textContent = status;
      if (data.currentLevel) {
        badge.style.display = '';
        badge.className = 'level-badge level-' + data.currentLevel;
        badge.textContent = data.currentLevel;
      } else {
        badge.style.display = 'none';
      }
      updateRunningCount();
    }

    function updateRunningCount() {
      var count = Object.values(agents).filter(function(a) { return a.info.state === 'running'; }).length;
      document.getElementById('running-count').textContent = count > 0 ? count + ' running' : '';
    }

    function selectAgent(agentId) {
      selectedAgent = agentId;
      renderSidebar();
      renderMainPanel();
    }

    function renderSidebar() {
      var sidebar = document.getElementById('sidebar');
      while (sidebar.firstChild) sidebar.removeChild(sidebar.firstChild);
      var running = [], done = [];
      Object.values(agents).forEach(function(a) {
        if (a.info.state === 'running') running.push(a);
        else done.push(a);
      });
      running.sort(function(a, b) { return b.info.startedAt - a.info.startedAt; });
      done.sort(function(a, b) { return (b.info.endedAt || 0) - (a.info.endedAt || 0); });
      if (running.length > 0) {
        var label = document.createElement('div');
        label.className = 'sidebar-group';
        label.textContent = 'Running';
        sidebar.appendChild(label);
        running.forEach(function(a) { sidebar.appendChild(createAgentEntry(a)); });
      }
      if (done.length > 0) {
        var label2 = document.createElement('div');
        label2.className = 'sidebar-group';
        label2.textContent = 'Done';
        sidebar.appendChild(label2);
        done.forEach(function(a) { sidebar.appendChild(createAgentEntry(a)); });
      }
      updateRunningCount();
    }

    function createAgentEntry(agent) {
      var div = document.createElement('div');
      div.className = 'agent-entry' + (selectedAgent === agent.info.agentId ? ' selected' : '');
      div.setAttribute('data-agent-id', agent.info.agentId);
      div.onclick = function() { selectAgent(agent.info.agentId); };
      var nameRow = document.createElement('div');
      nameRow.className = 'agent-name';
      var dot = document.createElement('span');
      dot.className = 'dot ' + agent.info.state;
      nameRow.appendChild(dot);
      var name = document.createElement('span');
      name.className = 'name-' + agent.info.agentType;
      name.textContent = agent.info.agentLabel;
      nameRow.appendChild(name);
      div.appendChild(nameRow);
      var meta = document.createElement('div');
      meta.className = 'agent-meta';
      var turns = agent.toolUses || 0;
      meta.textContent = formatDuration(agent.info.startedAt, agent.info.endedAt) + (turns > 0 ? ' \\u00b7 ' + turns + ' tools' : '');
      div.appendChild(meta);
      if (agent.info.subagents && agent.info.subagents.length > 0 && agent.info.state === 'running') {
        var subs = document.createElement('div');
        subs.className = 'agent-last';
        subs.textContent = '\\u21b3 ' + agent.info.subagents.join(', ');
        div.appendChild(subs);
      }
      return div;
    }

    function updateSidebarEntry(agentId) {
      var existing = document.querySelector('[data-agent-id="' + agentId + '"]');
      if (!existing) return;
      var agent = agents[agentId];
      if (!agent) return;
      existing.parentNode.replaceChild(createAgentEntry(agent), existing);
    }

    function renderMainPanel() {
      var header = document.getElementById('main-header');
      var content = document.getElementById('main-content');
      while (header.firstChild) header.removeChild(header.firstChild);
      while (content.firstChild) content.removeChild(content.firstChild);
      content.className = '';
      if (!selectedAgent || !agents[selectedAgent]) {
        content.className = 'empty-state';
        content.textContent = 'Select an agent to view activity';
        return;
      }
      var agent = agents[selectedAgent];
      var label = document.createElement('span');
      label.className = 'agent-label name-' + agent.info.agentType;
      label.textContent = agent.info.agentLabel;
      header.appendChild(label);
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = formatDuration(agent.info.startedAt, agent.info.endedAt);
      header.appendChild(meta);
      var activeSubagents = getActiveSubagents(agent);
      if (activeSubagents.length > 0) {
        var parentSection = document.createElement('div');
        parentSection.className = 'parent-section';
        agent.entries.filter(function(e) { return !e.isSubagent; }).forEach(function(e) {
          parentSection.appendChild(renderActivityLine(e));
        });
        content.appendChild(parentSection);
        var splits = document.createElement('div');
        splits.className = 'subagent-splits';
        activeSubagents.forEach(function(subName) {
          var panel = document.createElement('div');
          panel.className = 'subagent-panel';
          var subHeader = document.createElement('div');
          subHeader.className = 'subagent-header';
          var subNameEl = document.createElement('span');
          subNameEl.className = 'sub-name';
          subNameEl.textContent = subName;
          subHeader.appendChild(subNameEl);
          panel.appendChild(subHeader);
          var stream = document.createElement('div');
          stream.className = 'activity-stream';
          agent.entries.filter(function(e) { return e.isSubagent && e.subagentName === subName; }).forEach(function(e) {
            stream.appendChild(renderActivityLine(e, true));
          });
          panel.appendChild(stream);
          splits.appendChild(panel);
        });
        content.appendChild(splits);
      } else {
        var stream = document.createElement('div');
        stream.className = 'activity-stream';
        stream.id = 'activity-stream';
        agent.entries.forEach(function(e) { stream.appendChild(renderActivityLine(e)); });
        content.appendChild(stream);
        stream.scrollTop = stream.scrollHeight;
      }
    }

    function appendActivity(entry) {
      var agent = agents[selectedAgent];
      if (!agent) return;
      var activeSubagents = getActiveSubagents(agent);

      if (activeSubagents.length > 0) {
        // Check if we need to re-render (new subagent appeared that we don't have a panel for)
        var panels = document.querySelectorAll('.subagent-panel');
        var panelNames = [];
        panels.forEach(function(p) {
          var nameEl = p.querySelector('.sub-name');
          if (nameEl) panelNames.push(nameEl.textContent);
        });
        var needsRebuild = activeSubagents.some(function(s) { return panelNames.indexOf(s) === -1; });
        if (needsRebuild) { renderMainPanel(); return; }

        if (entry.isSubagent && entry.subagentName) {
          // Append to the correct subagent stream
          var idx = activeSubagents.indexOf(entry.subagentName);
          if (idx >= 0 && panels[idx]) {
            var stream = panels[idx].querySelector('.activity-stream');
            if (stream) {
              var atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 50;
              stream.appendChild(renderActivityLine(entry, true));
              if (atBottom) stream.scrollTop = stream.scrollHeight;
            }
          }
        } else {
          // Parent entry — append to parent section
          var parentSection = document.querySelector('.parent-section');
          if (parentSection) {
            parentSection.appendChild(renderActivityLine(entry));
            parentSection.scrollTop = parentSection.scrollHeight;
          }
        }
        return;
      }

      var stream = document.getElementById('activity-stream');
      if (!stream) { renderMainPanel(); return; }
      var atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 50;
      stream.appendChild(renderActivityLine(entry));
      if (atBottom) stream.scrollTop = stream.scrollHeight;
    }

    function getActiveSubagents(agent) {
      if (agent.info.state !== 'running') return [];
      return agent.info.subagents || [];
    }

    function renderActivityLine(entry, inPanel) {
      var div = document.createElement('div');
      div.className = 'activity-line ' + entry.type;
      if (entry.isSubagent && !inPanel) div.className += ' subagent';
      if (entry.isSubagent && entry.subagentName && !inPanel) {
        var labelSpan = document.createElement('span');
        labelSpan.className = 'subagent-label';
        labelSpan.textContent = '[' + entry.subagentName + '] ';
        div.appendChild(labelSpan);
      }
      var text = '';
      switch (entry.type) {
        case 'tool_use': text = '[tool] ' + entry.summary; break;
        case 'text': text = entry.detail || entry.summary; break;
        case 'result': text = '<< ' + entry.summary; break;
        case 'error': text = '!! ' + entry.summary; break;
        case 'status': text = '>> ' + entry.summary; break;
        case 'progress': text = '.. ' + entry.summary; break;
        default: text = entry.summary;
      }
      div.appendChild(document.createTextNode(text));
      return div;
    }

    function formatDuration(startedAt, endedAt) {
      var ms = (endedAt || Date.now()) - startedAt;
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      s = s % 60;
      return m + 'm ' + s + 's';
    }

    setInterval(function() {
      var hasRunning = Object.values(agents).some(function(a) { return a.info.state === 'running'; });
      if (hasRunning) renderSidebar();
    }, 1000);

    connect();
  </script>
</body>
</html>`;
}
