"use client";

import { HERO } from "@/lib/lessons/hero";
import { FigureView } from "./figure";

export function HeroScene() {
  return <FigureView def={HERO} variant="hero" warm={1500} />;
}
