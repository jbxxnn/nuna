"use client";

import { useEffect, useMemo, useState } from "react";

import MapboxMap from "@/components/mapbox-map";

type TrackLocation = {
  id: string;
  raw_text: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata?: {
    address?: string | null;
  } | null;
};

type AssignedRider = {
  full_name?: string | null;
  status?: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
  last_seen_at?: string | null;
} | null;

type TrackTrip = {
  id: string;
  status: string | null;
  created_at: string;
  distance_meters?: number | null;
  estimated_price?: number | null;
  pickup: TrackLocation | TrackLocation[] | null;
  dropoff: TrackLocation | TrackLocation[] | null;
  assigned_rider: AssignedRider | AssignedRider[] | null;
};

function formatLocationName(location: {
  raw_text: string | null;
  metadata?: {
    address?: string | null;
  } | null;
}) {
  const rawText = location.raw_text?.trim() || "Not available";
  const address =
    typeof location.metadata?.address === "string" ? location.metadata.address.trim() : "";

  if (!address || address.toLowerCase() === rawText.toLowerCase()) {
    return rawText;
  }

  return `${rawText} - ${address}`;
}

function formatStatus(status: string | null) {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "assigned":
      return "Rider Assigned";
    case "moving":
      return "Moving";
    case "picked_up":
      return "Picked Up";
    case "completed":
      return "Completed";
    case "canceled":
    case "cancelled":
      return "Canceled";
    default:
      return "Pending";
  }
}

function getStatusClasses(status: string | null) {
  switch (status) {
    case "confirmed":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "assigned":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "moving":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "picked_up":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "canceled":
    case "cancelled":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-stone-200 bg-stone-50 text-stone-700";
  }
}

function normalizeLocation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getLocationFreshness(lastSeenAt?: string | null) {
  if (!lastSeenAt) {
    return { label: "Live rider location not available yet.", isStale: true };
  }

  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const diffSeconds = Math.max(0, Math.round(diffMs / 1000));

  if (diffSeconds < 60) {
    return { label: `Updated ${diffSeconds}s ago`, isStale: false };
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) {
    return { label: `Updated ${diffMinutes}m ago`, isStale: diffMinutes >= 2 };
  }

  const diffHours = Math.round(diffMinutes / 60);
  return { label: `Updated ${diffHours}h ago`, isStale: true };
}

