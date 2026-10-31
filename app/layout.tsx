import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lastro API — reservas de estoque",
  description:
    "API demonstrativa com reservas atômicas, idempotência e persistência SQLite/D1. TypeScript, Hono e OpenAPI.",
  metadataBase: new URL("https://lastro-api-gustapaz.starrylinen.chatgpt.site"),
  alternates: { canonical: "/" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
