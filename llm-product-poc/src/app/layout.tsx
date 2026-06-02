import type { Metadata } from "next";
import "./globals.css";
import { startProber } from "@/lib/workflow/prober";

export const metadata: Metadata = {
  title: "SSP — Self-Service Portal",
  description: "Internal developer platform portal",
};

// Start the readiness prober once per Node process (idempotent guard inside).
startProber();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
