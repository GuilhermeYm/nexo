import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";

import { DashboardShortcut } from "@/components/dashboard-shortcut";
import { InlineScript } from "@/components/inline-script";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Nexo — O organizador pessoal inteligente",
  description:
    "Capture em segundos, encontre em milissegundos. A Nexo organiza suas notas, ideias e arquivos para você com IA.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Nonce do CSP gerado no proxy.ts. O await em headers() torna a página
  // dinâmica — requisito da v16 para CSP com nonce (docs: content-security-policy).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="pt-BR"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <head>
        <InlineScript html={THEME_INIT_SCRIPT} nonce={nonce} />
      </head>
      <body className="min-h-full flex flex-col">
        <DashboardShortcut />
        {children}
      </body>
    </html>
  );
}
