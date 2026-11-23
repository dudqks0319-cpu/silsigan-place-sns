import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "실시간 — 우리 동네의 지금",
  description: "지역 날씨와 주변 장소, 최근 현장 소식을 출처와 기준 시각까지 함께 확인하세요.",
  applicationName: "#실시간",
  icons: {
    icon: "/favicon.svg"
  },
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123c36"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
