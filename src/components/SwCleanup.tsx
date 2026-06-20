"use client";

import { useEffect } from "react";

/**
 * edmini no longer uses a service worker — it's online-only, and the old caching SW caused repeated
 * stale-app-shell bugs. This actively unregisters any worker still registered from a previous visit
 * (for browsers that reach fresh HTML). The kill-switch at public/sw.js handles browsers stuck on old
 * cached HTML that never load this code. Nothing here registers a worker.
 */
export default function SwCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister().catch(() => {})))
      .catch(() => {});
  }, []);

  return null;
}
