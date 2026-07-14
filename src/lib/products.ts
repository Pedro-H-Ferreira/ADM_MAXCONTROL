import { createHash } from "node:crypto";

export const PRODUCT_STATUSES = ["ACTIVE", "REVIEW", "INACTIVE"] as const;
export const PRODUCT_ITEM_TYPES = ["MATERIAL", "SERVICO", "MISTO", "INDEFINIDO"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type ProductItemType = (typeof PRODUCT_ITEM_TYPES)[number];

export type JsonRecord = Record<string, unknown>;

export const ORDER_OBSERVATION_FIELD = "observacaoPedido";

export type ProductOccurrenceSourceTable =
  | "solTabelaProdutos"
  | "tabelaProdutos"
  | typeof ORDER_OBSERVATION_FIELD;

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
  sourceTable: ProductOccurrenceSourceTable;
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

type ParsedObservationItem = {
  lineIndex: number;
  segmentIndex: number;
  rawLine: string;
  name: string;
  specification: string | null;
  quantity: string | null;
  unit: string | null;
  extractionMethod: "BULLET" | "LEADING_QUANTITY" | "TRAILING_QUANTITY" | "NARRATIVE";
  extractionConfidence: number;
};

const OBSERVATION_UNIT_PATTERN = [
  "UNIDADES?",
  "UNID(?:ADES?)?\\.?",
  "UNDS?\\.?",
  "UN\\.?",
  "PCTS?\\.?",
  "PACOTES?",
  "P[ÇC]S?\\.?",
  "PE[ÇC]AS?",
  "CXS?\\.?",
  "CAIXAS?",
  "ROLOS?",
  "KGS?\\.?",
  "QUILOS?",
  "LTS?\\.?",
  "LITROS?",
  "MTS?\\.?",
  "METROS?",
  "PARES?",
  "KITS?",
  "MILHEIROS?",
].join("|");

const observationUnitAliases: Array<[RegExp, string]> = [
  [/^(?:UNIDADES?|UNID(?:ADES?)?|UNDS?|UN|P[ÇC]S?|PE[ÇC]AS?)\.?$/i, "UN"],
  [/^(?:PCTS?|PACOTES?)\.?$/i, "PCT"],
  [/^(?:CXS?|CAIXAS?)\.?$/i, "CX"],
  [/^ROLOS?$/i, "ROLO"],
  [/^(?:KGS?|QUILOS?)\.?$/i, "KG"],
  [/^(?:LTS?|LITROS?)\.?$/i, "L"],
  [/^(?:MTS?|METROS?)\.?$/i, "M"],
  [/^PARES?$/i, "PAR"],
  [/^KITS?$/i, "KIT"],
  [/^MILHEIROS?$/i, "MIL"],
];

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

function parseObservationQuantity(value: string) {
  const compact = value.replace(/\s/g, "");
  const normalized = /^\d{1,3}(?:[.,]\d{3})+$/.test(compact)
    ? compact.replace(/[.,]/g, "")
    : compact.includes(",")
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity >= 0 ? String(quantity) : null;
}

function normalizeObservationUnit(value: string) {
  const unit = value.trim();
  return observationUnitAliases.find(([pattern]) => pattern.test(unit))?.[1] || null;
}

function observationUnitFromSpecification(value: string | null) {
  if (!value) return null;
  const match = value.match(new RegExp(`^(${OBSERVATION_UNIT_PATTERN})\\b`, "i"));
  return match ? normalizeObservationUnit(match[1]) : null;
}

function splitObservationSpecification(value: string) {
  const cleaned = value
    .replace(/^[\s\-–—:]+/, "")
    .replace(/[\s.;,\-–—:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const parenthetical = cleaned.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!parenthetical?.[1] || !parenthetical[2]?.trim()) {
    return { name: cleaned, specification: null };
  }
  return {
    name: parenthetical[1].trim(),
    specification: parenthetical[2].replace(/\s+/g, " ").trim(),
  };
}

function isObservationNote(value: string) {
  if (/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(value.trim())) return true;
  const normalized = normalizeProductName(value);
  if (!normalized) return true;
  if (/^(OBS|OBSERVACAO|OBSERVACOES|ATENCAO|URGENTE|JUSTIFICATIVA|MOTIVO|ENTREGA|PRAZO)\b/.test(normalized)) {
    return true;
  }
  if (/^(LISTA DE PEDIDOS|LISTA DE MATERIAIS|SEGUE ANEXO|PEDIDO SEGUE ANEXO|TESTE DE FLUXO)\b/.test(normalized)) {
    return true;
  }
  if (/^(MODELO|IMAGEM|FOTO)\b.*\bANEX/.test(normalized)) return true;
  if (/^(COMPRA DE NOVAS PECAS|NOVAS PECAS|PECAS EM ANEXO)$/.test(normalized)) return true;
  if (/^\d+\s*V\b/.test(normalized)) return true;
  if (/^(PRECO|VALOR) (UNITARIO|TOTAL)\b/.test(normalized)) return true;
  return /\b(MES|MENSALIDADE)\s+\d{1,2}\b/.test(normalized) && normalized.length < 45;
}

function narrativeProductName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > 220) return null;
  const patterns = [
    /^(?:COMPRA|AQUISI[ÇC][AÃ]O)\s+(?:DE|DO|DA|DOS|DAS)\s+(.+)$/i,
    /^(?:POR GENTILEZA\s+)?SOLICITO(?:\s+OR[ÇC]AMENTO|\s+COTA[ÇC][AÃ]O)?(?:\s+PARA)?(?:\s+A)?\s+COMPRA\s+(?:DE|DO|DA|DOS|DAS)\s+(.+)$/i,
    /^(?:POR GENTILEZA\s+)?SOLICITO\s+COTA[ÇC][AÃ]O\s+(?:DE|DO|DA|DOS|DAS)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const candidate = normalized.match(pattern)?.[1]?.trim();
    if (candidate && !isObservationNote(candidate)) return candidate;
  }
  return null;
}

