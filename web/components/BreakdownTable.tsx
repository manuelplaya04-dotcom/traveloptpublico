import { safeHref } from "@/lib/links";
import { fmtMinor } from "@/lib/money";
import type { BreakdownLine } from "@/lib/types";

export default function BreakdownTable({ lines, byCategory, total }: {
  lines: BreakdownLine[]; byCategory: Record<string, number>; total: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_td.text-right]:whitespace-nowrap" data-testid="breakdown">
        <thead>
          <tr className="border-b text-left">
            <th>Concepto</th><th className="text-right">Cant.</th><th className="text-right">Subtotal</th>
            <th className="text-right">Impuestos</th><th className="text-right">Total</th><th />
          </tr>
        </thead>
        <tbody>
          {lines.map((ln, i) => {
            const href = safeHref(ln.deeplink);
            return (
              <tr key={i} className="border-b">
                <td>{ln.description}</td>
                <td className="text-right">{ln.quantity}</td>
                <td className="text-right">{fmtMinor(ln.subtotal_minor)}</td>
                <td className="text-right">{fmtMinor(ln.tax_minor)}</td>
                <td className="text-right">{fmtMinor(ln.total_minor)}</td>
                <td>{href && <a className="underline" href={href} target="_blank" rel="noopener noreferrer">Comprar</a>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {Object.entries(byCategory).map(([cat, v]) => (
            <tr key={cat}><td colSpan={4} className="text-right capitalize">{cat}</td><td className="text-right">{fmtMinor(v)}</td><td /></tr>
          ))}
          <tr className="font-semibold"><td colSpan={4} className="text-right">TOTAL</td><td className="text-right">{fmtMinor(total)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}
