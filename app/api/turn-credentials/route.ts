import { NextResponse } from "next/server";

// Metered.caのSECRET KEYはブラウザに公開してはいけないため、
// このサーバー側だけで扱い、生成された一時的な認証情報だけをクライアントへ返す。
export async function GET() {
  const domain = process.env.METERED_DOMAIN;
  const secretKey = process.env.METERED_SECRET_KEY;

  if (!domain || !secretKey) {
    return NextResponse.json(
      {
        error: "METERED_DOMAIN または METERED_SECRET_KEY が設定されていません",
      },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${secretKey}`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "TURN認証情報の取得に失敗しました" },
        { status: 502 },
      );
    }

    const iceServers = await res.json();
    return NextResponse.json({ iceServers });
  } catch {
    return NextResponse.json(
      { error: "TURNサーバーへの接続に失敗しました" },
      { status: 502 },
    );
  }
}
