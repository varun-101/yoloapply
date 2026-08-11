"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// "Add to home screen", handled for both platforms:
//
//  - Android / desktop Chromium fires `beforeinstallprompt`, which we stash and
//    replay when the user taps Install. It only fires once the install criteria
//    are met (manifest + service worker + https), so this banner simply never
//    appears where installing is impossible.
//  - iOS has no such event: Safari installs only through Share → Add to Home
//    Screen. There is no API to trigger or even detect eligibility, so we show
//    the instructions instead — that's the whole reason for the platform split.
//
// Dismissal is snoozed, not permanent: nagging is worse than a second ask.

const SNOOZE_KEY = "yoloapply:install-dismissed-at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag — it does not implement display-mode: standalone.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep Chrome's mini-infobar out of the way
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
      try {
        window.localStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* private mode */
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    if (isIos()) setShowIosHelp(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* private mode — it just asks again next visit */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The event is single-use whichever way they answered.
    setDeferred(null);
    setHidden(true);
  }, [deferred]);

  if (hidden || (!deferred && !showIosHelp)) return null;

  // text-left is explicit: the banner can float over a centered page. It also
  // sits above the mobile tab bar; on md+ there is no bar to clear.
  return (
    <div
      role="complementary"
      aria-label="Install YOLOapply"
      className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg dark:border-slate-800 dark:bg-slate-900 md:bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:left-auto md:right-4 md:mx-0"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-signal font-display text-sm font-bold text-slate-950">
          Y
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Install YOLOapply
          </div>
          {deferred ? (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Keep your pipeline one tap away, full screen, no browser chrome.
            </p>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Tap</span>
              <Share className="h-3.5 w-3.5 shrink-0 text-signal" aria-label="Share" />
              <span>then</span>
              <SquarePlus className="h-3.5 w-3.5 shrink-0 text-signal" aria-hidden />
              <span className="font-medium text-slate-700 dark:text-slate-200">Add to Home Screen</span>
            </p>
          )}
          {deferred && (
            <Button size="sm" className="mt-2.5" onClick={install}>
              <Download className="h-3.5 w-3.5" />
              Install
            </Button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="-m-1 shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/70 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
