import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Eureka Labs · Revenue desk",
  description: "Eureka Labs billing desk. Piplup recovers failed AI/ML course AutoPays.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=tasa-orbiter@400,500,600,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${sans.variable} ${mono.variable} bg-canvas font-sans text-ink antialiased`}>{children}</body>
    </html>
  );
}
