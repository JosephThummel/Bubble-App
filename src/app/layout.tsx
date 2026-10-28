import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Constellation",
  description: "Your research, in orbit.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
