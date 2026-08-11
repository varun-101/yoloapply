"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Download, Share, SquarePlus, Smartphone } from "lucide-react";
import { usePwaInstall } from "@/components/pwa/use-install";

// The same install the floating banner offers, minus the snooze — this is
// where you come looking after dismissing the banner, or on a second device.

export default function AppSettings() {
  const { canInstall, installed, standalone, ios, ready, install } = usePwaInstall();
  const [outcome, setOutcome] = useState<"dismissed" | null>(null);
  const [chromium, setChromium] = useState(false);

  useEffect(() => {
    setChromium(/Chrome|Chromium|Edg|CriOS/.test(window.navigator.userAgent));
  }, []);

  async function onInstall() {
    setOutcome(null);
    const result = await install();
    if (result === "dismissed") setOutcome("dismissed");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-signal" />
            Install YOLOapply
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Installs to your home screen or desktop and opens full screen, no browser chrome.
            It&apos;s the same app and the same data, just one tap away.
          </p>

          {!ready ? (
            <div className="h-11 animate-pulse rounded-md bg-slate-100 dark:bg-slate-900" />
          ) : standalone || installed ? (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {standalone
                  ? "Installed — you're running the app right now."
                  : "Installed. Open it from your home screen or app list."}
              </span>
            </div>
          ) : canInstall ? (
            <Button onClick={onInstall} className="w-full sm:w-auto">
              <Download className="h-4 w-4" />
              Install app
            </Button>
          ) : outcome === "dismissed" ? (
            // The browser prompt is single-use: cancelling it destroys the
            // event, so canInstall is already false by the time we render.
            // Without this branch the card would drop straight to the generic
            // "not offered" copy, which reads like something broke.
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
              Install cancelled. Reload this page to get the prompt back.
            </div>
          ) : ios ? (
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                On iPhone and iPad, Safari installs from the Share menu:
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>Tap</span>
                <Share className="h-3.5 w-3.5 shrink-0 text-signal" aria-label="Share" />
                <span>then</span>
                <SquarePlus className="h-3.5 w-3.5 shrink-0 text-signal" aria-hidden />
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Add to Home Screen
                </span>
              </p>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Chrome and Firefox on iOS can&apos;t do this — iOS only allows Safari to install
                web apps.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
              <p className="font-medium text-slate-700 dark:text-slate-200">
                Your browser hasn&apos;t offered an install for this page.
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                <li>
                  Installing needs the site over https (or localhost) with the service worker
                  active — it isn&apos;t available on the dev server.
                </li>
                {chromium ? (
                  <li>
                    If you&apos;ve just loaded the page, give it a moment and reload — Chromium
                    decides on eligibility slightly after load.
                  </li>
                ) : (
                  <li>
                    Firefox on desktop doesn&apos;t support installing web apps. Chrome, Edge or
                    Safari will.
                  </li>
                )}
                <li>Already installed it? Then there is nothing left to do here.</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
