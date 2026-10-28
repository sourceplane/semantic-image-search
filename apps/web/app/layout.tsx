import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { cn } from "@/lib/utils";
import { TransitionProvider } from "@/lib/hooks/use-shared-transition";
import { SITE_NAME, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: `${SITE_NAME}: semantic search over images, on Cloudflare Workers with Workers AI.`,
  metadataBase: siteUrl(),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={cn("font-sans antialiased", GeistSans.variable)}>
        <TransitionProvider>{children}</TransitionProvider>
      </body>
    </html>
  );
}
