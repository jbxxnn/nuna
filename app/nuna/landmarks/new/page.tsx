'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, MapPin, Search, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import MapboxMap from '@/components/mapbox-map';

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
  relevance?: number;
}

interface LocalLocation {
  id: string;
  raw_text: string;
  latitude: number | null;
  longitude: number | null;
  is_verified: boolean;
  hit_count: number;
  confidence_score?: number;
  metadata?: {
    category?: string;
    address?: string | null;
    notes?: string | null;
  } | null;
}

const MINNA_BBOX = '6.45,9.45,6.65,9.75';
const MAP_STYLES = [
  { label: 'Light', value: 'mapbox://styles/mapbox/light-v11' },
  { label: 'Streets', value: 'mapbox://styles/mapbox/streets-v12' },
  { label: 'Outdoors', value: 'mapbox://styles/mapbox/outdoors-v12' },
  { label: 'Satellite', value: 'mapbox://styles/mapbox/satellite-streets-v12' },
];

export default function AddLandmarkPage() {
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState('landmark');
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [localResults, setLocalResults] = useState<LocalLocation[]>([]);
  const [mapboxResults, setMapboxResults] = useState<MapboxFeature[]>([]);
  const [duplicateCandidates, setDuplicateCandidates] = useState<LocalLocation[]>([]);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [mapStyle, setMapStyle] = useState(MAP_STYLES[0].value);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [mergingLocationId, setMergingLocationId] = useState<string | null>(null);
  const [pendingMergeCandidate, setPendingMergeCandidate] = useState<LocalLocation | null>(null);
  const [candidateQueue, setCandidateQueue] = useState<LocalLocation[]>([]);

  const tripId = searchParams.get('tripId');
  const tripLeg = searchParams.get('leg');

  const markerLabel = selectedLabel || name.trim() || 'Draft Landmark';
  const draftMarker = useMemo(
    () =>
      selectedCoords
        ? {
            id: 'draft-landmark',
            latitude: selectedCoords.lat,
            longitude: selectedCoords.lng,
            raw_text: markerLabel,
          }
        : null,
    [markerLabel, selectedCoords]
  );

  async function handleApiResponse<T>(response: Response): Promise<T> {
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof payload?.error === 'string' ? payload.error : 'Request failed.',
      );
    }

    return payload as T;
  }

  useEffect(() => {
    async function loadCandidateQueue() {
      try {
        const data = await handleApiResponse<{ candidates: LocalLocation[] }>(
          await fetch('/api/nuna/landmarks?mode=queue', { cache: 'no-store' }),
        );
        setCandidateQueue(data.candidates);
      } catch (queueError) {
        setError(
          queueError instanceof Error ? queueError.message : 'Failed to load landmark queue.',
        );
      }
    }

    loadCandidateQueue();
  }, []);

  useEffect(() => {
    async function loadTripContext() {
      if (!tripId || (tripLeg !== 'pickup' && tripLeg !== 'dropoff')) return;

      try {
        const data = await handleApiResponse<{ location: LocalLocation | null }>(
          await fetch(
            `/api/nuna/landmarks?mode=trip-context&tripId=${encodeURIComponent(tripId)}&leg=${encodeURIComponent(tripLeg)}`,
            { cache: 'no-store' },
          ),
        );

        if (!data.location) return;

        applyLocalResult(data.location);
        setMessage(`Loaded ${tripLeg} from flagged trip for landmark review.`);
      } catch {
        return;
      }
    }

    loadTripContext();
  }, [tripId, tripLeg]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setError('Enter a landmark name first.');
      return;
    }

    setLoadingSearch(true);
    setError(null);
    setMessage(null);

    try {
      const localPromise = handleApiResponse<{ results: LocalLocation[] }>(
        await fetch(`/api/nuna/landmarks?mode=search&q=${encodeURIComponent(trimmed)}`, {
          cache: 'no-store',
        }),
      );

      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      const mapboxPromise = token && token !== 'YOUR_MAPBOX_ACCESS_TOKEN_HERE'
        ? fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json?access_token=${token}&bbox=${MINNA_BBOX}&limit=5`
          ).then(async (response) => {
            if (!response.ok) throw new Error(`Mapbox returned ${response.status}`);
            const data = await response.json();
            return (data.features ?? []) as MapboxFeature[];
          })
        : Promise.resolve([]);

      const [localData, mapboxData] = await Promise.all([localPromise, mapboxPromise]);
      const localRows = localData.results ?? [];
      setLocalResults(localRows);
      setDuplicateCandidates(localRows);
      setMapboxResults(mapboxData);

      if (localRows.length === 0 && mapboxData.length === 0) {
        setMessage('No result found in Nuna or Mapbox. Click the map to place this landmark manually.');
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Search failed.');
      setLocalResults([]);
      setDuplicateCandidates([]);
      setMapboxResults([]);
    } finally {
      setLoadingSearch(false);
    }
  }

  function applyLocalResult(result: LocalLocation) {
    if (result.latitude === null || result.longitude === null) {
      setError('This local result has no coordinates yet. Click the map to place it manually.');
      return;
    }

    setSelectedCoords({ lat: result.latitude, lng: result.longitude });
    setLatInput(result.latitude.toString());
    setLngInput(result.longitude.toString());
    setSelectedLabel(result.raw_text);
    setEditingLocationId(result.id);
    setName(result.raw_text);
    setCategory(result.metadata?.category || 'landmark');
    setAddress(result.metadata?.address || '');
    setNotes(result.metadata?.notes || '');
    setDuplicateCandidates((prev) =>
      prev.some((candidate) => candidate.id === result.id) ? prev : [result, ...prev].slice(0, 5)
    );
    setMessage(`Loaded existing landmark for editing: ${result.raw_text}`);
    setError(null);
  }

  function applyMapboxResult(result: MapboxFeature) {
    setSelectedCoords({ lat: result.center[1], lng: result.center[0] });
    setLatInput(result.center[1].toString());
    setLngInput(result.center[0].toString());
    setSelectedLabel(result.place_name);
    setName((current) => current || result.place_name);
    setEditingLocationId(null);
    setMessage(`Selected Mapbox result: ${result.place_name}`);
    setError(null);
  }

  async function handleSave() {
    const trimmedName = name.trim().toLowerCase();
    if (!trimmedName) {
      setError('Landmark name is required.');
      return;
    }

    if (!selectedCoords) {
      setError('Select a result or click the map to place the landmark first.');
      return;
    }

    const exactDuplicate = duplicateCandidates.find((candidate) => candidate.raw_text === trimmedName);
    if (exactDuplicate && !selectedLabel?.toLowerCase().includes(trimmedName)) {
      setError('A landmark with this exact name already exists. Use the existing one or change the name before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const data = await handleApiResponse<{
        success: boolean;
        locationId: string;
        message: string;
      }>(
        await fetch('/api/nuna/landmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editingLocationId,
            name: trimmedName,
            aliases: aliases.split(','),
            address,
            category,
            notes,
            selectedCoords,
          }),
        }),
      );

      setEditingLocationId(data.locationId);
      setMessage(data.message);
      setAliases('');
      setCandidateQueue((prev) => prev.filter((candidate) => candidate.id !== data.locationId));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save landmark.');
    } finally {
      setSaving(false);
    }
  }

  function handleCoordinateChange(nextLat: string, nextLng: string) {
    setLatInput(nextLat);
    setLngInput(nextLng);

    const parsedLat = Number.parseFloat(nextLat);
    const parsedLng = Number.parseFloat(nextLng);

    if (Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
      return;
    }

    setSelectedCoords({ lat: parsedLat, lng: parsedLng });
    setSelectedLabel(name.trim() || 'Manual Landmark');
    setMessage(`Marker adjusted to ${parsedLat.toFixed(6)}, ${parsedLng.toFixed(6)}.`);
    setError(null);
  }

  async function handleMergeDuplicate(source: LocalLocation) {
    if (!editingLocationId) {
      setError('Load the landmark you want to keep first, then merge duplicates into it.');
      return;
    }

    if (source.id === editingLocationId) {
      setError('You cannot merge a landmark into itself.');
      return;
    }

    setMergingLocationId(source.id);
    setError(null);
    setMessage(null);

    try {
      const data = await handleApiResponse<{ success: boolean; message: string }>(
        await fetch('/api/nuna/landmarks/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: source.id,
            targetId: editingLocationId,
            targetName: name,
            sourceHitCount: source.hit_count,
            sourceConfidenceScore: source.confidence_score ?? 0,
            sourceRawText: source.raw_text,
          }),
        }),
      );

      setLocalResults((prev) => prev.filter((candidate) => candidate.id !== source.id));
      setDuplicateCandidates((prev) => prev.filter((candidate) => candidate.id !== source.id));
      setCandidateQueue((prev) => prev.filter((candidate) => candidate.id !== source.id));
      setMessage(data.message);
      setPendingMergeCandidate(null);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'Failed to merge duplicate landmark.');
    } finally {
      setMergingLocationId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary">Operator Tool</p>
            <h1 className="text-3xl font-black tracking-tight text-foreground">Add Verified Landmark</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Search Nuna and Mapbox first. If the place still does not exist, click the map to place it manually and save it as a verified Minna landmark.
            </p>
          </div>
          <Link
            href="/nuna"
            className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        <div className="grid gap-6 xl:grid-cols-[420px,1fr]">
          <div className="space-y-4">
            <form onSubmit={handleSearch} className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                Search Landmark
              </label>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="e.g. Iya Femi Restaurant"
                    className="w-full rounded-2xl border border-border bg-background py-3 pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary/30"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loadingSearch}
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingSearch ? 'Searching...' : 'Search'}
                </button>
              </div>
            </form>

            <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Landmark Details</p>
              {editingLocationId && (
                <div className="mb-3 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.24em] text-primary">
                  Editing existing landmark
                </div>
              )}
              <div className="space-y-3">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Landmark name"
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                />
                <input
                  value={aliases}
                  onChange={(event) => setAliases(event.target.value)}
                  placeholder="Aliases separated by commas"
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                />
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Address or descriptive location text"
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                />
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                >
                  <option value="landmark">Landmark</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="hospital">Hospital</option>
                  <option value="bank">Bank</option>
                  <option value="school">School</option>
                  <option value="market">Market</option>
                  <option value="junction">Junction</option>
                  <option value="filling_station">Filling Station</option>
                </select>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Operator notes"
                  className="min-h-24 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    value={latInput}
                    onChange={(event) => handleCoordinateChange(event.target.value, lngInput)}
                    placeholder="Latitude"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                  />
                  <input
                    value={lngInput}
                    onChange={(event) => handleCoordinateChange(latInput, event.target.value)}
                    placeholder="Longitude"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                  />
                </div>

                <select
                  value={mapStyle}
                  onChange={(event) => setMapStyle(event.target.value)}
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-primary/30"
                >
                  {MAP_STYLES.map((styleOption) => (
                    <option key={styleOption.value} value={styleOption.value}>
                      {styleOption.label} Map
                    </option>
                  ))}
                </select>

                <div className="rounded-2xl border border-border/60 bg-muted/10 p-4 text-xs text-muted-foreground">
                  {selectedCoords ? (
                    <>
                      <p className="font-bold uppercase tracking-widest text-foreground/70">Selected Coordinates</p>
                      <p className="mt-1">Lat: {selectedCoords.lat.toFixed(6)}</p>
                      <p>Lng: {selectedCoords.lng.toFixed(6)}</p>
                      <p className="mt-2 text-[11px] text-primary">You can drag the blue marker on the map to fine-tune this point.</p>
                    </>
                  ) : (
                    <p>Pick a search result or click the map to place a marker manually.</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Verified Landmark'}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Review New Landmark Candidates</p>
              <div className="space-y-2">
                {candidateQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unverified candidate landmarks waiting right now.</p>
                ) : (
                  candidateQueue.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => applyLocalResult(candidate)}
                      className="block w-full rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/20"
                    >
                      <p className="text-sm font-bold text-foreground">{candidate.raw_text}</p>
                      <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        {(candidate.confidence_score ?? 0).toFixed(2)} confidence • {candidate.hit_count} hits
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>

            {duplicateCandidates.length > 0 && (
              <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-5 shadow-sm">
                <p className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-amber-700">Similar Existing Landmarks</p>
                {pendingMergeCandidate && (
                  <div className="mb-4 rounded-2xl border border-red-500/20 bg-background/80 p-4">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-700">Confirm Merge</p>
                    <p className="mt-2 text-sm text-foreground">
                      Merge <span className="font-bold">{pendingMergeCandidate.raw_text}</span> into the current landmark?
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This will move trips, saved places, aliases, and event references to the current landmark, then delete the duplicate row.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleMergeDuplicate(pendingMergeCandidate)}
                        disabled={mergingLocationId === pendingMergeCandidate.id}
                        className="flex-1 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {mergingLocationId === pendingMergeCandidate.id ? 'Merging...' : 'Confirm Merge'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingMergeCandidate(null)}
                        className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-[10px] font-black uppercase tracking-widest text-foreground/80 transition-colors hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {duplicateCandidates.slice(0, 5).map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-2xl border border-amber-500/20 bg-background/80 px-4 py-3"
                    >
                      <p className="text-sm font-bold text-foreground">{candidate.raw_text}</p>
                      <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-amber-700/80">
                        {candidate.is_verified ? 'Verified' : 'Unverified'} • {candidate.hit_count} hits
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => applyLocalResult(candidate)}
                          className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-[10px] font-black uppercase tracking-widest text-foreground/80 transition-colors hover:bg-muted"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingMergeCandidate(candidate)}
                          disabled={!editingLocationId || editingLocationId === candidate.id || mergingLocationId === candidate.id}
                          className="flex-1 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Queue Merge
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {message && (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <p className="text-sm font-medium">{message}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-5 py-3">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary">Placement Map</p>
                <p className="text-sm text-muted-foreground">Click anywhere on the map to place or correct the landmark marker.</p>
              </div>
              <div className="h-[520px]">
                <MapboxMap
                  center={selectedCoords ? [selectedCoords.lng, selectedCoords.lat] : [6.55694, 9.61389]}
                  zoom={selectedCoords ? 15 : 13}
                  style={mapStyle}
                  markers={[]}
                  draftMarker={draftMarker}
                  onMapClick={(coords) => {
                    setSelectedCoords(coords);
                    setLatInput(coords.lat.toString());
                    setLngInput(coords.lng.toString());
                    setSelectedLabel(name.trim() || 'Manual Landmark');
                    setMessage(`Manual pin placed at ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}.`);
                    setError(null);
                  }}
                  onDraftMarkerDrag={(coords) => {
                    setSelectedCoords(coords);
                    setLatInput(coords.lat.toString());
                    setLngInput(coords.lng.toString());
                    setMessage(`Marker adjusted to ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}.`);
                  }}
                />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Nuna Results</p>
                </div>
                <div className="space-y-2">
                  {localResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No local landmarks found.</p>
                  ) : (
                    localResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => applyLocalResult(result)}
                        className="block w-full rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/20"
                      >
                        <p className="text-sm font-bold text-foreground">{result.raw_text}</p>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                          {result.is_verified ? 'Verified' : 'Unverified'} • {result.hit_count} hits
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground">Mapbox Results</p>
                </div>
                <div className="space-y-2">
                  {mapboxResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No Mapbox results found.</p>
                  ) : (
                    mapboxResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => applyMapboxResult(result)}
                        className="block w-full rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/20"
                      >
                        <p className="text-sm font-bold text-foreground">{result.place_name}</p>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                          Relevance {(result.relevance ?? 0).toFixed(2)}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
