import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ActivityLogPanel } from "@/components/jobs/ActivityLogPanel";
import { IngestPanel } from "@/components/ingest/IngestPanel";
import { PwaRegister } from "@/components/PwaRegister";
import { OnboardingTour } from "@/components/OnboardingTour";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cinekive",
  description: "Local-first cinematic visual library — your shots, searchable by craft",
  applicationName: "Cinekive",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Cinekive",
    statusBarStyle: "black",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

/** Neutral chrome — avoids the bright cyan PWA/browser top bar. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#f3f1ec" },
    { color: "#000000" },
  ],
  colorScheme: "dark light",
};

const themeBootScript = `
(function(){
  try {
    var t = localStorage.getItem('cinekive.appearance');
    if (t !== 'dark' && t !== 'light' && t !== 'slate') t = 'dark';
    document.documentElement.dataset.theme = t;
    document.documentElement.classList.toggle('dark', t !== 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', t === 'light' ? '#f3f1ec' : (t === 'slate' ? '#0b1220' : '#000000'));
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          <div className="flex h-screen overflow-hidden bg-cinema-black">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar />
              <main className="flex min-h-0 flex-1 flex-col">{children}</main>
            </div>
            <ActivityLogPanel />
            <IngestPanel />
            <PwaRegister />
            <OnboardingTour />
          </div>
        </Providers>
      </body>
    </html>
  );
}
