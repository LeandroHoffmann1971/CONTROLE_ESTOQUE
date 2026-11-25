import { describe, expect, it } from "vitest";
import {
  getMovementDateRangeErrors,
  isMovementDateRangeWithinSupportedYears
} from "./movementDateRange.js";

describe("movement date range", () => {
  it("accepts empty dates and the inclusive year boundaries", () => {
    expect(isMovementDateRangeWithinSupportedYears({ startDate: "", endDate: "" })).toBe(true);
    expect(isMovementDateRangeWithinSupportedYears({
      startDate: "2000-01-01",
      endDate: "2100-12-31"
    })).toBe(true);
  });

  it("rejects dates outside the supported years", () => {
    expect(isMovementDateRangeWithinSupportedYears({
      startDate: "1999-12-31",
      endDate: ""
    })).toBe(false);
    expect(isMovementDateRangeWithinSupportedYears({
      startDate: "",
      endDate: "2101-01-01"
    })).toBe(false);
  });

  it("requires both dates and reports the missing fields independently", () => {
    expect(getMovementDateRangeErrors({ startDate: "", endDate: "" }, ["startDate", "endDate"])).toEqual({
      startDate: "Informe a Data de Início.",
      endDate: "Informe a Data de Término."
    });
  });

  it("accepts the inclusive supported date boundaries", () => {
    expect(getMovementDateRangeErrors({
      startDate: "2000-01-01",
      endDate: "2100-12-31"
    }, ["startDate", "endDate"])).toEqual({});
  });

  it("requires only a field that has lost focus", () => {
    expect(getMovementDateRangeErrors(
      { startDate: "", endDate: "" },
      ["startDate"]
    )).toEqual({ startDate: "Informe a Data de Início." });
  });

  it("reports invalid dates and reversed ranges on the affected fields", () => {
    expect(getMovementDateRangeErrors({
      startDate: "1999-12-31",
      endDate: "2101-01-01"
    })).toEqual({
      startDate: "A data deve estar entre 01/01/2000 e 31/12/2100.",
      endDate: "A data deve estar entre 01/01/2000 e 31/12/2100."
    });
    expect(getMovementDateRangeErrors({
      startDate: "2025-02-02",
      endDate: "2025-02-01"
    })).toEqual({
      startDate: "A Data de Início deve ser menor ou igual à Data de Término.",
      endDate: "A Data de Início deve ser menor ou igual à Data de Término."
    });
  });
});
