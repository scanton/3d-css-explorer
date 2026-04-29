import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D CSS Card Layout Explorer",
  description: "Prototype editor for positioning card artwork with reproducible 3D CSS JSON."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
