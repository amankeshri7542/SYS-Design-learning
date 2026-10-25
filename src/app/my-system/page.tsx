import type { Metadata } from "next";
import { MySystem } from "@/components/my-system";

export const metadata: Metadata = {
  title: "Map your own system",
  description: "Describe a system like yours, watch it run, crash any part to see what breaks, and try the fix side by side. It runs in your browser.",
};

export default function Page() {
  return <MySystem />;
}
