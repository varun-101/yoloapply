import { WifiOff } from "lucide-react";
import { RetryButton } from "./retry-button";

// Shown by the service worker when a navigation fails with no network. It is
// precached at install time as a signed-out (public) page, so it must never
// depend on the user's session or data.
export const metadata = { title: "Offline · YOLOapply" };

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 dark:bg-white/[0.06]">
        <WifiOff className="h-5 w-5 text-signal" />
      </div>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        no connection
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">You&apos;re offline</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        YOLOapply needs a connection to reach your pipeline. The agent keeps sweeping the boards on the
        server, so nothing is lost while you&apos;re away.
      </p>
      <RetryButton />
    </div>
  );
}
