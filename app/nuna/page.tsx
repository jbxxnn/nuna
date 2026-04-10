'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import MapboxMap from "@/components/mapbox-map";
import Link from "next/link";
import { 
  Map as MapIcon, 
  Layers, 
  Search, 
  MapPin, 
  AlertCircle,
  Siren,
  CheckCircle2, 
  TrendingUp,
  RefreshCw,
  LocateFixed,
  Navigation,
  Banknote,
  Bot,
  ShieldAlert,
  TimerReset,
  Bike
} from "lucide-react";
import { getDrivingRoute, calculateSuggestedPrice, RouteData } from "@/lib/maps/directions";

const NUNA_MAP_STYLE = 'mapbox://styles/bindahq/cmnsnc6qh000101qo5oz23km9';
const STALE_TRIP_THRESHOLD_MINUTES = 20;
const ASSIGNMENT_RESPONSE_THRESHOLD_MINUTES = 5;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceInKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(toLat - fromLat);
  const longitudeDelta = toRadians(toLng - fromLng);
  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getMinutesSince(timestamp?: string | null) {
  if (!timestamp) return null;

  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) return null;

  return Math.max(0, Math.round((Date.now() - parsed) / 60000));
}

function getStaleTripState(trip: Trip) {
  const normalizedStatus = trip.status.trim().toLowerCase();
  if (normalizedStatus === 'completed' || normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
    return { isStale: false, ageMinutes: getMinutesSince(trip.created_at) ?? 0 };
  }

  const referenceTimestamp =
    trip.assigned_at ||
    trip.created_at;
  const ageMinutes = getMinutesSince(referenceTimestamp) ?? 0;

  return {
    isStale: ageMinutes >= STALE_TRIP_THRESHOLD_MINUTES,
    ageMinutes,
  };
}

function getAssignmentResponseState(trip: Trip) {
  const isAwaitingResponse = Boolean(trip.rider_id && trip.status.trim().toLowerCase() === 'pending');
  if (!isAwaitingResponse) {
    return {
      isAwaitingResponse: false,
      isTimedOut: false,
      ageMinutes: 0,
    };
  }

  const ageMinutes = getMinutesSince(trip.assigned_at) ?? 0;

  return {
    isAwaitingResponse: true,
    isTimedOut: ageMinutes >= ASSIGNMENT_RESPONSE_THRESHOLD_MINUTES,
    ageMinutes,
  };
}

