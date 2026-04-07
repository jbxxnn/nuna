import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateTwiMLResponse } from '@/lib/twilio';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = formData.get('From') as string; // whatsapp:+234...
    const body = formData.get('Body') as string;
    const latitude = formData.get('Latitude') as string;
    const longitude = formData.get('Longitude') as string;

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
    const { data: session } = await supabaseAdmin
      .from('session_states')
      .select('*')
      .eq('phone_number', phone)
      .maybeSingle();

    // Flow Logic
    if (!session) {
      // Phase 1: Greeting & Ask for Pickup
      await supabaseAdmin.from('session_states').insert({
        phone_number: phone,
        current_step: 'WAITING_FOR_PICKUP'
      });

      return new NextResponse(
        generateTwiMLResponse("Welcome to Nuna! 🚚\n\nWhere should we pick up from? (Send the location name or a GPS pin)"),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Phase 2: Handle Pickup
    if (session.current_step === 'WAITING_FOR_PICKUP') {
      const normalizedText = body.trim().toLowerCase();
      
      // Try to find existing location by text
      const { data: existingLoc } = await supabaseAdmin
        .from('locations')
        .select('id, hit_count')
        .eq('raw_text', normalizedText)
        .maybeSingle();

      let locationId;

      if (existingLoc) {
        await supabaseAdmin
          .from('locations')
          .update({ hit_count: (existingLoc.hit_count || 1) + 1 })
          .eq('id', existingLoc.id);
        locationId = existingLoc.id;
      } else {
        const { data: newLoc, error: locError } = await supabaseAdmin
          .from('locations')
          .insert({
            raw_text: body,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            is_gps: !!latitude,
            hit_count: 1
          })
          .select()
          .single();

        if (locError) throw locError;
        locationId = newLoc.id;
      }

      const { data: trip, error: tripError } = await supabaseAdmin
        .from('trips')
        .insert({
          user_id: profile.id,
          pickup_location_id: locationId,
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

    // Phase 3: Handle Drop-off
    if (session.current_step === 'WAITING_FOR_DROPOFF') {
      const normalizedText = body.trim().toLowerCase();
      
      // Try to find existing location by text
      const { data: existingLoc } = await supabaseAdmin
        .from('locations')
        .select('id, hit_count')
        .eq('raw_text', normalizedText)
        .maybeSingle();

      let locationId;

      if (existingLoc) {
        await supabaseAdmin
          .from('locations')
          .update({ hit_count: (existingLoc.hit_count || 1) + 1 })
          .eq('id', existingLoc.id);
        locationId = existingLoc.id;
      } else {
        const { data: newLoc, error: locError } = await supabaseAdmin
          .from('locations')
          .insert({
            raw_text: body,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            is_gps: !!latitude,
            hit_count: 1
          })
          .select()
          .single();

        if (locError) throw locError;
        locationId = newLoc.id;
      }

      const { error: tripUpdateError } = await supabaseAdmin.from('trips').update({
        dropoff_location_id: locationId,
        status: 'confirmed'
      }).eq('id', session.current_trip_id);

      if (tripUpdateError) {
        console.error('Error updating trip:', tripUpdateError);
        throw tripUpdateError;
      }

      await supabaseAdmin.from('session_states').delete().eq('phone_number', phone);

      return new NextResponse(
        generateTwiMLResponse("Perfect! ✅ Your trip has been recorded. A driver will be assigned soon. Thank you for using Nuna!"),
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
