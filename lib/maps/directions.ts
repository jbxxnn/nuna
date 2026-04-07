/**
 * Mapbox Directions API Utility
 * Used to calculate real driving paths and distances between locations.
 */

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

export interface RouteData {
  distance: number; // In meters
  duration: number; // In seconds
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

/**
 * Fetches the driving route between two points.
 * Uses 'driving-traffic' for high-accuracy local routing in Minna.
 */
export async function getDrivingRoute(
  pickup: [number, number], // [lng, lat]
  dropoff: [number, number]
): Promise<RouteData | null> {
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error('Missing Mapbox Access Token');
    return null;
  }

  const query = `${pickup[0]},${pickup[1]};${dropoff[0]},${dropoff[1]}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${query}?geometries=geojson&access_token=${MAPBOX_ACCESS_TOKEN}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      console.warn('No routes found between these points.');
      return null;
    }

    const route = data.routes[0];
    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry
    };
  } catch (error) {
    console.error('Mapbox Directions API Error:', error);
    return null;
  }
}

/**
 * Pricing Logic for Chanchaga LGA
 * Formula: ₦500 Base + ₦100 per Kilometer
 */
export function calculateSuggestedPrice(distanceMeters: number): number {
  const km = distanceMeters / 1000;
  const baseFare = 500;
  const perKmRate = 100;
  
  const rawPrice = baseFare + (km * perKmRate);
  
  // Round to nearest 50 for local convenience (e.g. ₦650, ₦700)
  return Math.round(rawPrice / 50) * 50;
}
