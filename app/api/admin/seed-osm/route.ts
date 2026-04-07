import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET() {
  try {
    // 1. Array of Overpass API mirrors for reliability
    const mirrors = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.osm.ch/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter'
    ];

    const bbox = "9.45,6.45,9.75,6.75";
    const overpassQuery = `
      [out:json][timeout:60];
      (
        node["amenity"]["name"](${bbox});
        node["shop"]["name"](${bbox});
        node["tourism"]["name"](${bbox});
        node["highway"="junction"]["name"](${bbox});
        node["brand"]["name"](${bbox});
      );
      out body;
    `;

    let data = null;
    let lastError = '';

    for (const mirror of mirrors) {
      try {
        console.log(`Fetching from ${mirror}...`);
        const url = `${mirror}?data=${encodeURIComponent(overpassQuery)}`;
        const response = await fetch(url);
        const responseText = await response.text();
        
        if (responseText.startsWith('{')) {
          data = JSON.parse(responseText);
          break; // Success!
        } else {
          lastError = `Mirror ${mirror} returned non-JSON: ${responseText.slice(0, 100)}`;
        }
      } catch (err: unknown) {
        lastError = `Mirror ${mirror} failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
      }
    }

    if (!data) {
      return NextResponse.json({ 
        error: 'All Overpass mirrors failed or returned non-JSON responses.',
        lastError 
      }, { status: 502 });
    }

    if (!data.elements || data.elements.length === 0) {
      return NextResponse.json({ message: 'No landmarks found in this area.' }, { status: 404 });
    }

    interface OSMElement {
      id: number;
      lat: number;
      lon: number;
      tags: {
        name?: string;
        amenity?: string;
        shop?: string;
        highway?: string;
        [key: string]: string | undefined;
      };
    }

    // 2. Transform OSM data into our Location schema
    const landmarks = (data.elements as OSMElement[])
      .filter((el) => el.tags && el.tags.name && el.tags.name.trim().length > 0)
      .map((el) => ({
        raw_text: el.tags.name!.trim().toLowerCase(), // Normalize to lowercase for consistency
        latitude: el.lat,
        longitude: el.lon,
        is_verified: true,
        hit_count: 5, // Seeded landmarks start with a head start
        confidence_score: 1.0,
        metadata: {
          osm_id: el.id,
          category: el.tags.amenity || el.tags.shop || el.tags.highway || 'landmark',
          osm_tags: el.tags
        }
      }));

    // Deduplicate landmarks by raw_text to avoid "ON CONFLICT" errors in the same batch
    const uniqueMap = new Map();
    for (const item of landmarks) {
      uniqueMap.set(item.raw_text, item);
    }
    const uniqueLandmarks = Array.from(uniqueMap.values());

    console.log(`Deduplicated to ${uniqueLandmarks.length} unique landmarks. Seeding one by one...`);

    let successCount = 0;
    let failCount = 0;

    for (const landmark of uniqueLandmarks) {
      const { error: insertError } = await supabaseAdmin
        .from('locations')
        .insert(landmark);
      
      if (insertError) {
        // Code 23505 is a unique constraint violation (landmark already exists)
        if (insertError.code === '23505' || insertError.message?.includes('unique')) {
           // Skip already existing landmarks
           console.log(`Skipping existing landmark: ${landmark.raw_text}`);
        } else {
          console.error(`Failed to insert ${landmark.raw_text}:`, insertError);
          failCount++;
          continue;
        }
      }
      successCount++;
    }

    return NextResponse.json({
      success: true,
      count: successCount,
      failed: failCount,
      message: `Finished seeding landmarks. ${successCount} processed successfully.`
    });

  } catch (error: unknown) {
    console.error('Seeding Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
