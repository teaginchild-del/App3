import { NavLink, Route, Routes } from 'react-router-dom';
import { isBase44 } from '@/api/base44Client';
import { cx } from '@/components/ui';
import Dashboard from '@/pages/Dashboard';
import QuickBooks from '@/pages/QuickBooks';
import QuickBooksCallback from '@/pages/QuickBooksCallback';
import ImportCsv from '@/pages/ImportCsv';
import Records from '@/pages/Records';
import Matching from '@/pages/Matching';
import Rules from '@/pages/Rules';
import RecordTypes from '@/pages/RecordTypes';

const NAV = [
  ['/', 'Dashboard'],
  ['/quickbooks', 'QuickBooks'],
  ['/import', 'Import'],
  ['/records', 'Records'],
  ['/matching', 'Matching'],
  ['/rules', 'Rules'],
  ['/record-types', 'Record Types'],
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-emerald-700">QBO Match</span>
          <nav className="flex flex-wrap gap-1">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cx('rounded px-2.5 py-1 text-sm', isActive ? 'bg-emerald-50 font-medium text-emerald-800' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          {!isBase44 && (
            <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Local mode · data in this browser</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quickbooks" element={<QuickBooks />} />
          <Route path="/quickbooks/callback" element={<QuickBooksCallback />} />
          <Route path="/import" element={<ImportCsv />} />
          <Route path="/records" element={<Records />} />
          <Route path="/matching" element={<Matching />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/record-types" element={<RecordTypes />} />
        </Routes>
      </main>
    </div>
  );
}
