import { SettingsTabs } from "./tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-5 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 mb-1.5">
          Settings
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold">Your setup</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
          The profile, projects, filters and credentials the agent works from.
        </p>
      </div>
      <SettingsTabs />
      {children}
    </div>
  );
}
