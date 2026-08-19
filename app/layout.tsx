import type { Metadata } from "next";
import { archivo, archivoBlack } from "@/lib/fonts";
import { assetPath } from "@/lib/routes";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FortMark",
    template: "%s · FortMark",
  },
  description: "Real estate, returned to its profession.",
  /**
   * Prefixed explicitly. Next applies the zone `basePath` to `<Link>`,
   * `router.push()` and `redirect()`, but NOT to metadata icon hrefs — there
   * is no basePath handling anywhere in its metadata resolver — so a bare
   * `/brand/…` was emitted verbatim and 404ed against the portal zone at the
   * origin root, exactly like the nav-rail mark did.
   */
  icons: { icon: assetPath("/brand/fortmark-logomark-black.png") },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${archivo.variable} ${archivoBlack.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
