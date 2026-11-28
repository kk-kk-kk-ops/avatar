import type { MetadataRoute } from 'next';

const BASE_URL = 'https://globy.grovina-studio.com';

/**
 * 検索エンジンに「どのページを見に来てよいか」を伝えるファイル（/robots.txt として公開されます）
 * ログイン後の画面・管理画面・API は検索結果に出す必要がないので除外します。
 * ※ 除外するパスは、実際のルート構成に合わせて調整してください。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/master', '/auth/', '/billing/', '/plan'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
