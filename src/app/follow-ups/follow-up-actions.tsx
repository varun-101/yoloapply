"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Send, X } from "lucide-react";

export default function FollowUpActions({ id, disabled }: { id: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"send" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function act(kind: "send" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(`/api/follow-ups/${id}`, {
        method: kind === "send" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: kind === "cancel" ? JSON.stringify({ action: "cancel" }) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Could not ${kind} follow-up.`);
      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => act("send")} disabled={disabled || busy !== null}>
          {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Review complete — send
        </Button>
        <Button size="sm" variant="outline" onClick={() => act("cancel")} disabled={disabled || busy !== null}>
          {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          Cancel
        </Button>
      </div>
      {error && <div className="text-xs text-rose-700 dark:text-rose-300">{error}</div>}
    </div>
  );
}
