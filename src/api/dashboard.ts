export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Temporal Fault Engine</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0d10;
      --panel: #121820;
      --line: #25313f;
      --text: #f4f7fb;
      --muted: #9badbf;
      --accent: #35d49a;
      --warn: #ffcc66;
      --bad: #ff6b6b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid var(--line);
      background: #0d1217;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1 { font-size: 20px; margin: 0; }
    main {
      display: grid;
      grid-template-columns: minmax(320px, 420px) 1fr;
      gap: 18px;
      padding: 18px;
    }
    section {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 16px;
    }
    h2 {
      font-size: 15px;
      margin: 0 0 14px;
      color: #dce7f2;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 12px;
    }
    input, textarea, select, button {
      width: 100%;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: #0a0f14;
      color: var(--text);
      padding: 10px 11px;
      font: inherit;
    }
    textarea { min-height: 150px; resize: vertical; }
    button {
      cursor: pointer;
      border-color: #2da97d;
      background: #13845f;
      font-weight: 700;
    }
    button.secondary {
      background: #17222c;
      border-color: var(--line);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(110px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    .metric {
      background: #0a0f14;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      min-width: 0;
    }
    .metric strong {
      display: block;
      font-size: 24px;
      line-height: 1.1;
      margin-bottom: 5px;
    }
    .metric span { color: var(--muted); font-size: 12px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 9px 8px;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    code {
      color: #a8f0cf;
      word-break: break-all;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .tabs button {
      width: auto;
      padding: 8px 12px;
    }
    .tabs button[aria-selected="true"] {
      background: #13845f;
      border-color: #2da97d;
    }
    .hidden { display: none; }
    .status { color: var(--muted); font-size: 13px; }
    .ok { color: var(--accent); }
    .bad { color: var(--bad); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 960px) {
      main { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <h1>Temporal Fault Engine</h1>
    <div id="socketStatus" class="status">WebSocket connecting</div>
  </header>
  <main>
    <div>
      <section>
        <div class="tabs">
          <button class="secondary" data-tab="producer" aria-selected="true">Producer</button>
          <button class="secondary" data-tab="consumer">Consumer</button>
          <button class="secondary" data-tab="benchmark">Benchmark</button>
        </div>

        <form id="producerPanel">
          <h2>Producer Dashboard</h2>
          <label>Schedule time
            <input id="scheduledAt" type="datetime-local" />
          </label>
          <label>Idempotency key
            <input id="idempotencyKey" placeholder="optional-key-123" />
          </label>
          <label>Payload JSON
            <textarea id="payload">{"eventId":"manual-test","source":"dashboard"}</textarea>
          </label>
          <button type="submit">Insert Event</button>
        </form>

        <div id="consumerPanel" class="hidden">
          <h2>Consumer Dashboard</h2>
          <label>Status filter
            <select id="statusFilter">
              <option value="">All</option>
              <option>PENDING</option>
              <option>CLAIMED</option>
              <option>EXECUTING</option>
              <option>EXECUTED</option>
              <option>FAILED</option>
            </select>
          </label>
          <button class="secondary" id="refreshEvents">Refresh Events</button>
        </div>

        <form id="benchmarkPanel" class="hidden">
          <h2>Benchmark Tooling</h2>
          <div class="row">
            <label>Event count
              <input id="benchCount" type="number" min="1" max="1000" value="100" />
            </label>
            <label>Delay ms
              <input id="benchDelay" type="number" min="0" value="0" />
            </label>
          </div>
          <label>Idempotency prefix
            <input id="benchPrefix" value="bench" />
          </label>
          <button type="submit">Run Insert Benchmark</button>
          <p id="benchmarkResult" class="status"></p>
        </form>
      </section>
    </div>

    <div>
      <section>
        <h2>Metrics</h2>
        <div id="metrics" class="grid"></div>
      </section>

      <section style="margin-top: 18px;">
        <h2>Recent Events</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>Attempts</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody id="events"></tbody>
        </table>
      </section>
    </div>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    const socketStatus = $("socketStatus");

    function defaultSchedule() {
      const now = new Date(Date.now() + 5000);
      now.setSeconds(0, 0);
      $("scheduledAt").value = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }

    async function request(path, options) {
      const res = await fetch(path, options);
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(data?.error || res.statusText);
      return data;
    }

    async function loadMetrics() {
      const data = await request("/metrics/json");
      const counts = data.events.byStatus;
      $("metrics").innerHTML = [
        ["Pending", counts.PENDING],
        ["Executing", counts.EXECUTING],
        ["Executed", counts.EXECUTED],
        ["Failed", counts.FAILED],
        ["Lag ms", data.events.maxSchedulerLagMs],
        ["Due pending", data.events.duePending],
        ["Avg exec ms", data.executions.avgDurationMs],
        ["DB", data.health.database],
        ["Redis", data.health.redis],
      ].map(([label, value]) => '<div class="metric"><strong>' + value + '</strong><span>' + label + '</span></div>').join("");
    }

    async function loadEvents() {
      const status = $("statusFilter").value;
      const rows = await request("/api/events?limit=50" + (status ? "&status=" + status : ""));
      $("events").innerHTML = rows.map((row) => (
        "<tr>" +
        "<td><code>" + row.id + "</code></td>" +
        "<td>" + row.status + "</td>" +
        "<td>" + new Date(row.scheduledAt).toLocaleString() + "</td>" +
        "<td>" + row.attemptCount + "</td>" +
        "<td><code>" + escapeHtml(JSON.stringify(row.payload)).slice(0, 180) + "</code></td>" +
        "</tr>"
      )).join("");
    }

    function escapeHtml(value) {
      return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    function connectSocket() {
      const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/ws");
      ws.onopen = () => { socketStatus.textContent = "WebSocket live"; socketStatus.className = "status ok"; };
      ws.onclose = () => {
        socketStatus.textContent = "WebSocket reconnecting";
        socketStatus.className = "status bad";
        setTimeout(connectSocket, 1200);
      };
      ws.onmessage = () => {
        loadMetrics().catch(console.error);
        loadEvents().catch(console.error);
      };
    }

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-tab]").forEach((item) => item.setAttribute("aria-selected", "false"));
        button.setAttribute("aria-selected", "true");
        ["producer", "consumer", "benchmark"].forEach((name) => {
          $(name + "Panel").classList.toggle("hidden", name !== button.dataset.tab);
        });
      });
    });

    $("producerPanel").addEventListener("submit", async (event) => {
      event.preventDefault();
      const rawPayload = $("payload").value.trim();
      const payload = rawPayload ? JSON.parse(rawPayload) : {};
      const idempotencyKey = $("idempotencyKey").value.trim();
      await request("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload,
          scheduledAt: new Date($("scheduledAt").value).toISOString(),
          ...(idempotencyKey ? { idempotencyKey } : {})
        })
      });
      await Promise.all([loadMetrics(), loadEvents()]);
    });

    $("benchmarkPanel").addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await request("/api/benchmarks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: $("benchCount").value,
          delayMs: $("benchDelay").value,
          prefix: $("benchPrefix").value
        })
      });
      $("benchmarkResult").textContent = result.inserted + " events inserted in " + result.durationMs + "ms (" + result.insertsPerSecond + "/s)";
      await Promise.all([loadMetrics(), loadEvents()]);
    });

    $("refreshEvents").addEventListener("click", loadEvents);
    $("statusFilter").addEventListener("change", loadEvents);

    defaultSchedule();
    connectSocket();
    loadMetrics().catch(console.error);
    loadEvents().catch(console.error);
    setInterval(loadMetrics, 5000);
  </script>
</body>
</html>`;
