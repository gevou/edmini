import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans } from "next/font/google";
import SwRegistration from "@/components/SwRegistration";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ed",
  description: "Conversational voice agent",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ed",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#09090f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/apple-icon.png" />
      </head>
      <body className="bg-[#09090f] text-white antialiased font-sans">
        <SwRegistration />
        {children}
      </body>
    </html>
  );
}
