"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Circle, Clock3, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApplicationReadiness, ApplicationTaskStatusValue } from "@/lib/application-agent/workflow-types";

interface TaskView {
  key: string;
  label: string;
  status: ApplicationTaskStatusValue;
  required: boolean;
  errorMessage: string | null;
}

const READINESS_LABEL: Record<ApplicationReadiness, string> = {
  NOT_STARTED: "Not started",
  PREPARING: "Preparing",
  NEEDS_REVIEW: "Needs review",
  READY: "Ready for review",
  FAILED: "Action needed",
};

function TaskIcon({ status }: { status: ApplicationTaskStatusValue }) {
  if (status === "SUCCESS") return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  if (status === "RUNNING") return <Loader2 className="h-4 w-4 animate-spin text-signal" />;
  if (status === "FAILED") return <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
  if (status === "NEEDS_REVIEW") return <Clock3 className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
  return <Circle className="h-4 w-4 text-slate-300 dark:text-slate-600" />;
}

export default function WorkflowPanel({
  applicationId,
  readiness,
  tasks,
  hasJobDescription,
}: {
  applicationId: string;
  readiness: ApplicationReadiness;
  tasks: TaskView[];
  hasJobDescription: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analysis = tasks.find((task) => task.key === "ANALYZE_MATCH");

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/applications/${applicationId}/analyze`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Match analysis failed");
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Application workflow</CardTitle>
        <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {READINESS_LABEL[readiness]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {tasks.map((task) => (
            <div key={task.key} className="rounded-md border border-slate-100 dark:border-slate-800 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <TaskIcon status={task.status} />
                <span className="font-medium">{task.label}</span>
                {!task.required && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400">optional</span>
                )}
              </div>
              {task.errorMessage && (
                <div className="mt-1 pl-6 text-xs text-rose-600 dark:text-rose-400">{task.errorMessage}</div>
              )}
            </div>
          ))}
        </div>
        {analysis && analysis.status !== "SUCCESS" && (
          <Button onClick={analyze} disabled={busy || !hasJobDescription} size="sm" variant="outline">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {analysis.status === "FAILED" ? "Retry match analysis" : "Analyze match"}
          </Button>
        )}
        {error && <div className="text-xs text-rose-600 dark:text-rose-400">{error}</div>}
      </CardContent>
    </Card>
  );
}
