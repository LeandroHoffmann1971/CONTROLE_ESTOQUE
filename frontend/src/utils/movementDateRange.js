export const MOVEMENT_DATE_MIN = "2000-01-01";
export const MOVEMENT_DATE_MAX = "2100-12-31";

export function isMovementDateRangeWithinSupportedYears({ startDate, endDate }) {
  return [startDate, endDate].every(date =>
    !date || (date >= MOVEMENT_DATE_MIN && date <= MOVEMENT_DATE_MAX)
  );
}

export function getMovementDateRangeErrors({ startDate, endDate }, requiredFields = []) {
  const errors = {};

  if (!startDate && requiredFields.includes("startDate")) {
    errors.startDate = "Informe a Data de Início.";
  } else if (startDate && (startDate < MOVEMENT_DATE_MIN || startDate > MOVEMENT_DATE_MAX)) {
    errors.startDate = "A data deve estar entre 01/01/2000 e 31/12/2100.";
  }

  if (!endDate && requiredFields.includes("endDate")) {
    errors.endDate = "Informe a Data de Término.";
  } else if (endDate && (endDate < MOVEMENT_DATE_MIN || endDate > MOVEMENT_DATE_MAX)) {
    errors.endDate = "A data deve estar entre 01/01/2000 e 31/12/2100.";
  }

  if (startDate && endDate && !errors.startDate && !errors.endDate && startDate > endDate) {
    const error = "A Data de Início deve ser menor ou igual à Data de Término.";
    errors.startDate = error;
    errors.endDate = error;
  }

  return errors;
}
