import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
import psycopg

DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@timescaledb:5432/analytics")

app = FastAPI(title="MMS Analytics Portal")


def q(sql, params=None):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()


@app.get("/api/status")
def status():
    telemetry_count = q("SELECT COUNT(*) FROM telemetry_values")[0][0]
    baseline_count = q("SELECT COUNT(*) FROM analytics_baselines")[0][0]
    open_alerts = q("SELECT COUNT(*) FROM analytics_alerts WHERE resolved = FALSE")[0][0]
    return {
        "telemetry_points": telemetry_count,
        "baselines": baseline_count,
        "open_alerts": open_alerts,
        "ok": True,
    }


@app.get("/api/alerts")
def alerts(limit: int = 20):
    rows = q(
        """
        SELECT created_at, asset_id, measurement_type, value, z_score, severity, message
        FROM analytics_alerts
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    return [
        {
            "created_at": r[0].isoformat(),
            "asset_id": r[1],
            "measurement_type": r[2],
            "value": r[3],
            "z_score": r[4],
            "severity": r[5],
            "message": r[6],
        }
        for r in rows
    ]


@app.get("/api/telemetry")
def telemetry(limit: int = 240):
    rows = q(
        """
        SELECT ts, asset_id, measurement_type, value
        FROM telemetry_values
        ORDER BY ts DESC
        LIMIT %s
        """,
        (limit,),
    )
    points = [
        {
            "ts": r[0].isoformat(),
            "asset_id": r[1],
            "measurement_type": r[2],
            "value": float(r[3]),
        }
        for r in rows
    ]
    return list(reversed(points))


@app.get("/", response_class=HTMLResponse)
def dashboard():
    return """
<!doctype html>
<html>
<head>
  <meta charset='utf-8' />
  <title>MMS Analytics Portal</title>
  <meta name='viewport' content='width=device-width, initial-scale=1' />
  <script src='https://cdn.jsdelivr.net/npm/chart.js'></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background:#f8fafc; color:#0f172a; }
    .grid { display:grid; grid-template-columns: repeat(3,1fr); gap:12px; }
    .card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:14px; }
    table { width:100%; border-collapse: collapse; font-size:13px; }
    th, td { padding:8px; border-bottom:1px solid #e2e8f0; text-align:left; }
    .sev-critical { color:#b91c1c; font-weight:700; }
    .sev-warning { color:#b45309; font-weight:700; }
  </style>
</head>
<body>
  <h1>MMS Predictive Analytics</h1>
  <p>Telemetry → baseline → anomaly detection pipeline</p>

  <div class='grid'>
    <div class='card'><div>Telemetry points</div><h2 id='telemetryCount'>-</h2></div>
    <div class='card'><div>Baselines</div><h2 id='baselineCount'>-</h2></div>
    <div class='card'><div>Open alerts</div><h2 id='alertCount'>-</h2></div>
  </div>

  <div class='card' style='margin-top:12px;'>
    <h3>Telemetry time series</h3>
    <canvas id='chart' height='80'></canvas>
  </div>

  <div class='card' style='margin-top:12px;'>
    <h3>Recent alerts</h3>
    <table>
      <thead><tr><th>Time</th><th>Asset</th><th>Type</th><th>Value</th><th>Z</th><th>Severity</th><th>Message</th></tr></thead>
      <tbody id='alertsBody'></tbody>
    </table>
  </div>

  <script>
    async function load() {
      const status = await fetch('/api/status').then(r => r.json())
      document.getElementById('telemetryCount').textContent = status.telemetry_points
      document.getElementById('baselineCount').textContent = status.baselines
      document.getElementById('alertCount').textContent = status.open_alerts

      const alerts = await fetch('/api/alerts').then(r => r.json())
      const tbody = document.getElementById('alertsBody')
      tbody.innerHTML = alerts.map(a => `
        <tr>
          <td>${new Date(a.created_at).toLocaleString()}</td>
          <td>${a.asset_id}</td>
          <td>${a.measurement_type}</td>
          <td>${a.value.toFixed(2)}</td>
          <td>${a.z_score.toFixed(2)}</td>
          <td class='sev-${a.severity}'>${a.severity}</td>
          <td>${a.message}</td>
        </tr>
      `).join('')

      const telemetry = await fetch('/api/telemetry?limit=200').then(r => r.json())
      const grouped = {}
      telemetry.forEach(p => {
        const key = `${p.asset_id}:${p.measurement_type}`
        grouped[key] ||= []
        grouped[key].push(p)
      })

      const keys = Object.keys(grouped)
      if (!keys.length) return
      const first = grouped[keys[0]]
      const labels = first.map(p => new Date(p.ts).toLocaleTimeString())
      const colors = ['#2563eb', '#16a34a', '#b45309', '#9333ea', '#dc2626']
      const datasets = keys.map((k, i) => ({
        label: k,
        data: grouped[k].map(p => p.value),
        borderColor: colors[i % colors.length],
        fill: false,
        tension: 0.2,
      }))

      new Chart(document.getElementById('chart').getContext('2d'), {
        type: 'line',
        data: { labels, datasets },
        options: { responsive: true, scales: { x: { display: true }, y: { display: true } } }
      })
    }
    load()
    setInterval(load, 10000)
  </script>
</body>
</html>
"""
