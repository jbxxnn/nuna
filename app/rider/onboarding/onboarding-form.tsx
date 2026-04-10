'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bike, Loader2 } from 'lucide-react';

type RiderProfileSeed = {
  full_name?: string | null;
  phone_number?: string | null;
  service_zone?: string | null;
  vehicle_type?: string | null;
  bike_plate_number?: string | null;
};

const SERVICE_ZONES = [
  'Bosso',
  'Chanchaga',
  'Kpakungu',
  'Tunga',
  'Gidan Kwano',
  'Maitumbi',
  'Barkin Sale',
  'Dutsen Kura',
];

const VEHICLE_TYPES = ['bike', 'tricycle', 'car'];

export default function OnboardingForm({
  initialProfile,
  email,
}: {
  initialProfile: RiderProfileSeed | null;
  email: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: initialProfile?.full_name ?? '',
    phoneNumber: initialProfile?.phone_number ?? '',
    serviceZone: initialProfile?.service_zone ?? '',
    vehicleType: initialProfile?.vehicle_type ?? '',
    bikePlateNumber: initialProfile?.bike_plate_number ?? '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/rider/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to save rider profile');
      }

      router.push('/rider');
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save rider profile');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f2e8] px-4 py-8 text-[#1f1a17]">
      <div className="mx-auto max-w-3xl">
        <section className="rounded-[32px] border border-black/10 bg-white p-6 shadow-[0_18px_60px_rgba(31,26,23,0.08)] md:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#8a5a2b]/10 p-3">
              <Bike className="h-5 w-5 text-[#8a5a2b]" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#8a5a2b]">Rider Onboarding</p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">Set up your rider profile</h1>
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#5f544d]">
            Fill in the operational details ops needs before they can approve and assign you for deliveries.
          </p>

          {email && (
            <div className="mt-4 rounded-2xl border border-black/10 bg-[#faf7f1] px-4 py-3 text-sm text-[#5f544d]">
              Signed in as <span className="font-bold text-[#1f1a17]">{email}</span>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Full Name</span>
              <input
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-black/10 bg-[#fcfbf8] px-4 py-3 text-sm outline-none transition-colors focus:border-[#8a5a2b]/40"
                placeholder="Amina Usman"
                required
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Phone Number</span>
              <input
                value={form.phoneNumber}
                onChange={(event) => setForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-black/10 bg-[#fcfbf8] px-4 py-3 text-sm outline-none transition-colors focus:border-[#8a5a2b]/40"
                placeholder="08012345678"
                required
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Service Zone</span>
              <select
                value={form.serviceZone}
                onChange={(event) => setForm((current) => ({ ...current, serviceZone: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-black/10 bg-[#fcfbf8] px-4 py-3 text-sm outline-none transition-colors focus:border-[#8a5a2b]/40"
                required
              >
                <option value="">Select zone</option>
                {SERVICE_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Vehicle Type</span>
              <select
                value={form.vehicleType}
                onChange={(event) => setForm((current) => ({ ...current, vehicleType: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-black/10 bg-[#fcfbf8] px-4 py-3 text-sm outline-none transition-colors focus:border-[#8a5a2b]/40"
                required
              >
                <option value="">Select vehicle</option>
                {VEHICLE_TYPES.map((vehicleType) => (
                  <option key={vehicleType} value={vehicleType}>
                    {vehicleType}
                  </option>
                ))}
              </select>
            </label>

            <label className="block md:col-span-2">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d625c]">Bike Plate Number</span>
              <input
                value={form.bikePlateNumber}
                onChange={(event) => setForm((current) => ({ ...current, bikePlateNumber: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-black/10 bg-[#fcfbf8] px-4 py-3 text-sm outline-none transition-colors focus:border-[#8a5a2b]/40"
                placeholder="ABC-123XY"
                required
              />
            </label>

            <div className="md:col-span-2 flex items-center justify-between rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
              <p>After submission, ops still needs to verify and approve your rider profile before assignment.</p>
            </div>

            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#1f7a4c] px-5 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? 'Saving...' : 'Complete Onboarding'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
