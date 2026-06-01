import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SSP — Self-Service Portal",
  description: "Internal developer platform portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
