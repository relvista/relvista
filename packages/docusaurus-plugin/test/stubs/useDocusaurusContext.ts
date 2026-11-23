/** The site config the stub returns; a test may set `themeConfig` (and put `{}` back after). */
export const siteConfig: { themeConfig: Record<string, unknown> } = { themeConfig: {} };

export default function useDocusaurusContext() {
  return { siteConfig };
}
