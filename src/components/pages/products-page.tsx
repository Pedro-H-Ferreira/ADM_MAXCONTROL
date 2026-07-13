"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Cloud,
  ExternalLink,
  History,
  ImageIcon,
  Link2,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fluigAdmApi } from "@/lib/fluig-api";
import type { ModuleConfig } from "@/lib/admin-data";
import type { OperationalLaunchRecord } from "@/lib/operational-launch";
import { cn } from "@/lib/utils";

const FLUIG_HOST = "https://nossaempresa.fluig.cloudtotvs.com.br";
const PAGE_SIZE = 20;
const PRODUCT_API_PAGE_SIZE = 100;

export type ProductKind = "MATERIAL" | "SERVICO" | "MISTO" | "INDEFINIDO";
export type ProductStatus = "ATIVO" | "REVISAR" | "INATIVO";

export type ProductCatalogRow = {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryCode: string | null;
  categoryLabel: string;
  materialTypeId: string | null;
  materialTypeLabel: string | null;
  kind: ProductKind;
  classification: string;
  classificationConfidence: number | null;
  classificationSource: string | null;
  status: ProductStatus;
  unit: string;
  supplierName: string | null;
  unitPriceCents: number | null;
  imageUrl: string | null;
  externalUrl: string | null;
  origin: "FLUIG" | "ADM";
  latestFluigRequestId: string | null;
  latestFluigRequestUrl: string | null;
  occurrenceCount: number;
  occurrences: ProductOccurrence[];
  updatedAt: string | null;
};

export type ProductOccurrence = {
  id: string;
  fluigRequestId: string;
  fluigRequestUrl: string | null;
  branchLabel: string | null;
  quantity: string | null;
  unit: string | null;
  unitPriceCents: number | null;
  observedAt: string | null;
};

type ProductCatalogOption = {
  value: string;
  label: string;
  code?: string | null;
};

type ProductCatalogField = {
  options: ProductCatalogOption[];
  allowCustom: boolean;
};

type ProductFormCatalogs = {
  categories: ProductCatalogField;
  materialTypes: ProductCatalogField;
  units: ProductCatalogField;
};

export type ProductFilters = {
  query: string;
  category: string;
  kind: string;
  status: string;
};

type JsonRecord = Record<string, unknown>;

type ProductEditForm = {
  name: string;
  categoryId: string;
  categoryCode: string;
  categoryLabel: string;
  materialTypeId: string;
  materialTypeLabel: string;
  kind: ProductKind;
  status: ProductStatus;
  unit: string;
  externalUrl: string;
};

