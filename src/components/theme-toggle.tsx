"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

// The inline script in layout.tsx applies the saved theme before first paint;
// this component just reflects and flips it. It sits on the rail, which now
// follows the theme, so its colors carry light + dark variants.
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // private mode etc. — theme just won't persist
    }
    setDark(next);
  }

  const icon =
    dark === null || dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />;

  if (compact) {
    return (
      <button
        onClick={toggle}
        title="Switch theme"
        className="grid h-7 w-7 place-items-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 dark:text-slate-400",
        "hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70"
      )}
      title="Switch theme"
    >
      {icon}
      <span>{dark ? "Switch to light" : "Switch to dark"}</span>
    </button>
  );
}
