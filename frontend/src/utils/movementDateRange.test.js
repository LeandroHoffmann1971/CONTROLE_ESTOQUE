import { describe, expect, it } from "vitest";
import { isMovementDateRangeWithinSupportedYears } from "./movementDateRange.js";

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
});
