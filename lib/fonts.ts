import localFont from "next/font/local";

// Archivo is the approved substitute for the licensed Sanomat Sans.
// Self-hosted so builds and dev sessions never depend on a font CDN.
export const archivo = localFont({
  src: [
    {
      path: "./fonts/Archivo-Variable.woff2",
      weight: "400 800",
      style: "normal",
    },
  ],
  variable: "--font-archivo",
  display: "swap",
});

export const archivoBlack = localFont({
  src: [
    {
      path: "./fonts/ArchivoBlack-Regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-archivo-black",
  display: "swap",
});
