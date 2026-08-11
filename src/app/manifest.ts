import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest (Next injects the <link rel="manifest">).
// This is what makes YOLOapply installable to an Android/desktop home screen;
// iOS reads name/icons from here too but installs via Share → Add to Home Screen.
//
// Note: /manifest.webmanifest is exempt from the middleware matcher (the
// extension list ends with `webmanifest`), so it stays publicly fetchable —
// browsers request it before the user has a session.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YOLOapply",
    short_name: "YOLOapply",
    description: "Your night-shift job agent: discovers roles, tailors resumes, drafts outreach.",
    // Signed out this lands on the marketing page, signed in on the dashboard.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0F1E", // slate.950 — matches the dark shell on splash
    theme_color: "#0B0F1E",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops these to its own shape — the mark sits in the safe circle.
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the installed icon for these.
    shortcuts: [
      { name: "Discover jobs", short_name: "Discover", url: "/discover" },
      { name: "Applications", short_name: "Pipeline", url: "/applications" },
      { name: "Interview prep", short_name: "Interview", url: "/interview" },
    ],
  };
}
