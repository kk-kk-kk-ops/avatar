import type { MetadataRoute } from 'next';

const BASE_URL = 'https://globy.grovina-studio.com';

/**
 * 検索エンジンに「載せてほしいページの一覧」を伝えるファイル（/sitemap.xml として公開されます）
 * 公開ページを追加・削除したら、ここも合わせて更新してください。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' | 'yearly' }[] = [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/features', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/pricing', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/security', priority: 0.7, changeFrequency: 'monthly' },
    // 2026-11-28追加。/lpのヘッダー・フッターから飛べる公開ページだが、
    // 元のファイル一覧に抜けていたため追加した。
    { path: '/operator', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/contact', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/tokushoho', priority: 0.3, changeFrequency: 'yearly' },
  ];
  return pages.map((p) => ({
    url: `${BASE_URL}${p.path === '/' ? '' : p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