function parseObservationLine(
  rawLine: string,
  lineIndex: number,
  segmentIndex: number
): ParsedObservationItem | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  const bulletMatch = trimmed.match(/^[*•▪◦-]\s*/u);
  const explicitBullet = Boolean(bulletMatch);
  const line = trimmed.slice(bulletMatch?.[0].length || 0).trim();
  if (!line || isObservationNote(line)) return null;

  const thousandUnits = line.match(
    new RegExp(`^(\\d[\\d.,]*)\\s+MIL\\s+(UNIDADES?|UNID(?:ADES?)?|UNDS?|UN)\\.?\\s*(?:[-–—:]\\s*)?(.+)$`, "i")
  );
  if (thousandUnits) {
    const baseQuantity = parseObservationQuantity(thousandUnits[1]);
    const parsed = splitObservationSpecification(thousandUnits[3]);
    if (!baseQuantity || !parsed.name || isObservationNote(parsed.name)) return null;
    return {
      lineIndex,
      segmentIndex,
      rawLine: trimmed,
      ...parsed,
      quantity: String(Number(baseQuantity) * 1000),
      unit: "UN",
      extractionMethod: "LEADING_QUANTITY",
      extractionConfidence: 0.95,
    };
  }

  const leadingQuantity = line.match(
    new RegExp(`^(\\d[\\d.,]*)\\s*(${OBSERVATION_UNIT_PATTERN})\\s*(?:DE\\s+)?(?:[-–—:]\\s*)?(.+)$`, "i")
  );
  if (leadingQuantity) {
    const quantity = parseObservationQuantity(leadingQuantity[1]);
    const unit = normalizeObservationUnit(leadingQuantity[2]);
    const parsed = splitObservationSpecification(leadingQuantity[3]);
    if (!quantity || !unit || !parsed.name || isObservationNote(parsed.name)) return null;
    return {
      lineIndex,
      segmentIndex,
      rawLine: trimmed,
      ...parsed,
      quantity,
      unit,
      extractionMethod: "LEADING_QUANTITY",
      extractionConfidence: 0.95,
    };
  }

  const trailingThousandUnits = line.match(
    /^(.*?)\s+(\d[\d.,]*)\s+MIL\s+UNIDADES?(?:\s+MENSAIS?)?\.?$/i
  );
  if (trailingThousandUnits) {
    const baseQuantity = parseObservationQuantity(trailingThousandUnits[2]);
    const parsed = splitObservationSpecification(trailingThousandUnits[1]);
    if (!baseQuantity || !parsed.name || isObservationNote(parsed.name)) return null;
    return {
      lineIndex,
      segmentIndex,
      rawLine: trimmed,
      ...parsed,
      quantity: String(Number(baseQuantity) * 1000),
      unit: "UN",
      extractionMethod: "TRAILING_QUANTITY",
      extractionConfidence: 0.85,
    };
  }

  const trailingQuantity = line.match(
    new RegExp(`^(.*?)\\s+(\\d[\\d.,]*)\\s*(${OBSERVATION_UNIT_PATTERN})(?:\\s+MENSAIS?)?\\.?$`, "i")
  );
  if (trailingQuantity) {
    const quantity = parseObservationQuantity(trailingQuantity[2]);
    const unit = normalizeObservationUnit(trailingQuantity[3]);
    const parsed = splitObservationSpecification(trailingQuantity[1]);
    if (!quantity || !unit || !parsed.name || isObservationNote(parsed.name)) return null;
    return {
      lineIndex,
      segmentIndex,
      rawLine: trimmed,
      ...parsed,
      quantity,
      unit,
      extractionMethod: "TRAILING_QUANTITY",
      extractionConfidence: 0.85,
    };
  }

  const leadingQuantityWithoutUnit = line.match(/^(\d[\d.,]*)\s+(?:[-–—:]\s*)?(.+)$/);
  if (explicitBullet && leadingQuantityWithoutUnit) {
    const quantity = parseObservationQuantity(leadingQuantityWithoutUnit[1]);
    const parsed = splitObservationSpecification(leadingQuantityWithoutUnit[2]);
    if (!quantity || !parsed.name || isObservationNote(parsed.name)) return null;
    return {
      lineIndex,
      segmentIndex,
      rawLine: trimmed,
      ...parsed,
      quantity,
      unit: observationUnitFromSpecification(parsed.specification),
      extractionMethod: "LEADING_QUANTITY",
      extractionConfidence: 0.82,
    };
  }

  if (explicitBullet) {
    const parsed = splitObservationSpecification(line);
    if (!parsed.name || isObservationNote(parsed.name)) return null;
    return {
      lineIndex,
      segmentIndex,
      rawLine: trimmed,
      ...parsed,
      quantity: null,
      unit: null,
      extractionMethod: "BULLET",
      extractionConfidence: 0.72,
    };
  }

  return null;
}

