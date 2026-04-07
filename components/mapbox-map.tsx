'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
// Mapbox CSS is already imported in layout.tsx

interface MapboxMapProps {
  accessToken?: string;
  center?: [number, number];
  zoom?: number;
  style?: string;
}

const MapboxMap: React.FC<MapboxMapProps> = ({
  accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'YOUR_MAPBOX_ACCESS_TOKEN_HERE',
  center = [6.55694, 9.61389], // Chanchaga LGA, Minna, Nigeria
  zoom = 12,
  style = 'mapbox://styles/mapbox/light-v11', // A plain, light style
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: style,
      center: center,
      zoom: zoom,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      console.log('Mapbox map loaded successfully');
      setIsLoaded(true);
      mapRef.current = map;
      // Force a resize to handle any layout shifts during mount
      setTimeout(() => map.resize(), 100);
    });

    return () => {
      map.remove();
    };
  }, [accessToken, center, zoom, style]);

  return (
    <div className="relative w-full h-full min-h-[500px] border border-border rounded-xl overflow-hidden shadow-sm bg-muted/20">
      <div ref={mapContainerRef} className="absolute inset-0" />
      
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/10 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">Initializing Map...</p>
          </div>
        </div>
      )}

      {/* Access Token Warning - Only shows if placeholder is used */}
      {accessToken === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE' && (
        <div className="absolute top-4 left-4 right-4 p-4 bg-amber-500/10 border border-amber-500/20 backdrop-blur-md rounded-lg z-20 text-center">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
            Mapbox Access Token Required
          </p>
          <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-1">
            Please set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in your .env.local file.
          </p>
        </div>
      )}
    </div>
  );
};

export default MapboxMap;
