import { describe, expect, it } from "vitest";
import {
  isValidCpf,
  isValidNumeric12_3,
  isValidPassword,
  isValidProductDescription,
  trimmedLength
} from "./validators.js";

describe("validators", () => {
  it("checks CPF digits, checksum, and repeated digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("123")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
  });

  it("accepts only six ASCII alphanumeric password characters", () => {
    expect(isValidPassword("Ab1234")).toBe(true);
    expect(isValidPassword("123")).toBe(false);
    expect(isValidPassword("Ab12!4")).toBe(false);
  });

  it("counts names after trimming and validates numeric(12,3)", () => {
    expect(trimmedLength("  Ana  ")).toBe(3);
    expect(isValidNumeric12_3("0")).toBe(true);
    expect(isValidNumeric12_3("1000000000")).toBe(false);
    expect(isValidNumeric12_3("1.2345")).toBe(false);
    expect(isValidNumeric12_3("0", false)).toBe(false);
  });

  it("validates product descriptions after trimming", () => {
    expect(isValidProductDescription("  abc  ")).toBe(true);
    expect(isValidProductDescription(" a ")).toBe(false);
    expect(isValidProductDescription(` ${"a".repeat(250)} `)).toBe(true);
    expect(isValidProductDescription("a".repeat(251))).toBe(false);
  });
});
