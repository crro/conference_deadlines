// Turns user input into an E.164 number and checks it against the dialing policy.

export function parsePrefixList(value) {
  return (value || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('+') ? p : `+${p}`));
}

export function normalizeNumber(input, defaultCountryCode = '1') {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);

  if (!hasPlus) {
    // NANP convenience: "1 555 123 4567" already includes the country code.
    if (defaultCountryCode === '1' && digits.length === 11 && digits.startsWith('1')) {
      digits = digits.slice(1);
    }
    // Most other countries write national numbers with a trunk 0 that is dropped after the country code.
    if (defaultCountryCode !== '1' && digits.startsWith('0')) digits = digits.slice(1);
    digits = `${defaultCountryCode}${digits}`;
  }

  // E.164 allows at most 15 digits; anything under 8 is not a dialable number.
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

export function checkDestination(number, { allowed, blocked }) {
  if (!number) return { ok: false, reason: 'That does not look like a valid phone number.' };
  if (blocked.some((p) => number.startsWith(p))) {
    return { ok: false, reason: 'Calls to this number range are blocked.' };
  }
  if (allowed.length && !allowed.some((p) => number.startsWith(p))) {
    return { ok: false, reason: `Only numbers starting with ${allowed.join(', ')} can be called.` };
  }
  return { ok: true };
}
