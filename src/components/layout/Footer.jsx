import React from 'react';

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 dark:border-slate-800/70">
      <div className="max-w-7xl mx-auto px-6 py-10 grid gap-6 md:grid-cols-3 text-sm text-slate-600 dark:text-slate-400">
        <div>
          <div className="font-extrabold text-slate-800 dark:text-slate-100 text-lg">SmartDocAid</div>
          <p className="mt-2">Your AI-powered multi-portal healthcare companion.</p>
        </div>
        <div>
          <div className="font-semibold text-slate-800 dark:text-slate-200">Product</div>
          <ul className="mt-2 space-y-1">
            <li><a className="hover:text-primary" href="/patient">Patient Portal</a></li>
            <li><a className="hover:text-primary" href="/doctor">Doctor Portal</a></li>
            <li><a className="hover:text-primary" href="/admin">Admin</a></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-slate-800 dark:text-slate-200">Company</div>
          <ul className="mt-2 space-y-1">
            <li><a className="hover:text-primary" href="#">Privacy</a></li>
            <li><a className="hover:text-primary" href="#">Terms</a></li>
            <li><a className="hover:text-primary" href="#">Contact</a></li>
          </ul>
        </div>
      </div>
      <div className="text-center text-xs py-4 text-slate-500 dark:text-slate-500">© {new Date().getFullYear()} SmartDocAid. All rights reserved.</div>
    </footer>
  );
}
