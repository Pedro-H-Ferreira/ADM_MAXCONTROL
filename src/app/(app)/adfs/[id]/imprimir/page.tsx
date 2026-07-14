import { notFound } from "next/navigation";
import { AdfPrintDocument } from "@/components/pages/adf-print-document";
import { getExpenseAuthorization } from "@/lib/db/expense-authorization-repository";
import { resolveCurrentAppUserForPage } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function ExpenseAuthorizationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveCurrentAppUserForPage();
  const { id } = await params;
  const authorization = await getExpenseAuthorization(actor, id);
  if (!authorization) notFound();
  return <AdfPrintDocument authorization={authorization} />;
}
