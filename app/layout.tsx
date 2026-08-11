import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  const forwardedProtocol = incoming.get("x-forwarded-proto");
  const protocol = forwardedProtocol ?? (host?.includes("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "https://aisupercam.pages.dev";
  const title = "AiSuperCam — hand-controlled webcam effects";
  const description =
    "Frame areas with two L-shaped hands and apply Mesh, ASCII, Thermal and Pixel effects in real time, directly in your browser.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      siteName: "AiSuperCam",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1680,
          height: 945,
          alt: "AiSuperCam with body mesh, ASCII, thermal and pixel webcam effects",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
