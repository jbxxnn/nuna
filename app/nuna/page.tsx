'use client';

import MapboxMap from "@/components/mapbox-map";
import { Info, Map as MapIcon, Layers, Search, MapPin, AlertCircle, CheckCircle2 } from "lucide-react";

export default function NunaPage() {
  const hasToken = typeof window !== 'undefined' && (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN !== undefined && process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN !== 'YOUR_MAPBOX_ACCESS_TOKEN_HERE');
  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <MapIcon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Nuna Map View</h1>
            <div className="flex items-center gap-1.5 leading-none">
              <MapPin className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Chanchaga LGA, Minna, Niger State</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
           <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Search precise location..." 
              className="pl-9 pr-4 py-2 bg-muted/50 border border-border rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 w-64 transition-all"
            />
          </div>
          <button className="p-2 hover:bg-muted rounded-full transition-colors">
            <Layers className="w-5 h-5 text-muted-foreground" />
          </button>
          <button className="p-2 hover:bg-muted rounded-full transition-colors">
            <Info className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex overflow-hidden">
        {/* Sidebar Space for Future Data */}
        <aside className="w-80 border-r border-border bg-card hidden lg:flex flex-col overflow-y-auto">
          <div className="p-6 border-b border-border">
            <h2 className="text-xs font-semibold mb-1 uppercase tracking-wider text-muted-foreground/80">Location Data</h2>
            <p className="text-[11px] text-muted-foreground">Detailed site information for the Minna region. Your database records will be listed here.</p>
          </div>
          
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/5">
            <div className="w-16 h-16 bg-muted/30 rounded-2xl flex items-center justify-center mb-6 relative">
              <Layers className="w-8 h-8 text-muted-foreground/40" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center border border-background">
                 <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              </div>
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Ready for Data Integration</h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
              Once you connect your database, location markers will populate this list and the map view.
            </p>
          </div>

          <div className="p-4 border-t border-border">
            <div className={`p-3 rounded-lg flex items-center gap-3 ${hasToken ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
              <div className={`w-2 h-2 rounded-full ${hasToken ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <div>
                <p className={`text-[10px] font-bold ${hasToken ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {hasToken ? 'Mapbox Connected' : 'Access Token Missing'}
                </p>
                <p className="text-[9px] text-muted-foreground mt-0.5 font-medium leading-none">
                  {hasToken ? 'Tiles are loading...' : 'Verify .env.local configuration'}
                </p>
              </div>
              {hasToken ? (
                <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-emerald-500" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 ml-auto text-amber-500 animate-bounce" />
              )}
            </div>
          </div>
        </aside>

        {/* Map Container */}
        <div className="flex-1 relative h-full">
          <MapboxMap 
            center={[6.55694, 9.61389]} 
            zoom={13} 
          />
        </div>
      </main>
    </div>
  );
}
