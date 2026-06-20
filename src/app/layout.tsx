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
        {/* Self-heal on a stale chunk (ChunkLoadError) after a deploy: reload once to the fresh
            build. Registered as an early inline script so it fires even if the failing chunk is the
            page itself (before React mounts). The 12s guard prevents reload loops. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  function isChunkErr(m){return !!m&&/Loading chunk|ChunkLoadError|Loading CSS chunk|dynamically imported module|module script failed/i.test(m);}
  function reloadOnce(){try{var k="__ed_chunk_reload",last=+sessionStorage.getItem(k)||0;if(Date.now()-last<12000)return;sessionStorage.setItem(k,""+Date.now());}catch(e){}location.reload();}
  addEventListener("error",function(e){var er=e&&e.error;if(isChunkErr(e&&e.message)||isChunkErr(er&&er.name)||isChunkErr(er&&er.message))reloadOnce();},true);
  addEventListener("unhandledrejection",function(e){var r=e&&e.reason;if(isChunkErr(r&&r.name)||isChunkErr(r&&r.message))reloadOnce();});
})();`,
          }}
        />
      </head>
      <body className="bg-[#09090f] text-white antialiased font-sans">
        <SwRegistration />
        {children}
      </body>
    </html>
  );
}
