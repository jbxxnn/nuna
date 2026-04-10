"use client";

import { useState } from "react";

import Link from "next/link";
import { AlertCircle, CheckCircle2, FileUp, Upload } from "lucide-react";

interface ImportResult {
  success: boolean;
  importedCount: number;
  aliasCount: number;
  errorCount: number;
  errors: string[];
}

export function LandmarkImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleImport() {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/nuna/landmarks/import", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ImportResult | { error?: string };
      const errorMessage =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : null;

      if (!response.ok) {
        throw new Error(errorMessage || "Import failed.");
      }

      setResult(payload as ImportResult);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-primary">
              Admin Tool
            </p>
            <h1 className="text-3xl font-black tracking-tight text-foreground">
              Import Landmarks From CSV
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Upload a CSV to bulk create or update verified landmarks. This tool
              is restricted to admins.
            </p>
          </div>
          <Link
            href="/nuna"
            className="rounded-2xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted/50"
          >
            Back to Dashboard
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FileUp className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-black text-foreground">Upload CSV</h2>
            </div>

            <div className="space-y-4">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm"
              />

              <button
                type="button"
                onClick={handleImport}
                disabled={uploading || !file}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {uploading ? "Importing..." : "Import CSV"}
              </button>
            </div>

            {error && (
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {result && (
              <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-700">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  <div className="space-y-2 text-sm font-medium">
                    <p>
                      Imported {result.importedCount} landmarks and {result.aliasCount} aliases.
                    </p>
                    <p>{result.errorCount} rows reported errors.</p>
                    {result.errors.length > 0 && (
                      <div className="rounded-xl border border-emerald-500/20 bg-background/70 p-3 text-xs text-foreground">
                        <p className="mb-2 font-black uppercase tracking-widest text-muted-foreground">
                          Import Notes
                        </p>
                        <div className="space-y-1">
                          {result.errors.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-black text-foreground">CSV Format</h2>
            <div className="mt-4 space-y-4 text-sm text-muted-foreground">
              <div>
                <p className="font-bold text-foreground">Required columns</p>
                <p>`raw_text`, `latitude`, `longitude`</p>
              </div>
              <div>
                <p className="font-bold text-foreground">Optional columns</p>
                <p>`category`, `address`, `notes`, `aliases`, `is_verified`, `confidence_score`</p>
              </div>
              <div>
                <p className="font-bold text-foreground">Aliases</p>
                <p>Use comma or semicolon separated aliases in one cell.</p>
              </div>
              <div>
                <p className="font-bold text-foreground">Example</p>
                <pre className="overflow-x-auto rounded-2xl border border-border bg-background p-3 text-xs text-foreground">
{`raw_text,latitude,longitude,category,address,notes,aliases,is_verified,confidence_score
iya femi restaurant,9.61389,6.55694,restaurant,Bosso Road Minna,Popular pickup point,"iya femi;iya femi minna",true,1
kpakungu roundabout,9.58012,6.54011,junction,Kpakungu Minna,,kpakungu,true,1`}
                </pre>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
