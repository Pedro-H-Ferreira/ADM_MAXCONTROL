import { LoadingSkeleton } from "@/components/shared/loading-skeleton";

export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando pagina" className="py-2">
      <LoadingSkeleton />
    </div>
  );
}
