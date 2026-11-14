"use client";

// 段階0(docs/realtime-authorization-plan.md 6-2節)。version.json(現在の
// 本番のデプロイID・世代)を、タブ表示中のみVersionWatcherProviderと同じ
// 間隔で定期的に取得し直す。管理画面・マスター画面の「版が古い人数」等の
// 表示が、画面を開いた時点の値のまま固まらないようにするために使う。
import { useEffect, useRef, useState } from "react";
import { fetchVersionFile, type VersionFileInfo } from "./versionWatcher";

const CHECK_INTERVAL_MS = 4 * 60 * 1000; // 4分おき(タブ表示中のみ)
const MIN_CHECK_GAP_MS = 60 * 1000; // タブ復帰時の連続実行を防ぐ最短間隔

export function useCurrentVersionInfo(): VersionFileInfo | null {
  const [info, setInfo] = useState<VersionFileInfo | null>(null);
  const lastCheckAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const maybeCheck = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheckAtRef.current < MIN_CHECK_GAP_MS) return;
      lastCheckAtRef.current = now;
      void fetchVersionFile().then((result) => {
        if (!cancelled && result) setInfo(result);
      });
    };

    maybeCheck();
    const interval = setInterval(maybeCheck, CHECK_INTERVAL_MS);
    const onVisibilityChange = () => maybeCheck();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return info;
}
