"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// The inline script in layout.tsx applies the saved theme before first paint;
// this component just reflects and flips it.
export function ThemeToggle() {
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

  return (
    <button
      onClick={toggle}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
      title="Toggle dark mode"
    >
      {/* Render both until mounted so SSR markup matches either theme. */}
      {dark === null ? (
        <Sun className="h-4 w-4" />
      ) : dark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
