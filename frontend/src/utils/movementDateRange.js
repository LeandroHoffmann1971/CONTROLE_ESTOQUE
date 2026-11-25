export const MOVEMENT_DATE_MIN = "2000-01-01";
export const MOVEMENT_DATE_MAX = "2100-12-31";

export function isMovementDateRangeWithinSupportedYears({ startDate, endDate }) {
  return [startDate, endDate].every(date =>
    !date || (date >= MOVEMENT_DATE_MIN && date <= MOVEMENT_DATE_MAX)
  );
}
