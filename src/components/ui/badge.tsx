import * as React from "react";
import { cn } from "@/lib/utils";

// Badges carry machine-produced facts (statuses, sources, scores), so they
// read as data: monospace, square corners, lowercase.
export function Badge({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] leading-4 font-medium",
        className
      )}
      {...p}
    />
  );
}
