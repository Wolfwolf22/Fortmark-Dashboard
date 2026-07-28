import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { archivo, archivoBlack } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { assetPath } from "@/lib/base-path";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FortMark",
    template: "%s · FortMark",
  },
  description: "Real estate, returned to its profession.",
  // basePath does not rewrite metadata icon strings — prefix explicitly.
  icons: { icon: assetPath("/brand/fortmark-logomark-black.png") },
  // The canonical origin is app.fortmark.net, never the raw deployment URL.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className={`${archivo.variable} ${archivoBlack.variable} font-sans`}>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
