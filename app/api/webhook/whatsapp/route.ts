import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateTwiMLResponse, verifyTwilioSignature } from '@/lib/twilio';
import { getDrivingRoute, calculateSuggestedPrice } from '@/lib/maps/directions';
import { LocationCandidate, resolveLocationInput } from '@/lib/location-resolver';
import { validateTrip } from '@/lib/trip-validation';

interface SessionStateRow {
  phone_number: string;
  current_step: string;
  current_trip_id?: string | null;
  pending_resolution_type?: string | null;
  pending_candidates?: LocationCandidate[] | null;
  retry_count?: number | null;
  last_prompt_type?: string | null;
  context_payload?: Record<string, unknown> | null;
}

const MAX_CLARIFICATION_RETRIES = 2;
const MAX_PIN_RETRIES = 2;
const SESSION_START_COMMANDS = ['nuna', 'hi', 'start'];
const SESSION_RESET_COMMANDS = ['cancel', 'reset', 'start over', 'restart'];

const PICKUP_PIN_MESSAGE =
  "I am still improving our map for some pick-up places.\n\n*Send your pick-up pin*\n📎 Tap *Attach*\n📍 Tap *Location*\n🔎 Search the place or send your current location if you are at the pick-up location right now\n\nSend the pin here when ready.";

const DROPOFF_PIN_MESSAGE =
  "I am still improving our map for some drop-off places.\n\n*Send your drop-off pin*\n📎 Tap *Attach*\n📍 Tap *Location*\n🔎 Search the place or send your current location if you are at the drop-off location right now\n\nSend the pin here when ready.";

function buildWelcomePrompt() {
  return "Welcome to *Nuna*.\n\n*Pick-up location*\nSend the place name or send a WhatsApp location pin.\n\nYou can type *Cancel* at any time to start again.";
}

function buildStartPrompt() {
  return "To start a booking, send *Nuna*, *Hi*, or *Start*.";
}

function buildManualReviewMessage(stage: 'pickup' | 'dropoff') {
  return stage === 'pickup'
    ? "I am still improving our map for some pick-up places.\n\nPlease send a clearer landmark name or send a WhatsApp pin."
    : "I am still improving our map for some drop-off places.\n\nPlease send a clearer landmark name or send a WhatsApp pin.";
}

function buildRenamePrompt(stage: 'pickup' | 'dropoff') {
  return stage === 'pickup'
    ? "Type the full *pick-up address name* you want to use."
    : "Type the full *drop-off address name* you want to use.";
}

function buildPickupSetPrompt(addressText: string) {
  return `I found this *pick-up address* from your pin:\n\n${addressText}\n\nIs this name correct?\n1. Yes, continue to drop-off\n2. No, I want to rename it`;
}

function buildDropoffSetPrompt(addressText: string) {
  return `I found this *drop-off address* from your pin:\n\n${addressText}\n\nIs this name correct?\n1. Yes, continue\n2. No, I want to rename it`;
}

function buildFinalRoutePrompt(km: string, estimatedPrice: number) {
  return `*Trip summary*\nDistance: *${km} km*\nEstimated fare: *₦${estimatedPrice}*\n\nReply with *Confirm* to book this trip.`;
}

function buildFallbackConfirmationPrompt() {
  return "*Trip saved*\n\nReply with *Confirm* to finish your booking.";
}

function buildPickupContactPrompt(contactNumber: string) {
  return `*Pick-up contact*\nShould the rider call this number for pick-up?\n\n${contactNumber}\n\n1. Yes\n2. No, use another number`;
}

function buildRecipientContactPrompt(contactNumber: string) {
  return `*Drop-off contact*\nShould the rider call this number at drop-off?\n\n${contactNumber}\n\n1. Yes\n2. No, use another number`;
}

function buildProceedToDropoffAfterContactPrompt(addressText: string) {
  return `*Pick-up contact saved*\n\nThe Pickup Location is set to\n\n${addressText}\n\nNow, where is the drop-off location?`;
}

function normalizeContactNumber(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return hasPlus ? `+${digits}` : digits;
}

async function saveResolvedLocation(
  resolution: Awaited<ReturnType<typeof resolveLocationInput>> | ReturnType<typeof resolutionFromCandidate>,
  options?: {
    overrideName?: string;
    metadataPatch?: Record<string, unknown>;
  }
) {
  const normalizedName = options?.overrideName?.trim().toLowerCase() || resolution.normalizedText;

  const { data: existingLoc } = await supabaseAdmin
    .from('locations')
    .select('id, hit_count, latitude, longitude, metadata')
    .eq('raw_text', normalizedName)
    .maybeSingle();

  if (existingLoc) {
    const updateData: {
      hit_count: number;
      latitude?: number;
      longitude?: number;
      confidence_score?: number;
      is_verified?: boolean;
      } = { hit_count: (existingLoc.hit_count || 1) + 1 };

    if (resolution.latitude !== null && resolution.longitude !== null) {
      updateData.latitude = resolution.latitude;
      updateData.longitude = resolution.longitude;
      updateData.confidence_score = resolution.score;
      updateData.is_verified = resolution.isVerified;
    }

    const mergedMetadata = options?.metadataPatch
      ? {
          ...(((existingLoc.metadata as Record<string, unknown> | null) || {})),
          ...options.metadataPatch,
        }
      : undefined;

    await supabaseAdmin
      .from('locations')
      .update(mergedMetadata ? { ...updateData, metadata: mergedMetadata } : updateData)
      .eq('id', existingLoc.id);

    return {
      locationId: existingLoc.id,
      latitude: resolution.latitude ?? existingLoc.latitude,
      longitude: resolution.longitude ?? existingLoc.longitude,
    };
  }

  const { data: newLoc, error: locError } = await supabaseAdmin
    .from('locations')
      .insert({
        raw_text: normalizedName,
        latitude: resolution.latitude,
        longitude: resolution.longitude,
        is_gps: resolution.source === 'pin',
        hit_count: 1,
        confidence_score: resolution.score,
        is_verified: resolution.isVerified,
        metadata: options?.metadataPatch || {},
      })
    .select()
    .single();

  if (locError) throw locError;

  return {
    locationId: newLoc.id,
    latitude: resolution.latitude,
    longitude: resolution.longitude,
  };
}

function buildWhatsAppPinMetadata(label?: string | null, address?: string | null) {
  const trimmedLabel = label?.trim();
  const trimmedAddress = address?.trim();

  if (!trimmedLabel && !trimmedAddress) {
    return undefined;
  }

  return {
    source: 'whatsapp_pin',
    ...(trimmedLabel ? { label: trimmedLabel } : {}),
    ...(trimmedAddress ? { address: trimmedAddress } : {}),
  };
}

