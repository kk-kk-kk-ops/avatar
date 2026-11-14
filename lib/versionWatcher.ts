// 段階0(docs/realtime-authorization-plan.md 6-2節)の共通ユーティリティ。
// ルートレイアウトのVersionWatcherProvider・AvatarSpace.tsx(入室中の
// 画面)の両方から使う。
import { BUILD_GENERATION } from "./buildGeneration.mjs";

export { BUILD_GENERATION };

// VercelがビルドごとにVERCEL_DEPLOYMENT_IDを発行するため、next.config.mjs
// でNEXT_PUBLIC_DEPLOYMENT_IDとして焼き込んでいる。ローカル開発では未設定
// (undefined)のままで、このときは下記の各関数が早期にnullを返し、
// バナー表示・強制再読み込みのいずれも行わない。
export const DEPLOYMENT_ID: string | null =
  process.env.NEXT_PUBLIC_DEPLOYMENT_ID || null;

export type VersionFileInfo = {
  deploymentId: string | null;
  buildGeneration: number;
};

// ビルド時に書き出されたpublic/version.json(scripts/write-version-file.mjs
// 参照)を取得する。取得URLに毎回変わる値を付け、ブラウザキャッシュを
// 確実に回避する(Vercelのエッジ・CDNキャッシュまで回避できるかは未検証。
// 設計書6-2節参照)。
export async function fetchVersionFile(): Promise<VersionFileInfo | null> {
  if (!DEPLOYMENT_ID) return null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<VersionFileInfo>;
    if (typeof data.buildGeneration !== "number") return null;
    return {
      deploymentId:
        typeof data.deploymentId === "string" ? data.deploymentId : null,
      buildGeneration: data.buildGeneration,
    };
  } catch {
    return null;
  }
}

const MANDATORY_RELOAD_HISTORY_KEY = "versionWatcher.mandatoryReloads";
const MANDATORY_RELOAD_WINDOW_MS = 120_000; // 2分
const MANDATORY_RELOAD_MAX_IN_WINDOW = 2; // この回数までは自動で再読み込みする

// 強制再読み込みの安全装置。同一タブで2分以内に2回まで自動実行を許可し、
// 3回目以降はfalseを返す(呼び出し側は手動操作を促すバナーへ切り替える)。
// sessionStorageが使えない環境(プライベートモード等)では、安全装置なしで
// 常にtrueを返す(実行自体は妨げない)。
export function recordMandatoryReloadAttempt(): boolean {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(MANDATORY_RELOAD_HISTORY_KEY);
    const history: number[] = raw ? JSON.parse(raw) : [];
    const recent = history.filter(
      (t) => now - t < MANDATORY_RELOAD_WINDOW_MS,
    );
    if (recent.length >= MANDATORY_RELOAD_MAX_IN_WINDOW) {
      return false;
    }
    recent.push(now);
    sessionStorage.setItem(
      MANDATORY_RELOAD_HISTORY_KEY,
      JSON.stringify(recent),
    );
    return true;
  } catch {
    return true;
  }
}