const emptyFormCatalogs: ProductFormCatalogs = {
  categories: { options: [], allowCustom: false },
  materialTypes: { options: [], allowCustom: false },
  units: { options: [], allowCustom: false },
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function firstValue(record: JsonRecord, keys: string[]) {
  const metadata = asRecord(record.metadata);
  for (const key of keys) {
    const value = record[key] ?? metadata[key];
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return null;
}

function firstString(record: JsonRecord, keys: string[]) {
  const value = firstValue(record, keys);
  return value === null ? "" : String(value).trim();
}

function firstNumber(record: JsonRecord, keys: string[]) {
  const value = firstValue(record, keys);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isGenericProductDescription(name: string, specification = "") {
  const normalizedName = normalizeText(name).replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedSpecification = normalizeText(specification).replace(/[^a-z0-9]+/g, " ").trim();
  const genericDescriptions = new Set([
    "descricao acima",
    "na descricao",
    "em anexo",
    "pedido em anexo",
    "teste",
  ]);
  if (genericDescriptions.has(normalizedName)) return true;
  return ["epi", "manutencao"].includes(normalizedName) && !normalizedSpecification;
}

function normalizeKind(value: string): ProductKind {
  const normalized = normalizeText(value);
  if (normalized.includes("indef")) return "INDEFINIDO";
  if (normalized.includes("misto") || normalized.includes("mixed")) return "MISTO";
  if (normalized.includes("serv")) return "SERVICO";
  if (normalized.includes("mater") || normalized.includes("prod") || normalized.includes("item")) return "MATERIAL";
  return "INDEFINIDO";
}

function normalizeStatus(value: string): ProductStatus {
  const normalized = normalizeText(value).replace(/[\s-]+/g, "_");
  if (["ativo", "active", "aprovado", "approved"].includes(normalized)) return "ATIVO";
  if (["inativo", "inactive", "arquivado", "archived"].includes(normalized)) return "INATIVO";
  return "REVISAR";
}

function safeExternalUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeImageUrl(value: string) {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  return safeExternalUrl(value);
}

export function buildFluigRequestUrl(requestId: string) {
  const normalized = requestId.replace(/\D/g, "");
  return normalized
    ? `${FLUIG_HOST}/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=${encodeURIComponent(normalized)}`
    : null;
}

function normalizeOccurrence(value: unknown, index: number): ProductOccurrence | null {
  const record = asRecord(value);
  const requestId = firstString(record, ["fluigRequestId", "fluig_request_id", "requestId"]);
  if (!requestId) return null;
  const explicitUrl = safeExternalUrl(firstString(record, ["fluigRequestUrl", "fluig_request_url"]));
  return {
    id: firstString(record, ["id", "occurrenceId"]) || `${requestId}-${index}`,
    fluigRequestId: requestId,
    fluigRequestUrl: explicitUrl || buildFluigRequestUrl(requestId),
    branchLabel: firstString(record, ["branchLabel", "branch_label", "filial"]) || null,
    quantity: firstString(record, ["quantity", "quantidade"]) || null,
    unit: firstString(record, ["unit", "unidade"]) || null,
    unitPriceCents: firstNumber(record, ["unitPriceCents", "unit_price_cents", "precoCentavos"]),
    observedAt: firstString(record, ["observedAt", "observed_at", "createdAt", "created_at"]) || null,
  };
}

export function normalizeProductApiItem(value: unknown, index = 0): ProductCatalogRow {
  const record = asRecord(value);
  const name = firstString(record, ["name", "nome", "description", "descricao", "productName", "item"]);
  const specification = firstString(record, ["specification", "especificacao", "technicalSpecification"]);
  const rawOccurrences = Array.isArray(record.occurrences)
    ? record.occurrences
    : Array.isArray(record.history)
      ? record.history
      : Array.isArray(record.historico)
        ? record.historico
        : [];
  const occurrences = rawOccurrences
    .map(normalizeOccurrence)
    .filter((item): item is ProductOccurrence => Boolean(item))
    .sort((left, right) => (Date.parse(right.observedAt || "") || 0) - (Date.parse(left.observedAt || "") || 0));
  const requestId = firstString(record, [
    "latestFluigRequestId",
    "latest_fluig_request_id",
    "lastFluigRequestId",
    "last_fluig_request_id",
    "fluigRequestId",
    "fluig_request_id",
  ]) || occurrences[0]?.fluigRequestId || "";
  const explicitOrigin = normalizeText(firstString(record, ["origin", "origem", "source", "fonte", "sourceSystem", "source_system"]));
  const explicitFluigUrl = safeExternalUrl(
    firstString(record, ["latestFluigRequestUrl", "latest_fluig_request_url", "fluigRequestUrl"])
  );
  const id = firstString(record, ["id", "productId", "produtoId"]);
  const priceCents = firstNumber(record, ["unitPriceCents", "lastUnitPriceCents", "priceCents", "precoCentavos", "ultimoPrecoCentavos"]);
  const kind = normalizeKind(firstString(record, ["itemType", "item_type", "kind", "type", "tipo"]));
  const confidence = firstNumber(record, ["classificationConfidence", "classification_confidence", "confidence"]);
  const categoryRef = asRecord(record.category);
  const materialTypeRef = asRecord(record.materialType);
  const categoryId = firstString(record, ["categoryId", "category_id"]) || firstString(categoryRef, ["id"]);
  const categoryCode = firstString(record, ["categoryCode", "category_code", "contaCentroCusto"]) || firstString(categoryRef, ["code"]);
  const categoryLabel = firstString(record, ["categoryLabel", "category_label", "codContaFin"]) || firstString(categoryRef, ["label", "name"]);
  const genericDescription = isGenericProductDescription(name, specification);

  return {
    id: id || `produto-${index + 1}`,
    sku: firstString(record, ["sku", "code", "codigo", "productCode"]) || "Sem SKU",
    name: name || "Item sem descricao",
    categoryId: categoryId || null,
    categoryCode: categoryCode || null,
    categoryLabel: categoryLabel || "Sem categoria financeira",
    materialTypeId: firstString(record, ["materialTypeId", "material_type_id"]) || firstString(materialTypeRef, ["id"]) || null,
    materialTypeLabel: firstString(materialTypeRef, ["label", "name"]) || firstString(record, ["materialTypeLabel", "material_type_label"]) || null,
    kind: genericDescription ? "INDEFINIDO" : kind,
    classification: firstString(record, ["classification", "classificacao"]) || (genericDescription ? "REVIEW" : kind),
    classificationConfidence: confidence === null ? null : confidence > 1 ? confidence / 100 : confidence,
    classificationSource: firstString(record, ["classificationSource", "classification_source", "classificacaoFonte", "syncStatus", "sync_status", "sourceSystem", "source_system"]) || null,
    status: genericDescription || kind === "INDEFINIDO" ? "REVISAR" : normalizeStatus(firstString(record, ["status", "situacao"])),
    unit: firstString(record, ["unit", "unidade", "unitOfMeasure"]) || "UN",
    supplierName: firstString(record, ["supplierName", "fornecedor", "supplier"]) || null,
    unitPriceCents: priceCents === null ? null : Math.round(priceCents),
    imageUrl: safeImageUrl(firstString(record, ["imageUrl", "image_url", "photoUrl", "fotoUrl", "foto_url"])),
    externalUrl: safeExternalUrl(
      firstString(record, ["externalUrl", "external_url", "productUrl", "product_url", "linkExterno"])
    ),
    origin: explicitOrigin.includes("fluig") || requestId ? "FLUIG" : "ADM",
    latestFluigRequestId: requestId || null,
    latestFluigRequestUrl: explicitFluigUrl || (requestId ? buildFluigRequestUrl(requestId) : null),
    occurrenceCount: Math.max(occurrences.length, Math.round(firstNumber(record, ["occurrenceCount", "usos"]) || 1)),
    occurrences,
    updatedAt: firstString(record, ["updatedAt", "updated_at", "lastSyncedAt", "last_synced_at"]) || null,
  };
}

function itemMetadataString(item: OperationalLaunchRecord["items"][number], keys: string[]) {
  const metadata = asRecord(item.metadata);
  return firstString(metadata, keys);
}

export function productsFromOperationalLaunches(launches: OperationalLaunchRecord[]) {
  const grouped = new Map<string, ProductCatalogRow>();

  for (const launch of launches) {
    for (const item of launch.items) {
      const explicitSku = itemMetadataString(item, ["sku", "code", "codigo", "productCode"]);
      const specification = itemMetadataString(item, ["specification", "especificacao", "technicalSpecification"]);
      const genericDescription = isGenericProductDescription(item.description, specification);
      const key = genericDescription
        ? `occurrence:${item.id}`
        : explicitSku
          ? `sku:${normalizeText(explicitSku)}`
          : `item:${normalizeText(item.description)}:${normalizeText(specification)}:${normalizeText(item.unit)}`;
      const candidate = normalizeProductApiItem({
        id: item.id,
        sku: explicitSku,
        name: item.description,
        specification,
        categoryCode: itemMetadataString(item, ["categoryCode", "category_code", "contaCentroCusto"]),
        categoryLabel: itemMetadataString(item, ["categoryLabel", "category_label", "codContaFin"]),
        itemType: genericDescription
          ? "INDEFINIDO"
          : itemMetadataString(item, ["itemType", "item_type", "kind", "type", "tipo"]),
        classification: itemMetadataString(item, ["classification", "classificacao"]),
        classificationConfidence: itemMetadataString(item, ["classificationConfidence", "classification_confidence"]),
        classificationSource: itemMetadataString(item, ["classificationSource", "classification_source"]),
        status: itemMetadataString(item, ["status", "situacao"]),
        unit: item.unit,
        supplierName: launch.supplierName,
        unitPriceCents: item.unitPriceCents,
        imageUrl: itemMetadataString(item, ["imageUrl", "image_url", "photoUrl", "fotoUrl"]),
        externalUrl: itemMetadataString(item, ["externalUrl", "external_url", "productUrl", "product_url", "linkExterno"]),
        origin: launch.fluigRequestId ? "FLUIG" : "ADM",
        latestFluigRequestId: launch.fluigRequestId,
        occurrences: launch.fluigRequestId
          ? [{
              id: item.id,
              fluigRequestId: launch.fluigRequestId,
              branchLabel: launch.branchLabel,
              quantity: String(item.quantity),
              unit: item.unit,
              unitPriceCents: item.unitPriceCents,
              observedAt: launch.updatedAt,
            }]
          : [],
        occurrenceCount: 1,
        updatedAt: launch.updatedAt,
      });
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, candidate);
        continue;
      }

      const candidateTime = Date.parse(candidate.updatedAt || "") || 0;
      const currentTime = Date.parse(current.updatedAt || "") || 0;
      const latest = candidateTime >= currentTime ? candidate : current;
      grouped.set(key, {
        ...latest,
        occurrenceCount: current.occurrenceCount + 1,
        occurrences: [...current.occurrences, ...candidate.occurrences].sort(
          (left, right) => (Date.parse(right.observedAt || "") || 0) - (Date.parse(left.observedAt || "") || 0)
        ),
        origin: current.origin === "FLUIG" || candidate.origin === "FLUIG" ? "FLUIG" : "ADM",
      });
    }
  }

  return Array.from(grouped.values()).sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt || "") || 0;
    const leftTime = Date.parse(left.updatedAt || "") || 0;
    return rightTime - leftTime || left.name.localeCompare(right.name, "pt-BR");
  });
}

