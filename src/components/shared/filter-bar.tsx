import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/shared/search-input";
import { PeriodFilter } from "@/components/shared/period-filter";

export function FilterBar({ placeholder }: { placeholder: string }) {
  return (
    <div className="stitch-animate-in stitch-hover-lift stitch-delay-200 flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
      <div className="w-full md:max-w-sm">
        <SearchInput placeholder={placeholder} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <PeriodFilter />
        <Button variant="outline" className="stitch-soft-button">
          Filtros
        </Button>
      </div>
    </div>
  );
}
