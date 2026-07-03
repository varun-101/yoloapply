"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, Loader2, Share2, X } from "lucide-react";

// Mints a public share link for this application (resume + cover letter) and
// shows it in a small popover with a copy button. Links are stateless signed
// tokens — closing the popover doesn't revoke anything; the link simply
// expires on its own (the copy below says so).
export default function ShareButton({ id, canShare }: { id: string; canShare: boolean }) {
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = link !== null || err !== null;

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/applications/${id}/share`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to create link");
      setLink({ url: j.url, expiresAt: j.expiresAt });
      setCopied(false);
      try {
        await navigator.clipboard.writeText(j.url);
        setCopied(true);
      } catch {
        // clipboard needs a secure context / permission — manual copy still works
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setLink(null);
    setErr(null);
    setCopied(false);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — the input below stays selectable
    }
  }

  return (
    <div className="relative">
      <Button variant="outline" onClick={open ? close : create} disabled={!canShare || busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        Share
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium">Public share link</div>
            <button
              onClick={close}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {err ? (
            <div className="mt-2 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-300">
              {err}
            </div>
          ) : link ? (
            <>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-700 dark:text-slate-300"
                />
                <Button variant="outline" size="sm" onClick={copy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Anyone with this link can view the resume and cover letter until{" "}
                <span className="font-mono">{link.expiresAt.slice(0, 10)}</span>. It can&apos;t be
                revoked early — it just expires.
              </p>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
