import type { Metadata, Viewport } from "next";
import "./globals.css";

const name = process.env.APP_NAME || "Lumen";

export const metadata: Metadata = {
  title: name,
  description: "Studio-quality photo edits from a single sentence.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // stop iOS zooming into inputs
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Telegram Mini App bridge; harmless in a normal browser. */}
        <script src="https://telegram.org/js/telegram-web-app.js?59" />
      </head>
      <body>{children}</body>
    </html>
  );
}
