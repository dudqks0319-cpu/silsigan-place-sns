import type { Metadata, Viewport } from "next";
import { NativeBridgeBootstrap } from "@/components/silsigan/NativeBridgeBootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "#실시간 - 지금 현장 사진",
  description: "가기 전, 최근 현장 사진과 관측시각으로 지금 분위기를 확인하세요.",
  applicationName: "#실시간",
  icons: {
    icon: "/favicon.svg"
  },
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <NativeBridgeBootstrap />
        {children}
      </body>
    </html>
  );
}
