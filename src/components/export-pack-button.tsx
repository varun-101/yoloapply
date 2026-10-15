"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, FolderArchive, GraduationCap, X } from "lucide-react";

// Download menu for the interview-prep export packs (generic profile pack or
// per-application pack). Plain <a> downloads against the export endpoints;
// mirrors the ShareButton popover pattern.
export default function ExportPackButton({
  endpoint,
  label = "Prep pack",
  zipHint,
}: {
  endpoint: string; // e.g. /api/export/profile or /api/applications/<id>/export
  label?: string;
  zipHint: string; // what the .zip adds over the .md
}) {
  const [open, setOpen] = useState(false);

  const options = [
    {
      href: endpoint,
      icon: FileText,
      title: "Markdown (.md)",
      hint: "Paste into ChatGPT, Claude, or any AI tool",
    },
    {
      href: `${endpoint}?format=zip`,
      icon: FolderArchive,
      title: "Bundle (.zip)",
      hint: zipHint,
    },
  ];

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        <GraduationCap className="h-4 w-4" /> {label}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium">Export prep pack</div>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Your facts, bundled for interview prep in whatever AI tool you like. Includes a
            ready-to-paste coaching prompt.
          </p>
          <div className="mt-2 space-y-1">
            {options.map((o) => (
              <a
                key={o.href}
                href={o.href}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 rounded-md border border-slate-200 dark:border-slate-800 px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-950"
              >
                <o.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{o.title}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{o.hint}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
