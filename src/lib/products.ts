import { createHash } from "node:crypto";

export const PRODUCT_STATUSES = ["ACTIVE", "REVIEW", "INACTIVE"] as const;
export const PRODUCT_ITEM_TYPES = ["MATERIAL", "SERVICO", "MISTO", "INDEFINIDO"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type ProductItemType = (typeof PRODUCT_ITEM_TYPES)[number];

export type JsonRecord = Record<string, unknown>;

export type ProductFluigRequestSource = {
  fluigRequestId: string;
  fluigRequestRowId?: string | null;
  branchId?: string | null;
  branchCode?: string | null;
  branchLabel?: string | null;
  observedAt?: string | null;
  formFields: Record<string, unknown>;
};

export type ExtractedProductOccurrence = {
  fluigRequestId: string;
  fluigRequestRowId: string | null;
  sourceTable: "solTabelaProdutos" | "tabelaProdutos";
  sourceRowIndex: number;
  sourceItemNumber: string;
  branchId: string | null;
  branchCode: string | null;
  branchLabel: string | null;
  name: string;
  normalizedName: string;
  dedupeKey: string;
  sku: string;
  description: string;
  specification: string | null;
  itemType: ProductItemType;
  materialTypeLabel: string | null;
  categoryCode: string | null;
  categoryLabel: string | null;
  classificationConfidence: number;
  classificationSource: string;
  reviewRequired: boolean;
  unit: string | null;
  quantity: string | null;
  unitPriceCents: number | null;
  observedAt: string | null;
  sourcePayload: JsonRecord;
};

type SecondaryRow = {
  index: number;
  itemNumber: string;
  name: string;
  specification: string | null;
  quantity: string | null;
  unit: string | null;
  unitPriceCents: number | null;
  payload: JsonRecord;
};

function cleanText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

export function normalizeProductName(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function buildProductDedupeKey(name: unknown, specification?: unknown) {
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) throw new Error("Nome do produto e obrigatorio.");

  // Exact normalized name + specification avoids fuzzy merges of distinct items.
  const normalizedSpecification = normalizeProductName(specification);
  return createHash("sha256")
    .update(`v1\u0000${normalizedName}\u0000${normalizedSpecification}`)
    .digest("hex");
}

function buildIsolatedProductDedupeKey(input: {
  fluigRequestId: string;
  fluigRequestRowId?: string | null;
  sourceTable: ExtractedProductOccurrence["sourceTable"];
  sourceRowIndex: number;
  name: string;
  specification: string | null;
}) {
  if (input.fluigRequestRowId) {
    return `OCCURRENCE:${input.fluigRequestRowId}:${input.sourceTable}:${input.sourceRowIndex}`;
  }
  return createHash("sha256")
    .update(
      [
        "v1-isolated",
        input.fluigRequestId,
        input.sourceTable,
        String(input.sourceRowIndex),
        normalizeProductName(input.name),
        normalizeProductName(input.specification),
      ].join("\u0000")
    )
    .digest("hex");
}

export function buildProductSku(dedupeKey: string) {
  const fragment = /^[a-f0-9]{64}$/i.test(dedupeKey)
    ? dedupeKey.slice(0, 12)
    : createHash("sha256").update(dedupeKey).digest("hex").slice(0, 12);
  return `FLG-${fragment.toUpperCase()}`;
}

export function parseFluigDecimal(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;

  const compact = text.replace(/\s/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  const number = Number(normalized.replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(number) ? String(number) : null;
}

export function parseFluigMoneyCents(value: unknown) {
  const decimal = parseFluigDecimal(value);
  if (decimal == null) return null;
  const amount = Number(decimal);
  return Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : null;
}

function childIndexes(fields: Record<string, unknown>, prefix: string) {
  const pattern = new RegExp(`^${prefix}___(\\d+)$`);
  return Array.from(
    new Set(
      Object.keys(fields)
        .map((key) => Number(key.match(pattern)?.[1]))
        .filter((value) => Number.isInteger(value) && value >= 0)
    )
  ).sort((left, right) => left - right);
}

function field(fields: Record<string, unknown>, prefix: string, index: number) {
  return cleanText(fields[`${prefix}___${index}`]);
}

function rowPayload(fields: Record<string, unknown>, prefixes: string[], index: number) {
  return Object.fromEntries(prefixes.map((prefix) => [prefix, fields[`${prefix}___${index}`] ?? null]));
}

function secondaryRows(fields: Record<string, unknown>) {
  return childIndexes(fields, "ItemSelect")
    .map((index): SecondaryRow | null => {
      const name = field(fields, "ItemSelect", index);
      if (!name) return null;
      const itemNumber = field(fields, "numProduto", index) || String(index);
      return {
        index,
        itemNumber,
        name,
        specification: field(fields, "especTecnica", index),
        quantity: parseFluigDecimal(field(fields, "qtdProduto", index)),
        unit: field(fields, "unMedidaProduto", index),
        unitPriceCents: parseFluigMoneyCents(field(fields, "valorProduto", index)),
        payload: rowPayload(
          fields,
          [
            "ItemSelect",
            "numProduto",
            "qtdProduto",
            "unMedidaProduto",
            "valorProduto",
            "valorTotal",
            "especTecnica",
            "rowTabelaProdutos",
          ],
          index
        ),
      };
    })
    .filter((row): row is SecondaryRow => Boolean(row));
}

export function isGenericProductDescription(name: unknown, specification?: unknown) {
  const normalizedName = normalizeProductName(name);
  const normalizedSpecification = normalizeProductName(specification);
  if (!normalizedName) return true;
  if (
    ["DESCRICAO ACIMA", "NA DESCRICAO", "EM ANEXO", "PEDIDO EM ANEXO", "TESTE"].includes(
      normalizedName
    )
  ) {
    return true;
  }
  if (normalizedName.endsWith(" EM ANEXO") || normalizedName === "ANEXO") return true;
  return !normalizedSpecification && ["EPI", "MANUTENCAO"].includes(normalizedName);
}

export function classifyProductItem(input: {
  name: string;
  specification: string | null;
  categoryLabel?: string | null;
}) {
  const normalizedName = normalizeProductName(input.name);
  const normalized = `${normalizedName} ${normalizeProductName(input.specification)}`.trim();
  const normalizedCategory = normalizeProductName(input.categoryLabel);
  if (isGenericProductDescription(input.name, input.specification)) {
    return {
      itemType: "INDEFINIDO" as const,
      classificationConfidence: 0,
      classificationSource: "GENERIC_DESCRIPTION",
      reviewRequired: true,
    };
  }

  const servicePattern =
    /\b(SERVICO|MAO DE OBRA|INSTALACAO|LOCACAO|ALUGUEL|REPARO|CONSERTO|FRETE|LAUDO|CONSULTORIA|HIGIENIZACAO|ADEQUACAO|PINTURA|RECARGA|CALIBRACAO|DEDETIZACAO|ASSESSORIA|TRANSPORTE|TROCA)\b/;
  const maintenanceServicePattern =
    /^(MANUTENCAO|MANUTENCAO CORRETIVA|MANUTENCAO PREVENTIVA)$|\bMANUTENCAO (CORRETIVA|PREVENTIVA|DE|EM)\b/;
  const materialPattern =
    /\b(MATERIAL|PECA|PECAS|FILTRO|OLEO|EPI|EQUIPAMENTO|INSUMO|BOBINA|FITA|FILME|CHAVE|CABO|PARAFUSO|EMBALAGEM|UTENSILIO|IMOBILIZADO|MOVEIS|UNIFORME|UNIFORMES|BANDEJA|LACRE|PAPEL)\b/;
  const serviceCategoryPattern = /\b(SERVICO|SERVICOS|LOCACAO|ALUGUEL|FRETE|HONORARIO|HONORARIOS|CONSULTORIA)\b/;
  const materialCategoryPattern =
    /\b(MATERIAL|MATERIAIS|EQUIPAMENTO|EQUIPAMENTOS|EPI|INSUMO|INSUMOS|IMOBILIZADO|MOVEIS|UTENSILIOS|UNIFORME|UNIFORMES|BENS DE PEQUENO VALOR|BOBINA|FILME|BANDEJA|EMBALAGEM|LACRE|CARTAZ|SINALIZACAO)\b/;
  const service =
    servicePattern.test(normalized) ||
    maintenanceServicePattern.test(normalizedName) ||
    serviceCategoryPattern.test(normalizedCategory);
  const material = materialPattern.test(normalized) || materialCategoryPattern.test(normalizedCategory);
  if (service && material) {
    return {
      itemType: "MISTO" as const,
      classificationConfidence: 0.7,
      classificationSource: "DESCRIPTION_RULE",
      reviewRequired: true,
    };
  }
  if (service) {
    return {
      itemType: "SERVICO" as const,
      classificationConfidence: 0.75,
      classificationSource: "DESCRIPTION_RULE",
      reviewRequired: true,
    };
  }
  if (material) {
    return {
      itemType: "MATERIAL" as const,
      classificationConfidence: 0.7,
      classificationSource: "DESCRIPTION_RULE",
      reviewRequired: true,
    };
  }
  return {
    itemType: "MATERIAL" as const,
    classificationConfidence: 0.55,
    classificationSource: "PURCHASE_CATALOG_DEFAULT",
    reviewRequired: true,
  };
}

export function inferProductMaterialTypeLabel(input: {
  name: string;
  specification?: string | null;
  itemType: ProductItemType;
  categoryLabel?: string | null;
}) {
  if (input.itemType === "INDEFINIDO") return null;
  if (input.itemType === "SERVICO") return "Servico";
  const normalized = `${normalizeProductName(input.name)} ${normalizeProductName(input.specification)}`.trim();
  const normalizedCategory = normalizeProductName(input.categoryLabel);
  if (/\b(EPI|EQUIPAMENTO DE PROTECAO INDIVIDUAL)\b/.test(normalizedCategory)) return "EPI / Seguranca";
  if (/\b(MATERIAL DE LIMPEZA|HIGIENE|CONSERVACAO)\b/.test(normalizedCategory)) return "Limpeza e higiene";
  if (/\b(MATERIAL DE ESCRITORIO|CARTAZ|SINALIZACAO)\b/.test(normalizedCategory)) {
    return "Escritorio e sinalizacao";
  }
  if (/\b(EMBALAGEM|BANDEJA|BOBINA|FILME|LACRE)\b/.test(normalizedCategory)) return "Embalagens e consumo";
  if (/\b(UNIFORME|UNIFORMES)\b/.test(normalizedCategory)) return "Uniformes";
  if (/\b(MOVEIS|MOBILIARIO)\b/.test(normalizedCategory)) return "Mobiliario";
  if (/\b(EPI|CAPACETE|LUVA DE SEGURANCA|OCULOS DE SEGURANCA)\b/.test(normalized)) return "EPI / Seguranca";
  if (/\b(AR CONDICIONADO|REFRIGERACAO|GAS R\s?\d+|CONDENSADORA|EVAPORADORA)\b/.test(normalized)) {
    return "Refrigeracao";
  }
  if (/\b(TOMADA|CABO|LAMPADA|MOTOR ELETRICO|DISJUNTOR|CONTATOR)\b/.test(normalized)) return "Eletrico";
  if (/\b(VALVULA|MANGUEIRA|TORNEIRA|MICTORIO|ENCANAMENTO|SIFAO)\b/.test(normalized)) return "Hidraulico";
  if (/\b(LIMPEZA|HIGIENE|DETERGENTE|SABAO|DESINFETANTE)\b/.test(normalized)) return "Limpeza e higiene";
  if (/\b(COMPUTADOR|TECLADO|RADIO|MONITOR|NOTEBOOK|IMPRESSORA)\b/.test(normalized)) return "TI e comunicacao";
  if (/\b(MOBILIARIO|CADEIRA|ARMARIO|MESA|ESTANTE)\b/.test(normalized)) return "Mobiliario";
  if (/\b(INSUMOS DE MANUTENCAO|EQUIPAMENTOS DE MANUTENCAO)\b/.test(normalizedCategory)) return "Manutencao";
  return "Material geral";
}

function occurrenceIdentity(input: {
  request: ProductFluigRequestSource;
  sourceTable: ExtractedProductOccurrence["sourceTable"];
  sourceRowIndex: number;
  name: string;
  specification: string | null;
}) {
  const normalizedName = normalizeProductName(input.name);
  const generic = isGenericProductDescription(input.name, input.specification);
  const dedupeKey = generic
    ? buildIsolatedProductDedupeKey({
        fluigRequestId: input.request.fluigRequestId,
        fluigRequestRowId: input.request.fluigRequestRowId,
        sourceTable: input.sourceTable,
        sourceRowIndex: input.sourceRowIndex,
        name: input.name,
        specification: input.specification,
      })
    : buildProductDedupeKey(input.name, input.specification);
  return {
    normalizedName,
    dedupeKey,
    sku: buildProductSku(dedupeKey),
  };
}

function commonOccurrence(
  request: ProductFluigRequestSource,
  input: {
    sourceTable: ExtractedProductOccurrence["sourceTable"];
    sourceRowIndex: number;
    sourceItemNumber: string;
    name: string;
    specification: string | null;
    quantity: string | null;
    unit: string | null;
    unitPriceCents: number | null;
    sourcePayload: JsonRecord;
  }
): ExtractedProductOccurrence {
  const categoryLabel = cleanText(request.formFields.codContaFin);
  const classification = classifyProductItem({ ...input, categoryLabel });
  return {
    fluigRequestId: request.fluigRequestId,
    fluigRequestRowId: request.fluigRequestRowId || null,
    sourceTable: input.sourceTable,
    sourceRowIndex: input.sourceRowIndex,
    sourceItemNumber: input.sourceItemNumber,
    branchId: request.branchId || null,
    branchCode: cleanText(request.branchCode),
    branchLabel: cleanText(request.branchLabel),
    name: input.name,
    ...occurrenceIdentity({
      request,
      sourceTable: input.sourceTable,
      sourceRowIndex: input.sourceRowIndex,
      name: input.name,
      specification: input.specification,
    }),
    description: input.name,
    specification: input.specification,
    ...classification,
    materialTypeLabel: inferProductMaterialTypeLabel({
      name: input.name,
      specification: input.specification,
      itemType: classification.itemType,
      categoryLabel,
    }),
    categoryCode: cleanText(request.formFields.contaCentroCusto),
    categoryLabel,
    unit: input.unit,
    quantity: input.quantity,
    unitPriceCents: input.unitPriceCents,
    observedAt: request.observedAt || null,
    sourcePayload: input.sourcePayload,
  };
}

export function extractProductsFromFluigRequest(
  request: ProductFluigRequestSource
): ExtractedProductOccurrence[] {
  const fields = request.formFields || {};
  const primaryIndexes = childIndexes(fields, "solProdutoServico");
  const secondary = secondaryRows(fields);

  if (!primaryIndexes.length) {
    return secondary.map((row) =>
      commonOccurrence(request, {
        sourceTable: "tabelaProdutos",
        sourceRowIndex: row.index,
        sourceItemNumber: row.itemNumber,
        name: row.name,
        specification: row.specification,
        quantity: row.quantity,
        unit: row.unit,
        unitPriceCents: row.unitPriceCents,
        sourcePayload: { secondary: row.payload },
      })
    );
  }

  const secondaryByNumber = new Map<string, SecondaryRow>();
  const secondaryByIndex = new Map<number, SecondaryRow>();
  for (const row of secondary) {
    if (!secondaryByNumber.has(row.itemNumber)) secondaryByNumber.set(row.itemNumber, row);
    secondaryByIndex.set(row.index, row);
  }

  return primaryIndexes.flatMap((index) => {
    const name = field(fields, "solProdutoServico", index);
    if (!name) return [];
    const itemNumber = field(fields, "solnumProdutoPedido", index) || String(index);
    const complement = secondaryByNumber.get(itemNumber) || secondaryByIndex.get(index) || null;
    const specification = field(fields, "SolEspecTecnica", index);
    const primaryQuantity = parseFluigDecimal(field(fields, "solQtdProduto", index));
    const primaryUnit = field(fields, "solUnMedidaProduto", index);
    const primaryPayload = rowPayload(
      fields,
      [
        "solProdutoServico",
        "SolEspecTecnica",
        "solQtdProduto",
        "solUnMedidaProduto",
        "solnumProdutoPedido",
        "solRowTabelaProdutos",
      ],
      index
    );

    return [
      commonOccurrence(request, {
        sourceTable: "solTabelaProdutos",
        sourceRowIndex: index,
        sourceItemNumber: itemNumber,
        name,
        specification,
        quantity: primaryQuantity || complement?.quantity || null,
        unit: primaryUnit || complement?.unit || null,
        unitPriceCents: complement?.unitPriceCents || null,
        sourcePayload: {
          primary: primaryPayload,
          secondaryComplement: complement?.payload || null,
          secondaryRowIndex: complement?.index || null,
        },
      }),
    ];
  });
}

export function formFieldsFromProductPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const formFields = (payload as JsonRecord).formFields;
  return formFields && typeof formFields === "object" && !Array.isArray(formFields)
    ? (formFields as Record<string, unknown>)
    : {};
}
