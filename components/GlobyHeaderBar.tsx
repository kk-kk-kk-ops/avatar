import GlobyLogo from "./GlobyLogo";

// 入室の仕組みの作り替え 段階E-5-1の見直し(2026-11-24・②③)。入室前の
// 画面(components/AvatarSpace.tsx)・ルーム0件の画面(components/
// RoomListScreen.tsx)に出す、会議室の中と同じ見た目のヘッダーの帯
// (ロゴのみ、ボタン類は出さない)。帯自体は画面の端から端まで出す
// (1440px中央寄せの対象はこの下のカード一覧+入室パネルのみ)。
export default function GlobyHeaderBar() {
  return (
    <div className="flex h-16 w-full shrink-0 items-center border-b border-slate-700 bg-slate-900 px-4">
      <GlobyLogo />
    </div>
  );
}