function mergeLocationSaveOptions(
  base?: {
    overrideName?: string;
    metadataPatch?: Record<string, unknown>;
  },
  extraMetadata?: Record<string, unknown>,
) {
  if (!base && !extraMetadata) {
    return undefined;
  }

  return {
    overrideName: base?.overrideName,
    metadataPatch: {
      ...(base?.metadataPatch || {}),
      ...(extraMetadata || {}),
    },
  };
}

async function renameTripPickupLocation(tripId: string, newName: string) {
  const normalizedName = newName.trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }

  const { data: trip } = await supabaseAdmin
    .from('trips')
    .select('pickup_location_id')
    .eq('id', tripId)
    .maybeSingle();

  if (!trip?.pickup_location_id) {
    return null;
  }

  const { data: location } = await supabaseAdmin
    .from('locations')
    .select('id, metadata')
    .eq('id', trip.pickup_location_id)
    .maybeSingle();

  if (!location) {
    return null;
  }

  const mergedMetadata = {
    ...(((location.metadata as Record<string, unknown> | null) || {})),
    address: newName.trim(),
  };

  await supabaseAdmin
    .from('locations')
    .update({
      raw_text: normalizedName,
      metadata: mergedMetadata,
    })
    .eq('id', location.id);

  return {
    locationId: location.id,
    addressText: newName.trim(),
  };
}

async function renameTripDropoffLocation(tripId: string, locationId: string, newName: string) {
  const normalizedName = newName.trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }

  const { data: location } = await supabaseAdmin
    .from('locations')
    .select('id, metadata')
    .eq('id', locationId)
    .maybeSingle();

  if (!location) {
    return null;
  }

  const mergedMetadata = {
    ...(((location.metadata as Record<string, unknown> | null) || {})),
    address: newName.trim(),
  };

  await supabaseAdmin
    .from('locations')
    .update({
      raw_text: normalizedName,
      metadata: mergedMetadata,
    })
    .eq('id', location.id);

  await supabaseAdmin
    .from('trips')
    .update({
      dropoff_location_id: location.id,
    })
    .eq('id', tripId);

  return {
    locationId: location.id,
    addressText: newName.trim(),
  };
}

function buildDropoffResolutionFromContext(context: Record<string, unknown>) {
  const confidence = typeof context.dropoff_confidence === 'string' ? context.dropoff_confidence : 'high';
  const source = typeof context.dropoff_source === 'string' ? context.dropoff_source : 'pin';
  const displayText =
    typeof context.dropoff_display_text === 'string' ? context.dropoff_display_text : '';

  return {
    action: 'accept' as const,
    confidence: confidence as 'high' | 'medium' | 'low' | 'very_low',
    source: source as 'pin' | 'local' | 'user_history' | 'none',
    reason: 'Resolved drop-off from stored pin confirmation context',
    clarificationPrompt: undefined,
    normalizedText: displayText.trim().toLowerCase(),
    displayText,
    latitude: typeof context.dropoff_lat === 'number' ? context.dropoff_lat : null,
    longitude: typeof context.dropoff_lng === 'number' ? context.dropoff_lng : null,
    score: typeof context.dropoff_score === 'number' ? context.dropoff_score : 1,
    isVerified: !!context.dropoff_is_verified,
    candidates: [],
    relationContext: undefined,
  };
}

