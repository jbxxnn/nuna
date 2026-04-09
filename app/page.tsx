import { AuthButton } from "@/components/auth-button";
import MapboxMap from "@/components/mapbox-map";
import { hasEnvVars } from "@/lib/utils";
import {
  ArrowRight,
  Bot,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";

const trustSignals = [
  { label: "● Available Now", color: "bg-emerald-100/80 text-emerald-800 border-emerald-200" },
  { label: "Currently Serving Minna, Niger, Nigeria", color: "bg-orange-200/80 text-orange-800 border-orange-300" },
];

const bookingSteps = [
  {
    step: "01",
    badge: "2 min",
    title: "Book Online",
    description:
      "Enter pickup and drop-off addresses, and recipient details. Get an instant fare estimate — no surprises.",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200 tracking-[-0.04em] text-xs font-medium",
  },
  {
    step: "02",
    badge: "Instant",
    title: "Rider assigned",
    description:
      "We match you with the nearest verified rider. See their name, photo, bike plate, and live ETA.",
    tone: "bg-amber-50 text-amber-700 border-amber-200 tracking-[-0.04em] text-xs font-medium",
  },
  {
    step: "03",
    badge: "Real Time",
    title: "Track your package",
    description: "Follow your package on the map from pickup to delivery. Get SMS updates at every stage.",
    tone: "bg-sky-50 text-sky-700 border-sky-200 tracking-[-0.04em] text-xs font-medium",
  },
  {
    step: "04",
    badge: "Confirmed",
    title: "Delivered & signed",
    description:
      "Recipient signs digitally or a photo is taken as proof of delivery. You're notified instantly.",
    tone: "bg-pink-50 text-pink-700 border-pink-200 tracking-[-0.04em] text-xs font-medium",
  },
];

const capabilityCards = [
  {
    title: "Deliveries today",
    stat: '842',
    style: "mt-3 max-w-2xl text-xs leading-7 text-emerald-800 sm:text-xs font-semibold",
    description:
      "↑ 21% vs last week",
  },
  {
    title: "Avg delivery time",
    stat: "45 min",
    style: "mt-3 max-w-2xl text-xs leading-7 text-emerald-800 sm:text-xs font-semibold",
    description:
      "↑ 6 min faster",
  },
  {
    title: "Success rate",
    stat: "98.2%",
    style: "mt-3 max-w-2xl text-xs leading-7 text-stone-600 sm:text-xs font-semibold",
    description:
      "first-attempt delivery",
  },
  {
    title: "Riders online now",
    stat: "12",
    style: "mt-3 max-w-2xl text-xs leading-7 text-stone-600 sm:text-xs font-semibold",
    description:
      "across 4 cities",
  },
];

export default function Home() {
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
                  <a href="#how-it-works" className="transition hover:text-stone-950">
                    How it works
                  </a>
                  <a href="#capabilities" className="transition hover:text-stone-950">
                    Capabilities
                  </a>
                  <a href="#ops-view" className="transition hover:text-stone-950">
                    Ops view
                  </a>
                </nav>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/nuna"
                  className="rounded-full border border-stone-300 bg-white/80 px-4 py-2 text-sm text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
                >
                  Open dashboard
                </Link>
                {hasEnvVars ? (
                  <Suspense>
                    <AuthButton />
                  </Suspense>
                ) : (
                  <div className="rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
                    Add env vars to enable auth
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="border-b border-stone-300/70 bg-emerald-900 text-sm text-stone-200 overflow-hidden relative flex">
            <div className="flex items-center gap-2 bg-emerald-900 px-5 py-3">
              <div className="w-3 h-3 rounded-full bg-emerald-300 animate-pulse shrink-0"></div>
            </div>
            <div className="bg-emerald-900 flex overflow-hidden py-3">
            <div className="flex whitespace-nowrap animate-marquee items-center">
              <div className="flex items-center gap-10 pr-10">
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">24</strong><span className="text-xs">rides completed today</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">98%</strong><span className="text-xs">on-time arrival rate</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">Minna</strong><span className="text-xs">now covered</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">45 min</strong><span className="text-xs">avg pickup time</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">₦500</strong><span className="text-xs">starting price</span></div>
              </div>
            </div>
            <div className="flex whitespace-nowrap animate-marquee items-center">
              <div className="flex items-center gap-10 pr-10">
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">24</strong><span className="text-xs">rides completed today</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">98%</strong><span className="text-xs">on-time arrival rate</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">Minna</strong><span className="text-xs">now covered</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">45 min</strong><span className="text-xs">avg pickup time</span></div>
                <span className="text-emerald-700">—</span>
                <div className="flex items-center gap-2"><strong className="text-white">₦500</strong><span className="text-xs">starting price</span></div>
              </div>
            </div>
            </div>
          </div>

          <div className="grid gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12 lg:py-14 max-w-7xl mx-auto">
            <div className="max-w-2xl">
              <div className="mb-6 flex flex-wrap gap-2">
                {trustSignals.map((signal) => (
                  <span
                    key={signal.label}
                    className={`rounded-full border px-3 py-0.5 text-xs font-medium ${signal.color} shadow-sm`}
                  >
                    {signal.label}
                  </span>
                ))}
              </div>

              <h1 className="max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.05em] text-stone-950 sm:text-5xl lg:text-7xl">
                Send <span className="text-emerald-700">Packages</span>{" "}
                <br />
                <span className="text-stone-950">With Ease</span>.
              </h1>
              <p className="mt-6 max-w-xl text-sm leading-7 text-stone-800 sm:text-lg">
                Nuna connects senders or recipients to verified dispatch riders for fast, safe package pickup and drop-off. Real-time tracking. Proof of delivery. No drama.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/nuna"
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800"
                >
                  Send a package
                  {/* <ArrowRight className="h-4 w-4" /> */}
                </Link>
                <Link
                  href="/protected"
                  className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white/70 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-white"
                >
                  Become a rider
                </Link>
              </div>

              <div className="mt-10 flex">


                <div className="p-4 backdrop-blur">
                  <div className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    120+
                  </div>
                  <div className="mt-1 text-xs font-medium text-stone-700">Packages delivered</div>
                </div>
                <div className="p-4 backdrop-blur">
                  <div className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
                    10+
                  </div>
                  <div className="mt-1 text-xs font-medium text-stone-700">Active riders</div>
                </div>
                <div className="p-4 backdrop-blur">
                  <div className="text-2xl font-semibold tracking-[-0.04em] text-stone-950 flex items-center gap-1">
                    4.9
                    <span className="text-stone-950 text-md">★</span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-stone-700">Avg delivery rating</div>
                </div>

              </div>
            </div>

            <div className="relative w-full max-w-md lg:ml-auto">
              <div className="absolute inset-0 -z-10 rounded-[28px] bg-[radial-gradient(circle_at_top_right,_rgba(22,163,74,0.16),_transparent_42%),radial-gradient(circle_at_bottom_left,_rgba(245,158,11,0.18),_transparent_30%)]" />
              <div className="rounded-[28px] border border-stone-300/80 bg-white/80 p-5 shadow-[0_18px_60px_rgba(28,28,28,0.12)] backdrop-blur sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-md font-bold font-mono text-stone-950">Book service</p>
                  </div>
                  <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                    High confidence
                  </div>
                </div>

                <div className="my-6 space-y-3">
                  <div className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-stone-500">
                      <span className="text-emerald-700 pr-2">●</span>Pick-up Address
                    </div>
                  </div>
                  <div className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-stone-500">
                      <span className="text-amber-700 pr-2">●</span>Drop-off Address
                    </div>
                  </div>
                  <div className="rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-stone-500">
                      <span className="text-stone-700 pr-2">●</span>Recipient Number
                    </div>
                  </div>
                <div className="h-44 w-full rounded-2xl overflow-hidden border border-stone-200 mt-4 mb-4 relative shadow-inner">
                  <MapboxMap 
                    zoom={11}
                    style="mapbox://styles/mapbox/light-v11"
                  />
                  <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-bold text-stone-500 border border-stone-200 shadow-sm pointer-events-none uppercase tracking-wider">
                    Minna Service Area
                  </div>
                </div>
              </div>

                <Button className="w-full bg-emerald-700 text-white py-6" variant="default">Book a ride</Button>
                <p className="text-xs text-center text-stone-400 pt-2">No surge pricing · Proof of delivery · Live tracking</p>
              </div>
            </div>
          </div>


<div className="border-t border-stone-300/70 w-full"></div>
          <section
            id="how-it-works"
            className="px-5 py-10 sm:px-8 lg:py-14 max-w-7xl mx-auto"
          >
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-lg font-bold text-stone-950">
                  How it works
                </p>
              </div>
              <p className="max-w-xl text-sm leading-6 text-stone-600 sm:text-base">
                Learn more →
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-4">
              {bookingSteps.map((item) => (
                <article
                  key={item.step}
                  className={`rounded-lg border border-stone-300/80 bg-white/80 p-6`}
                >
                  <div className="flex items-center justify-between text-2xl font-semibold tracking-[-0.06em] text-stone-200">
                    {item.step}
                    <Badge className={item.tone} variant="outline">{item.badge}</Badge>
                  </div>
                  <h3 className="mt-6 text-md font-semibold text-stone-950">{item.title}</h3>
                  <p className="mt-3 text-xs leading-7 text-stone-700 sm:text-xs">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </section>


<div className="border-t border-stone-300/70 w-full"></div>
          <section
            id="capabilities"
            className="px-5 py-10 sm:px-8 lg:py-14 max-w-7xl mx-auto"
          >

            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-lg font-bold text-stone-950">
                  Live delivery tracker
                </p>
              </div>
              <p className="max-w-xl text-sm leading-6 text-stone-600 sm:text-base">
                How tracking works →
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] items-start">
              <div className="rounded-md bg-[#f0f0ee] p-6 text-stone-100 sm:p-8">
                <p className="text-sm font-semibold tracking-[0.11em] text-stone-800">
Order #RNG-00452 · En route
                </p>
               
                <div className="text-stone-950 flex gap-4 align-items-start mt-12">
                  <div className="flex flex-col items-center"><div className="w-[28px] h-[28px] bg-emerald-700 text-white/80 rounded-full flex items-center justify-center text-xs font-500 flex-0;">✓</div><div className="w-[1px] h-[28px] bg-[rgba(0,0,0,0.25)]"></div></div>
                  <div className="pb-[20px]"><div className="text-[15px] font-semibold">Package picked up</div><div className="text-[12px] text-[#222] mt-[2px]">Lekki Phase 1 · 10:42 AM</div></div>
                </div>
                <div className="text-stone-950 flex gap-4 align-items-start">
                  <div className="flex flex-col items-center"><div className="w-[28px] h-[28px] bg-emerald-700 text-white/80 rounded-full flex items-center justify-center text-xs font-500 flex-0;">✓</div><div className="w-[1px] h-[28px] bg-[rgba(0,0,0,0.25)]"></div></div>
                  <div className="pb-[20px]"><div className="text-[15px] font-semibold">On the way</div><div className="text-[12px] text-[#222] mt-[2px]">Rider: Tunde A. · Bike: LSD-482-BK</div></div>
                </div>
                <div className="text-stone-950 flex gap-4 align-items-start">
                  <div className="flex flex-col items-center"><div className="w-[28px] h-[28px] bg-white text-stone-400 rounded-full flex items-center justify-center text-xs font-500 flex-0;">3</div></div>
                  <div className="pb-[20px]"><div className="text-[15px] font-semibold">Delivered</div><div className="text-[12px] text-[#222] mt-[2px]">05 May 2026 · 11:15 AM</div></div>
                </div>
              </div>

              <div className="grid gap-2 grid-cols-2">
                {capabilityCards.map((card) => (
                  <article
                    key={card.title}
                    className="rounded-md bg-[#f0f0ee] p-6"
                  >
                    <h3 className="text-xs font-semibold tracking-[-0.03em] text-stone-500">
                      {card.title}
                    </h3>
                    <h2 className="text-2xl font-semibold tracking-[-0.03em] pt-2 text-stone-950">
                      {card.stat}
                      </h2>
                    <p className={card.style}>
                      {card.description}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section
            id="ops-view"
            className="border-t border-stone-300/70 bg-white/40 px-5 py-10 sm:px-8 lg:py-14"
          >
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-800">
                  Ops view
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-4xl">
                  A cleaner story between the product promise and the dashboard you already have.
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-7 text-stone-600 sm:text-base">
                  The internal dashboard handles landmarks, trips, review flags, and
                  resolution events. This homepage now explains why those mechanics
                  matter instead of leaving users on the Supabase starter screen.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/nuna"
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-800"
                  >
                    Open operations dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-[28px] border border-stone-300/80 bg-white p-5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-800">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-stone-950">
                        Review risky trips before they fail
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Separate manual-review cases from clean trips and give ops a
                        straightforward resolution path.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-stone-300/80 bg-white p-5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-amber-100 p-3 text-amber-800">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-stone-950">
                        Learn from corrections
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Every clarification, correction, and confirmed pin becomes a
                        usable signal for better future bookings.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-stone-300/80 bg-white p-5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-sky-100 p-3 text-sky-800">
                      <MapPinned className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-stone-950">
                        Build a local map from real movement
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Instead of trusting incomplete address systems, Nuna gradually
                        builds a stronger location layer from confirmed usage.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <footer className="border-t border-stone-300/70 px-5 py-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-semibold tracking-[-0.04em] text-stone-950">
                  Nuna
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  Local location intelligence for better bookings.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-stone-600">
                <Link href="/" className="transition hover:text-stone-950">
                  Home
                </Link>
                <Link href="/nuna" className="transition hover:text-stone-950">
                  Dashboard
                </Link>
                <Link href="/auth/login" className="transition hover:text-stone-950">
                  Login
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}
