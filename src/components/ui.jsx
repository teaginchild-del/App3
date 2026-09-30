// Small Tailwind primitives. Kept dependency-free so Base44's editor can
// restyle or swap them for shadcn/ui without touching page logic.

export function cx(...c) {
  return c.filter(Boolean).join(' ');
}

export function Button({ variant = 'primary', size = 'md', className, ...props }) {
  const styles = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  return (
    <button
      className={cx('inline-flex items-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed', styles[variant], sizes[size], className)}
      {...props}
    />
  );
}

export function Card({ title, actions, children, className }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ tone = 'slate', children }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-sky-100 text-sky-800',
  };
  return <span className={cx('inline-block rounded px-1.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function StatusBadge({ status }) {
  const tone = { matched: 'green', confirmed: 'green', suggested: 'amber', rejected: 'red', unmatched: 'slate' }[status] || 'slate';
  return <Badge tone={tone}>{status || 'unmatched'}</Badge>;
}

export function ScoreBadge({ score }) {
  const tone = score >= 0.9 ? 'green' : score >= 0.75 ? 'blue' : 'amber';
  return <Badge tone={tone}>{Math.round((score || 0) * 100)}%</Badge>;
}

export function Field({ label, children, hint }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function Select({ options, value, onChange, placeholder, className }) {
  return (
    <select className={cx(inputClass, className)} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Alert({ tone = 'info', children }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  return <div className={cx('rounded-md border px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}

export function Empty({ children }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Table({ columns, rows, onRowClick, rowKey = (r) => r.id, selectedKey }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className={cx('whitespace-nowrap px-2 py-2 font-medium', c.align === 'right' && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx(
                'border-b border-slate-100',
                onRowClick && 'cursor-pointer hover:bg-slate-50',
                selectedKey != null && selectedKey === rowKey(r) && 'bg-emerald-50',
              )}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('whitespace-nowrap px-2 py-1.5', c.align === 'right' && 'text-right tabular-nums')}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const money = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function fmtMoney(n) {
  return n == null || Number.isNaN(n) ? '—' : money.format(n);
}
