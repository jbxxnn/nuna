'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Bike, CheckCircle2, Loader2, MapPinned, ShieldCheck, TimerReset, XCircle } from 'lucide-react';

type RiderStatus = 'offline' | 'available' | 'assigned' | 'on_trip' | 'suspended';
type TripStatus = 'pending' | 'confirmed' | 'moving' | 'picked_up' | 'completed' | 'canceled';

interface Rider {
  id: string;
  full_name?: string | null;
  phone_number?: string | null;
  vehicle_type?: string | null;
  bike_plate_number?: string | null;
  status: RiderStatus;
  is_verified: boolean;
  service_zone?: string | null;
  last_seen_at?: string | null;
}

interface TripLocation {
  id: string;
  raw_text: string;
  latitude: number;
  longitude: number;
  metadata?: {
    address?: string | null;
  } | null;
}

interface RiderTrip {
  id: string;
  status: TripStatus;
  created_at: string;
  sender_phone?: string | null;
  recipient_phone?: string | null;
  assigned_at?: string | null;
  confirmed_at?: string | null;
  picked_up_at?: string | null;
  completed_at?: string | null;
  canceled_at?: string | null;
  pickup: TripLocation | null;
  dropoff: TripLocation | null;
}

function getTripActionLabel(status: TripStatus) {
  if (status === 'pending') return 'Confirm Job';
  if (status === 'confirmed') return 'Start Moving';
  if (status === 'moving') return 'Mark Picked Up';
  if (status === 'picked_up') return 'Mark Completed';
  return null;
}

function getNextTripStatus(status: TripStatus): TripStatus | null {
  if (status === 'pending') return 'confirmed';
  if (status === 'confirmed') return 'moving';
  if (status === 'moving') return 'picked_up';
  if (status === 'picked_up') return 'completed';
  return null;
}

