export function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatCnpj(value: unknown) {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function isValidCnpj(value: unknown) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcDigit = (base: string, weights: number[]) => {
    const sum = weights.reduce((acc, weight, index) => acc + Number(base[index]) * weight, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

export function normalizeCnpj(value: unknown) {
  const digits = onlyDigits(value);
  return digits.length ? digits : null;
}

export function canonicalHistoricalCnpj(value: unknown) {
  const digits = onlyDigits(value);
  if (isValidCnpj(digits)) return digits;
  if (digits.length >= 8 && digits.length < 14) {
    const padded = digits.padStart(14, "0");
    if (isValidCnpj(padded)) return padded;
  }
  return null;
}
