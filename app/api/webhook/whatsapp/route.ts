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

async function saveResolvedLocation(resolution: Awaited<ReturnType<typeof resolveLocationInput>>) {
  const normalizedName = resolution.normalizedText;

  const { data: existingLoc } = await supabaseAdmin
    .from('locations')
    .select('id, hit_count, latitude, longitude')
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

    await supabaseAdmin
      .from('locations')
      .update(updateData)
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
      is_verified: resolution.isVerified
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
      stage === 'pickup'
        ? "I’m still unable to place the pickup correctly. I’ve flagged this for manual review. Please send a very clear landmark or a WhatsApp pin to continue."
        : "I’m still unable to place the drop-off correctly. I’ve flagged this for manual review. Please send a very clear landmark or a WhatsApp pin to continue."
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
  let routeMsg = "Got it! ✅ Your trip has been recorded. Thank you for using Nuna!";
  let distanceMeters = 0;
  let estimatedPrice = 0;
  let hasRoute = false;
  let pickupLat: number | null = null;
  let pickupLng: number | null = null;

  try {
    const { data: trip } = await supabaseAdmin
      .from('trips')
      .select('pickup_location_id')
      .eq('id', session.current_trip_id!)
      .single();

    if (trip?.pickup_location_id) {
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
          routeMsg = `Distance: *${km}km*. 🛣️\nSuggested fare: *₦${estimatedPrice}*. 💰\n\nType *'Confirm'* to book this ride!`;
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
        generateTwiMLResponse(validation.userMessage || "I need a clearer drop-off before I can continue. Please send a nearby landmark or share a WhatsApp pin."),
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

  await supabaseAdmin.from('session_states').update({
    current_step: 'WAITING_FOR_CONFIRMATION',
    pending_resolution_type: null,
    pending_candidates: [],
    retry_count: 0,
    last_prompt_type: null,
    context_payload: needsManualReview ? { validation_notes: validationNotes } : {},
    updated_at: new Date().toISOString()
  }).eq('phone_number', phone);

  if (!hasRoute) {
    routeMsg = "Got it! ✅ I've saved your drop-off. Type *'Confirm'* to finalize your booking!";
  }

  if (needsManualReview && validationMessage) {
    routeMsg = `${routeMsg}\n\n${validationMessage}`;
  }

  return new NextResponse(
    generateTwiMLResponse(routeMsg),
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
    const isReset = ['cancel', 'reset', 'start over', 'hi', 'restart', 'nuna'].includes(normalizedBody);

    if (isReset) {
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
        generateTwiMLResponse("Welcome to Nuna! 🚚\n\nWhere should we pick up from? (Send the location name or a GPS pin)\n\n_Type *'Cancel'* at any time to restart_"),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Flow Logic
    if (!session) {
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
        generateTwiMLResponse("Welcome to Nuna! 🚚\n\nWhere should we pick up from? (Send the location name or a GPS pin)\n\n_Type *'Cancel'* at any time to restart_"),
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
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "Please share a WhatsApp pin so I can place your pickup correctly."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }
      const { locationId } = await saveResolvedLocation(resolution);
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

      await supabaseAdmin.from('session_states').update({
        current_step: 'WAITING_FOR_DROPOFF',
        current_trip_id: trip.id,
        updated_at: new Date().toISOString()
      }).eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse("Got it! Now, where is the drop-off location?"),
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

      const matchedCandidate = matchCandidateReply(body, parsePendingCandidates(session));
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
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "Please share a WhatsApp pin so I can place your pickup correctly."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const { locationId } = await saveResolvedLocation(resolution);
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

      await supabaseAdmin.from('session_states').update({
        current_step: 'WAITING_FOR_DROPOFF',
        current_trip_id: trip.id,
        pending_resolution_type: null,
        pending_candidates: [],
        retry_count: 0,
        last_prompt_type: null,
        context_payload: {},
        updated_at: new Date().toISOString()
      }).eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse("Pickup set. Now, where is the drop-off location?"),
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
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "Please share a WhatsApp pin so I can place your drop-off correctly."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }
      const savedLocation = await saveResolvedLocation(resolution);
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

      const matchedCandidate = matchCandidateReply(body, parsePendingCandidates(session));
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
          },
        });
        return new NextResponse(
          generateTwiMLResponse(resolution.clarificationPrompt || "Please share a WhatsApp pin so I can place your drop-off correctly."),
          { headers: { 'Content-Type': 'text/xml' } }
        );
      }

      const savedLocation = await saveResolvedLocation(resolution);
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
            generateTwiMLResponse(`I couldn't find that ${saveCommand[1]} location to save as ${label}.`),
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
          generateTwiMLResponse(`${saveCommand[1] === 'pickup' ? 'Pickup' : 'Drop-off'} saved as *${label}*. Type *Confirm* to finish this booking.`),
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
        generateTwiMLResponse("Booking Confirmed! 🚀 A driver will be assigned soon. Thank you!"),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    return new NextResponse(generateTwiMLResponse("Sorry, I didn't catch that. Can we start over? Send 'Hi' to restart."), { headers: { 'Content-Type': 'text/xml' } });

  } catch (error) {
    console.error('Webhook error:', error);
    return new NextResponse(
      generateTwiMLResponse("Internal Error. Please try again later."),
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }
}
