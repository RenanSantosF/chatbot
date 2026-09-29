"use client";

import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { iniciarTour } from "@/lib/tour";

/** "Fazer o tour" — chama o TourGuiado, que vive no casco do painel. */
export function BotaoDoTour() {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={iniciarTour}
      className="gap-1.5"
    >
      <Compass className="size-4" />
      Fazer o tour
    </Button>
  );
}
