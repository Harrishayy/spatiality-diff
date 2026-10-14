import type { Metadata } from "next";
import { Barlow, Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const barlow = Barlow({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-barlow" });
const barlowCond = Barlow_Semi_Condensed({ weight: ["500", "600"], subsets: ["latin"], variable: "--font-barlow-cond" });
const jet = JetBrains_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = { title: "Spatiality Diff", description: "A change survey of the room, drawn to scale, with proof." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCond.variable} ${jet.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
