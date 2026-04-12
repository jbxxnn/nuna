import { reverseGeocode } from "@/lib/geocoding";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type ResolutionAction = "accept" | "clarify" | "request_pin";
export type ResolutionConfidence = "high" | "medium" | "low" | "very_low";
export type ResolutionSource = "pin" | "local" | "user_history" | "none";

export interface LocationCandidate {
  label: string;
  latitude: number | null;
  longitude: number | null;
  source: ResolutionSource;
  score: number;
  isVerified?: boolean;
}

export interface LocationResolutionResult {
  action: ResolutionAction;
  confidence: ResolutionConfidence;
  source: ResolutionSource;
  reason: string;
  clarificationPrompt?: string;
  normalizedText: string;
  displayText: string;
  latitude: number | null;
  longitude: number | null;
  score: number;
  isVerified: boolean;
  candidates: LocationCandidate[];
  relationContext?: {
    targetText: string;
    anchorText: string;
    relation: string;
    anchorCandidate?: LocationCandidate;
  };
}

interface ResolveLocationInputParams {
  text?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  label?: string | null;
  address?: string | null;
  userId?: string | null;
  leg?: "pickup" | "dropoff";
}

interface StoredLocation {
  id?: string;
  raw_text: string;
  latitude: number | null;
  longitude: number | null;
  is_verified: boolean | null;
  hit_count: number | null;
  metadata?: Record<string, unknown> | null;
}

interface StoredSavedPlace {
  label: string;
  use_count: number | null;
  last_used_at: string | null;
  location_id: string;
  locations: StoredLocation | StoredLocation[] | null;
}

interface MemoryIntent {
  type: "recent_trip" | "saved_place" | null;
  leg?: "pickup" | "dropoff";
  label?: string;
}

interface ParsedLandmarkPhrase {
  relation: string | null;
  landmarkText: string;
}

interface ParsedRelativeLocation {
  relation: string | null;
  targetText: string;
  anchorText: string;
}

const RELATION_PATTERNS = [
  "opposite",
  "beside",
  "next to",
  "close to",
  "near",
  "after",
  "before",
  "by",
  "around",
];

const GENERIC_LOCATION_TERMS = new Set([
  "hospital",
  "clinic",
  "school",
  "market",
  "junction",
  "roundabout",
  "bank",
  "hotel",
  "restaurant",
  "mosque",
  "church",
  "pharmacy",
  "station",
  "terminal",
  "park",
  "estate",
  "gate",
  "plaza",
]);

function buildLearningPinPrompt(subject: string) {
  return `I am still learning some places on the map, so I could not confirm this ${subject} yet.\n\nPlease send a WhatsApp location pin:\n📎 Tap Attach\n📍 Tap Location\n🔎 Search the place or send your current location\n\nSend the pin here when ready.`;
}

