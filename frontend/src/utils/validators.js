export function isValidCpf(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;

  for (let position = 9; position <= 10; position += 1) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += Number(digits[index]) * (position + 1 - index);
    }
    const remainder = sum % 11;
    const expected = remainder < 2 ? 0 : 11 - remainder;
    if (Number(digits[position]) !== expected) return false;
  }
  return true;
}

export function isValidPassword(value) {
  return /^[A-Za-z0-9]{6}$/.test(String(value ?? ""));
}

export function trimmedLength(value) {
  return String(value ?? "").trim().length;
}

export function isValidProductDescription(value) {
  return trimmedLength(value) >= 3 && trimmedLength(value) <= 250;
}

export function isValidUnit(value) {
  return trimmedLength(value) >= 1 && trimmedLength(value) <= 10;
}

export function isValidNumeric12_3(value, allowZero = true) {
  const number = Number(value);
  return Number.isFinite(number)
    && number <= 999999999.999
    && number >= (allowZero ? 0 : 0.001)
    && Math.round(number * 1000) === number * 1000;
}