function observationLineSegments(rawLine: string) {
  const trimmed = rawLine.trim();
  if (!trimmed) return [];
  const bullet = trimmed.match(/^[*•▪◦-]\s*/u)?.[0] || "";
  const content = trimmed.slice(bullet.length).trim();
  const separator = new RegExp(
    `\\s+(?:E|;|,)\\s+(?=\\d[\\d.,]*(?:\\s*(?:${OBSERVATION_UNIT_PATTERN}))?\\b)`,
    "gi"
  );
  return content
    .split(separator)
    .map((segment, segmentIndex) => ({
      segment: `${bullet || (segmentIndex > 0 ? "* " : "")}${segment.trim()}`,
      segmentIndex,
    }))
    .filter((item) => item.segment.trim());
}

export function parseOrderObservationProducts(value: unknown): ParsedObservationItem[] {
  const lines = String(value ?? "").split(/\r?\n/);
  const explicitItems = lines
    .flatMap((line, lineIndex) =>
      narrativeProductName(line)
        ? []
        : observationLineSegments(line).map(({ segment, segmentIndex }) =>
        parseObservationLine(segment, lineIndex, segmentIndex)
      )
    )
    .filter((item): item is ParsedObservationItem => Boolean(item));
  if (explicitItems.length) return explicitItems;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const candidate = narrativeProductName(lines[lineIndex]);
    if (!candidate) continue;
    const parsed = observationLineSegments(`* ${candidate}`)
      .map(({ segment, segmentIndex }) => parseObservationLine(segment, lineIndex, segmentIndex))
      .filter((item): item is ParsedObservationItem => Boolean(item))
      .map((item) => ({
        ...item,
        rawLine: lines[lineIndex].trim(),
        extractionMethod: "NARRATIVE" as const,
        extractionConfidence: 0.55,
      }));
    if (parsed.length) return parsed;
  }
  return [];
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

function observationField(fields: Record<string, unknown>) {
  const key = Object.keys(fields).find(
    (candidate) => normalizeProductName(candidate) === normalizeProductName(ORDER_OBSERVATION_FIELD)
  );
  return key ? { key, value: fields[key] } : null;
}

function observationOccurrences(request: ProductFluigRequestSource) {
  const observation = observationField(request.formFields || {});
  if (!observation) return [];
  return parseOrderObservationProducts(observation.value).map((item) =>
    commonOccurrence(request, {
      sourceTable: ORDER_OBSERVATION_FIELD,
      sourceRowIndex: item.lineIndex * 1000 + item.segmentIndex,
      sourceItemNumber: `OBS-${item.lineIndex + 1}.${item.segmentIndex + 1}`,
      name: item.name,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: null,
      sourcePayload: {
        fieldName: observation.key,
        originalLine: item.rawLine,
        lineNumber: item.lineIndex + 1,
        segmentNumber: item.segmentIndex + 1,
        extractionMethod: item.extractionMethod,
        extractionConfidence: item.extractionConfidence,
        parserVersion: "order-observation-v1",
      },
    })
  );
}

export function extractProductsFromFluigRequest(
  request: ProductFluigRequestSource
): ExtractedProductOccurrence[] {
  const fields = request.formFields || {};
  const primaryIndexes = childIndexes(fields, "solProdutoServico");
  const secondary = secondaryRows(fields);

  const structuredOccurrences = !primaryIndexes.length
    ? secondary.map((row) =>
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
    )
    : (() => {
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
      })();

  const structuredDedupeKeys = new Set(structuredOccurrences.map((item) => item.dedupeKey));
  const parsedObservationOccurrences = observationOccurrences(request).filter(
    (item) => !structuredDedupeKeys.has(item.dedupeKey)
  );
  return [...structuredOccurrences, ...parsedObservationOccurrences];
}

export function formFieldsFromProductPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const formFields = (payload as JsonRecord).formFields;
  return formFields && typeof formFields === "object" && !Array.isArray(formFields)
    ? (formFields as Record<string, unknown>)
    : {};
}
