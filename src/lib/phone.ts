export function normalizePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.startsWith("98") && digits.length === 12) {
    return "+" + digits;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return "+98" + digits.slice(1);
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return "+98" + digits;
  }

  return null;
}

export function isValidIranianPhone(phone: string): boolean {
  return /^\+98[0-9]{10}$/.test(phone);
}