export default function TrackClient({
  token,
  initialTrip,
}: {
  token: string;
  initialTrip: TrackTrip;
}) {
  const [trip, setTrip] = useState<TrackTrip>(initialTrip);

  useEffect(() => {
    let isMounted = true;

    const loadTrip = async () => {
      try {
        const response = await fetch(`/api/track/${token}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (isMounted && payload?.trip) {
          setTrip(payload.trip as TrackTrip);
        }
      } catch {
        // Keep the last known state on polling errors.
      }
    };

    const intervalId = window.setInterval(loadTrip, 15000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [token]);

  const pickup = normalizeLocation(trip.pickup);
  const dropoff = normalizeLocation(trip.dropoff);
  const assignedRider = normalizeLocation(trip.assigned_rider);

  const riderIsLive =
    typeof assignedRider?.current_latitude === "number" &&
    typeof assignedRider?.current_longitude === "number";
  const freshness = getLocationFreshness(assignedRider?.last_seen_at);

  const markers = useMemo(() => {
    const baseMarkers: {
      id: string;
      latitude: number;
      longitude: number;
      raw_text: string;
      is_verified: boolean;
      variant?: "pickup" | "dropoff" | "rider";
    }[] = [];

    if (pickup && typeof pickup.latitude === "number" && typeof pickup.longitude === "number") {
      baseMarkers.push({
        id: "pickup",
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        raw_text: formatLocationName(pickup),
        is_verified: true,
        variant: "pickup",
      });
    }

    if (dropoff && typeof dropoff.latitude === "number" && typeof dropoff.longitude === "number") {
      baseMarkers.push({
        id: "dropoff",
        latitude: dropoff.latitude,
        longitude: dropoff.longitude,
        raw_text: formatLocationName(dropoff),
        is_verified: true,
        variant: "dropoff",
      });
    }

    if (riderIsLive && assignedRider) {
      baseMarkers.push({
        id: "rider",
        latitude: assignedRider.current_latitude as number,
        longitude: assignedRider.current_longitude as number,
        raw_text: assignedRider.full_name ? `${assignedRider.full_name} (Rider)` : "Rider",
        is_verified: true,
        variant: "rider" as const,
      });
    }

    return baseMarkers;
  }, [assignedRider, dropoff, pickup, riderIsLive]);

  let center: [number, number] | undefined;

  if (
    pickup &&
    typeof pickup.longitude === "number" &&
    typeof pickup.latitude === "number" &&
    dropoff &&
    typeof dropoff.longitude === "number" &&
    typeof dropoff.latitude === "number"
  ) {
    center = [
      (pickup.longitude + dropoff.longitude) / 2,
      (pickup.latitude + dropoff.latitude) / 2,
    ];
  } else if (pickup && typeof pickup.longitude === "number" && typeof pickup.latitude === "number") {
    center = [pickup.longitude, pickup.latitude];
  } else if (dropoff && typeof dropoff.longitude === "number" && typeof dropoff.latitude === "number") {
    center = [dropoff.longitude, dropoff.latitude];
  } else if (riderIsLive) {
    center = [assignedRider.current_longitude as number, assignedRider.current_latitude as number];
  }

  const distanceKm =
    typeof trip.distance_meters === "number" && trip.distance_meters > 0
      ? `${(trip.distance_meters / 1000).toFixed(1)} km`
      : "Not available yet";
  const estimatedPrice =
    typeof trip.estimated_price === "number" && trip.estimated_price > 0
      ? `₦${trip.estimated_price.toLocaleString()}`
      : "Not available yet";

  return (
    <main className="min-h-screen bg-[#f6f2eb] text-stone-950">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-stone-200 bg-white/80 p-4 shadow-[0_20px_80px_rgba(120,103,81,0.10)] backdrop-blur sm:p-6">
          <div className="mb-6 flex flex-col gap-4 border-b border-stone-200 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-stone-500">
                Package Tracking
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-stone-950 sm:text-4xl">
                Track your delivery
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
                This page shows the current trip status and the planned pick-up and drop-off points.
              </p>
            </div>
            <div className={`inline-flex items-center rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] ${getStatusClasses(trip.status)}`}>
              {formatStatus(trip.status)}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
            <div className="overflow-hidden rounded-[1.75rem] border border-stone-200 bg-stone-100/70">
              <div className="h-[520px]">
                <MapboxMap
                  center={center}
                  zoom={12}
                  style="mapbox://styles/bindahq/cmnsnc6qh000101qo5oz23km9"
                  markers={markers}
                  hideMapboxLabels
                />
              </div>
            </div>

            <div className="space-y-4">
              <section className="rounded-[1.5rem] border border-stone-200 bg-stone-50/90 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Trip Summary</p>
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Pickup Location</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-stone-900">
                      {pickup ? formatLocationName(pickup) : "Not available yet"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500">Drop-off Location</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-stone-900">
                      {dropoff ? formatLocationName(dropoff) : "Not available yet"}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-[1.5rem] border border-stone-200 bg-stone-50/90 p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-stone-500">Delivery Status</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Distance</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-stone-950">{distanceKm}</p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Estimated Price</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-stone-950">{estimatedPrice}</p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4 sm:col-span-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-stone-500">Rider</p>
                    <p className="mt-2 text-sm font-semibold text-stone-900">
                      {assignedRider?.full_name
                        ? `${assignedRider.full_name}${assignedRider.status ? ` · ${formatStatus(assignedRider.status)}` : ""}`
                        : "A rider will be assigned soon."}
                    </p>
                    <p className={`mt-2 text-xs ${freshness.isStale ? "text-amber-700" : "text-emerald-700"}`}>
                      {riderIsLive ? freshness.label : freshness.label}
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
