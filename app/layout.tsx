import type { Metadata } from "next";
import { archivo, archivoBlack } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FortMark",
    template: "%s · FortMark",
  },
  description: "Real estate, returned to its profession.",
  icons: { icon: "/brand/fortmark-logomark-black.png" },
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
