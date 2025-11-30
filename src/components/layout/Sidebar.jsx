import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../App';
import { useTheme } from '../../theme/ThemeProvider';

export default function Sidebar() {
  const { profile } = useAuth() || {}; // fallback if context not ready
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  const sections = [
    { label: 'Overview', to: '/' },
    profile?.role === 'patient' && { label: 'Vitals', to: '/patient/vitals' },
    profile?.role === 'patient' && { label: 'Questionnaire', to: '/patient/questionnaire' },
    profile?.role === 'patient' && { label: 'Uploads', to: '/patient/uploads' },
    profile?.role === 'doctor' && { label: 'Patients', to: '/doctor' },
    profile?.role === 'doctor' && { label: 'My Profile', to: '/doctor/profile' },
    profile?.role === 'admin' && { label: 'Admin', to: '/admin' },
  ].filter(Boolean);

  return (
    <aside aria-label="Sidebar navigation" className={`fixed left-0 top-0 h-screen w-60 hidden lg:flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 backdrop-blur-sm pt-20`}>
      <nav className="px-4 space-y-1 text-sm">
        {sections.map(item => (
          <Link key={item.to} to={item.to} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium">
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

export function MobileSidebar() {
  const { profile } = useAuth() || {};
  const [open, setOpen] = useState(false);
  const sections = [
    { label: 'Overview', to: '/' },
    profile?.role === 'patient' && { label: 'Vitals', to: '/patient/vitals' },
    profile?.role === 'patient' && { label: 'Questionnaire', to: '/patient/questionnaire' },
    profile?.role === 'patient' && { label: 'Uploads', to: '/patient/uploads' },
    profile?.role === 'doctor' && { label: 'Patients', to: '/doctor' },
    profile?.role === 'doctor' && { label: 'My Profile', to: '/doctor/profile' },
    profile?.role === 'admin' && { label: 'Admin', to: '/admin' },
  ].filter(Boolean);

  return (
    <div className="lg:hidden">
      <button
        aria-label="Open navigation menu"
        className="btn btn-secondary fixed left-4 top-4 z-50"
        onClick={() => setOpen(true)}
      >☰</button>
      {open && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex">
          <div className="bg-white dark:bg-slate-900 w-64 h-full shadow-xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="font-bold">Menu</div>
              <button className="btn btn-light" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <nav className="space-y-1 text-sm flex-1 overflow-y-auto">
              {sections.map(item => (
                <Link key={item.to} to={item.to} onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <button aria-label="Close sidebar overlay" onClick={() => setOpen(false)} className="flex-1 bg-slate-900/40 backdrop-blur-sm" />
        </div>
      )}
    </div>
  );
}
