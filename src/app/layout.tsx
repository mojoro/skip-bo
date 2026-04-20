import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SiteFooter from "@/components/SiteFooter";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://skipbo.johnmoorman.com";
const DESCRIPTION =
  "Race to empty your stockpile in this classic Skip-Bo card game. Play online against friends in real-time rooms, no signup required.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Skip-Bo: online card game",
    template: "%s · Skip-Bo",
  },
  description: DESCRIPTION,
  applicationName: "Skip-Bo",
  authors: [{ name: "John Moorman", url: "https://johnmoorman.com" }],
  creator: "John Moorman",
  publisher: "John Moorman",
  category: "games",
  keywords: [
    "skip-bo",
    "skip bo",
    "card game",
    "online card game",
    "multiplayer card game",
    "browser game",
    "mattel",
    "sequence card game",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Skip-Bo",
    title: "Skip-Bo: online card game",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Skip-Bo: online card game",
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  formatDetection: {
    email: false,
    telephone: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e5e3e" },
    { media: "(prefers-color-scheme: dark)", color: "#073825" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Ask mobile browsers to shrink the layout viewport when the virtual
  // keyboard appears, rather than sliding the whole page up — keeps the
  // chat dock pinned to the real visible bottom instead of jarring the
  // entire tabletop.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
