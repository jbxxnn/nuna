'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bike, CheckCircle2, Loader2, Phone, Route, ShieldCheck, TimerReset, XCircle } from 'lucide-react';

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

  return (
    <main className="min-h-screen bg-[#f5f2e8] px-4 py-8 text-[#1f1a17]">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8a5a2b]">Rider Portal</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Assigned Deliveries</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5f544d]">
                Review your assigned trips, contact the sender or recipient, and update delivery status as you progress.
              </p>
            </div>
            {rider && (
              <div className="min-w-[260px] rounded-2xl border border-black/10 bg-[#faf7f1] p-4">
                <div className="flex items-center gap-2">
                  <Bike className="h-4 w-4 text-[#8a5a2b]" />
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-[#8a5a2b]">Rider Profile</p>
                </div>
                <p className="mt-3 text-base font-bold">{rider.full_name || 'Unnamed rider'}</p>
                <p className="mt-1 text-sm text-[#5f544d]">{rider.phone_number || 'No rider phone number'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#1f1a17]">
                    {rider.status}
                  </span>
                  {rider.is_verified && (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-700">
                      Verified
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs text-[#6d625c]">
                  {rider.vehicle_type || 'Vehicle not set'}
                  {rider.bike_plate_number ? ` • ${rider.bike_plate_number}` : ''}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => updateAvailability('available')}
                    disabled={availabilityUpdating || rider.status === 'available'}
                    className="rounded-2xl bg-[#1f7a4c] px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {availabilityUpdating && rider.status !== 'available' ? 'Updating...' : 'Go Available'}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAvailability('offline')}
                    disabled={availabilityUpdating || rider.status === 'offline' || activeTrips.length > 0}
                    className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-widest text-[#1f1a17] transition-colors hover:bg-[#f2ede3] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Go Offline
                  </button>
                </div>
                {activeTrips.length > 0 && (
                  <p className="mt-2 text-[11px] font-medium text-[#6d625c]">
                    Finish or decline active assignments before going offline.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-[28px] border border-black/10 bg-white shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
            <div className="flex items-center gap-3 text-sm font-medium text-[#5f544d]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading rider dashboard...
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.25fr,0.75fr]">
            <section className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black">Active Trips</h2>
                <span className="rounded-full border border-black/10 bg-[#faf7f1] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#5f544d]">
                  {activeTrips.length} active
                </span>
              </div>

              <div className="mt-5 space-y-4">
                {activeTrips.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-black/10 bg-[#faf7f1] p-8 text-center text-sm text-[#6d625c]">
                    No active trips assigned right now.
                  </div>
                ) : (
                  activeTrips.map((trip) => {
                    const nextStatus = getNextTripStatus(trip.status);
                    const nextLabel = getTripActionLabel(trip.status);

                    return (
                      <article key={trip.id} className="rounded-3xl border border-black/10 bg-[#fcfbf8] p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest ${getTripStatusClasses(trip.status)}`}>
                            {trip.status}
                          </div>
                          <p className="text-xs font-medium text-[#6d625c]">
                            Created {new Date(trip.created_at).toLocaleString()}
                          </p>
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <div className="rounded-2xl border border-black/10 bg-white p-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Pickup</p>
                            <p className="mt-2 text-sm font-bold">{trip.pickup?.metadata?.address || trip.pickup?.raw_text || 'No pickup location'}</p>
                            <p className="mt-2 text-xs text-[#6d625c]">
                              Sender: {trip.sender_phone || 'Not available'}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-black/10 bg-white p-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Drop-off</p>
                            <p className="mt-2 text-sm font-bold">{trip.dropoff?.metadata?.address || trip.dropoff?.raw_text || 'No drop-off location'}</p>
                            <p className="mt-2 text-xs text-[#6d625c]">
                              Recipient: {trip.recipient_phone || 'Not collected yet'}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#5f544d]">
                          {trip.assigned_at && (
                            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
                              Assigned {new Date(trip.assigned_at).toLocaleString()}
                            </span>
                          )}
                          {trip.confirmed_at && (
                            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
                              Confirmed {new Date(trip.confirmed_at).toLocaleString()}
                            </span>
                          )}
                          {trip.picked_up_at && (
                            <span className="rounded-full border border-black/10 bg-white px-3 py-1">
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
                                className="inline-flex items-center gap-2 rounded-2xl bg-[#1f7a4c] px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {actionTripId === trip.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                {actionTripId === trip.id ? 'Updating...' : 'Accept Assignment'}
                              </button>
                              <button
                                type="button"
                                onClick={() => respondToAssignment(trip.id, 'decline')}
                                disabled={actionTripId === trip.id}
                                className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-800 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                              className="inline-flex items-center gap-2 rounded-2xl bg-[#1f7a4c] px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
                              className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-700 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-[#8a5a2b]" />
                  <h2 className="text-lg font-black">Quick Contact</h2>
                </div>
                <div className="mt-4 space-y-3 text-sm text-[#5f544d]">
                  <p>Use the sender and recipient contacts in each trip card to coordinate pickup and delivery.</p>
                  <p>Recipient contact is still optional until intake starts collecting it consistently.</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
                <div className="flex items-center gap-2">
                  <TimerReset className="h-4 w-4 text-[#8a5a2b]" />
                  <h2 className="text-lg font-black">Assignment Queue</h2>
                </div>
                <div className="mt-4 space-y-3">
                  {pendingTrips.length === 0 ? (
                    <p className="text-sm text-[#6d625c]">No assignments waiting for your response.</p>
                  ) : (
                    pendingTrips.map((trip) => (
                      <div key={trip.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-800">Awaiting Response</p>
                        <p className="mt-2 text-sm font-bold text-[#1f1a17]">
                          {trip.pickup?.metadata?.address || trip.pickup?.raw_text || 'Pickup'} to {trip.dropoff?.metadata?.address || trip.dropoff?.raw_text || 'Drop-off'}
                        </p>
                        <p className="mt-1 text-xs text-[#6d625c]">
                          Assigned {trip.assigned_at ? new Date(trip.assigned_at).toLocaleString() : 'recently'}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-[#8a5a2b]" />
                  <h2 className="text-lg font-black">Recent History</h2>
                </div>
                <div className="mt-4 space-y-3">
                  {historyTrips.length === 0 ? (
                    <p className="text-sm text-[#6d625c]">No completed or canceled trips yet.</p>
                  ) : (
                    historyTrips.map((trip) => (
                      <div key={trip.id} className="rounded-2xl border border-black/10 bg-[#faf7f1] p-4">
                        <div className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${getTripStatusClasses(trip.status)}`}>
                          {trip.status}
                        </div>
                        <p className="mt-3 text-sm font-bold">
                          {trip.pickup?.metadata?.address || trip.pickup?.raw_text || 'Pickup'} to {trip.dropoff?.metadata?.address || trip.dropoff?.raw_text || 'Drop-off'}
                        </p>
                        <p className="mt-1 text-xs text-[#6d625c]">
                          {new Date(trip.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {rider && !rider.is_verified && (
                <div className="rounded-[28px] border border-amber-500/20 bg-amber-500/10 p-6 text-amber-800 shadow-[0_18px_60px_rgba(31,26,23,0.08)]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    <p className="text-sm font-bold">Verification Pending</p>
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
    </main>
  );
}
