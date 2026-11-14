"use client";

// 段階0(docs/realtime-authorization-plan.md 6-2節)。ルートレイアウトに
// 1箇所だけ置き、全ページ共通で新しい版のデプロイを検知する。
//
// - 通常更新: public/version.json(ビルド時に書き出す、deploymentId)を
//   定期的に取得し、自分のビルドと異なればバナーを表示する(押すまで
//   再読み込みしない)。「後で」で閉じた場合、同じdeploymentIdの間は
//   再表示しない(次の新しいデプロイで初めて再表示する)。
// - 必須更新: app_settings.min_build_generationを定期的に確認し、自分の
//   BUILD_GENERATIONより大きければ強制的に再読み込みする。条件が外れたら
//   (DBの値を下げた場合等)、次回の確認で手動バナーを消す。
// - 入室中(AvatarSpace.tsxのjoined中)は、既存の20秒ポーリングに相乗り
//   させるため、ここでのmin_build_generation確認は止める
//   (setInRoomPollingActive(true)で通知される)。version.jsonの確認は
//   入室中も続ける(バナーは入室中でも表示してよい想定のため)。
// - NEXT_PUBLIC_DEPLOYMENT_ID(ローカル開発では未設定)が無い場合は、
//   いずれのチェックも行わない。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  BUILD_GENERATION,
  DEPLOYMENT_ID,
  fetchVersionFile,
  recordMandatoryReloadAttempt,
} from "@/lib/versionWatcher";

const CHECK_INTERVAL_MS = 4 * 60 * 1000; // 4分おき(タブ表示中のみ)
const MIN_CHECK_GAP_MS = 60 * 1000; // タブ復帰時の連続実行を防ぐ最短間隔

type VersionWatcherContextValue = {
  // 入室中(joined)の間だけtrueにする。既存の20秒ポーリングに
  // min_build_generation確認を相乗りさせるため、ここでの確認を止める。
  setInRoomPollingActive: (active: boolean) => void;
};

const VersionWatcherContext = createContext<VersionWatcherContextValue>({
  setInRoomPollingActive: () => {},
});

export function useVersionWatcher() {
  return useContext(VersionWatcherContext);
}

export function VersionWatcherProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  // 版ファイルで分かった「現在の本番」のdeploymentId。null=まだ取得して
  // いない、または取得に失敗している。
  const [latestDeploymentId, setLatestDeploymentId] = useState<string | null>(
    null,
  );
  // 「後で」で閉じたdeploymentId。同じ値の間はバナーを再表示しない。
  const [dismissedDeploymentId, setDismissedDeploymentId] = useState<
    string | null
  >(null);
  const [manualReloadRequired, setManualReloadRequired] = useState(false);
  const inRoomPollingActiveRef = useRef(false);
  const lastCheckAtRef = useRef(0);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const setInRoomPollingActive = useCallback((active: boolean) => {
    inRoomPollingActiveRef.current = active;
  }, []);

  const check = useCallback(async () => {
    const info = await fetchVersionFile();
    if (info?.deploymentId) {
      setLatestDeploymentId(info.deploymentId);
    }

    // 入室中は既存のメンテナンス確認ポーリング(AvatarSpace.tsx)に
    // min_build_generation確認を任せる(二重問い合わせを避ける)。
    if (inRoomPollingActiveRef.current) return;

    if (!supabaseRef.current) {
      supabaseRef.current = createClient();
    }
    const { data } = await supabaseRef.current
      .from("app_settings")
      .select("min_build_generation")
      .eq("id", "default")
      .maybeSingle();
    const minGeneration = data?.min_build_generation;
    // 列が取得できなかった場合(未反映・一時的な問い合わせ失敗)は、
    // 既存のmanualReloadRequired状態を変えない(判定材料が無いため)。
    if (typeof minGeneration !== "number") return;
    if (BUILD_GENERATION < minGeneration) {
      if (recordMandatoryReloadAttempt()) {
        window.location.reload();
      } else {
        setManualReloadRequired(true);
      }
    } else {
      // 条件が外れた(DBの値を下げた等)ので、手動バナーを消す。
      setManualReloadRequired(false);
    }
  }, []);

  useEffect(() => {
    if (!DEPLOYMENT_ID) return; // ローカル開発等では何もしない

    const maybeCheck = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheckAtRef.current < MIN_CHECK_GAP_MS) return;
      lastCheckAtRef.current = now;
      void check();
    };

    maybeCheck();
    const interval = setInterval(maybeCheck, CHECK_INTERVAL_MS);
    const onVisibilityChange = () => maybeCheck();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [check]);

  const updateAvailable =
    latestDeploymentId !== null &&
    latestDeploymentId !== DEPLOYMENT_ID &&
    latestDeploymentId !== dismissedDeploymentId;

  return (
    <VersionWatcherContext.Provider value={{ setInRoomPollingActive }}>
      {children}
      {/* 位置について(components/AvatarSpace.tsx・TouchControls.tsxを
          確認済み): モバイル(sm未満)では画面下部の両隅に操作用の固定
          ボタンがある(左下: 車ON/OFF、56×56px、bottom-8 left-8。右下:
          移動用dpad、約168×168px、bottom-8 right-8、TouchControls.tsx)。
          ヘッダー(高さ64px)の右側にはマイク等の操作アイコンがあり、
          会議室入室中は上部中央(top: 164px付近)に「会議モード」ボタンや
          常時表示プレビュー行も出る。これらいずれとも重ならないよう、
          画面下部・両隅の操作ボタンよりは上(bottom: 210px、dpadの上端
          200pxより余裕を持たせる)、かつ右寄りの小さなカードに留める。
          ただし実際の見た目は本番/ブランチURLでの確認が必要
          (このコンポーネントはルートレイアウトに置かれ、管理画面・
          マスター画面等でも使われるため、会議室画面以外では特に問題は
          無いはず)。 */}
      {manualReloadRequired && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 210,
            right: 16,
            maxWidth: "min(280px, calc(100vw - 32px))",
            zIndex: 9999,
            background: "#b91c1c",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 8,
            boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
            fontSize: 13,
          }}
        >
          {t("versionWatcher.manualReloadRequired")}
        </div>
      )}
      {!manualReloadRequired && updateAvailable && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 210,
            right: 16,
            maxWidth: "min(280px, calc(100vw - 32px))",
            zIndex: 9999,
            background: "#1e293b",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 8,
            boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{t("versionWatcher.updateAvailable")}</span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: "#fff",
                color: "#1e293b",
                border: "none",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("versionWatcher.updateButton")}
            </button>
            <button
              type="button"
              onClick={() => setDismissedDeploymentId(latestDeploymentId)}
              style={{
                background: "transparent",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.5)",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t("versionWatcher.laterButton")}
            </button>
          </div>
        </div>
      )}
    </VersionWatcherContext.Provider>
  );
}