export function filterProductRows(rows: ProductCatalogRow[], filters: ProductFilters) {
  const query = normalizeText(filters.query);
  return rows.filter((row) => {
    const searchText = normalizeText(
      [
        row.sku,
        row.name,
        row.categoryCode || "",
        row.categoryLabel,
        row.classification,
        row.supplierName || "",
        row.latestFluigRequestId || "",
      ].join(" ")
    );
    if (query && !searchText.includes(query)) return false;
    if (filters.category !== "all" && row.categoryLabel !== filters.category) return false;
    if (filters.kind !== "all" && row.kind !== filters.kind) return false;
    if (filters.status !== "all" && row.status !== filters.status) return false;
    return true;
  });
}

function responseItems(value: unknown) {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of ["items", "products", "produtos", "data"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function responseError(value: unknown, fallback: string) {
  const record = asRecord(value);
  return firstString(record, ["error", "message", "erro"]) || fallback;
}

export function productCatalogPageNumbers(total: number, pageSize = PRODUCT_API_PAGE_SIZE) {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safePageSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : PRODUCT_API_PAGE_SIZE;
  const pageCount = Math.ceil(safeTotal / safePageSize);
  return Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
}

function catalogOptions(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value).options)
      ? (asRecord(value).options as unknown[])
      : Array.isArray(asRecord(value).items)
        ? (asRecord(value).items as unknown[])
        : [];
  const options = source.flatMap((item, index): ProductCatalogOption[] => {
    if (typeof item === "string" || typeof item === "number") {
      const raw = String(item).trim();
      if (!raw) return [];
      return [{ value: raw, label: raw }];
    }
    const record = asRecord(item);
    const rawValue = firstString(record, ["id", "value", "code", "name"]);
    const rawLabel = firstString(record, ["label", "name", "nome", "description"]);
    const code = firstString(record, ["code", "codigo"]);
    if (!rawValue && !rawLabel) return [];
    const valueText = rawValue || rawLabel || String(index);
    return [{ value: valueText, label: rawLabel || valueText, code: code || null }];
  });
  return Array.from(new Map(options.map((option) => [option.value, option])).values());
}

function catalogField(root: JsonRecord, keys: string[], field: "category" | "materialType" | "unit"): ProductCatalogField {
  const catalogs = asRecord(root.catalogs);
  const sourceKey = keys.find((key) => root[key] !== undefined || catalogs[key] !== undefined);
  const source = sourceKey ? root[sourceKey] ?? catalogs[sourceKey] : [];
  const sourceRecord = asRecord(source);
  const allowCustomValue = sourceRecord.allowCustom ?? sourceRecord.allow_custom ?? root[`allowCustom${field[0].toUpperCase()}${field.slice(1)}`];
  return {
    options: catalogOptions(source),
    allowCustom: allowCustomValue === true,
  };
}

export function normalizeProductCatalogsResponse(value: unknown): ProductFormCatalogs {
  const root = asRecord(value);
  return {
    categories: catalogField(root, ["categories", "categorias", "financialCategories"], "category"),
    materialTypes: catalogField(root, ["materialTypes", "material_types", "types", "tipos"], "materialType"),
    units: catalogField(root, ["units", "unidades", "measurementUnits"], "unit"),
  };
}

function fallbackCatalogs(rows: ProductCatalogRow[]): ProductFormCatalogs {
  const options = (values: string[]) =>
    Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right, "pt-BR"));
  return {
    categories: {
      options: options(rows.map((row) => row.categoryCode || row.categoryLabel)).map((value) => ({
        value,
        label: rows.find((row) => (row.categoryCode || row.categoryLabel) === value)?.categoryLabel || value,
      })),
      allowCustom: true,
    },
    materialTypes: {
      options: options(rows.map((row) => row.materialTypeLabel || "")).map((value) => ({ value, label: value })),
      allowCustom: false,
    },
    units: {
      options: options(rows.map((row) => row.unit)).map((value) => ({ value, label: value })),
      allowCustom: true,
    },
  };
}

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function formatDate(value: string | null) {
  if (!value) return "Nunca";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Nao informado" : date.toLocaleString("pt-BR");
}

function editFormFor(row: ProductCatalogRow): ProductEditForm {
  return {
    name: row.name,
    categoryId: row.categoryId || "",
    categoryCode: row.categoryCode || "",
    categoryLabel: row.categoryLabel === "Sem categoria financeira" ? "" : row.categoryLabel,
    materialTypeId: row.materialTypeId || "",
    materialTypeLabel: row.materialTypeLabel || "",
    kind: row.kind,
    status: row.status,
    unit: row.unit,
    externalUrl: row.externalUrl || "",
  };
}

