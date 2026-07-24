import { z } from "zod";
import { expenseAuthorizationStatuses } from "@/lib/expense-authorization";

const nullableText = z.string().trim().max(5000).nullable().optional();
const shortNullableText = z.string().trim().max(500).nullable().optional();
const nonnegativeMoney = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional();

export const expenseAuthorizationUpdateSchema = z.object({
  module: z.enum(["pagamentos", "compras"]).optional(),
  status: z.enum(expenseAuthorizationStatuses).optional(),
  issueDate: z.iso.date().optional(),
  invoiceNumber: shortNullableText,
  invoiceDueDate: z.iso.date().nullable().optional(),
  expenseType: nullableText,
  description: z.string().trim().min(1).max(5000).optional(),
  expenseAccount: nullableText,
  financialAccount: nullableText,
  costCenter: nullableText,
  branchId: z.string().uuid().nullable().optional(),
  branchCode: shortNullableText,
  branchLabel: shortNullableText,
  supplierName: nullableText,
  supplierTaxId: shortNullableText,
  amountCents: nonnegativeMoney,
  amountWords: nullableText,
  beneficiaryCategory: shortNullableText,
  beneficiaryName: nullableText,
  beneficiaryTaxId: shortNullableText,
  beneficiaryPhone: shortNullableText,
  paymentMethod: shortNullableText,
  bankName: shortNullableText,
  bankOperation: shortNullableText,
  bankAgency: shortNullableText,
  bankAccount: shortNullableText,
  pixKey: shortNullableText,
  requesterName: shortNullableText,
  requesterRole: shortNullableText,
  budgetPlannedCents: nonnegativeMoney,
  budgetRealizedCents: nonnegativeMoney,
  budgetDeviationCents: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  budgetDeviationPercent: z.number().min(-999999).max(999999).nullable().optional(),
  additionalInfo: nullableText,
  fluigRequestId: shortNullableText,
  physicalLocation: shortNullableText,
  deliveredTo: shortNullableText,
});

export const expenseAuthorizationCreateSchema = expenseAuthorizationUpdateSchema
  .omit({ status: true })
  .extend({
    module: z.enum(["pagamentos", "compras"]),
    issueDate: z.iso.date(),
    description: z.string().trim().min(1, "Informe o objetivo e a justificativa da ADF.").max(5000),
    creationSource: z.enum(["MANUAL", "DOCUMENTO_FISCAL"]),
    sourceDocument: z
      .object({
        name: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(150),
        sourceType: z.enum(["pdf", "xml"]),
        warnings: z.array(z.string().trim().max(1000)).max(20).optional(),
      })
      .nullable()
      .optional(),
  });
