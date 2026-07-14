"use client";

import { useEffect, useRef } from "react";

export function useVisibleRefresh(
  refresh: (silent: boolean) => void | Promise<void>,
  intervalMs = 30_000
) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    function run(silent: boolean) {
      if (silent && document.visibilityState === "hidden") return;
      void refreshRef.current(silent);
    }

    const initialLoad = window.setTimeout(() => run(false), 0);
    const interval = window.setInterval(() => run(true), intervalMs);
    const visibilityChanged = () => {
      if (document.visibilityState === "visible") run(true);
    };
    document.addEventListener("visibilitychange", visibilityChanged);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [intervalMs]);
}
