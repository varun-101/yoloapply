"use client";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Trash2, Upload, ExternalLink } from "lucide-react";

interface Info {
  exists: boolean;
  size?: number;
  uploadedAt?: string;
}

function bytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

export default function ResumePage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const res = await fetch("/api/resume", { cache: "no-store" });
    setInfo(await res.json());
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function upload(file: File) {
    setBusy("upload");
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setInfo(data);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setErr(null);
    try {
      const res = await fetch("/api/resume", { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Generic Resume</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        This PDF is attached to every cold email <em>unless</em> a personalized resume has been generated for
        the linked application.
      </p>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Current</CardTitle>
        </CardHeader>
        <CardContent>
          {info === null ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">Loading…</div>
          ) : info.exists ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-8 w-8 text-rose-600 dark:text-rose-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">Varun_Chandwani_Resume.pdf</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {bytes(info.size ?? 0)} · uploaded {info.uploadedAt ? new Date(info.uploadedAt).toLocaleString() : "—"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button asChild variant="outline">
                  <a href="/api/resume/file" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" /> Preview
                  </a>
                </Button>
                <Button variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                  {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Replace
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={remove}>
                  {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              No generic resume uploaded yet — cold emails will go out without an attachment until you upload one.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{info?.exists ? "Replace" : "Upload"} resume</CardTitle>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void upload(f);
            }}
            disabled={busy !== null}
            className="w-full rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-500 transition-colors px-4 py-8 text-sm text-slate-600 dark:text-slate-300 flex flex-col items-center gap-2 disabled:opacity-50"
          >
            {busy === "upload" ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                <span>Uploading…</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                <span>
                  <span className="font-medium">Click to upload</span> or drag a PDF here
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">PDF only, up to 10 MB</span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          {err && (
            <div className="mt-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
