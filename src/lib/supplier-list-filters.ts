import { z } from "zod";

export const supplierListFiltersSchema = z.object({
  search: z.string().trim().max(200).nullable(),
  status: z.enum(["ATIVO", "PENDENTE_REVISAO", "INATIVO"]).nullable(),
  sourceSystem: z.enum(["LOCAL", "FLUIG", "LOCAL_FLUIG", "PRE_CADASTRO_FLUIG"]).nullable(),
  syncStatus: z.enum(["NAO_SINCRONIZADO", "SINCRONIZADO", "PENDENTE_REVISAO", "ERRO_SYNC"]).nullable(),
  branchId: z.string().uuid("Filial invalida.").nullable(),
  attention: z.enum(["PENDING", "ERROR"]).nullable(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type SupplierListFilters = z.infer<typeof supplierListFiltersSchema>;

export function supplierListFilterValues(searchParams: URLSearchParams) {
  return {
    search: searchParams.get("q") || searchParams.get("search"),
    status: searchParams.get("status"),
    sourceSystem: searchParams.get("sourceSystem"),
    syncStatus: searchParams.get("syncStatus"),
    branchId: searchParams.get("branchId"),
    attention: searchParams.get("attention"),
    page: searchParams.get("page") || 1,
    pageSize: searchParams.get("pageSize") || 25,
  };
}
