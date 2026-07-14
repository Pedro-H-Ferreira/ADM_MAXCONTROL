import { z } from "zod";

const nullableText = (maximum = 500) => z.string().trim().max(maximum).nullable().optional();
const nullableId = z.string().uuid().nullable().optional();
const nonNegativeInteger = z.coerce.number().int().min(0);
const nonNegativeNumber = z.coerce.number().finite().min(0);
const positiveNumber = z.coerce.number().finite().positive();

export const maintenanceAssetSchema = z.object({
  branchId: z.string().uuid("Filial invalida."),
  internalCode: z.string().trim().min(1, "Codigo interno e obrigatorio.").max(80),
  assetTag: nullableText(120),
  name: z.string().trim().min(1, "Nome do ativo e obrigatorio.").max(180),
  categoryId: nullableId,
  subcategory: nullableText(120),
  brand: nullableText(120),
  model: nullableText(160),
  serialNumber: nullableText(160),
  description: nullableText(2_000),
  area: nullableText(160),
  physicalLocation: nullableText(240),
  costCenterCode: nullableText(80),
  costCenterLabel: nullableText(240),
  responsibleUserId: nullableId,
  responsibleName: nullableText(180),
  status: z.enum(["ATIVO", "EM_MANUTENCAO", "PARADO", "RESERVA", "BAIXADO", "EM_GARANTIA", "AGUARDANDO_PECA", "AGUARDANDO_TERCEIRO"]).optional(),
  criticality: z.enum(["CRITICA", "ALTA", "MEDIA", "BAIXA"]).optional(),
  acquiredAt: nullableText(64),
  acquisitionValueCents: nonNegativeInteger.optional(),
  supplierId: nullableId,
  invoiceNumber: nullableText(120),
  commissionedAt: nullableText(64),
  warrantyMonths: nonNegativeInteger.nullable().optional(),
  warrantyEndsAt: nullableText(64),
  usefulLifeMonths: nonNegativeInteger.nullable().optional(),
  qrCode: nullableText(240),
  barcode: nullableText(240),
  meterType: z.enum(["HOURS", "KM", "CYCLES"]).nullable().optional(),
  notes: nullableText(4_000),
}).strict();

export const maintenanceAssetUpdateSchema = maintenanceAssetSchema.partial().strict();

export const maintenanceAssetActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("TRANSFER"),
    branchId: z.string().uuid("Filial de destino invalida."),
    area: nullableText(160),
    physicalLocation: nullableText(240),
    responsibleUserId: nullableId,
    reason: z.string().trim().min(1, "Informe o motivo da transferencia.").max(1_000),
  }).strict(),
  z.object({
    action: z.literal("RETIRE"),
    reason: z.string().trim().min(1, "Informe o motivo da baixa.").max(1_000),
  }).strict(),
  z.object({
    action: z.literal("METER"),
    meterType: z.enum(["HOURS", "KM", "CYCLES"]),
    reading: nonNegativeNumber,
    readAt: nullableText(64),
    notes: nullableText(1_000),
  }).strict(),
]);

export const maintenanceMaterialSchema = z.object({
  code: z.string().trim().min(1, "Codigo do material e obrigatorio.").max(80),
  sku: nullableText(120),
  barcode: nullableText(160),
  name: z.string().trim().min(1, "Nome do material e obrigatorio.").max(180),
  description: nullableText(2_000),
  category: nullableText(120),
  unit: z.string().trim().min(1).max(20).optional(),
  brand: nullableText(120),
  model: nullableText(160),
  primarySupplierId: nullableId,
  averageCostCents: nonNegativeInteger.optional(),
  lastCostCents: nonNegativeInteger.optional(),
  minimumStock: nonNegativeNumber.optional(),
  maximumStock: nonNegativeNumber.nullable().optional(),
  reorderPoint: nonNegativeNumber.optional(),
  leadTimeDays: nonNegativeInteger.optional(),
  active: z.boolean().optional(),
  lotControl: z.boolean().optional(),
  expiryControl: z.boolean().optional(),
  serialControl: z.boolean().optional(),
}).strict();

export const maintenanceMaterialUpdateSchema = maintenanceMaterialSchema.partial().strict();

const stockMovementTypes = [
  "PURCHASE_IN", "MANUAL_IN", "RETURN_FROM_ORDER", "POSITIVE_ADJUSTMENT", "INVENTORY_IN", "REVERSAL_IN",
  "WORK_ORDER_OUT", "NEGATIVE_ADJUSTMENT", "LOSS", "DAMAGE", "INVENTORY_OUT", "WRITE_OFF", "REVERSAL_OUT", "TRANSFER",
] as const;

