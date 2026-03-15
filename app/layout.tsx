import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WhenToPlan",
  description: "Group availability planner — find the best time for everyone",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
