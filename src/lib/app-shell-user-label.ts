export function formatAppShellUserLabel(
  name: string,
  branchCodes: string[],
  hasAllBranches: boolean,
) {
  if (hasAllBranches) return "Todas Filiais";

  const normalizedName = name.trim().toLocaleUpperCase("pt-BR");
  const normalizedCodes = Array.from(
    new Set(branchCodes.map((code) => code.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));

  return [normalizedName, ...normalizedCodes].filter(Boolean).join(" - ");
}