export const maintenanceStockActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("MOVE"),
    movementType: z.enum(stockMovementTypes),
    materialId: z.string().uuid(),
    quantity: positiveNumber,
    fromLocationId: nullableId,
    toLocationId: nullableId,
    workOrderId: nullableId,
    assetId: nullableId,
    inventoryCountId: nullableId,
    unitCostCents: nonNegativeInteger.optional(),
    reason: z.string().trim().min(1, "Informe o motivo da movimentacao.").max(1_000),
    documentNumber: nullableText(120),
    notes: nullableText(2_000),
  }).strict(),
  z.object({
    action: z.literal("RESERVE"),
    orderId: z.string().uuid(),
    materialId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: positiveNumber,
  }).strict(),
  z.object({
    action: z.literal("CONSUME"),
    reservationId: z.string().uuid(),
    quantity: positiveNumber,
    unitCostCents: nonNegativeInteger.optional(),
  }).strict(),
  z.object({
    action: z.literal("RELEASE"),
    reservationId: z.string().uuid(),
    quantity: positiveNumber.nullable().optional(),
    reason: z.string().trim().min(1, "Informe o motivo da liberacao.").max(1_000),
  }).strict(),
  z.object({
    action: z.literal("RETURN_CONSUMPTION"),
    orderMaterialId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: positiveNumber,
    reason: z.string().trim().min(1, "Informe o motivo da devolucao.").max(1_000),
  }).strict(),
]);

const preventiveTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: nullableText(1_000),
  expectedMinutes: nonNegativeInteger.optional(),
  required: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
}).strict();

const preventiveMaterialSchema = z.object({
  materialId: z.string().uuid(),
  quantity: positiveNumber,
  notes: nullableText(1_000),
}).strict();

export const maintenancePreventivePlanSchema = z.object({
  code: z.string().trim().min(1, "Codigo do plano e obrigatorio.").max(80),
  name: z.string().trim().min(1, "Nome do plano e obrigatorio.").max(180),
  description: nullableText(2_000),
  branchId: nullableId,
  checklistTemplateId: nullableId,
  recurrenceValue: positiveNumber,
  recurrenceUnit: z.enum(["DAYS", "WEEKS", "MONTHS", "YEARS", "HOURS", "KM", "CYCLES"]),
  expectedMinutes: nonNegativeInteger.nullable().optional(),
  responsibleUserId: nullableId,
  responsibleName: nullableText(180),
  serviceProviderId: nullableId,
  priority: z.enum(["CRITICA", "ALTA", "MEDIA", "BAIXA"]).optional(),
  toleranceBefore: nonNegativeNumber.optional(),
  toleranceAfter: nonNegativeNumber.optional(),
  autoGenerateOrder: z.boolean().optional(),
  generationLeadDays: nonNegativeInteger.optional(),
  nextDueAt: nullableText(64),
  nextMeterValue: nonNegativeNumber.nullable().optional(),
  notifyBeforeDays: nonNegativeInteger.optional(),
  evidenceRequired: z.boolean().optional(),
  completionApprovalRequired: z.boolean().optional(),
  assetIds: z.array(z.string().uuid()).min(1, "Vincule pelo menos um ativo."),
  tasks: z.array(preventiveTaskSchema).max(100).optional(),
  materials: z.array(preventiveMaterialSchema).max(100).optional(),
}).strict();

export const maintenancePreventivePlanUpdateSchema = maintenancePreventivePlanSchema.extend({ active: z.boolean().optional() }).strict();

export const maintenanceInventorySchema = z.object({
  branchId: z.string().uuid("Filial invalida."),
  inventoryType: z.enum(["MATERIAL", "ASSET"]),
  warehouseId: nullableId,
  area: nullableText(160),
  notes: nullableText(2_000),
}).strict().superRefine((value, context) => {
  if (value.inventoryType === "MATERIAL" && !value.warehouseId) {
    context.addIssue({ code: "custom", path: ["warehouseId"], message: "Almoxarifado e obrigatorio." });
  }
});

export const maintenanceInventoryActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("COUNT_ITEM"),
    itemId: z.string().uuid(),
    round: z.coerce.number().int().min(1).max(2).optional(),
    quantity: nonNegativeNumber.optional(),
    found: z.boolean().optional(),
    foundLocation: nullableText(240),
    condition: nullableText(120),
    photoPath: nullableText(1_000),
    justification: nullableText(1_000),
  }).strict(),
  z.object({ action: z.literal("SUBMIT") }).strict(),
  z.object({ action: z.literal("APPROVE") }).strict(),
]);

export const maintenanceProviderSchema = z.object({
  supplierId: nullableId,
  name: z.string().trim().min(1, "Nome do prestador e obrigatorio.").max(180),
  taxId: nullableText(32),
  contactName: nullableText(180),
  email: z.string().trim().email("E-mail invalido.").max(240).nullable().optional().or(z.literal("")),
  phone: nullableText(40),
  specialties: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  slaMinutes: nonNegativeInteger.nullable().optional(),
  active: z.boolean().optional(),
}).strict();

export const maintenanceProviderUpdateSchema = maintenanceProviderSchema.partial().strict();

export const maintenanceWarehouseUpdateSchema = z.object({
  warehouseId: z.string().uuid(),
  name: z.string().trim().min(1).max(180).optional(),
  active: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  requireApprovalForAdjustment: z.boolean().optional(),
}).strict();
