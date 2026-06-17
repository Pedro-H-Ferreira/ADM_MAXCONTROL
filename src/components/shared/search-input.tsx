"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchInput({ placeholder = "Buscar" }: { placeholder?: string }) {
  return (
    <div className="stitch-animate-in-fast relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        className="h-9 pl-8 transition-all duration-300 focus:shadow-sm"
      />
    </div>
  );
}
