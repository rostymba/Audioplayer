import type { Metadata } from "next";
import "@fontsource/bitter/400.css";
import "@fontsource/golos-text/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/literata/400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audioplayer — books on live air",
  description: "A local EPUB reader paired with atmospheric internet radio.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
