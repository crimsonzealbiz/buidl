import type { Check } from "@/lib/proof/verify";

export function ChecksTable({ checks }: { checks: Check[] }) {
  return (
    <div className="card table-wrap">
      <table>
        <tbody>
          {checks.map((c) => (
            <tr key={c.name}>
              <td><span className={`badge ${c.ok ? "ok" : "bad"}`}>{c.ok ? "pass" : "fail"}</span></td>
              <td>{c.name}</td>
              <td className="mono">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
