/**
 * 検索エンジン向けの「サイト情報」（構造化データ）
 * - WebSite：検索結果に「grovina-studio.com」ではなく「Globy」と表示してもらうための指定
 * - Organization：運営元（GROVINA STUDIO）とロゴ
 * トップページ（/）にだけ1回置いてください。
 */
const BASE_URL = 'https://globy.grovina-studio.com';

const data = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      url: `${BASE_URL}/`,
      name: 'Globy',
      alternateName: ['グロビー', 'Globy オンラインオフィス', 'globy.grovina-studio.com'],
      inLanguage: 'ja',
      publisher: { '@id': `${BASE_URL}/#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: 'GROVINA STUDIO',
      url: 'https://grovina-studio.com/',
      logo: `${BASE_URL}/icon.png`,
    },
  ],
};

export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      // 中身は固定の文字列だけなので、ここで埋め込んでも安全です
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
