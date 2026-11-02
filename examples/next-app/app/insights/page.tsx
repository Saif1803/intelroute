import { analytics } from "@/lib/intelroute";

export const dynamic = "force-dynamic";
export const metadata = { title: "IntelRoute insights", description: "Recovered and unresolved URLs." };

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function Insights() {
  const s = analytics.summary();
  const stats: Array<[string, string | number]> = [
    ["Failed requests", s.failedRequests],
    ["Redirected", s.redirected],
    ["Suggested", s.suggested],
    ["Unresolved", s.unresolved],
    ["Recovery rate", pct(s.recoveryRate)],
    ["Accuracy", s.accuracy === null ? "—" : pct(s.accuracy)],
    ["Judge calls", s.judgeCalls],
    ["Avg latency", `${s.averageLatencyMs.toFixed(1)} ms`],
  ];
  return (
    <main>
      <h1>IntelRoute insights</h1>
      <p className="muted">In-memory analytics for this server process.</p>
      <div className="stats">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}>
            <span className="muted">{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <h2>Recovered URLs</h2>
      <table>
        <thead><tr><th>Requested</th><th>Redirected to</th><th className="num">Count</th></tr></thead>
        <tbody>
          {s.topRecovered.map((r) => (
            <tr key={r.from + r.to}><td><code>{r.from}</code></td><td><code>{r.to}</code></td><td className="num">{r.count}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>Unresolved URLs</h2>
      <table>
        <thead><tr><th>Requested</th><th className="num">Count</th></tr></thead>
        <tbody>
          {s.topUnresolved.map((r) => (
            <tr key={r.path}><td><code>{r.path}</code></td><td className="num">{r.count}</td></tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
