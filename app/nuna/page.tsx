'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import MapboxMap from "@/components/mapbox-map";
import { createClient } from "@/lib/supabase/client";
import { 
  Map as MapIcon, 
  Layers, 
  Search, 
  MapPin, 
  AlertCircle,
  CheckCircle2, 
  TrendingUp,
  RefreshCw,
  LocateFixed,
  Navigation,
  Clock as ClockIcon,
  Banknote
} from "lucide-react";
import { getDrivingRoute, calculateSuggestedPrice, RouteData } from "@/lib/maps/directions";

interface Location {
  id: string;
  raw_text: string;
  latitude: number;
  longitude: number;
  is_verified: boolean;
  hit_count: number;
  confidence_score: number;
  created_at: string;
}

interface Trip {
  id: string;
  status: string;
  created_at: string;
  pickup: Location;
  dropoff: Location;
}

export default function NunaPage() {
  const supabase = createClient();
  const [locations, setLocations] = useState<Location[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTab, setActiveTab] = useState<'landmarks' | 'trips'>('landmarks');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .order('hit_count', { ascending: false });

    if (error) {
      console.error('Supabase Query Error:', error);
      setErrorMsg(`Database Error: ${error.message}`);
    } else if (data) {
      setLocations(data);
    }
  }, [supabase]);

  const fetchTrips = useCallback(async () => {
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Trip Query Failed:', error);
      setErrorMsg(`Trip Sync Error: ${error.message}`);
    } else if (data) {
      setTrips(data as any[]); // Temporary cast while we define raw response type
    }
  }, [supabase]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setErrorMsg(null);
    await Promise.all([fetchLocations(), fetchTrips()]);
    setRefreshing(false);
    setLoading(false);
  }, [fetchLocations, fetchTrips]);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  const handleVerify = async (id: string) => {
    const { error } = await supabase
      .from('locations')
      .update({ is_verified: true })
      .eq('id', id);

    if (!error) {
      setLocations(prev => 
        prev.map(loc => loc.id === id ? { ...loc, is_verified: true } : loc)
      );
    }
  };

  const filteredLocations = useMemo(() => {
    return locations.filter(loc => 
      loc.raw_text.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [locations, searchQuery]);

  // LINK TRIPS IN MEMORY (Safe & Stable)
  const linkedTrips = useMemo(() => {
    if (locations.length === 0) return [];
    return trips.map(t => {
      const raw = t as unknown as { pickup_location_id: string; dropoff_location_id: string };
      const pickup = locations.find(loc => loc.id === raw.pickup_location_id);
      const dropoff = locations.find(loc => loc.id === raw.dropoff_location_id);
      if (!pickup || !dropoff) return null;
      return {
        ...t,
        pickup,
        dropoff
      } as Trip;
    }).filter((t): t is Trip => t !== null);
  }, [trips, locations]);

  const filteredTrips = useMemo(() => {
    return linkedTrips.filter(trip => 
      (trip.pickup?.raw_text?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      (trip.dropoff?.raw_text?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    );
  }, [linkedTrips, searchQuery]);

  const selectedLocation = useMemo(() => {
    if (activeTab === 'landmarks') return locations.find(loc => loc.id === selectedId);
    return null;
  }, [locations, selectedId, activeTab]);

  const selectedTrip = useMemo(() => {
    if (activeTab === 'trips') return linkedTrips.find(trip => trip.id === selectedId);
    return null;
  }, [linkedTrips, selectedId, activeTab]);

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

  const stats = useMemo(() => ({
    total: locations.length,
    verified: locations.filter(l => l.is_verified).length,
    activeTrips: linkedTrips.length
  }), [locations, linkedTrips]);

  const hasToken = typeof window !== 'undefined' && 
    (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN !== undefined && 
     process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN_HERE');

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
                onClick={() => { setActiveTab('landmarks'); setSelectedId(null); }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'landmarks' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                Hotspots
              </button>
              <button 
                onClick={() => { setActiveTab('trips'); setSelectedId(null); }}
                className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${activeTab === 'trips' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}
              >
                Live Trips
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
               <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">Operational Stats</h2>
               <TrendingUp className="w-3.5 h-3.5 text-muted-foreground/50" />
            </div>
            
            <div className="grid grid-cols-3 gap-2">
               <div className="bg-muted/30 p-2.5 rounded-xl border border-border/50 text-center transition-all hover:bg-muted/50 focus:ring-2 focus:ring-primary/20 cursor-default">
                  <p className="text-xs font-black text-foreground">{stats.total}</p>
                  <p className="text-[8px] font-bold text-muted-foreground uppercase mt-0.5">Total Hubs</p>
               </div>
               <div className="bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/10 text-center transition-all hover:bg-emerald-500/10 cursor-default">
                  <p className="text-xs font-black text-emerald-600">{stats.verified}</p>
                  <p className="text-[8px] font-bold text-emerald-600/70 uppercase mt-0.5">Verified</p>
               </div>
               <div className="bg-primary/5 p-2.5 rounded-xl border border-primary/10 text-center transition-all hover:bg-primary/10 cursor-default">
                  <p className="text-xs font-black text-primary">{stats.activeTrips}</p>
                  <p className="text-[8px] font-bold text-primary/70 uppercase mt-0.5">Bookings</p>
               </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4">
            <div className="px-3 pb-2 flex items-center justify-between bg-card sticky top-0 py-2 z-10 border-b border-border/50 mb-2">
               <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                 {activeTab === 'landmarks' ? 'Captured Landmarks' : 'Recent Bookings'}
               </p>
               {refreshing && <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
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
              filteredLocations.length === 0 ? (
                <div className="p-8 text-center bg-muted/5 rounded-2xl mx-2 border border-dashed border-border mt-8">
                  <Layers className="w-8 h-8 text-muted-foreground/30 mx-auto mb-4" />
                  <h3 className="text-xs font-bold text-foreground mb-1">No hotspots found</h3>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">Adjust your search or wait for new WhatsApp bookings.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredLocations.map((loc) => (
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
              )
            ) : (
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
                    <div 
                      key={trip.id}
                      onClick={() => setSelectedId(trip.id)}
                      className={`
                        group p-4 rounded-2xl transition-all cursor-pointer border border-transparent mx-1
                        ${selectedId === trip.id ? 'bg-primary/5 border-primary/10' : 'hover:bg-muted/50'}
                      `}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-1.5 bg-background shadow-xs px-2 py-0.5 rounded-full border border-border">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          <span className="text-[8px] font-black uppercase tracking-tighter text-foreground/70">
                            {trip.status}
                          </span>
                        </div>
                        <span className="text-[8px] font-bold text-muted-foreground">{new Date(trip.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
                  ))}
                </div>
              )
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
            activeTrip={selectedTrip ? {
              id: selectedTrip.id,
              pickup: { lat: selectedTrip.pickup.latitude, lng: selectedTrip.pickup.longitude },
              dropoff: { lat: selectedTrip.dropoff.latitude, lng: selectedTrip.dropoff.longitude },
              geometry: activeRoute?.geometry
            } : undefined}
            markers={locations.map(loc => ({
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
          <div className="absolute top-6 right-6 flex flex-col gap-2 z-10 pointer-events-none">
             <div className="bg-background/90 backdrop-blur-xl p-3 rounded-2xl border border-border shadow-2xl pointer-events-auto">
                <div className="flex items-center gap-3 mb-2">
                   <div className="w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
                   <p className="text-[10px] font-bold text-foreground/80 uppercase tracking-tighter">Verified Hubs</p>
                </div>
                <div className="flex items-center gap-3">
                   <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse ring-4 ring-amber-500/15" />
                   <p className="text-[10px] font-bold text-foreground/80 uppercase tracking-tighter">New Captures</p>
                </div>
             </div>
             <button 
               onClick={() => setSelectedId(null)}
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
