import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const PAGES = ['index', 'about', 'privacy', 'terms', 'contact'];

/**
 * Injects the AdSense tags (only when a valid publisher id is configured),
 * fills in the canonical site URL and emits ads.txt, robots.txt and sitemap.xml.
 */
function siteMeta(env) {
  const client = (env.VITE_ADSENSE_CLIENT || '').trim();
  const adsOn = /^ca-pub-\d{10,20}$/.test(client);
  const siteUrl = (env.VITE_SITE_URL || 'https://roadsterrocket.vercel.app').replace(/\/$/, '');
  const pages = ['/', '/about', '/privacy', '/terms', '/contact'];

  return {
    name: 'site-meta',
    transformIndexHtml(html) {
      const head = adsOn
        ? `<meta name="google-adsense-account" content="${client}">
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous" data-ad-frequency-hint="30s"></script>`
        : '';
      return html.replaceAll('<!--ADSENSE_HEAD-->', head).replaceAll('%SITE_URL%', siteUrl);
    },
    generateBundle() {
      if (adsOn) {
        this.emitFile({
          type: 'asset',
          fileName: 'ads.txt',
          source: `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`,
        });
      }
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
      const today = new Date().toISOString().slice(0, 10);
      const urls = pages
        .map((p) => `  <url><loc>${siteUrl}${p}</loc><lastmod>${today}</lastmod></url>`)
        .join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    plugins: [siteMeta(env)],
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        input: Object.fromEntries(PAGES.map((p) => [p, `${root}${p}.html`])),
      },
    },
  };
});
