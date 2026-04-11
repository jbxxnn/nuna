'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
// Mapbox CSS is already imported in layout.tsx

interface MapboxMapProps {
  accessToken?: string;
  center?: [number, number];
  zoom?: number;
  style?: string;
  hideMapboxLabels?: boolean;
  selectedMarkerId?: string | null;
  markers?: {
    id: string;
    latitude: number;
    longitude: number;
    raw_text: string;
    is_verified?: boolean;
    hit_count?: number;
  }[];
  activeTrip?: {
    id: string;
    pickup: { lat: number; lng: number };
    dropoff: { lat: number; lng: number };
    geometry?: {
      type: 'LineString';
      coordinates: [number, number][];
    };
  };
  onMarkerClick?: (id: string) => void;
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  draftMarker?: {
    id: string;
    latitude: number;
    longitude: number;
    raw_text: string;
  } | null;
  onDraftMarkerDrag?: (coords: { lat: number; lng: number }) => void;
}

const MapboxMap: React.FC<MapboxMapProps> = ({
  accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 'YOUR_MAPBOX_ACCESS_TOKEN_HERE',
  center = [6.55694, 9.61389], // Chanchaga LGA, Minna, Nigeria
  zoom = 12,
  style = 'mapbox://styles/mapbox/light-v11', // A plain, light style
  hideMapboxLabels = false,
  selectedMarkerId = null,
  markers = [],
  activeTrip,
  onMarkerClick,
  onMapClick,
  draftMarker = null,
  onDraftMarkerDrag,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: mapboxgl.Marker }>({});
  const draftMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const initialCenterRef = useRef(center);
  const initialZoomRef = useRef(zoom);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: style,
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      console.log('Mapbox map loaded successfully');
      mapRef.current = map;
      setIsLoaded(true);
      // Force a resize to handle any layout shifts during mount
      setTimeout(() => {
        if (mapRef.current) mapRef.current.resize();
      }, 100);
    });

    return () => {
      if (draftMarkerRef.current) {
        draftMarkerRef.current.remove();
        draftMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [accessToken, style]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded || !onMapClick) return;

    const map = mapRef.current;
    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      onMapClick({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [isLoaded, onMapClick]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded || !hideMapboxLabels) return;

    const map = mapRef.current;

    const hideLabels = () => {
      const styleLayers = map.getStyle().layers ?? [];

      styleLayers.forEach((layer) => {
        if (layer.type !== 'symbol') return;
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      });
    };

    hideLabels();
    map.on('styledata', hideLabels);

    return () => {
      map.off('styledata', hideLabels);
    };
  }, [hideMapboxLabels, isLoaded]);

  // Update markers when markers prop changes
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    const map = mapRef.current;

    // Focus Mode: Hide landmarks if a trip is active
    const showLandmarks = !activeTrip;

    // Remove existing markers that are no longer in the list
    Object.keys(markersRef.current).forEach(id => {
      if (!markers.find(m => m.id === id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    // Add or update markers
    markers.forEach(marker => {
      const isSelected = marker.id === selectedMarkerId;
      if (markersRef.current[marker.id]) {
        // Update existing marker position AND visibility
        const m = markersRef.current[marker.id];
        m.getElement().style.display = showLandmarks ? 'block' : 'none';
        m.setLngLat([marker.longitude, marker.latitude]);
        const inner = m.getElement().querySelector('.location-marker') as HTMLDivElement | null;
        const pulse = m.getElement().querySelector('.location-marker-pulse') as HTMLDivElement | null;
        if (inner) {
          inner.dataset.selected = isSelected ? 'true' : 'false';
          inner.style.backgroundColor = isSelected
            ? '#2563eb'
            : marker.is_verified
              ? '#10b981'
              : '#f59e0b';
          inner.style.transform = isSelected
            ? 'translate(-50%, -50%) scale(1.2)'
            : 'translate(-50%, -50%) scale(1)';
        }
        if (pulse) {
          pulse.style.display = isSelected ? 'block' : 'none';
        }
      } else {
        // Create custom element for marker styling
        const el = document.createElement('div');
        el.className = 'marker-container';
        el.style.display = showLandmarks ? 'block' : 'none';
        el.style.position = 'relative';
        el.style.width = '0';
        el.style.height = '0';
        
        const inner = document.createElement('div');
        inner.className = 'location-marker';
        inner.dataset.selected = isSelected ? 'true' : 'false';

        const pulse = document.createElement('div');
        pulse.className = 'location-marker-pulse';
        
        // Color based on verification
        const color = isSelected
          ? '#2563eb'
          : marker.is_verified
            ? '#10b981'
            : '#f59e0b'; // Blue-600, Emerald-500, or Amber-500
        
        // Size based on hit_count (Hotspot logic)
        const size = Math.min(10 + (marker.hit_count || 0) * 2, 40);
        const pulseSize = size + 14;

        pulse.style.width = `${pulseSize}px`;
        pulse.style.height = `${pulseSize}px`;
        pulse.style.backgroundColor = 'rgba(37, 99, 235, 0.22)';
        pulse.style.borderRadius = '9999px';
        pulse.style.position = 'absolute';
        pulse.style.left = '50%';
        pulse.style.top = '50%';
        pulse.style.transform = 'translate(-50%, -50%)';
        pulse.style.animation = 'marker-pulse 1.8s ease-out infinite';
        pulse.style.pointerEvents = 'none';
        pulse.style.display = isSelected ? 'block' : 'none';
        pulse.style.marginLeft = '0';
        pulse.style.marginTop = '0';
        
        inner.style.width = `${size}px`;
        inner.style.height = `${size}px`;
        inner.style.backgroundColor = color;
        inner.style.borderRadius = '50%';
        inner.style.border = '2px solid white';
        inner.style.boxShadow = isSelected
          ? '0 0 0 4px rgba(37, 99, 235, 0.25), 0 6px 18px rgba(37, 99, 235, 0.35)'
          : '0 2px 4px rgba(0,0,0,0.2)';
        inner.style.cursor = 'pointer';
        inner.style.transition = 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        inner.style.position = 'absolute';
        inner.style.left = '50%';
        inner.style.top = '50%';
        inner.style.transform = isSelected
          ? 'translate(-50%, -50%) scale(1.2)'
          : 'translate(-50%, -50%) scale(1)';
        inner.style.zIndex = '1';

        el.appendChild(pulse);
        el.appendChild(inner);

        // Add hover effect to INNER element
        el.onmouseenter = () => {
           inner.style.transform = isSelected
             ? 'translate(-50%, -50%) scale(1.28)'
             : 'translate(-50%, -50%) scale(1.3)';
           inner.style.filter = 'brightness(1.1)';
           inner.style.zIndex = '100';
        };
        el.onmouseleave = () => {
           inner.style.transform = isSelected
             ? 'translate(-50%, -50%) scale(1.2)'
             : 'translate(-50%, -50%) scale(1)';
           inner.style.filter = 'brightness(1)';
           inner.style.zIndex = '1';
        };

        // Create the Marker
        const m = new mapboxgl.Marker(el)
          .setLngLat([marker.longitude, marker.latitude])
          .addTo(map);

        el.addEventListener('click', () => {
          if (onMarkerClick) onMarkerClick(marker.id);
        });

        markersRef.current[marker.id] = m;
      }
    });
  }, [markers, isLoaded, onMarkerClick, activeTrip, selectedMarkerId]);

  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;

    if (!draftMarker) {
      if (draftMarkerRef.current) {
        draftMarkerRef.current.remove();
        draftMarkerRef.current = null;
      }
      return;
    }

    if (!draftMarkerRef.current) {
      draftMarkerRef.current = new mapboxgl.Marker({
        color: '#2563eb',
        draggable: !!onDraftMarkerDrag,
      })
        .setLngLat([draftMarker.longitude, draftMarker.latitude])
        .setPopup(
          new mapboxgl.Popup({ offset: 20 }).setHTML(
            `<div style="padding: 8px; font-family: sans-serif;">
               <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${draftMarker.raw_text}</h3>
               <p style="margin: 0; font-size: 10px; color: #666;">Draft landmark</p>
             </div>`
          )
        )
        .addTo(mapRef.current);

      if (onDraftMarkerDrag) {
        draftMarkerRef.current.on('dragend', () => {
          const lngLat = draftMarkerRef.current?.getLngLat();
          if (!lngLat) return;
          onDraftMarkerDrag({ lat: lngLat.lat, lng: lngLat.lng });
        });
      }
    } else {
      draftMarkerRef.current.setLngLat([draftMarker.longitude, draftMarker.latitude]);
      draftMarkerRef.current.setDraggable(!!onDraftMarkerDrag);
    }
  }, [draftMarker, isLoaded, onDraftMarkerDrag]);

  // Handle Trip Routing Layer
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const map = mapRef.current;

    const SOURCE_ID = 'trip-route';
    const LAYER_ID = 'trip-route-line';

    // Remove existing layers and sources if they exist
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    if (activeTrip && activeTrip.geometry) {
      const coords = activeTrip.geometry.coordinates;

      // Add actual markers for the Start and End points
      const pickupM = new mapboxgl.Marker({ color: '#10b981', scale: 0.8 })
        .setLngLat([activeTrip.pickup.lng, activeTrip.pickup.lat])
        .addTo(map);
        
      const dropoffM = new mapboxgl.Marker({ color: '#ef4444', scale: 0.8 })
        .setLngLat([activeTrip.dropoff.lng, activeTrip.dropoff.lat])
        .addTo(map);

      // Track these to remove them later
      const tripMarkers = [pickupM, dropoffM];

      const geojson = {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: coords
        }
      };

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: geojson
      });

      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#3b82f6', // blue-500
          'line-width': 4,
          'line-opacity': 0.8,
          'line-dasharray': [1, 2] // Dashed look for logistics
        }
      });

      // Fit bounds to show the whole trip precisely
      const bounds = new mapboxgl.LngLatBounds();
      coords.forEach(c => bounds.extend(c as [number, number]));

      map.fitBounds(bounds, {
        padding: 80,
        essential: true,
        duration: 1000 // Smooth transition
      });

      // Cleanup function to remove these specific trip markers
      return () => {
        tripMarkers.forEach(m => m.remove());
      };
    }
  }, [activeTrip, isLoaded]);

  // Handle center changes for specific location selection
  useEffect(() => {
    if (mapRef.current && center) {
      mapRef.current.flyTo({
        center: center,
        essential: true,
        duration: 1000
      });
    }
  }, [center]);

  return (
    <div className="relative w-full h-full min-h-[500px] bg-muted/20">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <style jsx>{`
        @keyframes marker-pulse {
          0% {
            transform: translate(-50%, -50%) scale(0.9);
            opacity: 0.75;
          }
          70% {
            transform: translate(-50%, -50%) scale(1.35);
            opacity: 0;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.35);
            opacity: 0;
          }
        }
      `}</style>
      
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/10 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">Initializing Admin Map...</p>
          </div>
        </div>
      )}

      {/* Mapbox Branding Overlay (Optional Customization) */}
      <div className="absolute bottom-4 left-4 z-10 pointer-events-none">
        <div className="bg-background/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-border shadow-sm">
           <p className="text-[10px] font-bold tracking-tight text-foreground/70 lowercase uppercase">Nuna Location Intelligence</p>
        </div>
      </div>

      {/* Access Token Warning */}
      {accessToken === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE' && (
        <div className="absolute top-4 left-4 right-4 p-4 bg-amber-500/10 border border-amber-500/20 backdrop-blur-md rounded-lg z-20 text-center">
          <p className="text-xs font-semibold text-amber-600">
            Mapbox Access Token Required
          </p>
          <p className="text-[10px] text-amber-600/80 mt-1">
            Please set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in your .env.local file.
          </p>
        </div>
      )}
    </div>
  );
};

export default MapboxMap;
