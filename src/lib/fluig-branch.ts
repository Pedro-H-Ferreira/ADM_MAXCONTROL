function cleanText(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text || text === "-" || /^\[object\b/i.test(text)) return null;
  return text;
}

function codeFromValue(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d{3,6}$/.test(text)) return text;

  const internalSuffix = text.match(/-(\d{3,6})$/);
  if (internalSuffix) return internalSuffix[1];

  const matches = Array.from(text.matchAll(/(\d{3,6})\s*-\s*(?=[^\d\s])/g));
  return matches.at(-1)?.[1] || null;
}

export function normalizeFluigBranch(input: {
  label?: unknown;
  explicitCode?: unknown;
}) {
  const rawLabel = cleanText(input.label);
  const code = codeFromValue(input.explicitCode) || codeFromValue(rawLabel);
  if (!code) return { code: null, label: null };

  if (!rawLabel) return { code, label: code };

  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const internalPrefix = new RegExp(`^\\d{7,}-${escapedCode}\\s*-\\s*`, "i");
  const normalizedLabel = rawLabel.replace(internalPrefix, `${code} - `);

  return {
    code,
    label: normalizedLabel || code,
  };
}
