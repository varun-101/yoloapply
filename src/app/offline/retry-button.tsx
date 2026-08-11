"use client";
import { Button } from "@/components/ui/button";

// A plain reload: if the network is back the real page renders, otherwise the
// service worker serves this page again.
export function RetryButton() {
  return (
    <Button className="mt-6" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
