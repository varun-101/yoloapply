"use client";
import { useCallback, useEffect, useState } from "react";

// Shared "add to home screen" state for the floating banner and the Settings
// card.
//
// The capture lives at MODULE scope on purpose. `beforeinstallprompt` fires
// once, early in page load, and Chrome never re-fires it — so a component that
// mounts later (Settings) or one that bailed out of listening (the banner,
// while snoozed) would miss it entirely. Stashing it here means whoever asks
// first still gets a working Install button.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's mini-infobar out of the way
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedFlag = true;
    emit();
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag — it does not implement display-mode: standalone.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

export interface PwaInstall {
  /** Chromium has handed us a prompt we can replay. */
  canInstall: boolean;
  /** The app was installed during this page's lifetime. */
  installed: boolean;
  /** Already running from the home screen / app window. */
  standalone: boolean;
  /** iOS: no install API exists, only Share → Add to Home Screen. */
  ios: boolean;
  /** Everything is resolved client-side; false until the first effect runs. */
  ready: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function usePwaInstall(): PwaInstall {
  const [state, setState] = useState({
    canInstall: false,
    installed: false,
    standalone: false,
    ios: false,
    ready: false,
  });

  useEffect(() => {
    const sync = () =>
      setState({
        canInstall: deferred !== null,
        installed: installedFlag,
        standalone: isStandalone(),
        ios: isIos(),
        ready: true,
      });
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    const evt = deferred;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // The event is single-use whichever way they answered.
    deferred = null;
    emit();
    return outcome;
  }, []);

  return { ...state, install };
}
