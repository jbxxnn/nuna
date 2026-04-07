import { supabaseAdmin } from './supabase-admin';

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

// Local Bounding Box for Minna/Chanchaga LGA to ensure local accuracy
// format: [minLongitude, minLatitude, maxLongitude, maxLatitude]
const MINNA_BBOX = [6.45, 9.45, 6.65, 9.75].join(',');

export interface GeocodeResult {
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  source: 'local' | 'mapbox' | 'none';
}

/**
 * Hybrid Geocoding Strategy
 * 1. Check local verified database
 * 2. Query Mapbox with local bounding box
 */
export async function hybridGeocode(text: string): Promise<GeocodeResult> {
  const normalizedText = text.trim().toLowerCase();

  // 1. Level 1: Local Cache Lookup
  const { data: localMatch } = await supabaseAdmin
    .from('locations')
    .select('latitude, longitude, is_verified')
    .eq('raw_text', normalizedText)
    .not('latitude', 'is', null)
    .order('is_verified', { ascending: false }) // Prioritize verified ones
    .order('hit_count', { ascending: false })     // Then most used ones
    .limit(1)
    .maybeSingle();

  if (localMatch && localMatch.latitude && localMatch.longitude) {
    return {
      latitude: localMatch.latitude,
      longitude: localMatch.longitude,
      confidence: localMatch.is_verified ? 1.0 : 0.8,
      source: 'local'
    };
  }

  // 2. Level 2: Mapbox Bounded Search
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error('Mapbox Access Token missing');
    return { latitude: null, longitude: null, confidence: 0, source: 'none' };
  }

  try {
    const query = encodeURIComponent(`${text}, Minna, Nigeria`);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_ACCESS_TOKEN}&bbox=${MINNA_BBOX}&limit=1`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const bestMatch = data.features[0];
      const [lng, lat] = bestMatch.center;
      
      // Mapbox relevance score is 0-1
      const confidence = bestMatch.relevance || 0.5;

      return {
        latitude: lat,
        longitude: lng,
        confidence: confidence,
        source: 'mapbox'
      };
    }
  } catch (error) {
    console.error('Mapbox Geocoding Error:', error);
  }

  // 3. Level 3: Fallback (None)
  return {
    latitude: null,
    longitude: null,
    confidence: 0,
    source: 'none'
  };
}

/**
 * Reverse Geocoding
 * Converts [lat, lng] into a human-readable address or landmark
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!MAPBOX_ACCESS_TOKEN) return null;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1&types=address,poi,neighborhood`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      // Return the best place name found
      return data.features[0].place_name;
    }
  } catch (error) {
    console.error('Reverse Geocoding Error:', error);
  }

  return null;
}
