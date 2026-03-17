export function parseCoordinate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function coordinatesLookSwapped(longitude, latitude) {
  return isValidLatitude(longitude) && isValidLongitude(latitude) && !isValidLongitude(longitude);
}

export function validateCoordinates(longitudeValue, latitudeValue) {
  const longitude = parseCoordinate(longitudeValue);
  const latitude = parseCoordinate(latitudeValue);
  const hasAnyInput = String(longitudeValue ?? "").trim() !== "" || String(latitudeValue ?? "").trim() !== "";

  if (!hasAnyInput) {
    return {
      longitude,
      latitude,
      isComplete: false,
      isValid: false,
      looksSwapped: false,
      message: "",
    };
  }

  if (longitude === null || latitude === null) {
    return {
      longitude,
      latitude,
      isComplete: false,
      isValid: false,
      looksSwapped: false,
      message: "Longitude and latitude must both be numeric before publishing.",
    };
  }

  const looksSwapped = coordinatesLookSwapped(longitude, latitude);
  if (!isValidLongitude(longitude) || !isValidLatitude(latitude)) {
    return {
      longitude,
      latitude,
      isComplete: true,
      isValid: false,
      looksSwapped,
      message: looksSwapped
        ? "These coordinates look reversed. Longitude should be between -180 and 180, and latitude should be between -90 and 90."
        : "Longitude must be between -180 and 180, and latitude must be between -90 and 90.",
    };
  }

  return {
    longitude,
    latitude,
    isComplete: true,
    isValid: true,
    looksSwapped: false,
    message: "",
  };
}

export function swapCoordinateValues(longitudeValue, latitudeValue) {
  return {
    longitude: String(latitudeValue ?? ""),
    latitude: String(longitudeValue ?? ""),
  };
}
