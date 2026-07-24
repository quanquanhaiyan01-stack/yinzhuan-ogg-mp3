import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "音转｜OGG 转 MP3",
    description: "无需上传，在浏览器本地把 OGG 音频转换为 MP3。",
    openGraph: {
      title: "音转｜OGG 转 MP3",
      description: "本地转换，不上传。",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "音转 OGG 转 MP3" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "音转｜OGG 转 MP3",
      description: "本地转换，不上传。",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