function emptyProductForm(): ProductEditForm {
  return {
    name: "",
    categoryId: "",
    categoryCode: "",
    categoryLabel: "",
    materialTypeId: "",
    materialTypeLabel: "",
    kind: "INDEFINIDO",
    status: "REVISAR",
    unit: "",
    externalUrl: "",
  };
}

function productKindLabel(kind: ProductKind) {
  if (kind === "MATERIAL") return "Material";
  if (kind === "SERVICO") return "Servico";
  if (kind === "MISTO") return "Misto";
  return "Indefinido";
}

function apiProductStatus(status: ProductStatus) {
  if (status === "ATIVO") return "ACTIVE";
  if (status === "INATIVO") return "INACTIVE";
  return "REVIEW";
}

export function ProductsPage({
  config,
  initialOpenForm = false,
  initialProductId = null,
}: {
  config: ModuleConfig;
  initialOpenForm?: boolean;
  initialProductId?: string | null;
}) {
  const [products, setProducts] = useState<ProductCatalogRow[]>([]);
  const [formCatalogs, setFormCatalogs] = useState<ProductFormCatalogs>(emptyFormCatalogs);
  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [catalogsError, setCatalogsError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<{ canCreate: boolean; canUpdate: boolean; canSyncHistory: boolean } | null>(null);
  const [filters, setFilters] = useState<ProductFilters>({ query: "", category: "all", kind: "all", status: "all" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sourceMode, setSourceMode] = useState<"catalog" | "purchases">("catalog");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(initialOpenForm);
  const [editingId, setEditingId] = useState<string | null>(initialProductId);
  const [editForm, setEditForm] = useState<ProductEditForm | null>(initialOpenForm ? emptyProductForm() : null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialProductId));
  const [statusTarget, setStatusTarget] = useState<ProductCatalogRow | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadCatalogs = useCallback(async () => {
    setCatalogsLoading(true);
    setCatalogsError(null);
    try {
      const response = await fetch("/api/produtos/catalogs", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Falha ao carregar categorias, tipos e unidades."));
      setFormCatalogs(normalizeProductCatalogsResponse(data));
    } catch (catalogError) {
      setCatalogsError(catalogError instanceof Error ? catalogError.message : "Falha ao carregar os catalogos de produtos.");
    } finally {
      setCatalogsLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/produtos?page=1&pageSize=${PRODUCT_API_PAGE_SIZE}`, { cache: "no-store" });
      if (response.status === 404) {
        const operational = await fluigAdmApi.listOperationalLaunches("compras", 100);
        setProducts(productsFromOperationalLaunches(operational.launches));
        setSourceMode("purchases");
      } else {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseError(data, "Falha ao carregar o catalogo de produtos."));
        const firstPageItems = responseItems(data);
        const total = Math.max(Number(asRecord(data).total) || 0, firstPageItems.length);
        const remainingPages = await Promise.all(
          productCatalogPageNumbers(total).map(async (pageNumber) => {
            const pageResponse = await fetch(
              `/api/produtos?page=${pageNumber}&pageSize=${PRODUCT_API_PAGE_SIZE}`,
              { cache: "no-store" }
            );
            const pageData = await pageResponse.json().catch(() => ({}));
            if (!pageResponse.ok) {
              throw new Error(responseError(pageData, `Falha ao carregar a pagina ${pageNumber} do catalogo.`));
            }
            return responseItems(pageData);
          })
        );
        const allItems = [firstPageItems, ...remainingPages].flat();
        setProducts(allItems.map((item, index) => normalizeProductApiItem(item, index)));
        const permissionData = asRecord(asRecord(data).permissions);
        setPermissions({
          canCreate: permissionData.canCreate !== false,
          canUpdate: permissionData.canUpdate !== false,
          canSyncHistory: permissionData.canSyncHistory === true,
        });
        setSourceMode("catalog");
      }
      setLastUpdatedAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Falha ao carregar produtos e servicos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadProducts();
      void loadCatalogs();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadCatalogs, loadProducts]);

  useEffect(() => {
    if (!initialProductId) return;
    let cancelled = false;
    fetch(`/api/produtos/${encodeURIComponent(initialProductId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseError(data, "Produto nao encontrado."));
        const raw = responseItems(data)[0] || asRecord(data).product || asRecord(data).item || data;
        const product = normalizeProductApiItem(raw);
        if (cancelled) return;
        setProducts((current) => [product, ...current.filter((item) => item.id !== product.id)]);
        setEditingId(product.id);
        setEditForm(editFormFor(product));
      })
      .catch((detailError) => {
        if (!cancelled) setError(detailError instanceof Error ? detailError.message : "Falha ao carregar o produto.");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialProductId]);

  useEffect(
    () => () => {
      if (imagePreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(imagePreviewUrl);
    },
    [imagePreviewUrl]
  );

  const categories = useMemo(
    () => Array.from(new Set(products.map((item) => item.categoryLabel))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [products]
  );
  const effectiveFormCatalogs = useMemo(
    () => (catalogsError && products.length ? fallbackCatalogs(products) : formCatalogs),
    [catalogsError, formCatalogs, products]
  );
  const filteredProducts = useMemo(() => filterProductRows(products, filters), [filters, products]);
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const visibleProducts = filteredProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const editingProduct = products.find((item) => item.id === editingId) || null;
  const activeFilters = Boolean(
    filters.query || filters.category !== "all" || filters.kind !== "all" || filters.status !== "all"
  );
  const metrics = useMemo(
    () => ({
      total: products.length,
      services: products.filter((item) => item.kind === "SERVICO").length,
      review: products.filter((item) => item.status === "REVISAR").length,
      fluig: products.filter((item) => item.origin === "FLUIG").length,
    }),
    [products]
  );

  function updateFilter(key: keyof ProductFilters, value: string) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setPage(1);
    setFilters({ query: "", category: "all", kind: "all", status: "all" });
  }

  function openEditor(product: ProductCatalogRow) {
    setCreating(false);
    setEditingId(product.id);
    setEditForm(editFormFor(product));
    setEditError(null);
    setImageFile(null);
    setImagePreviewUrl(null);
    setDetailLoading(true);
    fetch(`/api/produtos/${encodeURIComponent(product.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseError(data, "Falha ao carregar o historico do produto."));
        const raw = responseItems(data)[0] || asRecord(data).product || asRecord(data).item || data;
        const detailed = normalizeProductApiItem(raw);
        setProducts((current) => current.map((item) => (item.id === detailed.id ? detailed : item)));
        setEditForm(editFormFor(detailed));
      })
      .catch((detailError) => setEditError(detailError instanceof Error ? detailError.message : "Falha ao carregar o historico do produto."))
      .finally(() => setDetailLoading(false));
  }

  function openCreateForm() {
    setCreating(true);
    setEditingId(null);
    setEditForm(emptyProductForm());
    setEditError(null);
    setImageFile(null);
    setImagePreviewUrl(null);
  }

  function closeEditor() {
    setCreating(false);
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
    setImageFile(null);
    setImagePreviewUrl(null);
  }

  function selectImage(file: File | null) {
    setEditError(null);
    if (!file) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setEditError("Selecione um arquivo de imagem valido.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setEditError("A imagem precisa ter no maximo 5 MB.");
      return;
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  }

  async function uploadImage() {
    if (!editingProduct || !imageFile) return;
    setUploadingImage(true);
    setEditError(null);

    try {
      const body = new FormData();
      body.append("file", imageFile, imageFile.name);
      const response = await fetch(`/api/produtos/${encodeURIComponent(editingProduct.id)}/image`, {
        method: "POST",
        body,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Falha ao enviar a foto do produto."));

      const updated = responseItems(data)[0] || asRecord(data).product || asRecord(data).item;
      const returnedImage = safeImageUrl(
        firstString(asRecord(updated || data), ["imageUrl", "image_url", "photoUrl", "fotoUrl", "foto_url"])
      );
      if (returnedImage) {
        setProducts((current) =>
          current.map((item) => (item.id === editingProduct.id ? { ...item, imageUrl: returnedImage } : item))
        );
      } else {
        await loadProducts();
      }
      setImageFile(null);
      setImagePreviewUrl(null);
      setMessage("Foto enviada e vinculada ao produto.");
    } catch (uploadError) {
      setEditError(uploadError instanceof Error ? uploadError.message : "Falha ao enviar a foto do produto.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function saveProduct() {
    if ((!creating && !editingProduct) || !editForm) return;
    if (!editForm.name.trim() || !editForm.categoryLabel.trim() || !editForm.unit.trim()) {
      setEditError("Preencha nome, categoria e unidade.");
      return;
    }
    if (editForm.externalUrl.trim() && !safeExternalUrl(editForm.externalUrl.trim())) {
      setEditError("Informe um link externo valido, iniciado por http:// ou https://.");
      return;
    }

    setSaving(true);
    setEditError(null);
    try {
      const genericDescription = isGenericProductDescription(editForm.name);
      const effectiveKind = genericDescription ? "INDEFINIDO" : editForm.kind;
      const effectiveStatus = genericDescription || effectiveKind === "INDEFINIDO" ? "REVISAR" : editForm.status;
      const endpoint = creating ? "/api/produtos" : `/api/produtos/${encodeURIComponent(editingProduct!.id)}`;
      const response = await fetch(endpoint, {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          categoryId: editForm.categoryId || null,
          materialTypeId: editForm.materialTypeId || null,
          categoryCode: editForm.categoryCode.trim() || null,
          categoryLabel: editForm.categoryLabel.trim(),
          itemType: effectiveKind,
          classification: effectiveKind,
          classificationConfidence: effectiveKind === "INDEFINIDO" ? 0 : 1,
          classificationSource: "MANUAL",
          status: apiProductStatus(effectiveStatus),
          unit: editForm.unit.trim(),
          productUrl: editForm.externalUrl.trim() || null,
          externalUrl: editForm.externalUrl.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Falha ao salvar a revisao do produto."));

      const updatedRaw = responseItems(data)[0] || asRecord(data).product || asRecord(data).item || asRecord(data).produto;
      if (updatedRaw && Object.keys(asRecord(updatedRaw)).length) {
        const updated = normalizeProductApiItem(updatedRaw);
        setProducts((current) => [updated, ...current.filter((item) => item.id !== updated.id && item.id !== editingProduct?.id)]);
      } else {
        await loadProducts();
      }
      setMessage(creating ? "Produto ou servico criado no catalogo." : "Revisao salva no catalogo de produtos.");
      closeEditor();
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Falha ao salvar a revisao do produto.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    const nextStatus: ProductStatus = statusTarget.status === "INATIVO" ? "ATIVO" : "INATIVO";
    setChangingStatus(true);
    setError(null);
    try {
      const response = await fetch(`/api/produtos/${encodeURIComponent(statusTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: apiProductStatus(nextStatus) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Falha ao alterar o status do produto."));
      const updatedRaw = responseItems(data)[0] || asRecord(data).product || asRecord(data).item || asRecord(data).produto;
      const updated = Object.keys(asRecord(updatedRaw)).length
        ? normalizeProductApiItem(updatedRaw)
        : { ...statusTarget, status: nextStatus };
      setProducts((current) => current.map((item) => (item.id === statusTarget.id ? updated : item)));
      setMessage(nextStatus === "ATIVO" ? "Item reativado no catalogo." : "Item inativado no catalogo.");
      setStatusTarget(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Falha ao alterar o status do produto.");
    } finally {
      setChangingStatus(false);
    }
  }

  async function syncFluigHistory() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/produtos/sync-historico", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Falha ao sincronizar o historico Fluig."));
      await Promise.all([loadProducts(), loadCatalogs()]);
      const sync = asRecord(asRecord(data).sync);
      const imported = firstNumber(sync, ["products"]);
      const occurrences = firstNumber(sync, ["occurrences"]);
      setMessage(
        imported === null
          ? "Historico Fluig sincronizado."
          : `${imported} itens e ${occurrences || 0} ocorrencias processados do Fluig.`
      );
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha ao sincronizar o historico Fluig.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="stitch-slide-down flex flex-col gap-4 border-b pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{config.eyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Produtos e servicos</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Catalogo operacional consolidado com origem, revisao cadastral e referencia da ultima solicitacao Fluig.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void syncFluigHistory()} disabled={loading || catalogsLoading || syncing || permissions?.canSyncHistory === false}>
            {loading || catalogsLoading || syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Sincronizar
          </Button>
          <Button type="button" onClick={openCreateForm} disabled={permissions?.canCreate === false}>
            <Plus className="size-4" />
            Novo item
          </Button>
        </div>
      </header>

      <div className="grid border-y sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Itens no catalogo" value={metrics.total} icon={PackageCheck} />
        <Metric label="Servicos" value={metrics.services} icon={BriefcaseBusiness} />
        <Metric label="Aguardando revisao" value={metrics.review} icon={Pencil} tone={metrics.review ? "warning" : "default"} />
        <Metric label="Origem Fluig" value={metrics.fluig} icon={Cloud} />
      </div>

      <section className="space-y-3 border-b pb-4" aria-label="Filtros do catalogo">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
              placeholder="Buscar por produto, servico, SKU, fornecedor ou Fluig"
              className="pl-9"
              aria-label="Buscar produtos e servicos"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={filters.category} onValueChange={(value) => updateFilter("category", value)}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por categoria">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category} value={category}>{category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.kind} onValueChange={(value) => updateFilter("kind", value)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filtrar por tipo">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="MATERIAL">Material</SelectItem>
                <SelectItem value="SERVICO">Servico</SelectItem>
                <SelectItem value="MISTO">Misto</SelectItem>
                <SelectItem value="INDEFINIDO">Indefinido</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
              <SelectTrigger className="w-full sm:w-36" aria-label="Filtrar por status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="ATIVO">Ativo</SelectItem>
                <SelectItem value="REVISAR">Revisar</SelectItem>
                <SelectItem value="INATIVO">Inativo</SelectItem>
              </SelectContent>
            </Select>
            {activeFilters ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" onClick={clearFilters} aria-label="Limpar filtros">
                    <X className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Limpar filtros</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{filteredProducts.length} {filteredProducts.length === 1 ? "resultado" : "resultados"}</span>
          <span>Atualizado em {formatDate(lastUpdatedAt)}</span>
        </div>
      </section>

      {sourceMode === "purchases" && !loading ? (
        <p className="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          O catalogo dedicado ainda nao esta disponivel. A lista abaixo usa somente itens reais dos lancamentos de compras existentes.
        </p>
      ) : null}
      {message ? <p className="border-l-2 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{message}</p> : null}
      {error ? (
        <div className="flex items-center justify-between gap-3 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          <span>{error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadProducts()}>Tentar novamente</Button>
        </div>
      ) : null}

      {loading && !products.length ? (
        <ProductTableSkeleton />
      ) : visibleProducts.length ? (
        <>
          <div className="hidden overflow-hidden rounded-md border lg:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[56px]">Foto</TableHead>
                  <TableHead>Produto ou servico</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Ultimo valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[118px] text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell><ProductImage product={product} /></TableCell>
                    <TableCell className="max-w-[360px] whitespace-normal">
                      <p className="line-clamp-2 font-medium">{product.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{product.sku} · {product.unit}{product.supplierName ? ` · ${product.supplierName}` : ""}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-48 truncate">{product.categoryCode ? `${product.categoryCode} - ` : ""}{product.categoryLabel}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {productKindLabel(product.kind)}
                        {product.classificationConfidence !== null ? ` · ${Math.round(product.classificationConfidence * 100)}%` : ""}
                      </p>
                    </TableCell>
                    <TableCell><OriginBadge product={product} /></TableCell>
                    <TableCell className="text-right font-medium">{formatMoney(product.unitPriceCents)}</TableCell>
                    <TableCell><ProductStatusBadge status={product.status} /></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <ProductLinks product={product} />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" onClick={() => openEditor(product)} aria-label={`Revisar ${product.name}`} disabled={permissions?.canUpdate === false}>
                              {product.occurrences.length ? <History className="size-4" /> : <Pencil className="size-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Revisar cadastro e historico</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" onClick={() => setStatusTarget(product)} aria-label={product.status === "INATIVO" ? `Reativar ${product.name}` : `Inativar ${product.name}`} disabled={permissions?.canUpdate === false}>
                              {product.status === "INATIVO" ? <RotateCcw className="size-4" /> : <Power className="size-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{product.status === "INATIVO" ? "Reativar item" : "Inativar item"}</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="divide-y rounded-md border lg:hidden">
            {visibleProducts.map((product) => (
              <article key={product.id} className="p-3">
                <div className="flex gap-3">
                  <ProductImage product={product} large />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold">{product.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{product.sku} · {product.unit}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5"><OriginBadge product={product} /><ProductStatusBadge status={product.status} /></div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
                  <div><p className="text-muted-foreground">Categoria financeira</p><p className="mt-1 truncate font-medium">{product.categoryCode ? `${product.categoryCode} - ` : ""}{product.categoryLabel}</p></div>
                  <div><p className="text-muted-foreground">Ultimo valor</p><p className="mt-1 font-medium">{formatMoney(product.unitPriceCents)}</p></div>
                </div>
                <div className="mt-3 flex items-center justify-end gap-1">
                  <ProductLinks product={product} />
                  <Button type="button" variant="outline" size="sm" onClick={() => openEditor(product)} disabled={permissions?.canUpdate === false}>
                    <Pencil className="size-4" /> Revisar
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setStatusTarget(product)} aria-label={product.status === "INATIVO" ? `Reativar ${product.name}` : `Inativar ${product.name}`} disabled={permissions?.canUpdate === false}>
                    {product.status === "INATIVO" ? <RotateCcw className="size-4" /> : <Power className="size-4" />}
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Pagina {page} de {pageCount} · exibindo {visibleProducts.length} de {filteredProducts.length}</span>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
                <ChevronLeft className="size-4" /> Anterior
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>
                Proxima <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      ) : !error ? (
        <div className="flex min-h-52 flex-col items-center justify-center border-y px-4 py-10 text-center">
          <Box className="size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Nenhum produto ou servico encontrado</p>
          <p className="mt-1 text-xs text-muted-foreground">Ajuste os filtros ou sincronize os dados de compras.</p>
        </div>
      ) : null}

      <Dialog open={Boolean((creating || editingProduct) && editForm)} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {(creating || editingProduct) && editForm ? (
            <>
              <DialogHeader>
                <DialogTitle>{creating ? "Novo produto ou servico" : "Revisar produto ou servico"}</DialogTitle>
                <DialogDescription>
                  {creating
                    ? "Cadastre o item com classificacao, categoria financeira e unidade do catalogo operacional."
                    : "Atualize o cadastro e mantenha separados a foto, o link externo e a solicitacao Fluig."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <div
                    role="img"
                    aria-label={`Foto de ${editForm.name || "novo item"}`}
                    className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-muted/30 bg-cover bg-center"
                    style={imagePreviewUrl || editingProduct?.imageUrl ? { backgroundImage: `url(${JSON.stringify(imagePreviewUrl || editingProduct?.imageUrl)})` } : undefined}
                  >
                    {!imagePreviewUrl && !editingProduct?.imageUrl ? <ImageIcon className="size-8 text-muted-foreground" /> : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-image">Foto do produto</Label>
                    <Input id="product-image" type="file" accept="image/*" disabled={creating || permissions?.canUpdate === false} onChange={(event) => selectImage(event.target.files?.[0] || null)} />
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void uploadImage()} disabled={creating || permissions?.canUpdate === false || !imageFile || uploadingImage}>
                      {uploadingImage ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      Enviar foto
                    </Button>
                    {creating ? <p className="text-xs text-muted-foreground">Salve o item antes de enviar a foto.</p> : null}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="product-name">Nome</Label>
                    <Input id="product-name" value={editForm.name} disabled={!creating} onChange={(event) => setEditForm((current) => current ? { ...current, name: event.target.value } : current)} />
                  </div>
                  <div className="space-y-1.5">
                    <CatalogCombobox
                      id="product-category"
                      label="Categoria financeira"
                      value={editForm.categoryId || editForm.categoryLabel}
                      options={effectiveFormCatalogs.categories.options}
                      allowCustom={effectiveFormCatalogs.categories.allowCustom}
                      loading={catalogsLoading}
                      onChange={(value, label, code) => setEditForm((current) => current ? {
                        ...current,
                        categoryId: value === label ? "" : value,
                        categoryCode: code || "",
                        categoryLabel: label,
                      } : current)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <CatalogCombobox
                      id="product-unit"
                      label="Unidade"
                      value={editForm.unit}
                      options={effectiveFormCatalogs.units.options}
                      allowCustom={effectiveFormCatalogs.units.allowCustom}
                      loading={catalogsLoading}
                      disabled={!creating}
                      onChange={(value) => setEditForm((current) => current ? { ...current, unit: value } : current)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tipo do item</Label>
                    <Select value={editForm.kind} onValueChange={(value: ProductKind) => setEditForm((current) => current ? { ...current, kind: value } : current)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MATERIAL">Material</SelectItem>
                        <SelectItem value="SERVICO">Servico</SelectItem>
                        <SelectItem value="MISTO">Misto</SelectItem>
                        <SelectItem value="INDEFINIDO">Indefinido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <CatalogCombobox
                      id="product-material-type"
                      label="Tipo catalogado"
                      value={editForm.materialTypeId || editForm.materialTypeLabel}
                      options={effectiveFormCatalogs.materialTypes.options}
                      allowCustom={effectiveFormCatalogs.materialTypes.allowCustom}
                      loading={catalogsLoading}
                      onChange={(value, label) => setEditForm((current) => current ? { ...current, materialTypeId: value === label ? "" : value, materialTypeLabel: label } : current)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select value={editForm.status} onValueChange={(value: ProductStatus) => setEditForm((current) => current ? { ...current, status: value } : current)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="ATIVO">Ativo</SelectItem><SelectItem value="REVISAR">Revisar</SelectItem><SelectItem value="INATIVO">Inativo</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="product-external-url">Link externo do produto</Label>
                    <div className="relative">
                      <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="product-external-url" type="url" className="pl-9" placeholder="https://fornecedor.com/produto" value={editForm.externalUrl} onChange={(event) => setEditForm((current) => current ? { ...current, externalUrl: event.target.value } : current)} />
                    </div>
                  </div>
                  {!creating && editingProduct ? (
                    <>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>Classificacao</Label>
                        <div className="grid gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs sm:grid-cols-3">
                          <span><span className="text-muted-foreground">Resultado:</span> {editingProduct.classification}</span>
                          <span><span className="text-muted-foreground">Confianca:</span> {editingProduct.classificationConfidence === null ? "-" : `${Math.round(editingProduct.classificationConfidence * 100)}%`}</span>
                          <span><span className="text-muted-foreground">Fonte:</span> {editingProduct.classificationSource || "-"}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>Solicitacao Fluig mais recente</Label>
                        <div className="flex min-h-9 items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                          <span>{editingProduct.latestFluigRequestId ? `Fluig ${editingProduct.latestFluigRequestId}` : "Sem solicitacao Fluig vinculada"}</span>
                          {editingProduct.latestFluigRequestUrl ? (
                            <Button asChild type="button" variant="ghost" size="sm">
                              <a href={editingProduct.latestFluigRequestUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Abrir Fluig</a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              {!creating && editingProduct ? <OccurrenceHistory product={editingProduct} loading={detailLoading} /> : null}

              {catalogsError ? <p className="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{catalogsError}</p> : null}
              {editError ? <p className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">{editError}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeEditor} disabled={saving || uploadingImage}>Cancelar</Button>
                <Button type="button" onClick={() => void saveProduct()} disabled={saving || uploadingImage || (creating ? permissions?.canCreate === false : permissions?.canUpdate === false)}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : creating ? <Plus className="size-4" /> : <Pencil className="size-4" />}
                  {creating ? "Criar item" : "Salvar revisao"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(statusTarget)} onOpenChange={(open) => { if (!open && !changingStatus) setStatusTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{statusTarget?.status === "INATIVO" ? "Reativar item?" : "Inativar item?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget?.status === "INATIVO"
                ? `${statusTarget?.name || "Este item"} voltara a aparecer como ativo no catalogo.`
                : `${statusTarget?.name || "Este item"} permanecera no historico, mas ficara indisponivel para uso ativo.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changingStatus}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmStatusChange(); }} disabled={changingStatus}>
              {changingStatus ? <Loader2 className="size-4 animate-spin" /> : statusTarget?.status === "INATIVO" ? <RotateCcw className="size-4" /> : <Power className="size-4" />}
              {statusTarget?.status === "INATIVO" ? "Reativar" : "Inativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CatalogCombobox({
  id,
  label,
  value,
  options,
  allowCustom,
  loading,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: ProductCatalogOption[];
  allowCustom: boolean;
  loading: boolean;
  disabled?: boolean;
  onChange: (value: string, label: string, code?: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selected?.label || value);

  const filtered = useMemo(() => {
    const normalized = normalizeText(query);
    if (!normalized) return options.slice(0, 10);
    return options
      .filter((option) => normalizeText(`${option.label} ${option.value}`).includes(normalized))
      .slice(0, 10);
  }, [options, query]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          className="pl-9"
          value={query}
          disabled={disabled}
          placeholder={loading ? "Carregando opcoes..." : `Pesquisar ${label.toLowerCase()}`}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => {
            setOpen(false);
            setQuery(selected?.label || value);
          }, 150)}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            setOpen(true);
            if (allowCustom) onChange(next, next);
          }}
        />
        {open ? (
          <div className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
            {loading ? (
              <p className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Carregando...</p>
            ) : filtered.length ? (
              filtered.map((option) => (
                <button
                  key={`${option.value}-${option.label}`}
                  type="button"
                  className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-muted"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChange(option.value, option.label, option.code);
                    setQuery(option.label);
                    setOpen(false);
                  }}
                >
                  <span className="block truncate font-medium">{option.label}</span>
                  {option.value !== option.label ? <span className="mt-0.5 block truncate text-muted-foreground">{option.value}</span> : null}
                </button>
              ))
            ) : allowCustom && query.trim() ? (
              <button
                type="button"
                className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(query.trim(), query.trim());
                  setOpen(false);
                }}
              >
                Usar &quot;{query.trim()}&quot;
              </button>
            ) : (
              <p className="px-2 py-2 text-xs text-muted-foreground">Nenhuma opcao encontrada.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OccurrenceHistory({ product, loading }: { product: ProductCatalogRow; loading: boolean }) {
  return (
    <section className="space-y-2 border-t pt-4" aria-label="Historico de ocorrencias Fluig">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><History className="size-4 text-muted-foreground" /><h4 className="text-sm font-semibold">Ocorrencias Fluig</h4></div>
        <Badge variant="outline">{product.occurrences.length}</Badge>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-4 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Carregando ocorrencias...</div>
      ) : product.occurrences.length ? (
        <div className="max-h-52 divide-y overflow-y-auto rounded-md border">
          {product.occurrences.map((occurrence) => (
            <div key={occurrence.id} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium">Fluig {occurrence.fluigRequestId}{occurrence.branchLabel ? ` - ${occurrence.branchLabel}` : ""}</p>
                <p className="mt-1 truncate text-muted-foreground">
                  {[occurrence.quantity, occurrence.unit].filter(Boolean).join(" ") || "Quantidade nao informada"}
                  {occurrence.unitPriceCents !== null ? ` - ${formatMoney(occurrence.unitPriceCents)}` : ""}
                  {occurrence.observedAt ? ` - ${formatDate(occurrence.observedAt)}` : ""}
                </p>
              </div>
              {occurrence.fluigRequestUrl ? (
                <Button asChild type="button" variant="ghost" size="sm">
                  <a href={occurrence.fluigRequestUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Abrir</a>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">Nenhuma ocorrencia Fluig vinculada a este item.</p>
      )}
    </section>
  );
}

function Metric({ label, value, icon: Icon, tone = "default" }: { label: string; value: number; icon: typeof Box; tone?: "default" | "warning" }) {
  return (
    <div className="flex min-h-20 items-center gap-3 border-b px-3 py-3 last:border-b-0 xl:border-b-0 xl:border-l xl:first:border-l-0">
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border bg-background", tone === "warning" && "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200")}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0"><p className="text-xl font-semibold tabular-nums">{value}</p><p className="truncate text-xs text-muted-foreground">{label}</p></div>
    </div>
  );
}

function ProductImage({ product, large = false }: { product: ProductCatalogRow; large?: boolean }) {
  return (
    <div
      role="img"
      aria-label={`Foto de ${product.name}`}
      className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40 bg-cover bg-center", large ? "size-16" : "size-10")}
      style={product.imageUrl ? { backgroundImage: `url(${JSON.stringify(product.imageUrl)})` } : undefined}
    >
      {!product.imageUrl ? <ImageIcon className="size-4 text-muted-foreground" /> : null}
    </div>
  );
}

function OriginBadge({ product }: { product: ProductCatalogRow }) {
  return (
    <div className="space-y-1">
      <Badge variant="outline" className={cn("gap-1", product.origin === "FLUIG" ? "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200" : "bg-muted text-muted-foreground")}>
        {product.origin === "FLUIG" ? <Cloud className="size-3" /> : <Box className="size-3" />}{product.origin === "FLUIG" ? "Fluig" : "ADM"}
      </Badge>
      {product.occurrenceCount > 1 ? <p className="text-[11px] text-muted-foreground">{product.occurrenceCount} ocorrencias</p> : null}
    </div>
  );
}

function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[11px]", status === "ATIVO" && "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200", status === "REVISAR" && "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200", status === "INATIVO" && "bg-muted text-muted-foreground")}>
      {status}
    </Badge>
  );
}

function ProductLinks({ product }: { product: ProductCatalogRow }) {
  return (
    <>
      {product.externalUrl ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon">
              <a href={product.externalUrl} target="_blank" rel="noreferrer" aria-label={`Abrir link externo de ${product.name}`}><Link2 className="size-4" /></a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Link externo do produto</TooltipContent>
        </Tooltip>
      ) : null}
      {product.latestFluigRequestUrl ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon">
              <a href={product.latestFluigRequestUrl} target="_blank" rel="noreferrer" aria-label={`Abrir solicitacao Fluig ${product.latestFluigRequestId}`}><ExternalLink className="size-4" /></a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Solicitacao Fluig {product.latestFluigRequestId}</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}

function ProductTableSkeleton() {
  return (
    <div className="space-y-2 rounded-md border p-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b py-2 last:border-b-0"><Skeleton className="size-10 rounded-md" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-3/5" /></div><Skeleton className="h-6 w-20" /></div>
      ))}
    </div>
  );
}
