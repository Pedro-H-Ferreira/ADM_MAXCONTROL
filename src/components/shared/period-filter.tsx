import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PeriodFilter() {
  return (
    <Select defaultValue="mes-atual">
      <SelectTrigger className="stitch-soft-button h-9 w-full md:w-[180px]">
        <SelectValue placeholder="Período" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="mes-atual">Mês atual</SelectItem>
        <SelectItem value="30-dias">Próximos 30 dias</SelectItem>
        <SelectItem value="trimestre">Trimestre</SelectItem>
        <SelectItem value="ano">Ano corrente</SelectItem>
      </SelectContent>
    </Select>
  );
}
