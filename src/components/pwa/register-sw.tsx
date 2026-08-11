"use client";
import { useEffect } from "react";

// Registers /sw.js. Production only, on purpose: in dev, /_next/static chunks
// are not content-hashed, so a cache-first worker would serve stale bundles
// across HMR rebuilds. Test the installed experience with `npm run build &&
// npm run start` (or on the deployed host).
//
// Service workers require a secure context — https, or localhost. On a LAN IP
// over plain http the browser refuses to register and install is unavailable.
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* non-fatal: the app works fine without offline support */
      });
    };
    // Registering after load keeps the worker off the critical path.
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
