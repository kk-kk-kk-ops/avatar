"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  getAdminInviteInfo,
  getAdminRoomInfo,
  regenerateInviteTokenFromModal,
  updateInviteInviterNameFromModal,
  updateRoomTemplateFromModal,
} from "@/app/admin/actions";

// 管理画面モーダル化 M-3(2026-11)。会議室画面の設定パネルから開く、
// 招待URL・招待者名・ルームデザインの表示・変更。AdminOccupantsModal.tsx
// (M-1・M-2、在室者一覧・強制退出・BAN解除)とは別のモーダルにして、
// 既存のものには一切触れない(回帰リスクを避けるため)。このコンポーネント
// 自身はSupabaseのRealtimeチャンネルを一切購読しない(読み取り・操作は
// すべてapp/admin/actions.tsのServer Action経由)。
// ルームの削除・追加・名前変更はここには載せない(調査の結果、削除は
// 本番で未使用かつ通知を送らない作りのため、全プランmaxRooms=1の現状で
// 誤って0件にする事故を避ける。追加・名前変更は現状のUI設計上、意味が
// 無い。詳細は課題リスト参照)。

type TemplateOption = {
  id: string;
  name: string;
  backgroundImageUrl: string;
  thumbnailImageUrl: string | null;
};

export default function AdminInviteRoomModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t, locale } = useLocale();

  const [inviteToken, setInviteToken] = useState("");
  const [inviteLoadError, setInviteLoadError] = useState<string | null>(null);

  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(
    null,
  );
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [roomLoadError, setRoomLoadError] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminInviteInfo(locale).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setInviteToken(result.inviteToken);
        setNameInput(result.inviterName);
      } else {
        setInviteLoadError(result.error);
      }
    });
    getAdminRoomInfo(locale).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCurrentTemplateId(result.room?.templateId ?? null);
        setTemplates(result.templates);
        setSelectedTemplateId(
          result.room?.templateId ?? result.templates[0]?.id ?? "",
        );
      } else {
        setRoomLoadError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URLの形はapp/admin/InvitePanel.tsx:22-25と同じ。モーダルはトークンを
  // 開いた後に読み込むため、トークンが無い間は空にする。
  const inviteUrl =
    typeof window !== "undefined" && inviteToken
      ? `${window.location.origin}/?invite=${inviteToken}`
      : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(t("admin.copyFailed"));
    }
  };

  const handleSaveName = async () => {
    setNameError(null);
    setNameSaved(false);
    setSavingName(true);
    const result = await updateInviteInviterNameFromModal(nameInput, locale);
    setSavingName(false);
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!window.confirm(t("admin.regenerateConfirm"))) return;
    // 書き換え判定用に、再発行前のトークンをボタンを押した時点の値で
    // 覚えておく(この後setInviteTokenで上書きされる前のもの)。
    const previousToken = inviteToken;
    setRegenerateError(null);
    setRegenerating(true);
    const result = await regenerateInviteTokenFromModal(locale);
    setRegenerating(false);
    if (!result.ok) {
      setRegenerateError(result.error);
      return;
    }
    // 古いトークンを画面に残さないよう、招待情報を読み直す。
    const refreshed = await getAdminInviteInfo(locale);
    if (refreshed.ok) {
      setInviteToken(refreshed.inviteToken);
      setInviteLoadError(null);

      // 運営者は/?invite=<自分のトークン>というアドレスで会議室にいる
      // (app/master/MasterDashboard.tsxの「ルームへ」リンク。通常の"/"は
      // ログイン済みの運営者を/masterへ戻してしまうため、自分自身の
      // 招待URL経由でルーム入室画面へ進む作りになっている)。再発行後も
      // このアドレスの古いトークンがそのまま残ると、次に何らかの理由で
      // このタブが再読み込みされた(手動のリロード、ルームデザイン変更の
      // force-leaveによるreload等)時に、古いトークンがもう有効でない
      // ことでinvalid_inviteとなり、最終的に/masterへ誤って遷移してしまう
      // (2026-11確認)。これを防ぐため、今のアドレスに古いトークンが
      // 残っている場合だけ、ページの作り直しを起こさずにアドレスの値だけ
      // 新しいトークンへ書き換える。
      //
      // router.replace等(next/navigation)は使わない。ソフトナビゲーション
      // としてサーバーへの再フェッチを起こしてしまうため、ここで避けたい
      // 「ページの作り直し」そのものになってしまう。window.history.
      // replaceStateはNext.js側でpush/replaceStateが上書きされており、
      // ルーターの内部状態(canonicalUrl等)だけを追従させ、サーバーへの
      // 再フェッチは発生しない(node_modules/next/dist/client/components/
      // app-router.tsxで確認済み)。
      if (
        typeof window !== "undefined" &&
        previousToken &&
        refreshed.inviteToken
      ) {
        const url = new URL(window.location.href);
        if (url.searchParams.get("invite") === previousToken) {
          url.searchParams.set("invite", refreshed.inviteToken);
          window.history.replaceState(null, "", url);
        }
      }
    } else {
      setInviteLoadError(refreshed.error);
    }
  };

  const handleApplyTemplate = async () => {
    if (!window.confirm(t("room.roomDesignChangeConfirm"))) return;
    setApplyError(null);
    setApplying(true);
    const result = await updateRoomTemplateFromModal(
      selectedTemplateId,
      locale,
    );
    setApplying(false);
    if (!result.ok) {
      setApplyError(result.error);
      return;
    }
    // force-leaveの送信に失敗した場合(performUpdateRoomTemplate内で
    // console.errorのみ、ActionResultはok:trueのまま)、画面が再読み込み
    // されずこのモーダルが開いたまま残ることがあるため、適用済みの表示
    // (isCurrentlyApplied)に反映しておく。
    setCurrentTemplateId(selectedTemplateId);
    // 成功時、force-leaveブロードキャスト(targetId未指定)は操作した
    // 管理者自身がこのルームに在室中であれば自分のタブも受け取り
    // (components/AvatarSpace.tsx:6753-6769参照)、約1.5秒後に
    // window.location.reload()される。そのため、ここで結果表示や
    // getAdminRoomInfoの読み直しは行わない(読み直しても画面がすぐ
    // 再読み込みされるため意味が無い)。
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            {t("room.inviteRoomModalTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {inviteLoadError && (
          <p className="mb-2 text-xs text-red-600">{inviteLoadError}</p>
        )}

        <p className="mb-1 text-xs font-semibold text-slate-500">
          {t("admin.inviterNameHint")}
        </p>
        <div className="mb-1 flex gap-2">
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t("admin.inviterNamePlaceholder")}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="button"
            onClick={handleSaveName}
            disabled={savingName}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {savingName
              ? t("admin.saving")
              : nameSaved
                ? t("admin.saved")
                : t("admin.save")}
          </button>
        </div>
        {nameError && <p className="mb-3 text-xs text-red-600">{nameError}</p>}

        <p className="mb-2 mt-4 text-xs font-semibold text-slate-500">
          {t("admin.inviteUrl")}
        </p>
        <div className="mb-1 flex gap-2">
          <input
            readOnly
            value={inviteUrl}
            className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none"
          />
          <button
            type="button"
            onClick={handleCopy}
            disabled={!inviteUrl}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copied ? t("admin.copied") : t("admin.copy")}
          </button>
        </div>
        {copyError && <p className="mb-2 text-xs text-red-600">{copyError}</p>}

        <button
          type="button"
          onClick={handleRegenerate}
          disabled={regenerating}
          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {regenerating ? t("common.processing") : t("admin.regenerateUrl")}
        </button>
        <p className="mt-1 text-xs text-red-600">{t("admin.regenerateNote")}</p>
        {regenerateError && (
          <p className="mt-2 text-xs text-red-600">{regenerateError}</p>
        )}

        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold text-slate-500">
            {t("admin.roomDesign")}
          </p>
          {roomLoadError && (
            <p className="mb-2 text-xs text-red-600">{roomLoadError}</p>
          )}
          {templates.length === 0 ? (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("admin.noRoomDesigns")}
            </p>
          ) : (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {templates.map((template) => {
                const isCurrentlyApplied =
                  currentTemplateId === template.id && !applying;
                return (
                  <div
                    key={template.id}
                    className={`relative overflow-hidden rounded-lg border-2 bg-slate-100 ${
                      selectedTemplateId === template.id
                        ? "border-emerald-500"
                        : "border-transparent"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTemplateId(template.id)}
                      disabled={applying}
                      className="block w-full text-left disabled:opacity-60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={
                          template.thumbnailImageUrl ??
                          template.backgroundImageUrl
                        }
                        alt={template.name}
                        className="aspect-video w-full object-cover"
                      />
                    </button>
                    <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        disabled={applying}
                        className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        {template.name}
                      </button>
                      {selectedTemplateId === template.id && (
                        <button
                          type="button"
                          onClick={handleApplyTemplate}
                          disabled={applying || isCurrentlyApplied}
                          className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold disabled:cursor-not-allowed ${
                            isCurrentlyApplied
                              ? "bg-slate-300 text-slate-600"
                              : "bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60"
                          }`}
                        >
                          {applying
                            ? t("admin.applying")
                            : isCurrentlyApplied
                              ? t("admin.currentlyApplied")
                              : t("admin.apply")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {applyError && <p className="text-xs text-red-600">{applyError}</p>}
        </div>
      </div>
    </div>
  );
}
