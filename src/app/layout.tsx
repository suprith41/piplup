import type { Metadata } from "next";
import { IBM_Plex_Mono, Mulish } from "next/font/google";
import "./globals.css";

const sans = Mulish({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
      <body className={`${sans.variable} ${mono.variable} bg-white font-sans text-[#02042b] antialiased`}>{children}</body>
    </html>
  );
}
