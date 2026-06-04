export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Temporal Fault Engine | Observability Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #05070f;
      --bg-gradient: radial-gradient(ellipse at top, #0f162d, #03050a);
      --panel: rgba(13, 18, 33, 0.7);
      --panel-glow: rgba(16, 185, 129, 0.03);
      --border: rgba(255, 255, 255, 0.06);
      --border-focus: rgba(16, 185, 129, 0.4);
      --text: #f3f4f6;
      --text-muted: #8e9bb2;
      
      /* Harmonious HSL colors */
      --primary: #10b981; /* emerald */
      --primary-rgb: 16, 185, 129;
      --secondary: #3b82f6; /* blue */
      --secondary-rgb: 59, 130, 246;
      --accent: #8b5cf6; /* violet */
      --accent-rgb: 139, 92, 246;
      --warn: #f59e0b; /* amber */
      --warn-rgb: 245, 158, 11;
      --bad: #ef4444; /* rose */
      --bad-rgb: 239, 68, 68;
      
      --font-title: 'Outfit', sans-serif;
      --font-body: 'Inter', sans-serif;
      --font-mono: 'Fira Code', monospace;
    }

    * {
      box-sizing: border-box;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    body {
      margin: 0;
      font-family: var(--font-body);
      background: var(--bg);
      background-image: var(--bg-gradient);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 32px;
      background: rgba(8, 11, 22, 0.5);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand svg {
      width: 28px;
      height: 28px;
      color: var(--primary);
      filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.4));
    }

    .brand h1 {
      font-family: var(--font-title);
      font-size: 20px;
      font-weight: 700;
      margin: 0;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 30%, #a7f3d0 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .connection-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.04);
      padding: 6px 14px;
      border-radius: 9999px;
      border: 1px solid var(--border);
      transition: all 0.3s ease;
    }

    .connection-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--warn);
      box-shadow: 0 0 8px var(--warn);
      animation: pulse 1.8s infinite;
    }

    .connection-pill.connected .connection-dot {
      background: var(--primary);
      box-shadow: 0 0 8px var(--primary);
    }

    .connection-pill.disconnected .connection-dot {
      background: var(--bad);
      box-shadow: 0 0 8px var(--bad);
    }

    @keyframes pulse {
      0% { opacity: 0.6; }
      50% { opacity: 1; transform: scale(1.1); }
      100% { opacity: 0.6; }
    }

    main {
      flex: 1;
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 24px;
      padding: 24px 32px;
      max-width: 1600px;
      width: 100%;
      margin: 0 auto;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .content-area {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Card Panels */
    .panel {
      border: 1px solid var(--border);
      background: var(--panel);
      background-image: var(--panel-glow);
      border-radius: 12px;
      padding: 24px;
      backdrop-filter: blur(16px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      transition: border-color 0.3s ease;
    }

    .panel:hover {
      border-color: rgba(255, 255, 255, 0.1);
    }

    .panel-title {
      font-family: var(--font-title);
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 20px 0;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Tabs Styling */
    .navigation-tabs {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .nav-tab {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--text-muted);
      padding: 12px 16px;
      text-align: left;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .nav-tab svg {
      width: 18px;
      height: 18px;
      transition: transform 0.25s ease;
    }

    .nav-tab:hover {
      background: rgba(255, 255, 255, 0.03);
      color: #ffffff;
    }

    .nav-tab:hover svg {
      transform: translateX(2px);
    }

    .nav-tab.active {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.2);
      color: var(--primary);
    }

    .nav-tab.active svg {
      color: var(--primary);
      filter: drop-shadow(0 0 4px rgba(16, 185, 129, 0.4));
    }

    /* Forms inputs */
    .form-group {
      margin-bottom: 18px;
    }

    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .input-wrapper {
      position: relative;
    }

    input, textarea, select {
      width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(5, 7, 15, 0.6);
      color: var(--text);
      padding: 12px 14px;
      font-size: 14px;
      font-family: inherit;
      transition: all 0.3s ease;
    }

    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
      background: rgba(5, 7, 15, 0.95);
    }

    textarea {
      min-height: 120px;
      font-family: var(--font-mono);
      font-size: 12px;
      resize: vertical;
    }

    button.btn-primary {
      width: 100%;
      border-radius: 8px;
      border: 1px solid rgba(16, 185, 129, 0.3);
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
      transition: all 0.2s ease;
    }

    button.btn-primary:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
      border-color: rgba(16, 185, 129, 0.5);
    }

    button.btn-primary:active {
      transform: translateY(1px);
    }

    button.btn-secondary {
      width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    button.btn-secondary:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.15);
    }

    /* Grids & Cards */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
    }

    .metric-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }

    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: transparent;
    }

    .metric-card:hover {
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
    }

    /* Colored metric themes */
    .metric-card.total::before { background: var(--accent); }
    .metric-card.pending::before { background: var(--secondary); }
    .metric-card.executing::before { background: var(--warn); }
    .metric-card.executed::before { background: var(--primary); }
    .metric-card.failed::before { background: var(--bad); }

    .metric-value {
      font-size: 28px;
      font-weight: 700;
      font-family: var(--font-title);
      line-height: 1;
    }

    .metric-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Tables */
    .table-container {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 13px;
    }

    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }

    th {
      font-family: var(--font-title);
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.01);
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.5px;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.015);
    }

    code {
      font-family: var(--font-mono);
      font-size: 12px;
      background: rgba(255, 255, 255, 0.04);
      padding: 3px 6px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      color: #93c5fd;
    }

    .code-id {
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .copy-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .copy-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }

    /* Status Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .badge-pending {
      background: rgba(59, 130, 246, 0.1);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.2);
    }
    .badge-pending::before { background: #60a5fa; }

    .badge-claimed {
      background: rgba(139, 92, 246, 0.1);
      color: #a78bfa;
      border: 1px solid rgba(139, 92, 246, 0.2);
    }
    .badge-claimed::before { background: #a78bfa; }

    .badge-executing {
      background: rgba(245, 158, 11, 0.1);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .badge-executing::before { background: #fbbf24; }

    .badge-executed {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .badge-executed::before { background: #34d399; }

    .badge-failed {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .badge-failed::before { background: #f87171; }

    /* Worker Pill */
    .worker-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      color: #cbd5e1;
    }
    .worker-pill svg {
      width: 12px;
      height: 12px;
      color: var(--text-muted);
    }

    .hidden {
      display: none !important;
    }

    /* Performance Metrics Custom Styling */
    .perf-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }

    .perf-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }

    .perf-card .val {
      font-family: var(--font-title);
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 4px;
    }

    .perf-card .lbl {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .worker-dist-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .worker-dist-item {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .worker-dist-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 500;
    }

    .worker-dist-bar-container {
      height: 8px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .worker-dist-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--secondary) 0%, var(--primary) 100%);
      border-radius: 4px;
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .benchmark-status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--primary);
      margin-top: 12px;
      font-weight: 500;
    }

    @media (max-width: 960px) {
      main {
        grid-template-columns: 1fr;
        padding: 16px;
      }
      .perf-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
      <h1>Temporal Fault Engine</h1>
    </div>
    <div id="socketStatus" class="connection-pill disconnected">
      <div class="connection-dot"></div>
      <span id="socketStatusText">Connecting...</span>
    </div>
  </header>

  <main>
    <div class="sidebar">
      <section class="panel">
        <div class="panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          Console Modules
        </div>
        <div class="navigation-tabs">
          <button class="nav-tab active" data-tab="producer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            Producer View
          </button>
          <button class="nav-tab" data-tab="consumer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
            Consumer Explorer
          </button>
          <button class="nav-tab" data-tab="benchmark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Benchmark & Metrics
          </button>
        </div>
      </section>

      <!-- Producer Sidebar Panel -->
      <form id="producerPanel" class="panel">
        <div class="panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Insert Custom Event
        </div>
        <div class="form-group">
          <label for="scheduledAt">Schedule Time</label>
          <input id="scheduledAt" type="datetime-local" required />
        </div>
        <div class="form-group">
          <label for="idempotencyKey">Idempotency Key (Optional)</label>
          <input id="idempotencyKey" placeholder="e.g. order-unique-9923" />
        </div>
        <div class="form-group">
          <label for="payload">Payload JSON</label>
          <textarea id="payload">{"eventId":"manual-test","source":"dashboard"}</textarea>
        </div>
        <button type="submit" class="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Insert Event
        </button>
      </form>

      <!-- Consumer Sidebar Panel -->
      <div id="consumerPanel" class="panel hidden">
        <div class="panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filters & Controls
        </div>
        <div class="form-group">
          <label for="statusFilter">Lifecycle Status Filter</label>
          <select id="statusFilter">
            <option value="">All Statuses</option>
            <option>PENDING</option>
            <option>CLAIMED</option>
            <option>EXECUTING</option>
            <option>EXECUTED</option>
            <option>FAILED</option>
          </select>
        </div>
        <button class="btn-secondary" id="refreshEvents" style="margin-top: 10px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
          Sync Grid Data
        </button>
      </div>

      <!-- Benchmark Sidebar Panel -->
      <form id="benchmarkPanel" class="panel hidden">
        <div class="panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          Benchmark Controller
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label for="benchCount">Batch Count</label>
            <input id="benchCount" type="number" min="1" max="1000" value="200" />
          </div>
          <div class="form-group">
            <label for="benchDelay">Delay (ms)</label>
            <input id="benchDelay" type="number" min="0" value="0" />
          </div>
        </div>
        <div class="form-group">
          <label for="benchPrefix">Idempotency Prefix</label>
          <input id="benchPrefix" value="benchmark-run" />
        </div>
        <button type="submit" class="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          Execute Benchmark
        </button>
        <div id="benchmarkResult" class="benchmark-status-badge hidden">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <span id="benchmarkResultText">Benchmark completed.</span>
        </div>
      </form>
    </div>

    <div class="content-area">
      <!-- Producer metrics and recent events -->
      <div id="producerViewContent" class="view-content-wrapper">
        <section class="panel" style="margin-bottom: 20px;">
          <div class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
            System Event Lifecycle Counters
          </div>
          <div class="metrics-grid">
            <div class="metric-card total">
              <span class="metric-label">Total Events</span>
              <span id="statTotal" class="metric-value">0</span>
            </div>
            <div class="metric-card pending">
              <span class="metric-label">Pending</span>
              <span id="statPending" class="metric-value">0</span>
            </div>
            <div class="metric-card executing">
              <span class="metric-label">Executing</span>
              <span id="statExecuting" class="metric-value">0</span>
            </div>
            <div class="metric-card executed">
              <span class="metric-label">Executed</span>
              <span id="statExecuted" class="metric-value">0</span>
            </div>
            <div class="metric-card failed">
              <span class="metric-label">Failed</span>
              <span id="statFailed" class="metric-value">0</span>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Live Logs & Stream
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Status</th>
                  <th>Idempotency Key</th>
                  <th>Scheduled Time</th>
                  <th>Payload Preview</th>
                </tr>
              </thead>
              <tbody id="producerEventsTableBody">
                <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Syncing live logs feed...</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- Consumer main content -->
      <div id="consumerViewContent" class="view-content-wrapper hidden">
        <section class="panel">
          <div class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
            Consumer Explorer Grid
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Event ID</th>
                  <th>Payload</th>
                  <th>Scheduled Time</th>
                  <th>Actual Execution Time</th>
                  <th>Variance (ms)</th>
                  <th>Worker Node</th>
                </tr>
              </thead>
              <tbody id="consumEventsTableBody">
                <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Loading events grid...</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- Benchmark Metrics main content -->
      <div id="benchmarkViewContent" class="view-content-wrapper hidden">
        <section class="panel" style="margin-bottom: 20px;">
          <div class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
            Benchmark Latency performance
          </div>
          <div class="perf-grid">
            <div class="perf-card">
              <div id="benchAvg" class="val">0 ms</div>
              <div class="lbl">Average Latency</div>
            </div>
            <div class="perf-card">
              <div id="benchP50" class="val">0 ms</div>
              <div class="lbl">P50 (Median)</div>
            </div>
            <div class="perf-card">
              <div id="benchP95" class="val">0 ms</div>
              <div class="lbl">P95 Latency</div>
            </div>
            <div class="perf-card">
              <div id="benchP99" class="val">0 ms</div>
              <div class="lbl">P99 Latency</div>
            </div>
            <div class="perf-card">
              <div id="benchMax" class="val">0 ms</div>
              <div class="lbl">Maximum Latency</div>
            </div>
          </div>
        </section>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <section class="panel">
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
              Execution Volume Metrics
            </div>
            <div class="metrics-grid" style="grid-template-columns: repeat(3, 1fr); margin-bottom: 20px;">
              <div class="metric-card executed" style="padding: 14px;">
                <span class="metric-label" style="font-size: 11px;">Executed</span>
                <span id="benchExecuted" class="val" style="font-size: 24px; font-family: var(--font-title); font-weight: 700; color: #ffffff;">0</span>
              </div>
              <div class="metric-card failed" style="padding: 14px;">
                <span class="metric-label" style="font-size: 11px;">Failed</span>
                <span id="benchFailed" class="val" style="font-size: 24px; font-family: var(--font-title); font-weight: 700; color: #ffffff;">0</span>
              </div>
              <div class="metric-card total" style="padding: 14px;">
                <span class="metric-label" style="font-size: 11px;">Attempts</span>
                <span id="benchAttempts" class="val" style="font-size: 24px; font-family: var(--font-title); font-weight: 700; color: #ffffff;">0</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              Worker Distribution Load
            </div>
            <div id="workerDistribution" class="worker-dist-list">
              <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding-top: 15px;">No benchmark worker distributions found yet.</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    const socketStatus = $("socketStatus");
    const socketStatusText = $("socketStatusText");

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

    function formatTime(isoStr) {
      if (!isoStr) return "-";
      return new Date(isoStr).toLocaleTimeString() + " (" + new Date(isoStr).toLocaleDateString() + ")";
    }

    function getBadgeClass(status) {
      switch(status) {
        case "PENDING": return "badge badge-pending";
        case "CLAIMED": return "badge badge-claimed";
        case "EXECUTING": return "badge badge-executing";
        case "EXECUTED": return "badge badge-executed";
        case "FAILED": return "badge badge-failed";
        default: return "badge";
      }
    }

    function copyToClipboard(text, btnElement) {
      navigator.clipboard.writeText(text).then(() => {
        const originalContent = btnElement.innerHTML;
        btnElement.innerHTML = "<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='" + varToHex('--primary') + "' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'></polyline></svg>";
        setTimeout(() => { btnElement.innerHTML = originalContent; }, 1500);
      }).catch(console.error);
    }

    function varToHex(variable) {
      return variable === '--primary' ? '#10b981' : '#8e9bb2';
    }

    async function loadMetrics() {
      const data = await request("/metrics/json");
      const counts = data.events.byStatus;
      
      // Calculate Total Events
      const total = Object.values(counts).reduce((acc, curr) => acc + curr, 0);
      
      // Set values in Producer metrics
      $("statTotal").textContent = total;
      $("statPending").textContent = counts.PENDING;
      $("statExecuting").textContent = counts.EXECUTING;
      $("statExecuted").textContent = counts.EXECUTED;
      $("statFailed").textContent = counts.FAILED;
    }

    async function loadEvents() {
      const status = $("statusFilter").value;
      const rows = await request("/api/events?limit=50" + (status ? "&status=" + status : ""));
      
      // Populate Producer Log (recent events feed)
      $("producerEventsTableBody").innerHTML = rows.slice(0, 15).map((row) => (
        "<tr>" +
        "<td><div class='code-id'><code>" + row.id.slice(0, 8) + "...</code>" +
        "<button class='copy-btn' onclick='copyToClipboard(\"" + row.id + "\", this)' title='Copy ID'>" +
        "<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path></svg>" +
        "</button></div></td>" +
        "<td><span class='" + getBadgeClass(row.status) + "'>" + row.status + "</span></td>" +
        "<td>" + (row.idempotencyKey ? "<code>" + escapeHtml(row.idempotencyKey) + "</code>" : "<span style='color: var(--text-muted); font-size:12px;'>none</span>") + "</td>" +
        "<td>" + formatTime(row.scheduledAt) + "</td>" +
        "<td><code style='color: #86efac;'>" + escapeHtml(JSON.stringify(row.payload)).slice(0, 50) + "...</code></td>" +
        "</tr>"
      )).join("");

      // Populate Consumer Explorer Table
      // Columns: Event ID, Status, Worker ID, Scheduled Time, Execution Time
      $("consumEventsTableBody").innerHTML = rows.map((row) => {
        const variance = row.executedAt && row.scheduledAt
          ? Math.round(new Date(row.executedAt) - new Date(row.scheduledAt))
          : "-";

        return "<tr>" +
          "<td><div class='code-id'><code>" + row.id.slice(0, 8) + "...</code>" +
          "<button class='copy-btn' onclick='copyToClipboard(\"" + row.id + "\", this)' title='Copy ID'>" +
          "<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path></svg>" +
          "</button></div></td>" +
          "<td><code style='color: #86efac;'>" + escapeHtml(JSON.stringify(row.payload)).slice(0, 40) + "...</code></td>" +
          "<td>" + formatTime(row.scheduledAt) + "</td>" +
          "<td>" + (row.executedAt ? "<span style='color: var(--primary); font-weight:500;'>" + formatTime(row.executedAt) + "</span>" : "<span style='color: var(--text-muted);'>-</span>") + "</td>" +
          "<td>" + (variance !== "-" ? "<span style='font-weight:600; color: " + (variance <= 200 ? "var(--primary)" : "var(--bad)") + ";'>" + variance + " ms</span>" : "<span style='color: var(--text-muted);'>-</span>") + "</td>" +
          "<td>" + (row.claimedBy ? "<span class='worker-pill'><svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'></path><circle cx='12' cy='7' r='4'></circle></svg>" + escapeHtml(row.claimedBy) + "</span>" : "<span style='color: var(--text-muted); font-size:12px;'>-</span>") + "</td>" +
          "</tr>";
      }).join("");
    }

    async function loadBenchmarkMetrics() {
      try {
        const metrics = await request("/api/benchmarks/metrics");
        
        // Latencies
        $("benchAvg").textContent = metrics.latency.avg + " ms";
        $("benchP50").textContent = metrics.latency.p50 + " ms";
        $("benchP95").textContent = metrics.latency.p95 + " ms";
        $("benchP99").textContent = metrics.latency.p99 + " ms";
        $("benchMax").textContent = metrics.latency.max + " ms";

        // Counts
        $("benchExecuted").textContent = metrics.counts.executed;
        $("benchFailed").textContent = metrics.counts.failed;
        $("benchAttempts").textContent = metrics.counts.attempts;

        // Worker distribution
        const total = metrics.workerDistribution.reduce((acc, curr) => acc + curr.count, 0);
        if (metrics.workerDistribution.length === 0) {
          $("workerDistribution").innerHTML = "<div style='text-align: center; color: var(--text-muted); font-size: 13px; padding-top: 15px;'>No benchmark worker distributions found yet.</div>";
        } else {
          $("workerDistribution").innerHTML = metrics.workerDistribution.map((item) => {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return "<div class='worker-dist-item'>" +
              "<div class='worker-dist-header'>" +
                "<span class='worker-pill'>" +
                  "<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'></path><circle cx='12' cy='7' r='4'></circle></svg> " +
                  escapeHtml(item.worker) +
                "</span>" +
                "<span style='color: var(--text); font-weight: 600;'>" + item.count + " attempts (" + pct + "%)</span>" +
              "</div>" +
              "<div class='worker-dist-bar-container'>" +
                "<div class='worker-dist-bar' style='width: " + pct + "%;'></div>" +
              "</div>" +
            "</div>";
          }).join("");
        }
      } catch(err) {
        console.error("Error loading benchmark metrics", err);
      }
    }

    function escapeHtml(value) {
      if (typeof value !== "string") return String(value);
      return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    // Client-side WebSocket passive heartbeat & automatic reconnect
    let ws;
    let lastActive = Date.now();
    let isConnecting = false;

    function connectSocket() {
      if (isConnecting) return;
      isConnecting = true;

      const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(wsProtocol + "://" + location.host + "/ws");
      
      ws.onopen = () => {
        isConnecting = false;
        socketStatus.className = "connection-pill connected";
        socketStatusText.textContent = "Live Console";
        lastActive = Date.now();
      };

      ws.onclose = () => {
        isConnecting = false;
        socketStatus.className = "connection-pill disconnected";
        socketStatusText.textContent = "Reconnecting...";
        setTimeout(connectSocket, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        lastActive = Date.now();
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch(e) {}
        
        // Refresh dashboard data on updates
        if (payload?.type !== "heartbeat") {
          loadMetrics().catch(console.error);
          loadEvents().catch(console.error);
          loadBenchmarkMetrics().catch(console.error);
        }
      };
    }

    // Monitor WebSocket connection health actively from client-side
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // If we haven't heard from the server (either heartbeats or updates) in 35 seconds, force-reconnect
        if (Date.now() - lastActive > 35000) {
          console.warn("WebSocket stream stale. Forcing reconnect...");
          ws.close();
        }
      } else if (!isConnecting) {
        connectSocket();
      }
    }, 10000);

    // Tab Switching
    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll("[data-tab]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        
        const currentTab = button.dataset.tab;
        
        // Show/hide left sidebar forms
        ["producer", "consumer", "benchmark"].forEach((name) => {
          $(name + "Panel").classList.toggle("hidden", name !== currentTab);
        });

        // Show/hide main contents
        $("producerViewContent").classList.toggle("hidden", currentTab !== "producer");
        $("consumerViewContent").classList.toggle("hidden", currentTab !== "consumer");
        $("benchmarkViewContent").classList.toggle("hidden", currentTab !== "benchmark");

        // Reload data for the active view
        if (currentTab === "benchmark") {
          loadBenchmarkMetrics().catch(console.error);
        } else {
          loadEvents().catch(console.error);
          loadMetrics().catch(console.error);
        }
      });
    });

    // Forms Submission & Interaction
    $("producerPanel").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
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
        $("idempotencyKey").value = "";
      } catch(err) {
        alert("Event Insertion Failed: " + err.message);
      }
    });

    $("benchmarkPanel").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        $("benchmarkResult").classList.add("hidden");
        const count = $("benchCount").value;
        const delayMs = $("benchDelay").value;
        const prefix = $("benchPrefix").value;
        
        const result = await request("/api/benchmarks/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count, delayMs, prefix })
        });
        
        $("benchmarkResultText").textContent = result.inserted + " events inserted in " + result.durationMs + "ms (" + result.insertsPerSecond + "/s)";
        $("benchmarkResult").classList.remove("hidden");
        
        await Promise.all([loadMetrics(), loadEvents(), loadBenchmarkMetrics()]);
      } catch(err) {
        alert("Benchmark Initialization Failed: " + err.message);
      }
    });

    $("refreshEvents").addEventListener("click", loadEvents);
    $("statusFilter").addEventListener("change", loadEvents);

    // Initial setup
    defaultSchedule();
    connectSocket();
    
    // Background polling for safety/robustness
    loadMetrics().catch(console.error);
    loadEvents().catch(console.error);
    loadBenchmarkMetrics().catch(console.error);

    setInterval(() => {
      loadMetrics().catch(console.error);
      const activeTab = document.querySelector(".nav-tab.active").dataset.tab;
      if (activeTab === "benchmark") {
        loadBenchmarkMetrics().catch(console.error);
      } else {
        loadEvents().catch(console.error);
      }
    }, 5000);
  </script>
</body>
</html>`;
