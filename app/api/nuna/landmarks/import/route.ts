import { NextRequest, NextResponse } from "next/server";

import { canImportLandmarks, getCurrentAppUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface CsvRow {
  raw_text: string;
  latitude: string;
  longitude: string;
  category?: string;
  address?: string;
  notes?: string;
  aliases?: string;
  is_verified?: string;
  confidence_score?: string;
}

function parseCsv(csvText: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentField);
      if (currentRow.some((field) => field.trim() !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField);
  if (currentRow.some((field) => field.trim() !== "")) {
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    throw new Error("CSV file is empty.");
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.trim().toLowerCase());

  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (row[index] ?? "").trim();
    });
    return {
      raw_text: record.raw_text ?? "",
      latitude: record.latitude ?? "",
      longitude: record.longitude ?? "",
      category: record.category,
      address: record.address,
      notes: record.notes,
      aliases: record.aliases,
      is_verified: record.is_verified,
      confidence_score: record.confidence_score,
    } satisfies CsvRow;
  });
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function parseAliases(rawAliases: string | undefined) {
  if (!rawAliases) return [];

  return Array.from(
    new Set(
      rawAliases
        .split(/[;,]/)
        .map((alias) => alias.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export async function POST(request: NextRequest) {
  const appUser = await getCurrentAppUser();

  if (!appUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canImportLandmarks(appUser.role)) {
    return NextResponse.json({ error: "Only admins can import landmarks" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  const csvText = await file.text();

  let records: CsvRow[];
  try {
    records = parseCsv(csvText);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse CSV" },
      { status: 400 },
    );
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "CSV file has no data rows" }, { status: 400 });
  }

  const errors: string[] = [];
  let importedCount = 0;
  let aliasCount = 0;

  for (const [index, record] of records.entries()) {
    const rowNumber = index + 2;
    const rawText = record.raw_text?.trim().toLowerCase();
    const latitude = Number.parseFloat(record.latitude);
    const longitude = Number.parseFloat(record.longitude);

    if (!rawText) {
      errors.push(`Row ${rowNumber}: raw_text is required.`);
      continue;
    }

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      errors.push(`Row ${rowNumber}: latitude and longitude must be valid numbers.`);
      continue;
    }

    const confidenceScore = record.confidence_score
      ? Number.parseFloat(record.confidence_score)
      : 1;

    if (Number.isNaN(confidenceScore)) {
      errors.push(`Row ${rowNumber}: confidence_score must be a valid number.`);
      continue;
    }

    const payload = {
      raw_text: rawText,
      normalized_text: rawText,
      latitude,
      longitude,
      is_verified: parseBoolean(record.is_verified, true),
      confidence_score: confidenceScore,
      metadata: {
        category: record.category?.trim() || "landmark",
        address: record.address?.trim() || null,
        notes: record.notes?.trim() || null,
        source: "csv_import",
      },
      last_used_at: new Date().toISOString(),
    };

    const { data: locationRow, error: locationError } = await supabaseAdmin
      .from("locations")
      .upsert(payload, { onConflict: "raw_text" })
      .select("id")
      .single();

    if (locationError || !locationRow) {
      console.error("Failed to import CSV landmark:", locationError);
      errors.push(`Row ${rowNumber}: failed to import landmark "${rawText}".`);
      continue;
    }

    importedCount += 1;

    const aliases = parseAliases(record.aliases);
    if (aliases.length === 0) {
      continue;
    }

    const aliasRows = aliases.map((alias) => ({
      location_id: locationRow.id,
      alias_text: alias,
      normalized_alias: alias,
      source: "csv_import",
      confidence_score: 1,
    }));

    const { error: aliasError } = await supabaseAdmin
      .from("location_aliases")
      .upsert(aliasRows, { onConflict: "location_id,normalized_alias" });

    if (aliasError) {
      console.error("Failed to import CSV aliases:", aliasError);
      errors.push(`Row ${rowNumber}: landmark imported, but aliases failed for "${rawText}".`);
      continue;
    }

    aliasCount += aliasRows.length;
  }

  return NextResponse.json({
    success: errors.length === 0,
    importedCount,
    aliasCount,
    errorCount: errors.length,
    errors,
  });
}
