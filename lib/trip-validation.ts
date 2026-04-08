export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface TripValidationResult {
  isValid: boolean;
  needsManualReview: boolean;
  notes: string[];
  userMessage?: string;
}

const SERVICE_AREA = {
  minLongitude: 6.45,
  minLatitude: 9.45,
  maxLongitude: 6.75,
  maxLatitude: 9.75,
};

const MIN_TRIP_DISTANCE_METERS = 120;
const MAX_TRIP_DISTANCE_METERS = 50000;

export function isWithinServiceArea({ latitude, longitude }: Coordinates): boolean {
  return (
    longitude >= SERVICE_AREA.minLongitude &&
    longitude <= SERVICE_AREA.maxLongitude &&
    latitude >= SERVICE_AREA.minLatitude &&
    latitude <= SERVICE_AREA.maxLatitude
  );
}

export function distanceBetweenMeters(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;

  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return earthRadiusMeters * arc;
}

interface ValidateTripParams {
  pickup: Coordinates;
  dropoff: Coordinates;
  routeDistanceMeters: number | null;
}

export function validateTrip({
  pickup,
  dropoff,
  routeDistanceMeters,
}: ValidateTripParams): TripValidationResult {
  const notes: string[] = [];
  let needsManualReview = false;
  let isValid = true;
  let userMessage: string | undefined;

  const pickupInside = isWithinServiceArea(pickup);
  const dropoffInside = isWithinServiceArea(dropoff);

  if (!pickupInside || !dropoffInside) {
    isValid = false;
    notes.push("Pickup or drop-off is outside the current service area.");
    userMessage =
      "One of these locations looks outside our current Minna service area. Please send a nearby landmark or share a WhatsApp pin.";
  }

  const straightLineDistance = distanceBetweenMeters(pickup, dropoff);

  if (straightLineDistance < MIN_TRIP_DISTANCE_METERS) {
    needsManualReview = true;
    notes.push("Pickup and drop-off are extremely close together.");
    if (!userMessage) {
      userMessage =
        "Pickup and drop-off look very close together. Reply *Confirm* to continue or send a clearer drop-off.";
    }
  }

  if (routeDistanceMeters !== null && routeDistanceMeters > MAX_TRIP_DISTANCE_METERS) {
    needsManualReview = true;
    notes.push("Route distance is larger than the expected service range.");
  }

  if (routeDistanceMeters === null) {
    needsManualReview = true;
    notes.push("Route calculation did not return a reliable driving distance.");
  }

  return {
    isValid,
    needsManualReview,
    notes,
    userMessage,
  };
}
