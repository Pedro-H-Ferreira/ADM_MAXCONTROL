import type { FluigLaunchTemplate } from "@/lib/fluig-data";

function digits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function templateTimestamp(template: FluigLaunchTemplate) {
  const timestamp = template.lastSeenAt ? Date.parse(template.lastSeenAt) : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function supplierTemplates(
  templates: FluigLaunchTemplate[],
  supplier: { cnpj?: string | null; name?: string | null }
) {
  const supplierCnpj = digits(supplier.cnpj);
  const supplierName = normalize(supplier.name);

  return templates
    .filter((template) => {
      if (supplierCnpj) return digits(template.supplierCnpj) === supplierCnpj;
      return Boolean(supplierName && normalize(template.supplierName) === supplierName);
    })
    .sort((left, right) => templateTimestamp(right) - templateTimestamp(left));
}

export function selectSupplierTemplate(
  templates: FluigLaunchTemplate[],
  supplier: { cnpj?: string | null; name?: string | null }
) {
  const matches = supplierTemplates(templates, supplier);
  const branches = new Map<string, { code: string | null; label: string | null }>();

  for (const template of matches) {
    const code = template.branchCode?.trim() || null;
    const label = template.branchLabel?.trim() || null;
    const key = code || normalize(label);
    if (key && !branches.has(key)) branches.set(key, { code, label });
  }

  return {
    template: matches[0] || null,
    automaticBranch: branches.size === 1 ? [...branches.values()][0] : null,
    branchCount: branches.size,
  };
}