async function touchSavedPlaceUsage(
  userId: string,
  locationId: string,
  rawInput: string | null | undefined,
) {
  const normalizedInput = rawInput?.trim().toLowerCase() ?? '';
  if (!normalizedInput) return;

  const reservedLabels = new Set([
    'same place as last time',
    'same as last time',
    'last place',
    'same place',
    'same pickup as last time',
    'same pickup',
    'last pickup',
    'use last pickup',
    'same dropoff as last time',
    'same drop off as last time',
    'same dropoff',
    'same drop off',
    'last dropoff',
    'last drop off',
    'use last dropoff',
    'use last drop off',
  ]);

  if (
    reservedLabels.has(normalizedInput) ||
    normalizedInput === 'home' ||
    normalizedInput === 'work' ||
    normalizedInput.startsWith('use home') ||
    normalizedInput.startsWith('use work')
  ) {
    return;
  }

  const { data: existingSavedPlace } = await supabaseAdmin
    .from('user_saved_places')
    .select('id, use_count')
    .eq('user_id', userId)
    .eq('label', normalizedInput)
    .maybeSingle();

  if (existingSavedPlace) {
    await supabaseAdmin
      .from('user_saved_places')
      .update({
        location_id: locationId,
        use_count: (existingSavedPlace.use_count || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', existingSavedPlace.id);

    return;
  }

  await supabaseAdmin
    .from('user_saved_places')
    .insert({
      user_id: userId,
      label: normalizedInput,
      location_id: locationId,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    });
}

async function upsertSavedPlaceLabel(
  userId: string,
  locationId: string,
  label: 'home' | 'work',
) {
  const flagField = label === 'home' ? 'is_home' : 'is_work';
  const oppositeFlagField = label === 'home' ? 'is_work' : 'is_home';

  await supabaseAdmin
    .from('user_saved_places')
    .update({
      [flagField]: false,
    })
    .eq('user_id', userId)
    .eq(flagField, true);

  const { data: existingSavedPlace } = await supabaseAdmin
    .from('user_saved_places')
    .select('id, use_count')
    .eq('user_id', userId)
    .eq('label', label)
    .maybeSingle();

  if (existingSavedPlace) {
    await supabaseAdmin
      .from('user_saved_places')
      .update({
        location_id: locationId,
        use_count: Math.max(existingSavedPlace.use_count || 0, 1),
        last_used_at: new Date().toISOString(),
        [flagField]: true,
        [oppositeFlagField]: false,
      })
      .eq('id', existingSavedPlace.id);
    return;
  }

  await supabaseAdmin
    .from('user_saved_places')
    .insert({
      user_id: userId,
      label,
      location_id: locationId,
      use_count: 1,
      last_used_at: new Date().toISOString(),
      is_home: label === 'home',
      is_work: label === 'work',
    });
}

async function logResolutionEvent({
  userId,
  tripId,
  stage,
  inputText,
  actionTaken,
  confidence,
  resolutionSource,
  selectedLocationId,
  wasCorrected = false,
  metadata = {},
}: {
  userId: string;
  tripId?: string | null;
  stage: string;
  inputText?: string | null;
  actionTaken: string;
  confidence?: string | null;
  resolutionSource?: string | null;
  selectedLocationId?: string | null;
  wasCorrected?: boolean;
  metadata?: Record<string, unknown>;
}) {
  await supabaseAdmin
    .from('location_resolution_events')
    .insert({
      user_id: userId,
      trip_id: tripId ?? null,
      stage,
      input_text: inputText ?? null,
      action_taken: actionTaken,
      confidence: confidence ?? null,
      resolution_source: resolutionSource ?? null,
      selected_location_id: selectedLocationId ?? null,
      was_corrected: wasCorrected,
      metadata,
    });
}

function hasExceededRetryLimit(session: SessionStateRow, mode: 'clarification' | 'pin'): boolean {
  const retryCount = session.retry_count || 0;
  return mode === 'clarification'
    ? retryCount >= MAX_CLARIFICATION_RETRIES
    : retryCount >= MAX_PIN_RETRIES;
}

async function markTripForManualReview(tripId: string | null | undefined, note: string) {
  if (!tripId) return;

  await supabaseAdmin
    .from('trips')
    .update({
      needs_manual_review: true,
      validation_notes: note,
    })
    .eq('id', tripId);
}

async function failCurrentLeg({
  phone,
  userId,
  tripId,
  stage,
  note,
  resetTo,
}: {
  phone: string;
  userId: string;
  tripId?: string | null;
  stage: 'pickup' | 'dropoff';
  note: string;
  resetTo: 'WAITING_FOR_PICKUP' | 'WAITING_FOR_DROPOFF';
}) {
  await markTripForManualReview(tripId, note);
  await logResolutionEvent({
    userId,
    tripId,
    stage,
    actionTaken: 'retry_limit_exceeded',
    metadata: {
      note,
    },
  });

  await supabaseAdmin.from('session_states').update({
    current_step: resetTo,
    pending_resolution_type: null,
    pending_candidates: [],
    retry_count: 0,
    last_prompt_type: 'retry_limit_exceeded',
    context_payload: {},
    updated_at: new Date().toISOString(),
  }).eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse(
          buildManualReviewMessage(stage)
        ),
        { headers: { 'Content-Type': 'text/xml' } }
      );
}

function parsePendingCandidates(session: SessionStateRow): LocationCandidate[] {
  if (!Array.isArray(session.pending_candidates)) return [];
  return session.pending_candidates as LocationCandidate[];
}

function matchCandidateReply(body: string | null | undefined, candidates: LocationCandidate[]): LocationCandidate | null {
  const normalizedBody = body?.trim().toLowerCase() ?? '';
  if (!normalizedBody || candidates.length === 0) return null;

  const numericChoice = Number.parseInt(normalizedBody, 10);
  if (!Number.isNaN(numericChoice) && numericChoice >= 1 && numericChoice <= candidates.length) {
    return candidates[numericChoice - 1];
  }

  return candidates.find((candidate) => {
    const label = candidate.label.trim().toLowerCase();
    return label === normalizedBody || label.includes(normalizedBody) || normalizedBody.includes(label);
  }) || null;
}

function isNoMatchReply(body: string | null | undefined): boolean {
  const normalizedBody = body?.trim().toLowerCase() ?? '';
  return ['no', 'none', 'none of these', 'no match'].includes(normalizedBody);
}

function isNoMatchSelection(body: string | null | undefined, candidates: LocationCandidate[]): boolean {
  const normalizedBody = body?.trim().toLowerCase() ?? '';
  if (isNoMatchReply(normalizedBody)) return true;

  const numericChoice = Number.parseInt(normalizedBody, 10);
  if (Number.isNaN(numericChoice)) return false;

  return numericChoice === Math.min(candidates.length, 3) + 1;
}

function resolutionFromCandidate(candidate: LocationCandidate, body: string | null | undefined) {
  return {
    action: 'accept' as const,
    confidence: candidate.score >= 0.75 ? 'high' as const : 'medium' as const,
    source: candidate.source,
    reason: 'User selected a suggested location candidate',
    clarificationPrompt: undefined,
    normalizedText: candidate.label.trim().toLowerCase(),
    displayText: candidate.label,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    score: candidate.score,
    isVerified: !!candidate.isVerified,
    candidates: [candidate],
    originalInput: body?.trim() ?? candidate.label,
  };
}

function buildPendingLocationSaveOptions(session: SessionStateRow) {
  const context = session.context_payload || {};
  const pendingLandmarkName =
    typeof context.pending_landmark_name === 'string' ? context.pending_landmark_name : undefined;
  const anchorText =
    typeof context.anchor_text === 'string' ? context.anchor_text : undefined;
  const relation =
    typeof context.relation === 'string' ? context.relation : undefined;

  if (!pendingLandmarkName) {
    return undefined;
  }

  return {
    overrideName: pendingLandmarkName,
    metadataPatch: {
      source: 'whatsapp_pin_capture',
      relation_to_landmark: relation || null,
      anchor_landmark: anchorText || null,
    },
  };
}

async function completeDropoffStep({
  phone,
  session,
  userId,
  resolution,
  locationId,
  dropoffLat,
  dropoffLng,
}: {
  phone: string;
  session: SessionStateRow;
  userId: string;
  resolution: Awaited<ReturnType<typeof resolveLocationInput>> | ReturnType<typeof resolutionFromCandidate>;
  locationId: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
}) {
  let routeMsg = "*Trip saved*\n\nThank you for using Nuna.";
  let distanceMeters = 0;
  let estimatedPrice = 0;
  let hasRoute = false;
  let pickupLat: number | null = null;
  let pickupLng: number | null = null;
  let senderPhone: string | null = null;

  try {
    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('pickup_location_id, sender_phone')
      .eq('id', session.current_trip_id!)
      .single();

    if (trip?.pickup_location_id) {
      senderPhone = trip.sender_phone ?? null;
      const { data: pickup } = await supabaseAdmin
        .from('locations')
        .select('latitude, longitude')
        .eq('id', trip.pickup_location_id)
        .single();

      pickupLat = pickup?.latitude ?? null;
      pickupLng = pickup?.longitude ?? null;

      if (pickup?.latitude && pickup?.longitude && dropoffLat && dropoffLng) {
        const routeData = await getDrivingRoute(
          [pickup.longitude, pickup.latitude],
          [dropoffLng, dropoffLat]
        );

        if (routeData && routeData.distance > 0) {
          distanceMeters = routeData.distance;
          estimatedPrice = calculateSuggestedPrice(distanceMeters);
          const km = (distanceMeters / 1000).toFixed(1);
          routeMsg = buildFinalRoutePrompt(km, estimatedPrice);
          hasRoute = true;
        }
      }
    }
  } catch (err) {
    console.error('Pricing/Routing Error:', err);
  }

  let needsManualReview = false;
  let validationNotes: string[] = [];
  let validationMessage: string | undefined;

  if (pickupLat !== null && pickupLng !== null && dropoffLat !== null && dropoffLng !== null) {
    const validation = validateTrip({
      pickup: { latitude: pickupLat, longitude: pickupLng },
      dropoff: { latitude: dropoffLat, longitude: dropoffLng },
      routeDistanceMeters: hasRoute ? distanceMeters : null,
    });

    if (!validation.isValid) {
      await logResolutionEvent({
        userId,
        tripId: session.current_trip_id,
        stage: 'validation',
        inputText: null,
        actionTaken: 'reject_for_pin',
        confidence: resolution.confidence,
        resolutionSource: resolution.source,
        selectedLocationId: locationId,
        metadata: {
          notes: validation.notes,
        },
      });
      await supabaseAdmin.from('trips').update({
        dropoff_location_id: locationId,
        dropoff_confidence: resolution.confidence,
        dropoff_resolution_source: resolution.source,
        distance_meters: distanceMeters > 0 ? distanceMeters : null,
        estimated_price: estimatedPrice > 0 ? estimatedPrice : null,
        status: 'pending',
        needs_manual_review: true,
        validation_notes: validation.notes.join(' '),
      }).eq('id', session.current_trip_id);

      await supabaseAdmin.from('session_states').update({
        current_step: 'AWAITING_DROPOFF_PIN',
        pending_resolution_type: 'dropoff_pin',
        pending_candidates: [],
        retry_count: (session.retry_count || 0) + 1,
        last_prompt_type: 'dropoff_validation',
        context_payload: {
          validation_notes: validation.notes,
        },
        updated_at: new Date().toISOString()
      }).eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse(validation.userMessage || "I need a clearer *drop-off* before I can continue.\n\nPlease send a nearby landmark name or send a WhatsApp pin."),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    needsManualReview = validation.needsManualReview;
    validationNotes = validation.notes;
    validationMessage = validation.userMessage;
  }

  await logResolutionEvent({
    userId,
    tripId: session.current_trip_id,
    stage: 'validation',
    inputText: null,
    actionTaken: needsManualReview ? 'flag_manual_review' : 'pass',
    confidence: resolution.confidence,
    resolutionSource: resolution.source,
    selectedLocationId: locationId,
    metadata: {
      notes: validationNotes,
    },
  });

  await supabaseAdmin.from('trips').update({
    dropoff_location_id: locationId,
    dropoff_confidence: resolution.confidence,
    dropoff_resolution_source: resolution.source,
    distance_meters: distanceMeters > 0 ? distanceMeters : null,
    estimated_price: estimatedPrice > 0 ? estimatedPrice : null,
    status: 'pending',
    needs_manual_review: needsManualReview,
    validation_notes: validationNotes.length > 0 ? validationNotes.join(' ') : null,
  }).eq('id', session.current_trip_id);

  if (!hasRoute) {
    routeMsg = buildFallbackConfirmationPrompt();
  }

  if (needsManualReview && validationMessage) {
    routeMsg = `${routeMsg}\n\n${validationMessage}`;
  }

  const shouldAskForDirectRecipientNumber = !senderPhone || senderPhone === phone;

  await supabaseAdmin.from('session_states').update({
    current_step: shouldAskForDirectRecipientNumber
      ? 'AWAITING_RECIPIENT_CONTACT_INPUT'
      : 'AWAITING_RECIPIENT_CONTACT_CONFIRMATION',
    pending_resolution_type: null,
    pending_candidates: [],
    retry_count: 0,
    last_prompt_type: shouldAskForDirectRecipientNumber
      ? 'recipient_contact_input'
      : 'recipient_contact_confirmation',
    context_payload: {
      ...(needsManualReview ? { validation_notes: validationNotes } : {}),
      final_confirmation_message: routeMsg,
      sender_phone: senderPhone,
    },
    updated_at: new Date().toISOString()
  }).eq('phone_number', phone);

  return new NextResponse(
    generateTwiMLResponse(
      shouldAskForDirectRecipientNumber
        ? "Send the *drop-off contact number* the rider should call."
        : buildRecipientContactPrompt(senderPhone),
    ),
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const signature = req.headers.get('x-twilio-signature');
    const formParams = Object.fromEntries(
      Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
    );

    const isValidTwilioRequest = verifyTwilioSignature({
      url: req.url,
      signature,
      params: formParams,
    });

    if (!isValidTwilioRequest) {
      return new NextResponse(
        generateTwiMLResponse("Invalid webhook signature."),
        { status: 403, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const from = formData.get('From') as string; // whatsapp:+234...
    const body = formData.get('Body') as string;
    const latitude = formData.get('Latitude') as string;
    const longitude = formData.get('Longitude') as string;
    const label = formData.get('Label') as string; // WhatsApp Point of Interest name
    const address = formData.get('Address') as string; // WhatsApp Address
    const whatsappPinMetadata = buildWhatsAppPinMetadata(label, address);

    if (!from) {
      return new NextResponse("Missing From parameter", { status: 400 });
    }

    const phone = from.replace('whatsapp:', '');

    // 1. Get or create profile
    let { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('phone_number', phone)
      .single();

    if (!profile) {
      const { data: newProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({ phone_number: phone })
        .select()
        .single();
      
      if (profileError) {
        console.error('Error creating profile:', profileError);
        // Fallback for race conditions or other issues
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('phone_number', phone)
          .single();
        profile = existingProfile;
      } else {
        profile = newProfile;
      }
    }

    if (!profile) throw new Error("Could not find or create profile");

    // 2. Get session state
    const { data: sessionData } = await supabaseAdmin
      .from('session_states')
      .select('*')
      .eq('phone_number', phone)
      .maybeSingle();
    const session = sessionData as SessionStateRow | null;

    // --- Phase 0: Global Commands (Reset / Cancel) ---
    const normalizedBody = body?.trim().toLowerCase();
    const isStartCommand = SESSION_START_COMMANDS.includes(normalizedBody);
    const isResetCommand = SESSION_RESET_COMMANDS.includes(normalizedBody);
    const isReset = isStartCommand || isResetCommand;

    if (session && isReset) {
      await supabaseAdmin.from('session_states').delete().eq('phone_number', phone);
      await supabaseAdmin.from('session_states').insert({
        phone_number: phone,
        current_step: 'WAITING_FOR_PICKUP',
        pending_resolution_type: null,
        pending_candidates: [],
        retry_count: 0,
        last_prompt_type: null,
        context_payload: {}
      });
      return new NextResponse(
        generateTwiMLResponse(buildWelcomePrompt()),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Flow Logic
    if (!session) {
      if (!isStartCommand) {
        return new NextResponse(
          generateTwiMLResponse(buildStartPrompt()),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      // Phase 1: Greeting & Ask for Pickup
      await supabaseAdmin.from('session_states').insert({
        phone_number: phone,
        current_step: 'WAITING_FOR_PICKUP',
        pending_resolution_type: null,
        pending_candidates: [],
        retry_count: 0,
        last_prompt_type: null,
        context_payload: {}
      });

      return new NextResponse(
        generateTwiMLResponse(buildWelcomePrompt()),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    const updateSessionState = async (
      currentStep: string,
      extra: Partial<SessionStateRow> = {}
    ) => {
      await supabaseAdmin.from('session_states').update({
        current_step: currentStep,
        updated_at: new Date().toISOString(),
        ...extra,
      }).eq('phone_number', phone);
    };

    // Phase 2: Handle Pickup
    if (session.current_step === 'WAITING_FOR_PICKUP') {
      const resolution = await resolveLocationInput({
        text: body,
        latitude,
        longitude,
        label,
        address,
        userId: profile.id,
        leg: 'pickup',
      });

      if (resolution.action === 'clarify') {
        await logResolutionEvent({
          userId: profile.id,
          stage: 'pickup',
          inputText: body,
          actionTaken: 'clarify',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
            candidates: resolution.candidates.map((candidate) => candidate.label),
          },
        });
        await updateSessionState('AWAITING_PICKUP_CLARIFICATION', {
          pending_resolution_type: 'pickup_selection',
          pending_candidates: resolution.candidates,
          retry_count: 0,
          last_prompt_type: 'pickup_clarification',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "I found the area, but I need a more specific pickup landmark."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (resolution.action === 'request_pin') {
        await logResolutionEvent({
          userId: profile.id,
          stage: 'pickup',
          inputText: body,
          actionTaken: 'request_pin',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
          },
        });
        await updateSessionState('AWAITING_PICKUP_PIN', {
          pending_resolution_type: 'pickup_pin',
          pending_candidates: [],
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'pickup_pin',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || PICKUP_PIN_MESSAGE),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }
      const { locationId } = await saveResolvedLocation(
        resolution,
        mergeLocationSaveOptions(undefined, whatsappPinMetadata),
      );
      await touchSavedPlaceUsage(profile.id, locationId, body);
      await logResolutionEvent({
        userId: profile.id,
        stage: 'pickup',
        inputText: body,
        actionTaken: 'accept',
        confidence: resolution.confidence,
        resolutionSource: resolution.source,
        selectedLocationId: locationId,
      });

      const { data: trip, error: tripError } = await supabaseAdmin
        .from('trips')
        .insert({
          user_id: profile.id,
          pickup_location_id: locationId,
          sender_phone: phone,
          pickup_confidence: resolution.confidence,
          pickup_resolution_source: resolution.source,
          status: 'pending'
        })
        .select()
        .single();

      if (tripError) {
        console.error('Error creating trip:', tripError);
        throw tripError;
      }

      if (resolution.source === 'pin') {
        const pickupAddressText = resolution.displayText;
        await supabaseAdmin.from('session_states').update({
          current_step: 'AWAITING_PICKUP_PIN_CONFIRMATION',
          current_trip_id: trip.id,
          context_payload: {
            pickup_address_text: pickupAddressText,
            pickup_display_text: resolution.displayText,
          },
          updated_at: new Date().toISOString()
        }).eq('phone_number', phone);

        return new NextResponse(
          generateTwiMLResponse(buildPickupSetPrompt(pickupAddressText)),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      await supabaseAdmin.from('session_states').update({
        current_step: 'AWAITING_PICKUP_CONTACT_CONFIRMATION',
        current_trip_id: trip.id,
        last_prompt_type: 'pickup_contact_confirmation',
        context_payload: {
          pickup_address_text: resolution.displayText,
          pickup_display_text: resolution.displayText,
        },
        updated_at: new Date().toISOString()
      }).eq('phone_number', phone);

      return new NextResponse(
          generateTwiMLResponse(buildPickupContactPrompt(phone)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_PICKUP_CLARIFICATION' || session.current_step === 'AWAITING_PICKUP_PIN') {
      const isPinMode = session.current_step === 'AWAITING_PICKUP_PIN';
      if (hasExceededRetryLimit(session, isPinMode ? 'pin' : 'clarification')) {
        return await failCurrentLeg({
          phone,
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'pickup',
          note: 'Pickup retry limit exceeded during clarification/pin collection.',
          resetTo: 'WAITING_FOR_PICKUP',
        });
      }

      const pendingCandidates = parsePendingCandidates(session);

      if (!isPinMode && isNoMatchSelection(body, pendingCandidates)) {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'pickup',
          inputText: body,
          actionTaken: 'request_pin',
          confidence: 'low',
          resolutionSource: 'local',
          metadata: {
            reason: 'User rejected the suggested pickup candidates.',
            candidates: pendingCandidates.map((candidate) => candidate.label),
          },
        });
        await updateSessionState('AWAITING_PICKUP_PIN', {
          pending_resolution_type: 'pickup_pin',
          pending_candidates: [],
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'pickup_pin',
        });
        return new NextResponse(
          generateTwiMLResponse(PICKUP_PIN_MESSAGE),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const matchedCandidate = matchCandidateReply(body, pendingCandidates);
      const resolution = matchedCandidate
        ? resolutionFromCandidate(matchedCandidate, body)
        : await resolveLocationInput({
            text: body,
            latitude,
            longitude,
            label,
            address,
            userId: profile.id,
            leg: 'pickup',
          });

      if (resolution.action === 'clarify') {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'pickup',
          inputText: body,
          actionTaken: 'clarify',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
            retry_count: (session.retry_count || 0) + 1,
            candidates: resolution.candidates.map((candidate) => candidate.label),
          },
        });
        await updateSessionState('AWAITING_PICKUP_CLARIFICATION', {
          pending_resolution_type: 'pickup_selection',
          pending_candidates: resolution.candidates,
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'pickup_clarification',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "I still need a more specific pickup landmark. Reply with the exact place name or send a WhatsApp pin."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (resolution.action === 'request_pin') {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'pickup',
          inputText: body,
          actionTaken: 'request_pin',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
            retry_count: (session.retry_count || 0) + 1,
          },
        });
        await updateSessionState('AWAITING_PICKUP_PIN', {
          pending_resolution_type: 'pickup_pin',
          pending_candidates: [],
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'pickup_pin',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || PICKUP_PIN_MESSAGE),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const { locationId } = await saveResolvedLocation(
        resolution,
        mergeLocationSaveOptions(buildPendingLocationSaveOptions(session), whatsappPinMetadata),
      );
      await touchSavedPlaceUsage(profile.id, locationId, body);
      await logResolutionEvent({
        userId: profile.id,
        tripId: session.current_trip_id,
        stage: 'pickup',
        inputText: body,
        actionTaken: matchedCandidate ? 'select_candidate' : 'accept',
        confidence: resolution.confidence,
        resolutionSource: resolution.source,
        selectedLocationId: locationId,
        wasCorrected: !!matchedCandidate,
      });

      const { data: trip, error: tripError } = await supabaseAdmin
        .from('trips')
        .insert({
          user_id: profile.id,
          pickup_location_id: locationId,
          sender_phone: phone,
          pickup_confidence: resolution.confidence,
          pickup_resolution_source: resolution.source,
          status: 'pending'
        })
        .select()
        .single();

      if (tripError) {
        console.error('Error creating trip:', tripError);
        throw tripError;
      }

      if (resolution.source === 'pin') {
        const pickupAddressText = resolution.displayText;
        await supabaseAdmin.from('session_states').update({
          current_step: 'AWAITING_PICKUP_PIN_CONFIRMATION',
          current_trip_id: trip.id,
          pending_resolution_type: null,
          pending_candidates: [],
          retry_count: 0,
          last_prompt_type: 'pickup_pin_confirmation',
          context_payload: {
            pickup_address_text: pickupAddressText,
            pickup_display_text: resolution.displayText,
          },
          updated_at: new Date().toISOString()
        }).eq('phone_number', phone);

        return new NextResponse(
          generateTwiMLResponse(buildPickupSetPrompt(pickupAddressText)),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      await supabaseAdmin.from('session_states').update({
        current_step: 'AWAITING_PICKUP_CONTACT_CONFIRMATION',
        current_trip_id: trip.id,
        pending_resolution_type: null,
        pending_candidates: [],
        retry_count: 0,
        last_prompt_type: 'pickup_contact_confirmation',
        context_payload: {
          pickup_address_text: resolution.displayText,
          pickup_display_text: resolution.displayText,
        },
        updated_at: new Date().toISOString()
      }).eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse(buildPickupContactPrompt(phone)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_PICKUP_PIN_CONFIRMATION') {
      const normalizedReply = body?.trim().toLowerCase() ?? '';
      const context = session.context_payload || {};
      const pickupAddressText =
        typeof context.pickup_address_text === 'string' && context.pickup_address_text.trim()
          ? context.pickup_address_text.trim()
          : 'this location';

      if (normalizedReply === '2' || normalizedReply.includes('rename')) {
        await updateSessionState('AWAITING_PICKUP_PIN_RENAME', {
          last_prompt_type: 'pickup_pin_rename',
          context_payload: {
            ...context,
            pickup_address_text: pickupAddressText,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(buildRenamePrompt('pickup')),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (normalizedReply === '1' || normalizedReply.includes('yes') || normalizedReply.includes('drop')) {
        await updateSessionState('AWAITING_PICKUP_CONTACT_CONFIRMATION', {
          pending_resolution_type: null,
          pending_candidates: [],
          retry_count: 0,
          last_prompt_type: 'pickup_contact_confirmation',
          context_payload: {
            ...context,
            pickup_address_text: pickupAddressText,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(buildPickupContactPrompt(phone)),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      return new NextResponse(
        generateTwiMLResponse(buildPickupSetPrompt(pickupAddressText)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_PICKUP_PIN_RENAME') {
      const renamedPickup = session.current_trip_id
        ? await renameTripPickupLocation(session.current_trip_id, body || '')
        : null;

      if (!renamedPickup) {
        return new NextResponse(
          generateTwiMLResponse(buildRenamePrompt('pickup')),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      await updateSessionState('AWAITING_PICKUP_CONTACT_CONFIRMATION', {
        pending_resolution_type: null,
        pending_candidates: [],
        retry_count: 0,
        last_prompt_type: 'pickup_contact_confirmation',
        context_payload: {
          pickup_address_text: renamedPickup.addressText,
          pickup_display_text: renamedPickup.addressText,
        },
      });

      return new NextResponse(
        generateTwiMLResponse(buildPickupContactPrompt(phone)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_PICKUP_CONTACT_CONFIRMATION') {
      const normalizedReply = body?.trim().toLowerCase() ?? '';
      const context = session.context_payload || {};
      const pickupAddressText =
        typeof context.pickup_address_text === 'string' && context.pickup_address_text.trim()
          ? context.pickup_address_text.trim()
          : 'your pick-up location';

      if (normalizedReply === '1' || normalizedReply.includes('yes')) {
        await supabaseAdmin
          .from('trips')
          .update({ sender_phone: phone })
          .eq('id', session.current_trip_id);

        await updateSessionState('WAITING_FOR_DROPOFF', {
          pending_resolution_type: null,
          pending_candidates: [],
          retry_count: 0,
          last_prompt_type: null,
          context_payload: {},
        });

        return new NextResponse(
          generateTwiMLResponse(buildProceedToDropoffAfterContactPrompt(pickupAddressText)),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (normalizedReply === '2' || normalizedReply.includes('another') || normalizedReply.includes('no')) {
        await updateSessionState('AWAITING_PICKUP_CONTACT_INPUT', {
          last_prompt_type: 'pickup_contact_input',
          context_payload: {
            ...context,
            pickup_address_text: pickupAddressText,
          },
        });

        return new NextResponse(
          generateTwiMLResponse("Send the *pick-up contact number* the rider should call."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      return new NextResponse(
        generateTwiMLResponse(buildPickupContactPrompt(phone)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_PICKUP_CONTACT_INPUT') {
      const context = session.context_payload || {};
      const pickupAddressText =
        typeof context.pickup_address_text === 'string' && context.pickup_address_text.trim()
          ? context.pickup_address_text.trim()
          : 'your pick-up location';
      const contactNumber = normalizeContactNumber(body);

      if (!contactNumber) {
        return new NextResponse(
          generateTwiMLResponse("Send a valid *pick-up contact number* the rider should call."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      await supabaseAdmin
        .from('trips')
        .update({ sender_phone: contactNumber })
        .eq('id', session.current_trip_id);

      await updateSessionState('WAITING_FOR_DROPOFF', {
        pending_resolution_type: null,
        pending_candidates: [],
        retry_count: 0,
        last_prompt_type: null,
        context_payload: {},
      });

      return new NextResponse(
        generateTwiMLResponse(buildProceedToDropoffAfterContactPrompt(pickupAddressText)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Phase 3: Handle Drop-off
    if (session.current_step === 'WAITING_FOR_DROPOFF') {
      const resolution = await resolveLocationInput({
        text: body,
        latitude,
        longitude,
        label,
        address,
        userId: profile.id,
        leg: 'dropoff',
      });

      if (resolution.action === 'clarify') {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'dropoff',
          inputText: body,
          actionTaken: 'clarify',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
            candidates: resolution.candidates.map((candidate) => candidate.label),
          },
        });
        await updateSessionState('AWAITING_DROPOFF_CLARIFICATION', {
          pending_resolution_type: 'dropoff_selection',
          pending_candidates: resolution.candidates,
          retry_count: 0,
          last_prompt_type: 'dropoff_clarification',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "I found the area, but I need a more specific drop-off landmark."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (resolution.action === 'request_pin') {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'dropoff',
          inputText: body,
          actionTaken: 'request_pin',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
          },
        });
        await updateSessionState('AWAITING_DROPOFF_PIN', {
          pending_resolution_type: 'dropoff_pin',
          pending_candidates: [],
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'dropoff_pin',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || DROPOFF_PIN_MESSAGE),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }
      const savedLocation = await saveResolvedLocation(
        resolution,
        mergeLocationSaveOptions(undefined, whatsappPinMetadata),
      );
      const locationId = savedLocation.locationId;
      const dropoffLat = savedLocation.latitude;
      const dropoffLng = savedLocation.longitude;
      await touchSavedPlaceUsage(profile.id, locationId, body);
      await logResolutionEvent({
        userId: profile.id,
        tripId: session.current_trip_id,
        stage: 'dropoff',
        inputText: body,
        actionTaken: 'accept',
        confidence: resolution.confidence,
        resolutionSource: resolution.source,
        selectedLocationId: locationId,
      });

      if (resolution.source === 'pin') {
        const dropoffAddressText = resolution.displayText;
        await updateSessionState('AWAITING_DROPOFF_PIN_CONFIRMATION', {
          pending_resolution_type: null,
          pending_candidates: [],
          retry_count: 0,
          last_prompt_type: 'dropoff_pin_confirmation',
          context_payload: {
            dropoff_location_id: locationId,
            dropoff_lat: dropoffLat,
            dropoff_lng: dropoffLng,
            dropoff_address_text: dropoffAddressText,
            dropoff_display_text: resolution.displayText,
            dropoff_confidence: resolution.confidence,
            dropoff_source: resolution.source,
            dropoff_score: resolution.score,
            dropoff_is_verified: resolution.isVerified,
          },
        });

        return new NextResponse(
          generateTwiMLResponse(buildDropoffSetPrompt(dropoffAddressText)),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      return await completeDropoffStep({
        phone,
        session,
        userId: profile.id,
        resolution,
        locationId,
        dropoffLat,
        dropoffLng,
      });
    }

    if (session.current_step === 'AWAITING_DROPOFF_CLARIFICATION' || session.current_step === 'AWAITING_DROPOFF_PIN') {
      const isPinMode = session.current_step === 'AWAITING_DROPOFF_PIN';
      if (hasExceededRetryLimit(session, isPinMode ? 'pin' : 'clarification')) {
        return await failCurrentLeg({
          phone,
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'dropoff',
          note: 'Drop-off retry limit exceeded during clarification/pin collection.',
          resetTo: 'WAITING_FOR_DROPOFF',
        });
      }

      const pendingCandidates = parsePendingCandidates(session);

      if (!isPinMode && isNoMatchSelection(body, pendingCandidates)) {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'dropoff',
          inputText: body,
          actionTaken: 'request_pin',
          confidence: 'low',
          resolutionSource: 'local',
          metadata: {
            reason: 'User rejected the suggested drop-off candidates.',
            candidates: pendingCandidates.map((candidate) => candidate.label),
          },
        });
        await updateSessionState('AWAITING_DROPOFF_PIN', {
          pending_resolution_type: 'dropoff_pin',
          pending_candidates: [],
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'dropoff_pin',
        });
        return new NextResponse(
          generateTwiMLResponse(DROPOFF_PIN_MESSAGE),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const matchedCandidate = matchCandidateReply(body, pendingCandidates);
      const resolution = matchedCandidate
        ? resolutionFromCandidate(matchedCandidate, body)
        : await resolveLocationInput({
            text: body,
            latitude,
            longitude,
            label,
            address,
            userId: profile.id,
            leg: 'dropoff',
          });

      if (resolution.action === 'clarify') {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'dropoff',
          inputText: body,
          actionTaken: 'clarify',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
            retry_count: (session.retry_count || 0) + 1,
            candidates: resolution.candidates.map((candidate) => candidate.label),
          },
        });
        await updateSessionState('AWAITING_DROPOFF_CLARIFICATION', {
          pending_resolution_type: 'dropoff_selection',
          pending_candidates: resolution.candidates,
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'dropoff_clarification',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "I still need a more specific drop-off landmark. Reply with the exact place name or send a WhatsApp pin."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (resolution.action === 'request_pin') {
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'dropoff',
          inputText: body,
          actionTaken: 'request_pin',
          confidence: resolution.confidence,
          resolutionSource: resolution.source,
          metadata: {
            reason: resolution.reason,
            retry_count: (session.retry_count || 0) + 1,
          },
        });
        await updateSessionState('AWAITING_DROPOFF_PIN', {
          pending_resolution_type: 'dropoff_pin',
          pending_candidates: [],
          retry_count: (session.retry_count || 0) + 1,
          last_prompt_type: 'dropoff_pin',
          context_payload: {
            original_input: body?.trim() ?? '',
            pending_landmark_name: resolution.relationContext?.targetText || null,
            anchor_text: resolution.relationContext?.anchorText || null,
            relation: resolution.relationContext?.relation || null,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || DROPOFF_PIN_MESSAGE),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const savedLocation = await saveResolvedLocation(
        resolution,
        mergeLocationSaveOptions(buildPendingLocationSaveOptions(session), whatsappPinMetadata),
      );
      const locationId = savedLocation.locationId;
      const dropoffLat = savedLocation.latitude;
      const dropoffLng = savedLocation.longitude;
      await touchSavedPlaceUsage(profile.id, locationId, body);
      await logResolutionEvent({
        userId: profile.id,
        tripId: session.current_trip_id,
        stage: 'dropoff',
        inputText: body,
        actionTaken: matchedCandidate ? 'select_candidate' : 'accept',
        confidence: resolution.confidence,
        resolutionSource: resolution.source,
        selectedLocationId: locationId,
        wasCorrected: !!matchedCandidate,
      });

      if (resolution.source === 'pin') {
        const dropoffAddressText = resolution.displayText;
        await updateSessionState('AWAITING_DROPOFF_PIN_CONFIRMATION', {
          pending_resolution_type: null,
          pending_candidates: [],
          retry_count: 0,
          last_prompt_type: 'dropoff_pin_confirmation',
          context_payload: {
            dropoff_location_id: locationId,
            dropoff_lat: dropoffLat,
            dropoff_lng: dropoffLng,
            dropoff_address_text: dropoffAddressText,
            dropoff_display_text: resolution.displayText,
            dropoff_confidence: resolution.confidence,
            dropoff_source: resolution.source,
            dropoff_score: resolution.score,
            dropoff_is_verified: resolution.isVerified,
          },
        });

        return new NextResponse(
          generateTwiMLResponse(buildDropoffSetPrompt(dropoffAddressText)),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      return await completeDropoffStep({
        phone,
        session,
        userId: profile.id,
        resolution,
        locationId,
        dropoffLat,
        dropoffLng,
      });
    }

    if (session.current_step === 'AWAITING_DROPOFF_PIN_CONFIRMATION') {
      const normalizedReply = body?.trim().toLowerCase() ?? '';
      const context = session.context_payload || {};
      const dropoffAddressText =
        typeof context.dropoff_address_text === 'string' && context.dropoff_address_text.trim()
          ? context.dropoff_address_text.trim()
          : 'this location';

      if (normalizedReply === '2' || normalizedReply.includes('rename')) {
        await updateSessionState('AWAITING_DROPOFF_PIN_RENAME', {
          last_prompt_type: 'dropoff_pin_rename',
          context_payload: {
            ...context,
            dropoff_address_text: dropoffAddressText,
          },
        });
        return new NextResponse(
          generateTwiMLResponse(buildRenamePrompt('dropoff')),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (normalizedReply === '1' || normalizedReply.includes('yes') || normalizedReply.includes('continue')) {
        const resolution = buildDropoffResolutionFromContext(context);
        const locationId = typeof context.dropoff_location_id === 'string' ? context.dropoff_location_id : '';
        const dropoffLat = typeof context.dropoff_lat === 'number' ? context.dropoff_lat : null;
        const dropoffLng = typeof context.dropoff_lng === 'number' ? context.dropoff_lng : null;

        if (!locationId) {
          return new NextResponse(
            generateTwiMLResponse(buildDropoffSetPrompt(dropoffAddressText)),
            { headers: { 'Content-Type': 'text/xml' } }
          );
        }

        return await completeDropoffStep({
          phone,
          session,
          userId: profile.id,
          resolution,
          locationId,
          dropoffLat,
          dropoffLng,
        });
      }

      return new NextResponse(
        generateTwiMLResponse(buildDropoffSetPrompt(dropoffAddressText)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_DROPOFF_PIN_RENAME') {
      const context = session.context_payload || {};
      const locationId = typeof context.dropoff_location_id === 'string' ? context.dropoff_location_id : '';
      const renamedDropoff = session.current_trip_id && locationId
        ? await renameTripDropoffLocation(session.current_trip_id, locationId, body || '')
        : null;

      if (!renamedDropoff) {
        return new NextResponse(
          generateTwiMLResponse(buildRenamePrompt('dropoff')),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const nextContext = {
        ...context,
        dropoff_address_text: renamedDropoff.addressText,
        dropoff_display_text: renamedDropoff.addressText,
      };
      const resolution = buildDropoffResolutionFromContext(nextContext);
      const dropoffLat = typeof context.dropoff_lat === 'number' ? context.dropoff_lat : null;
      const dropoffLng = typeof context.dropoff_lng === 'number' ? context.dropoff_lng : null;

      return await completeDropoffStep({
        phone,
        session,
        userId: profile.id,
        resolution,
        locationId: renamedDropoff.locationId,
        dropoffLat,
        dropoffLng,
      });
    }

    if (session.current_step === 'AWAITING_RECIPIENT_CONTACT_CONFIRMATION') {
      const normalizedReply = body?.trim().toLowerCase() ?? '';
      const context = session.context_payload || {};
      const senderPhone =
        typeof context.sender_phone === 'string' && context.sender_phone.trim()
          ? context.sender_phone.trim()
          : phone;
      const finalConfirmationMessage =
        typeof context.final_confirmation_message === 'string' && context.final_confirmation_message.trim()
          ? context.final_confirmation_message.trim()
          : buildFallbackConfirmationPrompt();

      if (normalizedReply === '1' || normalizedReply.includes('yes')) {
        await supabaseAdmin
          .from('trips')
          .update({ recipient_phone: senderPhone })
          .eq('id', session.current_trip_id);

        await updateSessionState('WAITING_FOR_CONFIRMATION', {
          last_prompt_type: null,
          context_payload: context,
        });

        return new NextResponse(
          generateTwiMLResponse(finalConfirmationMessage),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      if (normalizedReply === '2' || normalizedReply.includes('another') || normalizedReply.includes('no')) {
        await updateSessionState('AWAITING_RECIPIENT_CONTACT_INPUT', {
          last_prompt_type: 'recipient_contact_input',
          context_payload: context,
        });

        return new NextResponse(
          generateTwiMLResponse("Send the *drop-off contact number* the rider should call."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      return new NextResponse(
        generateTwiMLResponse(buildRecipientContactPrompt(senderPhone)),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    if (session.current_step === 'AWAITING_RECIPIENT_CONTACT_INPUT') {
      const context = session.context_payload || {};
      const finalConfirmationMessage =
        typeof context.final_confirmation_message === 'string' && context.final_confirmation_message.trim()
          ? context.final_confirmation_message.trim()
          : buildFallbackConfirmationPrompt();
      const contactNumber = normalizeContactNumber(body);

      if (!contactNumber) {
        return new NextResponse(
          generateTwiMLResponse("Send a valid *drop-off contact number* the rider should call."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      await supabaseAdmin
        .from('trips')
        .update({ recipient_phone: contactNumber })
        .eq('id', session.current_trip_id);

      await updateSessionState('WAITING_FOR_CONFIRMATION', {
        last_prompt_type: null,
        context_payload: context,
      });

      return new NextResponse(
        generateTwiMLResponse(finalConfirmationMessage),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Phase 4: Handle Confirmation
    if (session.current_step === 'WAITING_FOR_CONFIRMATION') {
      const saveCommand = normalizedBody.match(/^save\s+(pickup|dropoff)\s+as\s+(home|work)$/);
      if (saveCommand && session.current_trip_id) {
        const leg = saveCommand[1] === 'pickup' ? 'pickup_location_id' : 'dropoff_location_id';
        const label = saveCommand[2] as 'home' | 'work';

        const { data: trip } = await supabaseAdmin
          .from('trips')
          .select(`id, ${leg}`)
          .eq('id', session.current_trip_id)
          .single();

        const locationId = trip?.[leg as keyof typeof trip] as string | null | undefined;
        if (!locationId) {
          return new NextResponse(
          generateTwiMLResponse(`I could not find that ${saveCommand[1]} location to save as *${label}*.`),
            { headers: { 'Content-Type': 'text/xml' } }
          );
        }

        await upsertSavedPlaceLabel(profile.id, locationId, label);
        await logResolutionEvent({
          userId: profile.id,
          tripId: session.current_trip_id,
          stage: 'memory',
          inputText: body,
          actionTaken: `save_${saveCommand[1]}_as_${label}`,
          selectedLocationId: locationId,
        });

        return new NextResponse(
          generateTwiMLResponse(`${saveCommand[1] === 'pickup' ? '*Pick-up*' : '*Drop-off*'} saved as *${label}*.\n\nReply with *Confirm* to finish this booking.`),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      await supabaseAdmin.from('trips').update({
        status: 'confirmed'
      }).eq('id', session.current_trip_id);

      await logResolutionEvent({
        userId: profile.id,
        tripId: session.current_trip_id,
        stage: 'booking',
        inputText: body,
        actionTaken: 'confirm',
      });

      await supabaseAdmin.from('session_states').delete().eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse("*Booking confirmed*\nA rider will be assigned soon.\n\nThank you for using Nuna."),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    return new NextResponse(generateTwiMLResponse("I did not understand that.\n\nSend *Hi* to start again."), { headers: { 'Content-Type': 'text/xml' } });

  } catch (error) {
    console.error('Webhook error:', error);
    return new NextResponse(
      generateTwiMLResponse("Something went wrong.\nPlease try again later."),
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }
}
