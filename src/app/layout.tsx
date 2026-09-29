import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "System Lab — See how systems work",
  description: "An interactive system design playground. Explore 56 concepts, simulate real architectures, and connect the dots with AWS. Made by Aman."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