function formatCandidateLabel(candidate: StoredLocation): string {
  const address =
    typeof candidate.metadata?.address === "string" ? candidate.metadata.address.trim() : "";

  if (!address) {
    return candidate.raw_text;
  }

  const normalizedRawText = normalizeText(candidate.raw_text);
  const normalizedAddress = normalizeText(address);

  if (!normalizedAddress || normalizedAddress === normalizedRawText) {
    return candidate.raw_text;
  }

  return `${candidate.raw_text} - ${address}`;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function isShortUnderspecifiedInput(input: string, candidateLabel?: string): boolean {
  const normalizedInput = normalizeText(input);
  const inputTokens = tokenize(normalizedInput);

  if (!normalizedInput || inputTokens.length === 0) {
    return false;
  }

  const candidateTokens = candidateLabel ? tokenize(candidateLabel) : [];
  const hasExtraCandidateWords = candidateTokens.length > inputTokens.length;
  const hasGenericTerm = inputTokens.some((token) => GENERIC_LOCATION_TERMS.has(token));

  if (hasGenericTerm && inputTokens.length <= 3) {
    return true;
  }

  return inputTokens.length <= 2 && hasExtraCandidateWords;
}

function parseLandmarkPhrase(input: string): ParsedLandmarkPhrase {
  const normalized = normalizeText(input);

  for (const pattern of RELATION_PATTERNS) {
    if (normalized.startsWith(`${pattern} `)) {
      return {
        relation: pattern,
        landmarkText: normalized.slice(pattern.length).trim(),
      };
    }

    const middlePattern = ` ${pattern} `;
    if (normalized.includes(middlePattern)) {
      const parts = normalized.split(middlePattern);
      const landmarkText = parts[parts.length - 1]?.trim() ?? "";
      if (landmarkText) {
        return {
          relation: pattern,
          landmarkText,
        };
      }
    }
  }

  return {
    relation: null,
    landmarkText: normalized,
  };
}

function parseRelativeLocation(input: string): ParsedRelativeLocation {
  const normalized = normalizeText(input);

  for (const pattern of RELATION_PATTERNS) {
    const middlePattern = ` ${pattern} `;
    if (normalized.includes(middlePattern)) {
      const [left, ...rest] = normalized.split(middlePattern);
      const right = rest.join(middlePattern).trim();
      return {
        relation: pattern,
        targetText: left.trim(),
        anchorText: right,
      };
    }
  }

  return {
    relation: null,
    targetText: "",
    anchorText: "",
  };
}

function computeCandidateScore(input: string, candidate: StoredLocation): number {
  const normalizedInput = normalizeText(input);
  const candidateText = normalizeText(candidate.raw_text);

  if (!normalizedInput || !candidateText) return 0;
  if (candidateText === normalizedInput) return 1;

  const inputTokens = tokenize(normalizedInput);
  const candidateTokens = tokenize(candidateText);
  const overlap = inputTokens.filter((token) => candidateTokens.includes(token)).length;
  const tokenScore = inputTokens.length > 0 ? overlap / inputTokens.length : 0;
  const prefixScore =
    candidateText.startsWith(normalizedInput) || normalizedInput.startsWith(candidateText) ? 0.2 : 0;
  const verifyBoost = candidate.is_verified ? 0.1 : 0;
  const hitBoost = Math.min((candidate.hit_count || 0) / 50, 0.1);

  return Math.min(tokenScore + prefixScore + verifyBoost + hitBoost, 0.99);
}

function buildClarificationPrompt(input: string, candidates: LocationCandidate[]): string {
  if (candidates.length === 0) {
    return "I found the area, but I need a more specific landmark. Please reply with a nearby junction, market, bank, school, or send a WhatsApp pin.";
  }

  const visibleCandidates = candidates.slice(0, 3);
  const noOptionNumber = visibleCandidates.length + 1;
  const options = visibleCandidates
    .map((candidate, index) => `${index + 1}. ${candidate.label}`)
    .join("\n");

  return `I found these matches for "${input}":\n${options}\n${noOptionNumber}. No\n\nReply with a number from 1 to ${noOptionNumber}.`;
}

async function findLocalCandidates(input: string): Promise<LocationCandidate[]> {
  const parsedPhrase = parseLandmarkPhrase(input);
  const normalizedInput = parsedPhrase.landmarkText;
  const tokens = tokenize(parsedPhrase.landmarkText).slice(0, 4);

  if (!normalizedInput) return [];

  const orFilters = [
    `raw_text.ilike.%${normalizedInput}%`,
    ...tokens.map((token) => `raw_text.ilike.%${token}%`),
  ];

  const { data } = await supabaseAdmin
    .from("locations")
    .select("id, raw_text, latitude, longitude, is_verified, hit_count, metadata")
    .not("latitude", "is", null)
    .or(orFilters.join(","))
    .order("is_verified", { ascending: false })
    .order("hit_count", { ascending: false })
    .limit(15);

  if (!data) return [];

  return (data as StoredLocation[])
    .map((candidate) => ({
      label: formatCandidateLabel(candidate),
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      source: "local" as const,
      score: computeCandidateScore(parsedPhrase.landmarkText || input, candidate),
      isVerified: !!candidate.is_verified,
    }))
    .filter((candidate) => candidate.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function buildRelationClarificationPrompt(input: string, relation: string, candidates: LocationCandidate[]): string {
  const visibleCandidates = candidates.slice(0, 3);
  const noOptionNumber = visibleCandidates.length + 1;
  const options = visibleCandidates
    .map((candidate, index) => `${index + 1}. ${candidate.label}`)
    .join("\n");

  return `I found places matching "${input}". Which landmark is your location ${relation}?\n${options}\n${noOptionNumber}. No\n\nReply with a number from 1 to ${noOptionNumber}.`;
}

function parseMemoryIntent(input: string, currentLeg: "pickup" | "dropoff"): MemoryIntent {
  const normalized = normalizeText(input);

  if (["home", "work"].includes(normalized)) {
    return { type: "saved_place", label: normalized };
  }

  if (normalized.startsWith("use ")) {
    const maybeLabel = normalized.replace(/^use\s+/, "").trim();
    if (maybeLabel) {
      return { type: "saved_place", label: maybeLabel };
    }
  }

  if ([
    "same place as last time",
    "same as last time",
    "last place",
    "same place",
  ].includes(normalized)) {
    return { type: "recent_trip", leg: currentLeg };
  }

  if ([
    "same pickup as last time",
    "same pickup",
    "last pickup",
    "use last pickup",
  ].includes(normalized)) {
    return { type: "recent_trip", leg: "pickup" };
  }

  if ([
    "same dropoff as last time",
    "same drop off as last time",
    "same dropoff",
    "same drop off",
    "last dropoff",
    "last drop off",
    "use last dropoff",
    "use last drop off",
  ].includes(normalized)) {
    return { type: "recent_trip", leg: "dropoff" };
  }

  return { type: null };
}

async function getRecentTripLocationCandidate(
  userId: string,
  leg: "pickup" | "dropoff",
): Promise<LocationCandidate | null> {
  const locationColumn = leg === "pickup" ? "pickup_location_id" : "dropoff_location_id";
  const { data } = await supabaseAdmin
    .from("trips")
    .select(
      `id, created_at, ${locationColumn}, locations!trips_${locationColumn}_fkey(id, raw_text, latitude, longitude, is_verified, hit_count, metadata)`
    )
    .eq("user_id", userId)
    .not(locationColumn, "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const location = (data?.locations ?? null) as StoredLocation | null;
  if (!location?.latitude || !location?.longitude) return null;

  return {
    label: formatCandidateLabel(location),
    latitude: location.latitude,
    longitude: location.longitude,
    source: "user_history",
    score: 0.95,
    isVerified: !!location.is_verified,
  };
}

async function getSavedPlaceCandidate(
  userId: string,
  input: string,
): Promise<LocationCandidate | null> {
  const normalizedInput = normalizeText(input);
  const { data } = await supabaseAdmin
    .from("user_saved_places")
    .select(
      "label, use_count, last_used_at, location_id, locations(id, raw_text, latitude, longitude, is_verified, hit_count, metadata)"
    )
    .eq("user_id", userId)
    .order("use_count", { ascending: false })
    .order("last_used_at", { ascending: false });

  const rows = (data ?? []) as StoredSavedPlace[];
  const match = rows.find((row) => normalizeText(row.label) === normalizedInput);
  const locationValue = match?.locations;
  const location = Array.isArray(locationValue) ? locationValue[0] : locationValue;

  if (!match || !location?.latitude || !location?.longitude) return null;

  return {
    label: formatCandidateLabel(location),
    latitude: location.latitude,
    longitude: location.longitude,
    source: "user_history",
    score: 0.98,
    isVerified: !!location.is_verified,
  };
}

export async function resolveLocationInput({
  text,
  latitude,
  longitude,
  label,
  address,
  userId,
  leg = "pickup",
}: ResolveLocationInputParams): Promise<LocationResolutionResult> {
  const rawText = text?.trim() ?? "";
  const lat = latitude ? parseFloat(latitude) : null;
  const lng = longitude ? parseFloat(longitude) : null;

  if (lat !== null && lng !== null) {
    const displayText = label
      ? address
        ? `${label}, ${address}`
        : label
      : (await reverseGeocode(lat, lng)) || rawText || `${lat}, ${lng}`;

    const normalizedText = displayText.trim().toLowerCase();

    return {
      action: "accept",
      confidence: "high",
      source: "pin",
      reason: "User shared a WhatsApp location pin",
      clarificationPrompt: undefined,
      normalizedText,
      displayText,
      latitude: lat,
      longitude: lng,
      score: 1,
      isVerified: true,
      candidates: [
        {
          label: displayText,
          latitude: lat,
          longitude: lng,
          source: "pin",
          score: 1,
          isVerified: true,
        },
      ],
    };
  }

  const normalizedInput = normalizeText(rawText);
  if (!normalizedInput) {
    return {
      action: "request_pin",
      confidence: "very_low",
      source: "none",
      reason: "No location text or coordinates were provided",
      clarificationPrompt: buildLearningPinPrompt("location"),
      normalizedText: "",
      displayText: "",
      latitude: null,
      longitude: null,
      score: 0,
      isVerified: false,
      candidates: [],
    };
  }

  if (userId) {
    const memoryIntent = parseMemoryIntent(rawText, leg);

    if (memoryIntent.type === "recent_trip" && memoryIntent.leg) {
      const memoryCandidate = await getRecentTripLocationCandidate(userId, memoryIntent.leg);
      if (memoryCandidate) {
        return {
          action: "accept",
          confidence: "high",
          source: "user_history",
          reason: `Resolved using the user's most recent ${memoryIntent.leg}`,
          clarificationPrompt: undefined,
          normalizedText: normalizeText(memoryCandidate.label),
          displayText: memoryCandidate.label,
          latitude: memoryCandidate.latitude,
          longitude: memoryCandidate.longitude,
          score: memoryCandidate.score,
          isVerified: !!memoryCandidate.isVerified,
          candidates: [memoryCandidate],
        };
      }
    }

    const savedPlaceCandidate = await getSavedPlaceCandidate(
      userId,
      memoryIntent.type === "saved_place" && memoryIntent.label ? memoryIntent.label : rawText,
    );
    if (savedPlaceCandidate) {
      return {
        action: "accept",
        confidence: "high",
        source: "user_history",
        reason: "Resolved using the user's saved place",
        clarificationPrompt: undefined,
        normalizedText: normalizeText(savedPlaceCandidate.label),
        displayText: savedPlaceCandidate.label,
        latitude: savedPlaceCandidate.latitude,
        longitude: savedPlaceCandidate.longitude,
        score: savedPlaceCandidate.score,
        isVerified: !!savedPlaceCandidate.isVerified,
        candidates: [savedPlaceCandidate],
      };
    }
  }

  const { data: localMatch } = await supabaseAdmin
    .from("locations")
    .select("raw_text, latitude, longitude, is_verified, hit_count, metadata")
    .eq("raw_text", normalizedInput)
    .not("latitude", "is", null)
    .order("is_verified", { ascending: false })
    .order("hit_count", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (localMatch?.latitude && localMatch?.longitude) {
    const exactMatchCandidates = await findLocalCandidates(rawText);

    return {
      action: "clarify",
      confidence: localMatch.is_verified ? "high" : "medium",
      source: "local",
      reason: "Found matching saved locations and need the user to confirm the intended one",
      clarificationPrompt: buildClarificationPrompt(rawText, exactMatchCandidates.length > 0 ? exactMatchCandidates : [
        {
          label: formatCandidateLabel(localMatch),
          latitude: localMatch.latitude,
          longitude: localMatch.longitude,
          source: "local",
          score: localMatch.is_verified ? 1 : 0.8,
          isVerified: !!localMatch.is_verified,
        },
      ]),
      normalizedText: localMatch.raw_text,
      displayText: formatCandidateLabel(localMatch),
      latitude: localMatch.latitude,
      longitude: localMatch.longitude,
      score: localMatch.is_verified ? 1 : 0.8,
      isVerified: !!localMatch.is_verified,
      candidates: exactMatchCandidates.length > 0 ? exactMatchCandidates : [
        {
          label: formatCandidateLabel(localMatch),
          latitude: localMatch.latitude,
          longitude: localMatch.longitude,
          source: "local",
          score: localMatch.is_verified ? 1 : 0.8,
          isVerified: !!localMatch.is_verified,
        },
      ],
      relationContext: undefined,
    };
  }

  const relativeLocation = parseRelativeLocation(rawText);
  if (relativeLocation.relation && relativeLocation.targetText && relativeLocation.anchorText) {
    const [targetCandidates, anchorCandidates] = await Promise.all([
      findLocalCandidates(relativeLocation.targetText),
      findLocalCandidates(relativeLocation.anchorText),
    ]);

    const bestTargetCandidate = targetCandidates[0];
    const bestAnchorCandidate = anchorCandidates[0];
    const anchorIsKnown = !!bestAnchorCandidate && bestAnchorCandidate.score >= 0.75;
    const targetIsKnown = !!bestTargetCandidate && bestTargetCandidate.score >= 0.9;

    if (targetIsKnown && bestTargetCandidate) {
      return {
        action: "accept",
        confidence: bestTargetCandidate.isVerified ? "high" : "medium",
        source: "local",
        reason: "Matched the target landmark while using a known anchor as context",
        clarificationPrompt: undefined,
        normalizedText: normalizeText(bestTargetCandidate.label),
        displayText: bestTargetCandidate.label,
        latitude: bestTargetCandidate.latitude,
        longitude: bestTargetCandidate.longitude,
        score: bestTargetCandidate.score,
        isVerified: !!bestTargetCandidate.isVerified,
        candidates: targetCandidates,
        relationContext: {
          targetText: relativeLocation.targetText,
          anchorText: relativeLocation.anchorText,
          relation: relativeLocation.relation,
          anchorCandidate: bestAnchorCandidate,
        },
      };
    }

    if (anchorIsKnown && !targetIsKnown) {
      return {
        action: "request_pin",
        confidence: "low",
        source: "local",
        reason: "Recognized the anchor landmark but not the target place described near it",
        clarificationPrompt: `I know ${bestAnchorCandidate?.label}, but I am still learning ${relativeLocation.targetText} on the map.\n\nPlease send a WhatsApp location pin:\n📎 Tap Attach\n📍 Tap Location\n🔎 Search the place or send your current location\n\nSend the pin here when ready.`,
        normalizedText: normalizeText(relativeLocation.targetText),
        displayText: relativeLocation.targetText,
        latitude: null,
        longitude: null,
        score: 0.4,
        isVerified: false,
        candidates: anchorCandidates,
        relationContext: {
          targetText: relativeLocation.targetText,
          anchorText: relativeLocation.anchorText,
          relation: relativeLocation.relation,
          anchorCandidate: bestAnchorCandidate,
        },
      };
    }
  }

  const localCandidates = await findLocalCandidates(rawText);
  const bestLocalCandidate = localCandidates[0];
  const parsedPhrase = parseLandmarkPhrase(rawText);
  const inputLooksUnderspecified = bestLocalCandidate
    ? isShortUnderspecifiedInput(rawText, bestLocalCandidate.label)
    : false;

  if (bestLocalCandidate && bestLocalCandidate.score >= 0.9 && !inputLooksUnderspecified) {
    return {
      action: "clarify",
      confidence: bestLocalCandidate.isVerified ? "high" : "medium",
      source: "local",
      reason: "Found strong local landmark matches and need user confirmation",
      clarificationPrompt: parsedPhrase.relation
        ? buildRelationClarificationPrompt(parsedPhrase.landmarkText, parsedPhrase.relation, localCandidates)
        : buildClarificationPrompt(rawText, localCandidates),
      normalizedText: normalizeText(bestLocalCandidate.label),
      displayText: bestLocalCandidate.label,
      latitude: bestLocalCandidate.latitude,
      longitude: bestLocalCandidate.longitude,
      score: bestLocalCandidate.score,
      isVerified: !!bestLocalCandidate.isVerified,
      candidates: localCandidates,
      relationContext: undefined,
    };
  }

  if (bestLocalCandidate && inputLooksUnderspecified) {
    return {
      action: "clarify",
      confidence: "low",
      source: "local",
      reason: "The input is too short or generic to trust a partial landmark match automatically",
      clarificationPrompt: buildClarificationPrompt(rawText, localCandidates),
      normalizedText: normalizedInput,
      displayText: rawText,
      latitude: bestLocalCandidate.latitude,
      longitude: bestLocalCandidate.longitude,
      score: bestLocalCandidate.score,
      isVerified: !!bestLocalCandidate.isVerified,
      candidates: localCandidates,
      relationContext: undefined,
    };
  }

  if (localCandidates.length > 1 && bestLocalCandidate && bestLocalCandidate.score >= 0.55) {
    return {
      action: "clarify",
      confidence: "medium",
      source: "local",
      reason: "Found multiple likely local landmark matches",
      clarificationPrompt: parsedPhrase.relation
        ? buildRelationClarificationPrompt(parsedPhrase.landmarkText, parsedPhrase.relation, localCandidates)
        : buildClarificationPrompt(rawText, localCandidates),
      normalizedText: normalizedInput,
      displayText: rawText,
      latitude: bestLocalCandidate.latitude,
      longitude: bestLocalCandidate.longitude,
      score: bestLocalCandidate.score,
      isVerified: !!bestLocalCandidate.isVerified,
      candidates: localCandidates,
      relationContext: undefined,
    };
  }

  if (localCandidates.length === 1 && bestLocalCandidate && bestLocalCandidate.score >= 0.45) {
    return {
      action: "clarify",
      confidence: "low",
      source: "local",
      reason: "Found one possible local landmark, but confidence is too low to trust automatically",
      clarificationPrompt: buildClarificationPrompt(rawText, localCandidates),
      normalizedText: normalizedInput,
      displayText: rawText,
      latitude: bestLocalCandidate.latitude,
      longitude: bestLocalCandidate.longitude,
      score: bestLocalCandidate.score,
      isVerified: !!bestLocalCandidate.isVerified,
      candidates: localCandidates,
      relationContext: undefined,
    };
  }

  return {
    action: "request_pin",
    confidence: "very_low",
    source: "none",
    reason: "Could not resolve the location from local data",
    clarificationPrompt: buildLearningPinPrompt("location"),
    normalizedText: normalizedInput,
    displayText: rawText,
    latitude: null,
    longitude: null,
    score: 0,
    isVerified: false,
    candidates: [],
    relationContext: undefined,
  };
}
