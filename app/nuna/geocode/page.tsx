'use client';

import { FormEvent, useState } from 'react';
import { Search, MapPin, AlertCircle } from 'lucide-react';
import MapboxMap from '@/components/mapbox-map';

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
  relevance?: number;
  text?: string;
}

const MINNA_BBOX = '6.45,9.45,6.65,9.75';

export default function GeocodeDebugPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [useLocalBbox, setUseLocalBbox] = useState(true);
  const [selectedFeature, setSelectedFeature] = useState<MapboxFeature | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token || token === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE') {
      setError('Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.');
      setResults([]);
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter an address or landmark first.');
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const encodedQuery = encodeURIComponent(trimmed);
      const params = new URLSearchParams({
        access_token: token,
        limit: '5',
      });

      if (useLocalBbox) {
        params.set('bbox', MINNA_BBOX);
      }

      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`Mapbox returned ${response.status}`);
      }

      const data = await response.json();
      const features = (data.features ?? []) as MapboxFeature[];
      setResults(features);
      setSelectedFeature(features[0] ?? null);
    } catch (fetchError) {
      setResults([]);
      setSelectedFeature(null);
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown geocoding error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary">Debug Tool</p>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Mapbox Geocode Checker</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Paste a landmark or address to see what Mapbox returns. This helps verify whether a location exists in Mapbox before blaming Nuna&apos;s resolver.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Behind Central Bank, Minna, Nigeria"
                className="w-full rounded-2xl border border-border bg-background py-3 pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary/30"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Checking...' : 'Search Mapbox'}
            </button>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={useLocalBbox}
              onChange={(event) => setUseLocalBbox(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Restrict search to Nuna&apos;s Minna bounding box
          </label>
        </form>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="space-y-3">
          {selectedFeature && (
            <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary">Map Preview</p>
                  <p className="text-sm font-bold text-foreground">{selectedFeature.place_name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFeature(null)}
                  className="text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              <div className="h-[360px]">
                <MapboxMap
                  center={selectedFeature.center}
                  zoom={15}
                  markers={[
                    {
                      id: selectedFeature.id,
                      latitude: selectedFeature.center[1],
                      longitude: selectedFeature.center[0],
                      raw_text: selectedFeature.place_name,
                      is_verified: true,
                      hit_count: 1,
                    },
                  ]}
                />
              </div>
            </div>
          )}

          {results.length === 0 && !loading && !error ? (
            <div className="rounded-3xl border border-dashed border-border bg-muted/10 p-8 text-center">
              <p className="text-sm text-muted-foreground">No results yet. Run a search to inspect Mapbox candidates.</p>
            </div>
          ) : (
            results.map((feature) => (
              <button
                key={feature.id}
                type="button"
                onClick={() => setSelectedFeature(feature)}
                className={`block w-full rounded-3xl border bg-card p-5 text-left shadow-sm transition-colors ${
                  selectedFeature?.id === feature.id
                    ? 'border-primary/30 ring-2 ring-primary/10'
                    : 'border-border hover:border-primary/20'
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-primary" />
                    <p className="truncate text-sm font-bold text-foreground">{feature.place_name}</p>
                  </div>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
                    {(feature.relevance ?? 0).toFixed(2)}
                  </span>
                </div>

                <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                  <div className="rounded-2xl bg-muted/20 p-3">
                    <p className="mb-1 font-bold uppercase tracking-widest text-foreground/70">Center</p>
                    <p>Longitude: {feature.center[0]}</p>
                    <p>Latitude: {feature.center[1]}</p>
                  </div>
                  <div className="rounded-2xl bg-muted/20 p-3">
                    <p className="mb-1 font-bold uppercase tracking-widest text-foreground/70">Label</p>
                    <p>{feature.text || 'n/a'}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