function getTripStatusClasses(status: TripStatus) {
  if (status === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700';
  if (status === 'moving') return 'border-amber-500/20 bg-amber-500/10 text-amber-700';
  if (status === 'canceled') return 'border-red-500/20 bg-red-500/10 text-red-700';
  if (status === 'confirmed') return 'border-blue-500/20 bg-blue-500/10 text-blue-700';
  if (status === 'picked_up') return 'border-primary/20 bg-primary/10 text-primary';
  return 'border-border bg-background text-foreground';
}

export default function RiderPage() {
  const router = useRouter();
  const [rider, setRider] = useState<Rider | null>(null);
  const [trips, setTrips] = useState<RiderTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionTripId, setActionTripId] = useState<string | null>(null);
  const [availabilityUpdating, setAvailabilityUpdating] = useState(false);
  const [locationSharingState, setLocationSharingState] = useState<'idle' | 'active' | 'denied' | 'unsupported'>('idle');

  const loadDashboard = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/rider/dashboard', { cache: 'no-store' });
      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 409 && payload?.onboardingRequired) {
          router.replace('/rider/onboarding');
          return;
        }
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to load rider dashboard');
      }

      setRider(payload.rider as Rider);
      setTrips((payload.trips ?? []) as RiderTrip[]);
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : 'Failed to load rider dashboard');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!rider) return;

    const shouldTrack =
      rider.status === 'available' || rider.status === 'assigned' || rider.status === 'on_trip';

    if (!shouldTrack) {
      setLocationSharingState('idle');
      return;
    }

    if (!('geolocation' in navigator)) {
      setLocationSharingState('unsupported');
      return;
    }

    let cancelled = false;

    const sendLocation = async (latitude: number, longitude: number) => {
      try {
        const response = await fetch('/api/rider/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        });

        if (response.ok && !cancelled) {
          setLocationSharingState('active');
        }
      } catch {
        // Leave the previous state untouched on transient network failures.
      }
    };

    const requestLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          void sendLocation(position.coords.latitude, position.coords.longitude);
        },
        () => {
          if (!cancelled) {
            setLocationSharingState('denied');
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 15000,
          timeout: 10000,
        },
      );
    };

    requestLocation();
    const intervalId = window.setInterval(requestLocation, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [rider]);

  const activeTrips = useMemo(
    () => trips.filter((trip) => !['completed', 'canceled'].includes(trip.status)),
    [trips],
  );

  const pendingTrips = useMemo(
    () => activeTrips.filter((trip) => trip.status === 'pending'),
    [activeTrips],
  );

  const historyTrips = useMemo(
    () => trips.filter((trip) => ['completed', 'canceled'].includes(trip.status)).slice(0, 8),
    [trips],
  );

  const updateTripStatus = useCallback(async (tripId: string, status: TripStatus) => {
    setActionTripId(tripId);
    setError(null);

    try {
      const response = await fetch(`/api/rider/trips/${tripId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to update trip status');
      }

      await loadDashboard();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Failed to update trip status');
    } finally {
      setActionTripId(null);
    }
  }, [loadDashboard]);

  const updateAvailability = useCallback(async (status: RiderStatus) => {
    if (status !== 'available' && status !== 'offline') {
      return;
    }

    setAvailabilityUpdating(true);
    setError(null);

    try {
      const response = await fetch('/api/rider/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to update rider availability');
      }

      await loadDashboard();
    } catch (availabilityError) {
      setError(availabilityError instanceof Error ? availabilityError.message : 'Failed to update rider availability');
    } finally {
      setAvailabilityUpdating(false);
    }
  }, [loadDashboard]);

  const respondToAssignment = useCallback(async (tripId: string, responseMode: 'accept' | 'decline') => {
    setActionTripId(tripId);
    setError(null);

    try {
      const response = await fetch(`/api/rider/trips/${tripId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: responseMode }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to respond to assignment');
      }

      await loadDashboard();
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : 'Failed to respond to assignment');
    } finally {
      setActionTripId(null);
    }
  }, [loadDashboard]);

  const riderSignals = rider ? [
    {
      label: rider.is_verified ? 'Approved for dispatch' : 'Awaiting ops approval',
      tone: rider.is_verified
        ? 'bg-emerald-100/80 text-emerald-800 border-emerald-200'
        : 'bg-amber-100/80 text-amber-800 border-amber-200',
    },
    {
      label: rider.service_zone ? `Serving ${rider.service_zone}` : 'Service zone pending',
      tone: 'bg-orange-200/80 text-orange-800 border-orange-300',
    },
  ] : [];

  return (
    <main className="min-h-screen bg-stone-950 text-stone-950">
      <section className="mx-auto min-h-screen max-w-full">
        <div className="overflow-hidden bg-[#f5f5f3]">
          <header className="border-b border-stone-300/70">
            <div className="flex flex-col gap-4 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center justify-between gap-24">
                <Link href="/" className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold tracking-[-0.04em] text-stone-950">
                    Nuna
                  </span>
                </Link>
                <nav className="hidden items-center gap-6 text-sm text-stone-600 lg:flex">
                  <a href="#active-jobs" className="transition hover:text-stone-950">Active jobs</a>
                  <a href="#assignment-queue" className="transition hover:text-stone-950">Queue</a>
                  <a href="#history" className="transition hover:text-stone-950">History</a>
                </nav>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/nuna"
                  className="rounded-full border border-stone-300 bg-white/80 px-4 py-2 text-sm text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
                >
                  Open ops
                </Link>
                <Link
                  href="/"
                  className="rounded-full border border-stone-300 bg-white/80 px-4 py-2 text-sm text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
                >
                  Home
                </Link>
              </div>
            </div>
          </header>

          <div className="border-b border-stone-300/70 bg-emerald-900 text-sm text-stone-200 overflow-hidden relative flex">
            <div className="flex items-center gap-2 bg-emerald-900 px-5 py-3">
              <div className="w-3 h-3 rounded-full bg-emerald-300 animate-pulse shrink-0" />
            </div>
            <div className="bg-emerald-900 flex overflow-hidden py-3">
              <div className="flex whitespace-nowrap animate-marquee items-center">
                <div className="flex items-center gap-10 pr-10">
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{activeTrips.length}</strong><span className="text-xs">active jobs</span></div>
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{pendingTrips.length}</strong><span className="text-xs">awaiting response</span></div>
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{historyTrips.length}</strong><span className="text-xs">recent completed/canceled</span></div>
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{rider?.service_zone || 'Minna'}</strong><span className="text-xs">service zone</span></div>
                </div>
              </div>
              <div className="flex whitespace-nowrap animate-marquee items-center">
                <div className="flex items-center gap-10 pr-10">
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{activeTrips.length}</strong><span className="text-xs">active jobs</span></div>
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{pendingTrips.length}</strong><span className="text-xs">awaiting response</span></div>
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{historyTrips.length}</strong><span className="text-xs">recent completed/canceled</span></div>
                  <span className="text-emerald-700">—</span>
                  <div className="flex items-center gap-2"><strong className="text-white">{rider?.service_zone || 'Minna'}</strong><span className="text-xs">service zone</span></div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 py-10 sm:px-8 lg:py-14 max-w-7xl mx-auto">
            <section className="rounded-[32px] border border-stone-300/80 bg-white/80 shadow-[0_18px_60px_rgba(28,28,28,0.12)] backdrop-blur overflow-hidden">
              <div className="grid gap-0 lg:grid-cols-[1.35fr_0.65fr]">
                <div className="border-b border-stone-200/80 p-6 sm:p-8 lg:border-b-0 lg:border-r">
                  <div className="mb-5 flex flex-wrap gap-2">
                    {riderSignals.map((signal) => (
                      <span
                        key={signal.label}
                        className={`rounded-full border px-3 py-0.5 text-xs font-medium ${signal.tone} shadow-sm`}
                      >
                        {signal.label}
                      </span>
                    ))}
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.24em] text-stone-500">Rider Briefing</p>
                      <h1 className="mt-3 max-w-2xl text-3xl font-semibold leading-[1.02] tracking-[-0.05em] text-stone-950 sm:text-4xl lg:text-5xl">
                        Today’s work,
                        <span className="text-emerald-700"> live assignments, </span>
                        and rider readiness.
                      </h1>
                      <p className="mt-5 max-w-xl text-sm leading-7 text-stone-700 sm:text-base">
                        Stay accurate on availability, respond to new jobs quickly, and move each delivery through pickup and completion without losing contact with ops.
                      </p>

                      <div className="mt-7 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => updateAvailability('available')}
                          disabled={availabilityUpdating || rider?.status === 'available'}
                          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {availabilityUpdating && rider?.status !== 'available' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                          {availabilityUpdating && rider?.status !== 'available' ? 'Updating...' : 'Go available'}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateAvailability('offline')}
                          disabled={availabilityUpdating || rider?.status === 'offline' || activeTrips.length > 0}
                          className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white/70 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Go offline
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                      <div className="rounded-[24px] border border-stone-200 bg-stone-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Active Jobs</p>
                        <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">{activeTrips.length}</p>
                        <p className="mt-1 text-xs font-medium text-stone-600">Deliveries currently under your name</p>
                      </div>
                      <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Awaiting Response</p>
                        <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">{pendingTrips.length}</p>
                        <p className="mt-1 text-xs font-medium text-amber-800">Assignments that still need your decision</p>
                      </div>
                      <div className="rounded-[24px] border border-stone-200 bg-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Recent History</p>
                        <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-stone-950">{historyTrips.length}</p>
                        <p className="mt-1 text-xs font-medium text-stone-600">Recently completed or canceled jobs</p>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <div className="mt-6 rounded-3xl border border-red-300 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
                      {error}
                    </div>
                  )}
                </div>

                <div className="bg-[#faf8f2] p-6 sm:p-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.24em] text-stone-500">Status Rail</p>
                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-stone-950">Rider profile</h2>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-medium ${rider?.is_verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {rider?.is_verified ? 'Dispatch ready' : 'Pending approval'}
                    </div>
                  </div>

                  {loading ? (
                    <div className="my-10 flex items-center justify-center gap-3 text-sm text-stone-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading rider profile...
                    </div>
                  ) : (
                    <div className="mt-6 space-y-3">
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Name</p>
                        <p className="mt-2 text-sm font-semibold text-stone-950">{rider?.full_name || 'Not set'}</p>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Zone</p>
                        <p className="mt-2 text-sm font-semibold text-stone-950">{rider?.service_zone || 'Not set'}</p>
                      </div>
                      <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Vehicle</p>
                        <p className="mt-2 text-sm font-semibold text-stone-950">
                          {rider?.vehicle_type || 'Not set'}{rider?.bike_plate_number ? ` • ${rider.bike_plate_number}` : ''}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-stone-800">
                      <MapPinned className="h-4 w-4 text-emerald-700" />
                      <p className="text-sm font-semibold">Dispatch guidance</p>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-stone-600">
                      Keep your status accurate. Ops can only assign you when you are approved and marked available.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="max-w-7xl mx-auto px-5 pb-12 sm:px-8">
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center rounded-[28px] border border-stone-300/80 bg-white/80 shadow-[0_18px_60px_rgba(28,28,28,0.12)]">
                <div className="flex items-center gap-3 text-sm font-medium text-stone-600">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading rider dashboard...
                </div>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                <section id="active-jobs" className="rounded-[28px] border border-stone-300/80 bg-white/80 p-6 shadow-[0_18px_60px_rgba(28,28,28,0.12)] backdrop-blur">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold tracking-[-0.03em] text-stone-950">Active jobs</h2>
                    <span className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-stone-700">
                      {activeTrips.length} active
                    </span>
                  </div>

                  <div className="mt-5 space-y-4">
                    {activeTrips.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center text-sm text-stone-600">
                        No active trips assigned right now.
                      </div>
                    ) : (
                      activeTrips.map((trip) => {
                        const nextStatus = getNextTripStatus(trip.status);
                        const nextLabel = getTripActionLabel(trip.status);

                        return (
                          <article key={trip.id} className="rounded-[24px] border border-stone-200 bg-[#fcfbf8] p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest ${getTripStatusClasses(trip.status)}`}>
                                {trip.status}
                              </div>
                              <p className="text-xs font-medium text-stone-600">
                                Created {new Date(trip.created_at).toLocaleString()}
                              </p>
                            </div>

                            <div className="mt-4 grid gap-4 md:grid-cols-2">
                              <div className="rounded-2xl border border-stone-200 bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-500">Pickup</p>
                                <p className="mt-2 text-sm font-semibold text-stone-950">{trip.pickup?.metadata?.address || trip.pickup?.raw_text || 'No pickup location'}</p>
                                <p className="mt-2 text-xs text-stone-600">Sender: {trip.sender_phone || 'Not available'}</p>
                              </div>
                              <div className="rounded-2xl border border-stone-200 bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-stone-500">Drop-off</p>
                                <p className="mt-2 text-sm font-semibold text-stone-950">{trip.dropoff?.metadata?.address || trip.dropoff?.raw_text || 'No drop-off location'}</p>
                                <p className="mt-2 text-xs text-stone-600">Recipient: {trip.recipient_phone || 'Not collected yet'}</p>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-600">
                              {trip.assigned_at && (
                                <span className="rounded-full border border-stone-200 bg-white px-3 py-1">
                                  Assigned {new Date(trip.assigned_at).toLocaleString()}
                                </span>
                              )}
                              {trip.confirmed_at && (
                                <span className="rounded-full border border-stone-200 bg-white px-3 py-1">
                                  Confirmed {new Date(trip.confirmed_at).toLocaleString()}
                                </span>
                              )}
                              {trip.picked_up_at && (
                                <span className="rounded-full border border-stone-200 bg-white px-3 py-1">
                                  Picked up {new Date(trip.picked_up_at).toLocaleString()}
                                </span>
                              )}
                            </div>

                            <div className="mt-5 flex flex-wrap gap-3">
                              {trip.status === 'pending' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => respondToAssignment(trip.id, 'accept')}
                                    disabled={actionTripId === trip.id}
                                    className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {actionTripId === trip.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    {actionTripId === trip.id ? 'Updating...' : 'Accept Assignment'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => respondToAssignment(trip.id, 'decline')}
                                    disabled={actionTripId === trip.id}
                                    className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100 px-5 py-3 text-sm font-medium text-amber-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <TimerReset className="h-4 w-4" />
                                    Decline Assignment
                                  </button>
                                </>
                              ) : (
                                nextStatus && nextLabel && (
                                  <button
                                    type="button"
                                    onClick={() => updateTripStatus(trip.id, nextStatus)}
                                    disabled={actionTripId === trip.id}
                                    className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {actionTripId === trip.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    {actionTripId === trip.id ? 'Updating...' : nextLabel}
                                  </button>
                                )
                              )}
                              {trip.status !== 'completed' && trip.status !== 'canceled' && (
                                <button
                                  type="button"
                                  onClick={() => updateTripStatus(trip.id, 'canceled')}
                                  disabled={actionTripId === trip.id}
                                  className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-5 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <XCircle className="h-4 w-4" />
                                  Cancel Trip
                                </button>
                              )}
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>

                <section className="space-y-6">
                  <div id="assignment-queue" className="rounded-[28px] border border-stone-300/80 bg-white/80 p-6 shadow-[0_18px_60px_rgba(28,28,28,0.12)] backdrop-blur">
                    <div className="flex items-center gap-2">
                      <TimerReset className="h-4 w-4 text-[#8a5a2b]" />
                      <h2 className="text-lg font-semibold tracking-[-0.03em] text-stone-950">Assignment queue</h2>
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-stone-600">
                      {pendingTrips.length === 0 ? (
                        <p>No assignments waiting for your response.</p>
                      ) : (
                        pendingTrips.map((trip) => (
                          <div key={trip.id} className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-800">Awaiting response</p>
                            <p className="mt-2 text-sm font-semibold text-stone-950">
                              {trip.pickup?.metadata?.address || trip.pickup?.raw_text || 'Pickup'} to {trip.dropoff?.metadata?.address || trip.dropoff?.raw_text || 'Drop-off'}
                            </p>
                            <p className="mt-1 text-xs text-stone-600">
                              Assigned {trip.assigned_at ? new Date(trip.assigned_at).toLocaleString() : 'recently'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-stone-300/80 bg-white/80 p-6 shadow-[0_18px_60px_rgba(28,28,28,0.12)] backdrop-blur">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-[#8a5a2b]" />
                      <h2 className="text-lg font-semibold tracking-[-0.03em] text-stone-950">Rider status</h2>
                    </div>
                    <div className="mt-4 space-y-3 text-sm text-stone-600">
                      <p>Use sender and recipient contacts inside each job card to coordinate pickup and delivery.</p>
                      <p>Go available only when you are ready to accept new work from ops.</p>
                      {activeTrips.length > 0 && (
                        <p>Finish or decline active assignments before going offline.</p>
                      )}
                      <p>
                        {locationSharingState === 'active' && 'Live location sharing is active while you stay available or on a trip.'}
                        {locationSharingState === 'denied' && 'Location access is blocked on this device, so customers will not see live updates yet.'}
                        {locationSharingState === 'unsupported' && 'This device does not support live location updates in the rider dashboard.'}
                        {locationSharingState === 'idle' && 'Live location updates start when you are available or actively handling a trip.'}
                      </p>
                    </div>
                  </div>

                  <div id="history" className="rounded-[28px] border border-stone-300/80 bg-white/80 p-6 shadow-[0_18px_60px_rgba(28,28,28,0.12)] backdrop-blur">
                    <div className="flex items-center gap-2">
                      <Bike className="h-4 w-4 text-[#8a5a2b]" />
                      <h2 className="text-lg font-semibold tracking-[-0.03em] text-stone-950">Recent history</h2>
                    </div>
                    <div className="mt-4 space-y-3">
                      {historyTrips.length === 0 ? (
                        <p className="text-sm text-stone-600">No completed or canceled trips yet.</p>
                      ) : (
                        historyTrips.map((trip) => (
                          <div key={trip.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                            <div className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${getTripStatusClasses(trip.status)}`}>
                              {trip.status}
                            </div>
                            <p className="mt-3 text-sm font-semibold text-stone-950">
                              {trip.pickup?.metadata?.address || trip.pickup?.raw_text || 'Pickup'} to {trip.dropoff?.metadata?.address || trip.dropoff?.raw_text || 'Drop-off'}
                            </p>
                            <p className="mt-1 text-xs text-stone-600">
                              {new Date(trip.created_at).toLocaleString()}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {rider && !rider.is_verified && (
                    <div className="rounded-[28px] border border-amber-300 bg-amber-50 p-6 text-amber-900 shadow-[0_18px_60px_rgba(28,28,28,0.12)]">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        <p className="text-sm font-semibold">Verification pending</p>
                      </div>
                      <p className="mt-3 text-sm">
                        Your rider profile is not marked as verified yet. Ops may restrict assignment until verification is complete.
                      </p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