function formatMinutesLabel(totalMinutes: number) {
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatDistanceLabel(distanceKm: number | null) {
  if (distanceKm === null) {
    return 'No rider GPS';
  }

  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m away`;
  }

  return `${distanceKm.toFixed(1)} km away`;
}

function getRiderStatusPriority(status: Rider['status']) {
  switch (status) {
    case 'available':
      return 0;
    case 'assigned':
      return 1;
    case 'on_trip':
      return 2;
    case 'offline':
      return 3;
    case 'suspended':
      return 4;
    default:
      return 5;
  }
}

function getLastSeenTone(lastSeenAt?: string | null) {
  const minutes = getMinutesSince(lastSeenAt);

  if (minutes === null) {
    return {
      label: 'No live ping',
      className: 'text-muted-foreground',
    };
  }

  if (minutes <= 5) {
    return {
      label: `Seen ${formatMinutesLabel(minutes)} ago`,
      className: 'text-emerald-700',
    };
  }

  if (minutes <= 20) {
    return {
      label: `Seen ${formatMinutesLabel(minutes)} ago`,
      className: 'text-amber-700',
    };
  }

  return {
    label: `Seen ${formatMinutesLabel(minutes)} ago`,
    className: 'text-red-700',
  };
}

function normalizeText(value?: string | null) {
  return value?.trim().toLowerCase() ?? '';
}

function matchesRiderQuery(rider: Rider, query: string) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return true;
  }

  return [
    rider.full_name,
    rider.phone_number,
    rider.service_zone,
    rider.vehicle_type,
    rider.bike_plate_number,
    rider.status,
    rider.is_verified ? 'verified' : 'pending',
  ]
    .map((value) => normalizeText(value))
    .some((value) => value.includes(normalizedQuery));
}

function matchesServiceZone(rider: Rider, trip: Trip) {
  const serviceZone = normalizeText(rider.service_zone);
  if (!serviceZone) {
    return false;
  }

  const pickupAddress = normalizeText(trip.pickup.metadata?.address);
  const pickupRawText = normalizeText(trip.pickup.raw_text);

  return pickupAddress.includes(serviceZone) || pickupRawText.includes(serviceZone);
}

function hasStaleRiderGps(lastSeenAt?: string | null) {
  const minutes = getMinutesSince(lastSeenAt);
  return minutes === null || minutes > 20;
}

function getTripStatusClasses(status: string) {
  const normalized = status.trim().toLowerCase();

  if (normalized === 'completed') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700';
  }

  if (normalized === 'moving') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-700';
  }

  if (normalized === 'canceled' || normalized === 'cancelled') {
    return 'border-red-500/20 bg-red-500/10 text-red-700';
  }

  if (normalized === 'confirmed') {
    return 'border-blue-500/20 bg-blue-500/10 text-blue-700';
  }

  return 'border-primary/20 bg-primary/10 text-primary';
}

interface Location {
  id: string;
  raw_text: string;
  latitude: number;
  longitude: number;
  is_verified: boolean;
  hit_count: number;
  confidence_score: number;
  created_at: string;
  metadata?: {
    address?: string | null;
    category?: string | null;
    notes?: string | null;
  } | null;
}

interface RawTrip {
  id: string;
  status: string;
  created_at: string;
  needs_manual_review?: boolean;
  validation_notes?: string | null;
  sender_phone?: string | null;
  recipient_phone?: string | null;
  rider_id?: string | null;
  assigned_at?: string | null;
  sender_profile?: {
    phone_number?: string | null;
  } | null;
  assigned_rider?: Rider | null;
  pickup: Location | null;
  dropoff: Location | null;
}

interface Trip {
  id: string;
  status: string;
  created_at: string;
  pickup: Location;
  dropoff: Location;
  needs_manual_review?: boolean;
  validation_notes?: string | null;
  sender_phone?: string | null;
  recipient_phone?: string | null;
  rider_id?: string | null;
  assigned_at?: string | null;
  sender_profile?: {
    phone_number?: string | null;
  } | null;
  assigned_rider?: Rider | null;
}

interface RiderRecommendation extends Rider {
  distanceToPickupKm: number | null;
  freshnessMinutes: number | null;
  performance: RiderPerformanceMetrics;
  zoneMatch: boolean;
  hasStaleGps: boolean;
  cancellationRate: number;
  completionRate: number;
  priorDeclineForTrip: boolean;
  priorTimeoutForTrip: boolean;
  assignmentHistory: RiderAssignmentStats;
}

interface Rider {
  id: string;
  user_id: string;
  full_name?: string | null;
  phone_number?: string | null;
  vehicle_type?: string | null;
  bike_plate_number?: string | null;
  status: 'offline' | 'available' | 'assigned' | 'on_trip' | 'suspended';
  is_verified: boolean;
  service_zone?: string | null;
  ops_notes?: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface ResolutionEvent {
  id: string;
  stage: string;
  action_taken: string;
  confidence: string | null;
  resolution_source: string | null;
  selected_location_id: string | null;
  created_at: string;
}

interface HotspotStat {
  label: string;
  count: number;
}

interface RiderPerformanceMetrics {
  recentTrips: number;
  completedTrips: number;
  canceledTrips: number;
}

interface TripAssignmentHistory {
  declinedRiderIds: string[];
  timedOutRiderIds: string[];
}

interface RiderAssignmentStats {
  declines: number;
  timeouts: number;
}

const EMPTY_RIDER_PERFORMANCE: RiderPerformanceMetrics = {
  recentTrips: 0,
  completedTrips: 0,
  canceledTrips: 0,
};

const EMPTY_TRIP_ASSIGNMENT_HISTORY: TripAssignmentHistory = {
  declinedRiderIds: [],
  timedOutRiderIds: [],
};

const EMPTY_RIDER_ASSIGNMENT_STATS: RiderAssignmentStats = {
  declines: 0,
  timeouts: 0,
};

export default function NunaPage() {
  const [hotspots, setHotspots] = useState<Location[]>([]);
  const [candidateLocations, setCandidateLocations] = useState<Location[]>([]);
  const [landmarkSearchResults, setLandmarkSearchResults] = useState<Location[]>([]);
  const [trips, setTrips] = useState<RawTrip[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [events, setEvents] = useState<ResolutionEvent[]>([]);
  const [riderMetrics, setRiderMetrics] = useState<Record<string, RiderPerformanceMetrics>>({});
  const [tripAssignmentHistory, setTripAssignmentHistory] = useState<Record<string, TripAssignmentHistory>>({});
  const [riderAssignmentStats, setRiderAssignmentStats] = useState<Record<string, RiderAssignmentStats>>({});
  const [activeTab, setActiveTab] = useState<'landmarks' | 'trips' | 'ops'>('landmarks');
  const [loading, setLoading] = useState(true);
  const [landmarkSearchLoading, setLandmarkSearchLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [riderSearchQuery, setRiderSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actioningTripId, setActioningTripId] = useState<string | null>(null);
  const [assigningTripId, setAssigningTripId] = useState<string | null>(null);
  const [riderActionId, setRiderActionId] = useState<string | null>(null);
  const [savingRiderNotesId, setSavingRiderNotesId] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [riderNoteDrafts, setRiderNoteDrafts] = useState<Record<string, string>>({});
  const [locationStats, setLocationStats] = useState({ totalLocations: 0, verifiedLocations: 0 });

  const handleApiResponse = async <T,>(response: Response): Promise<T> => {
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        typeof payload?.error === 'string' ? payload.error : 'Request failed',
      );
    }

    return payload as T;
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setErrorMsg(null);

    try {
      const data = await handleApiResponse<{
        hotspots: Location[];
        candidateLocations: Location[];
        trips: RawTrip[];
        riders: Rider[];
        events: ResolutionEvent[];
        riderMetrics: Record<string, RiderPerformanceMetrics>;
        tripAssignmentHistory: Record<string, TripAssignmentHistory>;
        riderAssignmentStats: Record<string, RiderAssignmentStats>;
        stats: {
          totalLocations: number;
          verifiedLocations: number;
        };
      }>(await fetch('/api/nuna/dashboard', { cache: 'no-store' }));

      setHotspots(data.hotspots);
      setCandidateLocations(data.candidateLocations);
      setLandmarkSearchResults([]);
      setTrips(data.trips);
      setRiders(data.riders);
      setEvents(data.events);
      setRiderMetrics(data.riderMetrics);
      setTripAssignmentHistory(data.tripAssignmentHistory);
      setRiderAssignmentStats(data.riderAssignmentStats);
      setLocationStats(data.stats);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load dashboard';
      setErrorMsg(message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    if (activeTab !== 'landmarks') {
      return;
    }

    const trimmed = searchQuery.trim();

    if (!trimmed) {
      setLandmarkSearchResults([]);
      setLandmarkSearchLoading(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setLandmarkSearchLoading(true);

      try {
        const data = await handleApiResponse<{ results: Location[] }>(
          await fetch(`/api/nuna/landmarks?mode=search&q=${encodeURIComponent(trimmed)}`, {
            cache: 'no-store',
          }),
        );

        if (!isCancelled) {
          setLandmarkSearchResults(data.results);
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMsg(error instanceof Error ? error.message : 'Failed to search hotspots');
          setLandmarkSearchResults([]);
        }
      } finally {
        if (!isCancelled) {
          setLandmarkSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeTab, searchQuery]);

  const handleVerify = async (id: string) => {
    try {
      await handleApiResponse<{ success: boolean }>(
        await fetch(`/api/nuna/locations/${id}/verify`, { method: 'POST' }),
      );
      setErrorMsg(null);
      setHotspots(prev => 
        prev.map(loc => loc.id === id ? { ...loc, is_verified: true } : loc)
      );
      setCandidateLocations(prev => prev.filter((loc) => loc.id !== id));
      setLandmarkSearchResults(prev =>
        prev.map(loc => loc.id === id ? { ...loc, is_verified: true } : loc),
      );
      setLocationStats(prev => ({
        totalLocations: prev.totalLocations,
        verifiedLocations: prev.verifiedLocations + 1,
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify landmark';
      setErrorMsg(message);
    }
  };

  const handleResolveReview = async (tripId: string) => {
    setActioningTripId(tripId);
    const operatorNote = reviewDrafts[tripId]?.trim();

    try {
      const data = await handleApiResponse<{
        success: boolean;
        updates: { needs_manual_review: boolean; validation_notes: string | null };
      }>(
        await fetch(`/api/nuna/trips/${tripId}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'resolve', note: operatorNote ?? null }),
        }),
      );

      setErrorMsg(null);
      setTrips((prev) =>
        prev.map((trip) =>
          trip.id === tripId
            ? {
                ...trip,
                needs_manual_review: data.updates.needs_manual_review,
                validation_notes: data.updates.validation_notes,
              }
            : trip
        )
      );
      setReviewDrafts((prev) => ({ ...prev, [tripId]: '' }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to resolve review';
      setErrorMsg(message);
    }

    setActioningTripId(null);
  };

  const handleSaveReviewNote = async (tripId: string, existingNotes: string | null | undefined) => {
    const draft = reviewDrafts[tripId]?.trim();
    if (!draft) return;

    setActioningTripId(tripId);

    try {
      const data = await handleApiResponse<{
        success: boolean;
        updates: { needs_manual_review: boolean; validation_notes: string | null };
      }>(
        await fetch(`/api/nuna/trips/${tripId}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'note',
            note: draft,
            existingNotes: existingNotes ?? null,
          }),
        }),
      );

      setErrorMsg(null);
      setTrips((prev) =>
        prev.map((trip) =>
          trip.id === tripId
            ? {
                ...trip,
                needs_manual_review: data.updates.needs_manual_review,
                validation_notes: data.updates.validation_notes,
              }
            : trip
        )
      );
      setReviewDrafts((prev) => ({ ...prev, [tripId]: '' }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save review note';
      setErrorMsg(message);
    }

    setActioningTripId(null);
  };

  const handleAssignRider = async (tripId: string, riderId: string | null) => {
    setAssigningTripId(tripId);

    try {
      await handleApiResponse<{ success: boolean }>(
        await fetch(`/api/nuna/trips/${tripId}/assignment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ riderId }),
        }),
      );
      setErrorMsg(null);
      await handleRefresh();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to assign rider');
    } finally {
      setAssigningTripId(null);
    }
  };

  const handleRiderAction = async (riderId: string, action: 'approve' | 'suspend' | 'restore') => {
    setRiderActionId(riderId);

    try {
      await handleApiResponse<{ success: boolean }>(
        await fetch(`/api/nuna/riders/${riderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }),
      );
      setErrorMsg(null);
      await handleRefresh();
      setSelectedRiderId(riderId);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to update rider');
    } finally {
      setRiderActionId(null);
    }
  };

  const handleSaveRiderNotes = async (riderId: string) => {
    setSavingRiderNotesId(riderId);

    try {
      await handleApiResponse<{ success: boolean; notes: string | null }>(
        await fetch(`/api/nuna/riders/${riderId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: riderNoteDrafts[riderId] ?? '' }),
        }),
      );
      setErrorMsg(null);
      await handleRefresh();
      setSelectedRiderId(riderId);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to save rider notes');
    } finally {
      setSavingRiderNotesId(null);
    }
  };

  const linkedTrips = useMemo(() => {
    return trips.map(t => {
      if (!t.pickup || !t.dropoff) return null;
      return {
        ...t,
        pickup: t.pickup,
        dropoff: t.dropoff,
      } as Trip;
    }).filter((t): t is Trip => t !== null);
  }, [trips]);

  const displayedHotspots = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      return landmarkSearchResults;
    }

    return hotspots;
  }, [hotspots, landmarkSearchResults, searchQuery]);

  const filteredTrips = useMemo(() => {
    return linkedTrips
      .filter(trip => 
        (trip.pickup?.raw_text?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        (trip.dropoff?.raw_text?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      )
      .sort((left, right) => {
        const leftAssignment = getAssignmentResponseState(left);
        const rightAssignment = getAssignmentResponseState(right);

        if (leftAssignment.isTimedOut !== rightAssignment.isTimedOut) {
          return leftAssignment.isTimedOut ? -1 : 1;
        }

        if (leftAssignment.isAwaitingResponse !== rightAssignment.isAwaitingResponse) {
          return leftAssignment.isAwaitingResponse ? -1 : 1;
        }

        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      });
  }, [linkedTrips, searchQuery]);

  const filteredOpsTrips = useMemo(() => {
    return linkedTrips.filter((trip) => {
      if (!trip.needs_manual_review) return false;
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        trip.pickup.raw_text.toLowerCase().includes(query) ||
        trip.dropoff.raw_text.toLowerCase().includes(query) ||
        (trip.validation_notes?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [linkedTrips, searchQuery]);

  const assignmentWatchTrips = useMemo(() => {
    return linkedTrips
      .filter((trip) => getAssignmentResponseState(trip).isAwaitingResponse)
      .sort((left, right) => {
        const leftState = getAssignmentResponseState(left);
        const rightState = getAssignmentResponseState(right);

        if (leftState.isTimedOut !== rightState.isTimedOut) {
          return leftState.isTimedOut ? -1 : 1;
        }

        return rightState.ageMinutes - leftState.ageMinutes;
      });
  }, [linkedTrips]);

  const availableRiders = useMemo(() => {
    return riders.filter((rider) => rider.is_verified && rider.status === 'available');
  }, [riders]);

  const selectedLocation = useMemo(() => {
    if (activeTab !== 'landmarks') return null;
    return [...hotspots, ...candidateLocations, ...landmarkSearchResults].find((loc) => loc.id === selectedId) ?? null;
  }, [hotspots, candidateLocations, landmarkSearchResults, selectedId, activeTab]);

  const selectedTrip = useMemo(() => {
    if (activeTab === 'trips' || activeTab === 'ops') return linkedTrips.find(trip => trip.id === selectedId);
    return null;
  }, [linkedTrips, selectedId, activeTab]);

  const selectedRider = useMemo(() => {
    if (activeTab !== 'ops') return null;
    return riders.find((rider) => rider.id === selectedRiderId) ?? null;
  }, [activeTab, riders, selectedRiderId]);

  useEffect(() => {
    if (!selectedRider) {
      return;
    }

    setRiderNoteDrafts((current) => {
      if (current[selectedRider.id] !== undefined) {
        return current;
      }

      return {
        ...current,
        [selectedRider.id]: selectedRider.ops_notes ?? '',
      };
    });
  }, [selectedRider]);

  const pendingRiders = useMemo(() => {
    return riders
      .filter((rider) => !rider.is_verified)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  }, [riders]);

  const managedRiders = useMemo(() => {
    return riders
      .filter((rider) => rider.is_verified || rider.status === 'suspended')
      .sort((left, right) => {
        if (left.status === 'suspended' && right.status !== 'suspended') return -1;
        if (left.status !== 'suspended' && right.status === 'suspended') return 1;
        return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      })
      .slice(0, 8);
  }, [riders]);

  const filteredPendingRiders = useMemo(() => {
    return pendingRiders.filter((rider) => matchesRiderQuery(rider, riderSearchQuery));
  }, [pendingRiders, riderSearchQuery]);

  const filteredManagedRiders = useMemo(() => {
    return managedRiders.filter((rider) => matchesRiderQuery(rider, riderSearchQuery));
  }, [managedRiders, riderSearchQuery]);

  const riderRecommendations = useMemo<RiderRecommendation[]>(() => {
    if (!selectedTrip) {
      return [];
    }

    const currentTripHistory = tripAssignmentHistory[selectedTrip.id] ?? EMPTY_TRIP_ASSIGNMENT_HISTORY;

    return availableRiders
      .map((rider) => {
        const riderPerformance = riderMetrics[rider.id] ?? EMPTY_RIDER_PERFORMANCE;
        const riderHistory = riderAssignmentStats[rider.id] ?? EMPTY_RIDER_ASSIGNMENT_STATS;
        const distanceToPickupKm =
          typeof rider.current_latitude === 'number' &&
          typeof rider.current_longitude === 'number'
            ? getDistanceInKm(
                rider.current_latitude,
                rider.current_longitude,
                selectedTrip.pickup.latitude,
                selectedTrip.pickup.longitude,
              )
            : null;

        return {
          ...rider,
          distanceToPickupKm,
          freshnessMinutes: getMinutesSince(rider.last_seen_at),
          performance: riderPerformance,
          zoneMatch: matchesServiceZone(rider, selectedTrip),
          hasStaleGps: hasStaleRiderGps(rider.last_seen_at),
          cancellationRate:
            riderPerformance.recentTrips > 0
              ? (riderPerformance.canceledTrips / riderPerformance.recentTrips)
              : 0,
          completionRate:
            riderPerformance.recentTrips > 0
              ? (riderPerformance.completedTrips / riderPerformance.recentTrips)
              : 0,
          priorDeclineForTrip: currentTripHistory.declinedRiderIds.includes(rider.id),
          priorTimeoutForTrip: currentTripHistory.timedOutRiderIds.includes(rider.id),
          assignmentHistory: riderHistory,
        };
      })
      .filter((rider) => !rider.priorDeclineForTrip && !rider.priorTimeoutForTrip)
      .sort((left, right) => {
        const statusPriority = getRiderStatusPriority(left.status) - getRiderStatusPriority(right.status);
        if (statusPriority !== 0) return statusPriority;

        if (left.zoneMatch !== right.zoneMatch) {
          return left.zoneMatch ? -1 : 1;
        }

        if (left.hasStaleGps !== right.hasStaleGps) {
          return left.hasStaleGps ? 1 : -1;
        }

        const leftHighCancellationRisk = left.performance.recentTrips >= 3 && left.cancellationRate >= 0.3;
        const rightHighCancellationRisk = right.performance.recentTrips >= 3 && right.cancellationRate >= 0.3;
        if (leftHighCancellationRisk !== rightHighCancellationRisk) {
          return leftHighCancellationRisk ? 1 : -1;
        }

        const leftWeakResponsePattern = left.assignmentHistory.declines + left.assignmentHistory.timeouts;
        const rightWeakResponsePattern = right.assignmentHistory.declines + right.assignmentHistory.timeouts;
        if (leftWeakResponsePattern !== rightWeakResponsePattern) {
          return leftWeakResponsePattern - rightWeakResponsePattern;
        }

        if (left.cancellationRate !== right.cancellationRate) return left.cancellationRate - right.cancellationRate;
        if (left.completionRate !== right.completionRate) return right.completionRate - left.completionRate;

        const leftDistance = left.distanceToPickupKm ?? Number.POSITIVE_INFINITY;
        const rightDistance = right.distanceToPickupKm ?? Number.POSITIVE_INFINITY;
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;

        const leftFreshness = left.freshnessMinutes ?? Number.POSITIVE_INFINITY;
        const rightFreshness = right.freshnessMinutes ?? Number.POSITIVE_INFINITY;
        return leftFreshness - rightFreshness;
      });
  }, [availableRiders, riderAssignmentStats, riderMetrics, selectedTrip, tripAssignmentHistory]);

  const reassignmentRecommendations = useMemo(() => {
    if (!selectedTrip?.rider_id) {
      return riderRecommendations;
    }

    return riderRecommendations.filter((rider) => rider.id !== selectedTrip.rider_id);
  }, [riderRecommendations, selectedTrip]);

  // Phase 3: Route Data & Pricing State
  const [routeLoading, setRouteLoading] = useState(false);
  const [activeRoute, setActiveRoute] = useState<RouteData | null>(null);

  useEffect(() => {
    async function updateRoute() {
      if (selectedTrip) {
        setRouteLoading(true);
        const data = await getDrivingRoute(
          [selectedTrip.pickup.longitude, selectedTrip.pickup.latitude],
          [selectedTrip.dropoff.longitude, selectedTrip.dropoff.latitude]
        );
        setActiveRoute(data);
        setRouteLoading(false);
      } else {
        setActiveRoute(null);
      }
    }
    updateRoute();
  }, [selectedTrip]);

  const opsStats = useMemo(() => {
    const manualReviewTrips = linkedTrips.filter((trip) => trip.needs_manual_review);
    const pendingAssignments = linkedTrips.filter((trip) => getAssignmentResponseState(trip).isAwaitingResponse);
    const clarifyEvents = events.filter((event) => event.action_taken === 'clarify');
    const pinEvents = events.filter((event) => event.action_taken === 'request_pin');
    const retryLimitEvents = events.filter((event) => event.action_taken === 'retry_limit_exceeded');

    return {
      manualReviewTrips: manualReviewTrips.length,
      pendingAssignments: pendingAssignments.length,
      timedOutAssignments: pendingAssignments.filter((trip) => getAssignmentResponseState(trip).isTimedOut).length,
      clarifyEvents: clarifyEvents.length,
      pinEvents: pinEvents.length,
      retryLimitEvents: retryLimitEvents.length,
    };
  }, [events, linkedTrips]);

  const riderPipelineStats = useMemo(() => {
    return {
      pendingApproval: riders.filter((rider) => !rider.is_verified).length,
      verifiedOffline: riders.filter((rider) => rider.is_verified && rider.status === 'offline').length,
      verifiedAvailable: riders.filter((rider) => rider.is_verified && rider.status === 'available').length,
      suspended: riders.filter((rider) => rider.status === 'suspended').length,
    };
  }, [riders]);

  const ambiguityHotspots = useMemo<HotspotStat[]>(() => {
    const counts = new Map<string, number>();
    const knownLocations = [...hotspots, ...candidateLocations, ...linkedTrips.flatMap((trip) => [trip.pickup, trip.dropoff])];

    events
      .filter((event) => event.action_taken === 'clarify' && event.selected_location_id)
      .forEach((event) => {
        const location = knownLocations.find((entry) => entry.id === event.selected_location_id);
        const label = location?.raw_text || 'Unknown landmark';
        counts.set(label, (counts.get(label) || 0) + 1);
      });

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [events, hotspots, candidateLocations, linkedTrips]);

  const outcomeStats = useMemo<HotspotStat[]>(() => {
    const counts = new Map<string, number>();
    events.forEach((event) => {
      counts.set(event.action_taken, (counts.get(event.action_taken) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [events]);

  const riderLoadCounts = useMemo(() => {
    const counts = new Map<string, number>();

    linkedTrips.forEach((trip) => {
      if (!trip.rider_id) {
        return;
      }

      const normalizedStatus = trip.status.trim().toLowerCase();
      if (normalizedStatus === 'completed' || normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
        return;
      }

      counts.set(trip.rider_id, (counts.get(trip.rider_id) ?? 0) + 1);
    });

    return counts;
  }, [linkedTrips]);

  const staleTripsCount = useMemo(() => {
    return linkedTrips.filter((trip) => getStaleTripState(trip).isStale).length;
  }, [linkedTrips]);

  const stats = useMemo(() => ({
    total: locationStats.totalLocations,
    verified: locationStats.verifiedLocations,
    activeTrips: linkedTrips.length,
    reviewTrips: linkedTrips.filter((trip) => trip.needs_manual_review).length,
    staleTrips: staleTripsCount,
    pendingRiders: riders.filter((rider) => !rider.is_verified).length,
    readyRiders: riders.filter((rider) => rider.is_verified && rider.status === 'available').length,
  }), [locationStats, linkedTrips, riders, staleTripsCount]);

  const mapMarkers = useMemo(() => {
    const markerMap = new Map<string, Location>();

    displayedHotspots.forEach((location) => markerMap.set(location.id, location));
    candidateLocations.forEach((location) => markerMap.set(location.id, location));

    if (selectedLocation) {
      markerMap.set(selectedLocation.id, selectedLocation);
    }

    return Array.from(markerMap.values());
  }, [displayedHotspots, candidateLocations, selectedLocation]);

  // Fix hydration mismatch by moving token check to client-side only
  const [hasToken, setHasToken] = useState(false);
  useEffect(() => {
    setHasToken(
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN !== undefined && 
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN_HERE'
    );
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl shadow-inner">
            <MapIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground/90">Nuna Intelligence</h1>
            <div className="flex items-center gap-1.5 leading-none">
              <MapPin className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Minna Operations Dashboard</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative hidden md:block group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <input 
              type="text" 
              placeholder={`Search ${activeTab === 'landmarks' ? 'hotspots' : 'bookings'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-muted/30 border border-border rounded-full text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 w-64 transition-all hover:bg-muted/50"
            />
          </div>
          <button 
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2.5 hover:bg-muted rounded-xl transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <div className="h-6 w-px bg-border mx-1" />
          <Link
            href="/nuna/landmarks/new"
            className="rounded-xl border border-border bg-background px-3 py-2 text-[10px] font-black uppercase tracking-widest text-foreground/80 transition-colors hover:bg-muted"
          >
            Add Landmark
          </Link>
          <Link
            href="/nuna/landmarks/import"
            className="rounded-xl border border-border bg-background px-3 py-2 text-[10px] font-black uppercase tracking-widest text-foreground/80 transition-colors hover:bg-muted"
          >
            Import CSV
          </Link>
          <div className="flex items-center gap-2 bg-primary/5 px-3 py-1.5 rounded-full border border-primary/10">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            <span className="text-[10px] font-bold text-primary uppercase tracking-tighter">Live Monitor</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex overflow-hidden">
        {/* Sidebar Space for Data */}
        <aside className="w-80 border-r border-border bg-card flex flex-col overflow-hidden shadow-2xl z-20">
          {/* Tab Switcher */}
          <div className="px-4 pt-4">
            <div className="bg-muted/40 p-1 rounded-2xl flex gap-1 border border-border/50">
              <button 
                onClick={() => { setActiveTab('landmarks'); setSelectedId(null); setSelectedRiderId(null); }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'landmarks' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                Hotspots
              </button>
              <button 
                onClick={() => { setActiveTab('trips'); setSelectedId(null); setSelectedRiderId(null); }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'trips' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                Live Trips
              </button>
              <button 
                onClick={() => { setActiveTab('ops'); setSelectedId(null); setSelectedRiderId(null); }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'ops' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                Ops
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4">
            <div className="px-3 pb-2 flex items-center justify-between bg-card sticky top-0 py-2 z-10 border-b border-border/50 mb-2">
               <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                 {activeTab === 'landmarks' ? 'Top Hotspots' : activeTab === 'trips' ? 'Recent Bookings' : 'Ops Watchlist'}
               </p>
               {(refreshing || landmarkSearchLoading) && <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
            </div>

            {errorMsg && (
              <div className="p-4 mx-2 mt-2 bg-red-500/10 border border-red-500/20 rounded-xl">
                <div className="flex items-center gap-2 text-red-600 mb-1">
                  <AlertCircle className="w-4 h-4" />
                  <p className="text-[10px] font-bold uppercase">Fetch Error</p>
                </div>
                <p className="text-[10px] text-red-600/80 font-medium leading-relaxed">{errorMsg}</p>
              </div>
            )}

            {loading ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                <p className="text-[10px] text-muted-foreground font-medium animate-pulse">Syncing logistics brain...</p>
              </div>
            ) : activeTab === 'landmarks' ? (
              /* LANDMARKS LIST */
              displayedHotspots.length === 0 && candidateLocations.length === 0 ? (
                <div className="p-8 text-center bg-muted/5 rounded-2xl mx-2 border border-dashed border-border mt-8">
                  <Layers className="w-8 h-8 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-xs font-bold text-foreground mb-1">No hotspots found</h3>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">Adjust your search or wait for new WhatsApp bookings.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="px-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      {searchQuery.trim() ? 'Search Results' : 'Popular Hotspots'}
                    </p>
                  </div>
                  <div className="space-y-1">
                  {displayedHotspots.map((loc) => (
                    <div 
                      key={loc.id}
                      onClick={() => setSelectedId(loc.id)}
                      className={`
                        group p-3 rounded-2xl transition-all cursor-pointer border border-transparent mx-1
                        ${selectedId === loc.id ? 'bg-primary/5 border-primary/10' : 'hover:bg-muted/50'}
                      `}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`
                          mt-1 w-2 h-2 rounded-full shrink-0 shadow-sm
                          ${loc.is_verified ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-amber-500 animate-pulse'}
                        `} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-bold truncate ${selectedId === loc.id ? 'text-primary' : 'text-foreground/90'}`}>
                            {loc.raw_text}
                          </p>
                          <p className="text-[9px] text-muted-foreground font-medium mt-0.5 flex items-center gap-1.5">
                            {loc.hit_count} hits • {new Date(loc.created_at).toLocaleDateString()}
                          </p>
                          
                          {selectedId === loc.id && !loc.is_verified && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleVerify(loc.id);
                              }}
                              className="mt-2 text-[8px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md hover:bg-emerald-500/20 transition-colors flex items-center gap-1 w-fit group/btn"
                            >
                             <CheckCircle2 className="w-2.5 h-2.5 group-hover/btn:scale-110 transition-transform" />
                             Verify Landmark
                            </button>
                          )}
                        </div>
                        {loc.hit_count > 5 && (
                          <div className="p-1 px-1.5 bg-primary/10 rounded-md text-primary" title="Popular Hotspot">
                            <TrendingUp className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  </div>
                  {!searchQuery.trim() && (
                    <>
                      <div className="px-3 pt-2">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          Needs Review
                        </p>
                      </div>
                      {candidateLocations.length === 0 ? (
                        <div className="p-6 text-center bg-muted/5 rounded-2xl mx-2 border border-dashed border-border">
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            No unverified landmarks waiting right now.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {candidateLocations.map((loc) => (
                            <div 
                              key={loc.id}
                              onClick={() => setSelectedId(loc.id)}
                              className={`
                                group p-3 rounded-2xl transition-all cursor-pointer border border-transparent mx-1
                                ${selectedId === loc.id ? 'bg-amber-500/10 border-amber-500/20' : 'hover:bg-muted/50'}
                              `}
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-1 w-2 h-2 rounded-full shrink-0 shadow-sm bg-amber-500 animate-pulse" />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-bold truncate ${selectedId === loc.id ? 'text-amber-700' : 'text-foreground/90'}`}>
                                    {loc.raw_text}
                                  </p>
                                  <p className="text-[9px] text-muted-foreground font-medium mt-0.5 flex items-center gap-1.5">
                                    {loc.hit_count} hits • review needed
                                  </p>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleVerify(loc.id);
                                    }}
                                    className="mt-2 text-[8px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md hover:bg-emerald-500/20 transition-colors flex items-center gap-1 w-fit group/btn"
                                  >
                                    <CheckCircle2 className="w-2.5 h-2.5 group-hover/btn:scale-110 transition-transform" />
                                    Verify Landmark
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            ) : activeTab === 'trips' ? (
              /* TRIPS LIST */
              filteredTrips.length === 0 ? (
                <div className="p-8 text-center bg-muted/5 rounded-2xl mx-2 border border-dashed border-border mt-8">
                  <MapPin className="w-8 h-8 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-xs font-bold text-foreground mb-1">No trips found</h3>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">New bookings from WhatsApp will appear here automatically.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredTrips.map((trip) => (
                    (() => {
                      const staleState = getStaleTripState(trip);
                      const assignmentState = getAssignmentResponseState(trip);

                      return (
                    <div 
                      key={trip.id}
                      onClick={() => setSelectedId(trip.id)}
                      className={`
                        group p-4 rounded-2xl transition-all cursor-pointer border border-transparent mx-1
                        ${selectedId === trip.id ? 'bg-primary/5 border-primary/10' : 'hover:bg-muted/50'}
                        ${staleState.isStale ? 'ring-1 ring-red-500/20 bg-red-500/[0.03]' : ''}
                        ${assignmentState.isTimedOut ? 'ring-1 ring-amber-500/30 bg-amber-500/[0.06]' : ''}
                      `}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className={`flex items-center gap-1.5 shadow-xs px-2 py-0.5 rounded-full border ${getTripStatusClasses(trip.status)}`}>
                            <div className="w-1.5 h-1.5 rounded-full bg-current" />
                            <span className="text-[8px] font-black uppercase tracking-tighter">
                              {trip.status}
                            </span>
                          </div>
                          {staleState.isStale && (
                            <div className="flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-red-700">
                              <AlertCircle className="h-3 w-3" />
                              <span className="text-[8px] font-black uppercase tracking-tighter">
                                Stale
                              </span>
                            </div>
                          )}
                          {assignmentState.isAwaitingResponse && (
                            <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${assignmentState.isTimedOut ? 'border border-amber-500/20 bg-amber-500/10 text-amber-800' : 'border border-primary/20 bg-primary/10 text-primary'}`}>
                              <TimerReset className="h-3 w-3" />
                              <span className="text-[8px] font-black uppercase tracking-tighter">
                                {assignmentState.isTimedOut ? 'No response' : 'Awaiting rider'}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="block text-[8px] font-bold text-muted-foreground">
                            {new Date(trip.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`block text-[8px] font-bold ${staleState.isStale ? 'text-red-700' : 'text-muted-foreground'}`}>
                            {formatMinutesLabel(staleState.ageMinutes)} open
                          </span>
                          {assignmentState.isAwaitingResponse && (
                            <span className={`block text-[8px] font-bold ${assignmentState.isTimedOut ? 'text-amber-800' : 'text-primary'}`}>
                              {formatMinutesLabel(assignmentState.ageMinutes)} waiting
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2.5 relative pl-4 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-muted before:rounded-full">
                        <div className="relative">
                          <div className="absolute -left-[18.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/10" />
                          <p className="text-[10px] font-bold text-foreground/90 leading-tight">
                            {trip.pickup.raw_text}
                          </p>
                        </div>
                        <div className="relative">
                          <div className="absolute -left-[18.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 ring-4 ring-amber-500/10" />
                          <p className="text-[10px] font-bold text-foreground/90 leading-tight">
                            {trip.dropoff.raw_text}
                          </p>
                        </div>
                      </div>

                      {/* Phase 3: Pricing Info (Only when selected) */}
                      {selectedId === trip.id && activeRoute && (
                        <div className="mt-4 pt-4 border-t border-primary/10 flex items-center justify-between gap-2">
                           <div className="flex items-center gap-1.5 p-2 bg-emerald-500/5 rounded-xl border border-emerald-500/10 flex-1">
                              <Navigation className="w-3 h-3 text-emerald-600" />
                              <span className="text-[10px] font-black text-emerald-700">{(activeRoute.distance / 1000).toFixed(1)} KM</span>
                           </div>
                           <div className="flex items-center gap-1.5 p-2 bg-primary/5 rounded-xl border border-primary/10 flex-1">
                              <Banknote className="w-3 h-3 text-primary" />
                              <span className="text-[10px] font-black text-primary">₦{calculateSuggestedPrice(activeRoute.distance)}</span>
                           </div>
                        </div>
                      )}
                      
                      {selectedId === trip.id && routeLoading && (
                        <div className="mt-4 pt-4 border-t border-primary/10 flex items-center justify-center gap-2">
                           <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                           <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Calculating Route...</p>
                        </div>
                      )}
                    </div>
                      );
                    })()
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-4 px-1">
                <div className="mx-1 rounded-2xl border border-red-500/10 bg-red-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Manual Review Queue</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-red-500/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-red-600">{opsStats.manualReviewTrips}</p>
                      <p className="text-[8px] font-bold uppercase text-red-600/70">Flagged Trips</p>
                    </div>
                    <div className="rounded-xl border border-amber-500/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-amber-600">{opsStats.retryLimitEvents}</p>
                      <p className="text-[8px] font-bold uppercase text-amber-600/70">Retry Failures</p>
                    </div>
                    <div className="rounded-xl border border-primary/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-primary">{opsStats.pendingAssignments}</p>
                      <p className="text-[8px] font-bold uppercase text-primary/70">Awaiting Rider</p>
                    </div>
                    <div className="rounded-xl border border-red-500/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-red-600">{opsStats.timedOutAssignments}</p>
                      <p className="text-[8px] font-bold uppercase text-red-600/70">Timed Out</p>
                    </div>
                  </div>
                </div>

                <div className="mx-1 rounded-2xl border border-amber-500/10 bg-amber-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <TimerReset className="h-4 w-4 text-amber-700" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-800">Assignment Watch</p>
                  </div>
                  {assignmentWatchTrips.length === 0 ? (
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      No rider assignments are waiting for response right now.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {assignmentWatchTrips
                        .slice(0, 4)
                        .map((trip) => {
                          const responseState = getAssignmentResponseState(trip);

                          return (
                            <button
                              key={trip.id}
                              type="button"
                              onClick={() => {
                                setActiveTab('ops');
                                setSelectedId(trip.id);
                                setSelectedRiderId(null);
                              }}
                              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                responseState.isTimedOut
                                  ? 'border-red-500/20 bg-red-500/10 hover:bg-red-500/15'
                                  : 'border-amber-500/20 bg-background/80 hover:bg-amber-500/10'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="truncate text-[10px] font-bold text-foreground">
                                  {trip.assigned_rider?.full_name || trip.assigned_rider?.phone_number || 'Assigned rider'}
                                </p>
                                <span className={`text-[8px] font-black uppercase tracking-widest ${responseState.isTimedOut ? 'text-red-700' : 'text-amber-800'}`}>
                                  {responseState.isTimedOut ? 'Timed out' : 'Waiting'}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-[9px] text-foreground/75">
                                {trip.pickup.metadata?.address || trip.pickup.raw_text} to {trip.dropoff.metadata?.address || trip.dropoff.raw_text}
                              </p>
                              <p className={`mt-1 text-[8px] font-bold ${responseState.isTimedOut ? 'text-red-700' : 'text-amber-800'}`}>
                                {formatMinutesLabel(responseState.ageMinutes)} since assignment
                              </p>
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>

                <div className="mx-1 rounded-2xl border border-border/60 bg-background/80 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Find Riders</p>
                    <span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">
                      name, phone, zone
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={riderSearchQuery}
                      onChange={(event) => setRiderSearchQuery(event.target.value)}
                      placeholder="Search riders..."
                      className="w-full rounded-2xl border border-border bg-muted/20 py-3 pl-10 pr-4 text-[11px] font-medium outline-none transition-colors focus:border-primary/30"
                    />
                  </div>
                </div>

                <div className="mx-1 rounded-2xl border border-emerald-500/10 bg-emerald-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">Pending Riders</p>
                  </div>
                  {filteredPendingRiders.length === 0 ? (
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      {riderSearchQuery.trim() ? 'No pending riders match this search.' : 'No new rider profiles are waiting for approval.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filteredPendingRiders.slice(0, 6).map((rider) => (
                        <button
                          key={rider.id}
                          type="button"
                          onClick={() => {
                            setSelectedRiderId(rider.id);
                            setSelectedId(null);
                          }}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                            selectedRiderId === rider.id
                              ? 'border-emerald-500/20 bg-emerald-500/10'
                              : 'border-emerald-500/10 bg-background/80 hover:bg-emerald-500/10'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-[10px] font-bold text-foreground">
                              {rider.full_name || rider.phone_number || 'Unnamed rider'}
                            </p>
                            <span className="text-[8px] font-black uppercase tracking-widest text-emerald-800">
                              Pending
                            </span>
                          </div>
                          <p className="mt-1 truncate text-[9px] text-foreground/75">
                            {rider.phone_number || 'No phone'} • {rider.service_zone || 'No zone'} • {rider.vehicle_type || 'No vehicle'}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mx-1 rounded-2xl border border-border/60 bg-muted/10 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Bike className="h-4 w-4 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Rider Pipeline</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-amber-500/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-amber-700">{riderPipelineStats.pendingApproval}</p>
                      <p className="text-[8px] font-bold uppercase text-amber-700/70">Pending</p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-foreground">{riderPipelineStats.verifiedOffline}</p>
                      <p className="text-[8px] font-bold uppercase text-muted-foreground">Offline</p>
                    </div>
                    <div className="rounded-xl border border-primary/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-primary">{riderPipelineStats.verifiedAvailable}</p>
                      <p className="text-[8px] font-bold uppercase text-primary/70">Available</p>
                    </div>
                    <div className="rounded-xl border border-red-500/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-red-600">{riderPipelineStats.suspended}</p>
                      <p className="text-[8px] font-bold uppercase text-red-600/70">Suspended</p>
                    </div>
                  </div>
                </div>

                <div className="mx-1 rounded-2xl border border-border/60 bg-muted/10 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Bike className="h-4 w-4 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Rider Management</p>
                  </div>
                  {filteredManagedRiders.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      {riderSearchQuery.trim() ? 'No riders match this search.' : 'No verified or suspended riders yet.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {filteredManagedRiders.map((rider) => (
                        <button
                          key={rider.id}
                          type="button"
                          onClick={() => {
                            setSelectedRiderId(rider.id);
                            setSelectedId(null);
                          }}
                          className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                            selectedRiderId === rider.id
                              ? 'border-primary/20 bg-primary/10'
                              : 'border-border/70 bg-background/80 hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-[10px] font-bold text-foreground">
                              {rider.full_name || rider.phone_number || 'Unnamed rider'}
                            </p>
                            <span className={`text-[8px] font-black uppercase tracking-widest ${
                              rider.status === 'suspended' ? 'text-red-700' : 'text-primary'
                            }`}>
                              {rider.status}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-[9px] text-foreground/75">
                            {rider.service_zone || 'No zone'} • {rider.vehicle_type || 'No vehicle'}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  {filteredOpsTrips.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/5 p-8 text-center">
                      <Siren className="mx-auto mb-4 h-8 w-8 text-muted-foreground/30" />
                      <h3 className="mb-1 text-xs font-bold text-foreground">No flagged trips</h3>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">Trips that need manual review will appear here.</p>
                    </div>
                  ) : (
                    filteredOpsTrips.map((trip) => (
                      <div
                        key={trip.id}
                        onClick={() => { setSelectedId(trip.id); setSelectedRiderId(null); }}
                        className={`mx-1 cursor-pointer rounded-2xl border p-4 transition-all ${selectedId === trip.id ? 'border-red-500/20 bg-red-500/5' : 'border-transparent hover:bg-muted/50'}`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5">
                            <Siren className="h-3 w-3 text-red-600" />
                            <span className="text-[8px] font-black uppercase tracking-tighter text-red-700">Manual Review</span>
                          </div>
                          <span className="text-[8px] font-bold text-muted-foreground">{new Date(trip.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="space-y-2.5">
                          <p className="text-[10px] font-bold text-foreground/90">{trip.pickup.raw_text}</p>
                          <p className="text-[10px] font-bold text-foreground/90">{trip.dropoff.raw_text}</p>
                        </div>
                        {trip.validation_notes && (
                          <div className="mt-3 rounded-xl border border-red-500/10 bg-background/80 p-2">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-red-700">Review Note</p>
                            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{trip.validation_notes}</p>
                          </div>
                        )}
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Link
                            href={`/nuna/landmarks/new?tripId=${trip.id}&leg=pickup`}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-center text-[9px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                          >
                            Promote Pickup
                          </Link>
                          <Link
                            href={`/nuna/landmarks/new?tripId=${trip.id}&leg=dropoff`}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-center text-[9px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                          >
                            Promote Drop-off
                          </Link>
                        </div>
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={reviewDrafts[trip.id] ?? ''}
                            onChange={(e) =>
                              setReviewDrafts((prev) => ({
                                ...prev,
                                [trip.id]: e.target.value,
                              }))
                            }
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Add operator note..."
                            className="min-h-20 w-full rounded-xl border border-border bg-background/80 px-3 py-2 text-[10px] font-medium text-foreground outline-none transition-colors focus:border-primary/30"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSaveReviewNote(trip.id, trip.validation_notes);
                              }}
                              disabled={actioningTripId === trip.id || !(reviewDrafts[trip.id]?.trim())}
                              className="flex-1 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actioningTripId === trip.id ? 'Saving...' : 'Save Note'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleResolveReview(trip.id);
                              }}
                              disabled={actioningTripId === trip.id}
                              className="flex-1 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {actioningTripId === trip.id ? 'Resolving...' : 'Resolve Review'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mx-1 rounded-2xl border border-border/60 bg-muted/10 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-foreground/80">Resolution Signals</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-primary/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-primary">{opsStats.clarifyEvents}</p>
                      <p className="text-[8px] font-bold uppercase text-primary/70">Clarify</p>
                    </div>
                    <div className="rounded-xl border border-amber-500/10 bg-background/80 p-3 text-center">
                      <p className="text-xs font-black text-amber-600">{opsStats.pinEvents}</p>
                      <p className="text-[8px] font-bold uppercase text-amber-600/70">Pin Requests</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Ambiguity Hotspots</p>
                    {ambiguityHotspots.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">No clarification hotspots yet.</p>
                    ) : (
                      ambiguityHotspots.map((item) => (
                        <div key={item.label} className="flex items-center justify-between rounded-xl bg-background/80 px-3 py-2">
                          <span className="truncate pr-3 text-[10px] font-bold text-foreground/90">{item.label}</span>
                          <span className="text-[9px] font-black uppercase text-primary">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-4 space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Event Outcomes</p>
                    {outcomeStats.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">No event data yet.</p>
                    ) : (
                      outcomeStats.map((item) => (
                        <div key={item.label} className="flex items-center justify-between rounded-xl bg-background/80 px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/80">{item.label.replaceAll('_', ' ')}</span>
                          <span className="text-[9px] font-black uppercase text-foreground">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-muted/20 border-t border-border mt-auto">
            <div className={`p-3 rounded-xl flex items-center gap-3 ${hasToken ? 'bg-emerald-500/5 border border-emerald-500/10' : 'bg-amber-500/10 border border-amber-500/20'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${hasToken ? 'bg-emerald-500' : 'bg-amber-500 pulse'}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-[9px] font-black uppercase tracking-tighter ${hasToken ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {hasToken ? 'Tiles Loaded' : 'Token Missing'}
                </p>
                <p className="text-[8px] text-muted-foreground font-bold truncate">
                  {hasToken ? 'Chanchaga Vector Grid Active' : 'Check .env.local config'}
                </p>
              </div>
              <MapPin className={`w-3.5 h-3.5 ${hasToken ? 'text-emerald-600/50' : 'text-amber-600/50'}`} />
            </div>
          </div>
        </aside>

        {/* Map Container */}
        <div className="flex-1 relative h-full">
          <MapboxMap 
            center={selectedLocation ? [selectedLocation.longitude, selectedLocation.latitude] : [6.55694, 9.61389]} 
            zoom={selectedLocation ? 15 : 13} 
            style={NUNA_MAP_STYLE}
            hideMapboxLabels
            selectedMarkerId={activeTab === 'landmarks' ? selectedId : null}
            activeTrip={selectedTrip ? {
              id: selectedTrip.id,
              pickup: { lat: selectedTrip.pickup.latitude, lng: selectedTrip.pickup.longitude },
              dropoff: { lat: selectedTrip.dropoff.latitude, lng: selectedTrip.dropoff.longitude },
              geometry: activeRoute?.geometry
            } : undefined}
            markers={mapMarkers.map(loc => ({
              id: loc.id,
              latitude: loc.latitude,
              longitude: loc.longitude,
              raw_text: loc.raw_text,
              is_verified: loc.is_verified,
              hit_count: loc.hit_count
            }))}
            onMarkerClick={(id) => {
              if (activeTab === 'landmarks') setSelectedId(id);
            }}
          />

          {/* Map Overlay HUD */}
        <div className="absolute left-6 top-6 right-[22rem] z-10 pointer-events-none hidden xl:block">
             <div className="rounded-2xl border border-border bg-background/90 p-4 shadow-2xl backdrop-blur-xl pointer-events-auto">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Operational Stats</h2>
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
                </div>
                <div className="grid grid-cols-7 gap-2">
                  <div className="rounded-xl border border-border/50 bg-muted/30 p-2.5 text-center transition-all hover:bg-muted/50 cursor-default">
                    <p className="text-xs font-black text-foreground">{stats.total}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-muted-foreground">Total Hubs</p>
                  </div>
                  <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-2.5 text-center transition-all hover:bg-emerald-500/10 cursor-default">
                    <p className="text-xs font-black text-emerald-600">{stats.verified}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-emerald-600/70">Verified</p>
                  </div>
                  <div className="rounded-xl border border-primary/10 bg-primary/5 p-2.5 text-center transition-all hover:bg-primary/10 cursor-default">
                    <p className="text-xs font-black text-primary">{stats.activeTrips}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-primary/70">Bookings</p>
                  </div>
                  <div className="rounded-xl border border-red-500/10 bg-red-500/5 p-2.5 text-center transition-all hover:bg-red-500/10 cursor-default">
                    <p className="text-xs font-black text-red-600">{stats.reviewTrips}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-red-600/70">Review</p>
                  </div>
                  <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-2.5 text-center transition-all hover:bg-amber-500/10 cursor-default">
                    <p className="text-xs font-black text-amber-600">{stats.staleTrips}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-amber-600/70">Stale</p>
                  </div>
                  <div className="rounded-xl border border-primary/10 bg-primary/5 p-2.5 text-center transition-all hover:bg-primary/10 cursor-default">
                    <p className="text-xs font-black text-primary">{stats.readyRiders}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-primary/70">Ready Riders</p>
                  </div>
                  <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-2.5 text-center transition-all hover:bg-amber-500/10 cursor-default">
                    <p className="text-xs font-black text-amber-700">{stats.pendingRiders}</p>
                    <p className="mt-0.5 text-[8px] font-bold uppercase text-amber-700/70">Pending Riders</p>
                  </div>
                </div>
             </div>
          </div>
        <div className="absolute top-6 right-6 flex flex-col gap-2 z-10 pointer-events-none">
             {activeTab === 'landmarks' && selectedLocation && (
               <div className="bg-background/90 backdrop-blur-xl p-4 rounded-2xl border border-border shadow-2xl pointer-events-auto w-[280px]">
                  <p className="text-[10px] font-black text-primary uppercase tracking-[0.22em]">Hotspot Details</p>
                  <div className="mt-3 space-y-2">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Name</p>
                      <p className="mt-1 text-xs font-bold text-foreground break-words">{selectedLocation.raw_text}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Address</p>
                      <p className="mt-1 text-[11px] font-medium text-foreground/80 break-words">
                        {selectedLocation.metadata?.address || 'No address saved'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Verified</p>
                        <p className={`mt-1 text-[11px] font-bold ${selectedLocation.is_verified ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {selectedLocation.is_verified ? 'Yes' : 'No'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Confidence</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedLocation.confidence_score.toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Hits</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedLocation.hit_count}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Category</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground capitalize">
                          {selectedLocation.metadata?.category || 'landmark'}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Lat / Lng</p>
                      <p className="mt-1 text-[11px] font-mono font-medium text-foreground/85">
                        {selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}
                      </p>
                    </div>
                  </div>
               </div>
             )}
             {activeTab === 'ops' && !selectedTrip && selectedRider && (
               <div className="bg-background/90 backdrop-blur-xl p-4 rounded-2xl border border-border shadow-2xl pointer-events-auto w-[320px]">
                  <p className="text-[10px] font-black text-primary uppercase tracking-[0.22em]">Rider Details</p>
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Name</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedRider.full_name || 'Unnamed rider'}
                        </p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Status</p>
                        <p className={`mt-1 text-[11px] font-bold ${selectedRider.status === 'suspended' ? 'text-red-700' : selectedRider.is_verified ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {selectedRider.status}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Phone</p>
                      <p className="mt-1 text-[11px] font-bold text-foreground">
                        {selectedRider.phone_number || 'No phone number'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Zone</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedRider.service_zone || 'Not set'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Vehicle</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedRider.vehicle_type || 'Not set'}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Plate Number</p>
                      <p className="mt-1 text-[11px] font-bold text-foreground">
                        {selectedRider.bike_plate_number || 'Not set'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Approval</p>
                      <p className={`mt-1 text-[11px] font-bold ${selectedRider.is_verified ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {selectedRider.is_verified ? 'Verified for dispatch' : 'Pending ops approval'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
                      <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Ops Notes</p>
                      <textarea
                        value={riderNoteDrafts[selectedRider.id] ?? ''}
                        onChange={(event) =>
                          setRiderNoteDrafts((current) => ({
                            ...current,
                            [selectedRider.id]: event.target.value,
                          }))
                        }
                        className="mt-2 min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-[10px] font-medium text-foreground outline-none transition-colors focus:border-primary/30"
                        placeholder="Add approval notes, follow-up context, or suspension reason..."
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRiderNotes(selectedRider.id)}
                        disabled={savingRiderNotesId === selectedRider.id}
                        className="mt-3 w-full rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingRiderNotesId === selectedRider.id ? 'Saving...' : 'Save Notes'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      {!selectedRider.is_verified && (
                        <button
                          type="button"
                          onClick={() => handleRiderAction(selectedRider.id, 'approve')}
                          disabled={riderActionId === selectedRider.id}
                          className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {riderActionId === selectedRider.id ? 'Updating...' : 'Approve'}
                        </button>
                      )}
                      {selectedRider.status === 'suspended' ? (
                        <button
                          type="button"
                          onClick={() => handleRiderAction(selectedRider.id, 'restore')}
                          disabled={riderActionId === selectedRider.id}
                          className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {riderActionId === selectedRider.id ? 'Updating...' : 'Restore'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRiderAction(selectedRider.id, 'suspend')}
                          disabled={riderActionId === selectedRider.id}
                          className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-red-700 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {riderActionId === selectedRider.id ? 'Updating...' : 'Suspend'}
                        </button>
                      )}
                    </div>
                  </div>
               </div>
             )}
             {(activeTab === 'trips' || activeTab === 'ops') && selectedTrip && (
               (() => {
                 const staleState = getStaleTripState(selectedTrip);

                 return (
               <div className="bg-background/90 backdrop-blur-xl p-4 rounded-2xl border border-border shadow-2xl pointer-events-auto w-[320px]">
                  <p className="text-[10px] font-black text-primary uppercase tracking-[0.22em]">Trip Details</p>
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 mb-8">
                      <div className={`rounded-md border px-3 py-2 ${getTripStatusClasses(selectedTrip.status)}`}>
                        <p className="text-xs font-bold capitalize">
                          {selectedTrip.status}
                        </p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[10px] font-semibold">
                          {new Date(selectedTrip.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {staleState.isStale && (
                      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-red-700">Needs attention</p>
                        <p className="mt-1 text-[11px] font-bold text-red-700">
                          Trip has been open for {formatMinutesLabel(staleState.ageMinutes)}.
                        </p>
                      </div>
                    )}
                    {getAssignmentResponseState(selectedTrip).isAwaitingResponse && (
                      <div className={`rounded-xl border px-3 py-2 ${getAssignmentResponseState(selectedTrip).isTimedOut ? 'border-red-500/20 bg-red-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
                        <p className={`text-[8px] font-black uppercase tracking-widest ${getAssignmentResponseState(selectedTrip).isTimedOut ? 'text-red-700' : 'text-amber-800'}`}>
                          Awaiting rider response
                        </p>
                        <p className={`mt-1 text-[11px] font-bold ${getAssignmentResponseState(selectedTrip).isTimedOut ? 'text-red-700' : 'text-amber-800'}`}>
                          Assigned {formatMinutesLabel(getAssignmentResponseState(selectedTrip).ageMinutes)} ago and not yet accepted.
                        </p>
                        {reassignmentRecommendations[0] && (
                          <button
                            type="button"
                            onClick={() => handleAssignRider(selectedTrip.id, reassignmentRecommendations[0].id)}
                            disabled={assigningTripId === selectedTrip.id}
                            className="mt-3 w-full rounded-xl border border-primary/20 bg-primary px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {assigningTripId === selectedTrip.id
                              ? 'Reassigning...'
                              : `Reassign to ${reassignmentRecommendations[0].full_name || reassignmentRecommendations[0].phone_number || 'Next Best Rider'}`}
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Pickup</p>
                      <p className="mt-1 text-[11px] font-bold text-foreground break-words">
                        {selectedTrip.pickup.metadata?.address || 'No pickup address saved'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Drop-off</p>
                      <p className="mt-1 text-[11px] font-bold text-foreground break-words">
                        {selectedTrip.dropoff.metadata?.address || 'No drop-off address saved'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-8 pt-8">
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3 text-emerald-600" />Pick-up</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedTrip.sender_phone || selectedTrip.sender_profile?.phone_number || 'Not available'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3 text-red-600" />Drop-off</p>
                        <p className="mt-1 text-[11px] font-bold text-foreground">
                          {selectedTrip.recipient_phone || 'Not collected yet'}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Assigned Rider</p>
                          <p className="mt-1 text-[11px] font-bold text-foreground">
                            {selectedTrip.assigned_rider?.full_name || 'No rider assigned'}
                          </p>
                          <p className="mt-1 text-[10px] text-foreground/70">
                            {selectedTrip.assigned_rider?.phone_number || 'No rider contact'}
                          </p>
                          {selectedTrip.assigned_at && (
                            <p className="mt-1 text-[9px] text-muted-foreground">
                              Assigned {new Date(selectedTrip.assigned_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                        {selectedTrip.assigned_rider && (
                          <button
                            type="button"
                            onClick={() => handleAssignRider(selectedTrip.id, null)}
                            disabled={assigningTripId === selectedTrip.id}
                            className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-red-700 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50 pointer-events-auto"
                          >
                            {assigningTripId === selectedTrip.id ? 'Updating...' : 'Unassign'}
                          </button>
                        )}
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Recommended Riders</p>
                          <p className="text-[8px] font-bold uppercase tracking-widest text-primary">
                            Ranked by readiness
                          </p>
                        </div>
                        {riderRecommendations[0] && selectedTrip.rider_id !== riderRecommendations[0].id && (
                          <button
                            type="button"
                            onClick={() => handleAssignRider(selectedTrip.id, riderRecommendations[0].id)}
                            disabled={assigningTripId === selectedTrip.id}
                            className="w-full rounded-xl border border-primary/20 bg-primary px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {assigningTripId === selectedTrip.id ? 'Assigning...' : `Quick Assign ${riderRecommendations[0].full_name || riderRecommendations[0].phone_number || 'Best Rider'}`}
                          </button>
                        )}
                        {riderRecommendations.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground">
                            No verified riders available right now. Riders who already declined or timed out on this trip are excluded.
                          </p>
                        ) : (
                          riderRecommendations.slice(0, 4).map((rider, index) => {
                            const lastSeen = getLastSeenTone(rider.last_seen_at);
                            const activeLoad = riderLoadCounts.get(rider.id) ?? 0;
                            const completionRate =
                              rider.performance.recentTrips > 0
                                ? Math.round((rider.performance.completedTrips / rider.performance.recentTrips) * 100)
                                : null;
                            const cancellationRate =
                              rider.performance.recentTrips > 0
                                ? Math.round((rider.performance.canceledTrips / rider.performance.recentTrips) * 100)
                                : null;
                            const highCancellationRisk =
                              rider.performance.recentTrips >= 3 && rider.cancellationRate >= 0.3;
                            const weakResponseCount = rider.assignmentHistory.declines + rider.assignmentHistory.timeouts;

                            return (
                            <div key={rider.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-[10px] font-bold text-foreground">
                                    {index + 1}. {rider.full_name || rider.phone_number || 'Unnamed rider'}
                                  </p>
                                  {index === 0 && (
                                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-primary">
                                      Best fit
                                    </span>
                                  )}
                                  {rider.zoneMatch && (
                                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-emerald-700">
                                      Zone match
                                    </span>
                                  )}
                                </div>
                                <p className="truncate text-[9px] text-foreground/70">
                                  {rider.phone_number || 'No phone'} • {rider.status}
                                  {rider.vehicle_type ? ` • ${rider.vehicle_type}` : ''}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <span className="text-[8px] font-bold text-foreground/75">
                                    {formatDistanceLabel(rider.distanceToPickupKm)}
                                  </span>
                                  <span className={`text-[8px] font-bold ${lastSeen.className}`}>
                                    {lastSeen.label}
                                  </span>
                                  {rider.hasStaleGps && (
                                    <span className="text-[8px] font-bold text-amber-700">
                                      GPS stale
                                    </span>
                                  )}
                                  <span className="text-[8px] font-bold text-foreground/65">
                                    {activeLoad} active {activeLoad === 1 ? 'trip' : 'trips'}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  {completionRate !== null ? (
                                    <span className="text-[8px] font-bold text-emerald-700">
                                      {completionRate}% completed
                                    </span>
                                  ) : (
                                    <span className="text-[8px] font-bold text-muted-foreground">
                                      No recent trip history
                                    </span>
                                  )}
                                  {cancellationRate !== null && (
                                    <span className="text-[8px] font-bold text-red-700">
                                      {cancellationRate}% canceled
                                    </span>
                                  )}
                                  {highCancellationRisk && (
                                    <span className="text-[8px] font-bold text-red-700">
                                      High cancel risk
                                    </span>
                                  )}
                                  {weakResponseCount > 0 && (
                                    <span className="text-[8px] font-bold text-amber-800">
                                      {rider.assignmentHistory.declines} declines • {rider.assignmentHistory.timeouts} timeouts
                                    </span>
                                  )}
                                  {rider.performance.recentTrips > 0 && (
                                    <span className="text-[8px] font-bold text-foreground/65">
                                      {rider.performance.recentTrips} recent trips
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleAssignRider(selectedTrip.id, rider.id)}
                                disabled={assigningTripId === selectedTrip.id || selectedTrip.rider_id === rider.id}
                                className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50 pointer-events-auto"
                              >
                                {selectedTrip.rider_id === rider.id ? 'Assigned' : assigningTripId === selectedTrip.id ? 'Assigning...' : 'Assign'}
                              </button>
                            </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {activeRoute ? (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                          <p className="text-[8px] font-black uppercase tracking-widest text-primary/70">Route</p>
                          <div className="flex items-center justify-between">
                          <p className="mt-1 text-base font-black text-emerald-700 flex items-center gap-2">
                            <Navigation className="w-3 h-3" /> {(activeRoute.distance / 1000).toFixed(1)} km
                          </p>
                          <p className="mt-1 text-lg text-primary font-black">
                            ₦{calculateSuggestedPrice(activeRoute.distance)}
                          </p>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                          <p className="text-[8px] font-black uppercase tracking-widest text-muted-foreground">Route</p>
                          <p className="mt-1 text-[11px] font-bold text-foreground">
                            {routeLoading ? 'Calculating...' : 'n/a'}
                          </p>
                        </div>
                      )}
                    </div>
                    {selectedTrip.validation_notes && (
                      <div className="rounded-xl border border-red-500/10 bg-red-500/5 px-3 py-2">
                        <p className="text-[8px] font-black uppercase tracking-widest text-red-700">Review Notes</p>
                        <p className="mt-1 text-[10px] leading-relaxed text-foreground/80 break-words">
                          {selectedTrip.validation_notes}
                        </p>
                      </div>
                    )}
                  </div>
               </div>
                 );
               })()
             )}
             <button 
               onClick={() => { setSelectedId(null); setSelectedRiderId(null); }}
               className="bg-background/90 backdrop-blur-xl p-3 rounded-2xl border border-border shadow-2xl pointer-events-auto hover:bg-muted transition-colors flex items-center gap-2 group"
             >
                <LocateFixed className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                <p className="text-[10px] font-bold text-foreground/80 uppercase tracking-tighter">Center Minna</p>
             </button>
          </div>
        </div>
      </main>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: hsl(var(--border));
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--muted-foreground) / 0.2);
        }
      `}</style>
    </div>
  );
}
