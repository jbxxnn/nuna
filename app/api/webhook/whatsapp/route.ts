import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateTwiMLResponse } from '@/lib/twilio';
import { hybridGeocode, reverseGeocode } from '@/lib/geocoding';

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
      
      // 1. Try to find/generate coordinates
      let lat = latitude ? parseFloat(latitude) : null;
      let lng = longitude ? parseFloat(longitude) : null;
      let confidence = latitude ? 1.0 : 0;
      let source = latitude ? 'gps' : 'none';
      let locationName = body;

      if (latitude && longitude) {
        // Automatically find a name for the GPS pin to reduce user friction
        const reverseName = await reverseGeocode(lat!, lng!);
        if (reverseName) {
            locationName = reverseName;
        } else if (!body || body.toLowerCase() === 'location') {
            locationName = `Point near ${lat}, ${lng}`;
        }
      } else {
        const geo = await hybridGeocode(body);
        lat = geo.latitude;
        lng = geo.longitude;
        confidence = geo.confidence;
        source = geo.source;
      }

      // 2. Check if we should reuse an existing location record
      const { data: existingLoc } = await supabaseAdmin
        .from('locations')
        .select('id, hit_count')
        .eq('raw_text', locationName.trim().toLowerCase())
        .maybeSingle();

      let locationId;

      if (existingLoc) {
        const updateData: {
          hit_count: number;
          latitude?: number;
          longitude?: number;
          confidence_score?: number;
        } = { hit_count: (existingLoc.hit_count || 1) + 1 };
        
        if (lat && lng && source !== 'none') {
            updateData.latitude = lat;
            updateData.longitude = lng;
            updateData.confidence_score = confidence;
        }

        await supabaseAdmin
          .from('locations')
          .update(updateData)
          .eq('id', existingLoc.id);
        
        locationId = existingLoc.id;
      } else {
        const { data: newLoc, error: locError } = await supabaseAdmin
          .from('locations')
          .insert({
            raw_text: locationName,
            latitude: lat,
            longitude: lng,
            is_gps: !!latitude,
            hit_count: 1,
            confidence_score: confidence,
            is_verified: !!latitude
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
      
      // 1. Try to find/generate coordinates
      let lat = latitude ? parseFloat(latitude) : null;
      let lng = longitude ? parseFloat(longitude) : null;
      let confidence = latitude ? 1.0 : 0;
      let source = latitude ? 'gps' : 'none';
      let locationName = body;

      if (latitude && longitude) {
        const reverseName = await reverseGeocode(lat!, lng!);
        if (reverseName) {
            locationName = reverseName;
        } else if (!body || body.toLowerCase() === 'location') {
            locationName = `Point near ${lat}, ${lng}`;
        }
      } else {
        const geo = await hybridGeocode(body);
        lat = geo.latitude;
        lng = geo.longitude;
        confidence = geo.confidence;
        source = geo.source;
      }

      // 2. Check if we should reuse an existing location record
      const { data: existingLoc } = await supabaseAdmin
        .from('locations')
        .select('id, hit_count')
        .eq('raw_text', locationName.trim().toLowerCase())
        .maybeSingle();

      let locationId;

      if (existingLoc) {
        const updateData: {
          hit_count: number;
          latitude?: number;
          longitude?: number;
          confidence_score?: number;
        } = { hit_count: (existingLoc.hit_count || 1) + 1 };
        
        if (lat && lng && source !== 'none') {
            updateData.latitude = lat;
            updateData.longitude = lng;
            updateData.confidence_score = confidence;
        }

        await supabaseAdmin
          .from('locations')
          .update(updateData)
          .eq('id', existingLoc.id);
        
        locationId = existingLoc.id;
      } else {
        const { data: newLoc, error: locError } = await supabaseAdmin
          .from('locations')
          .insert({
            raw_text: locationName,
            latitude: lat,
            longitude: lng,
            is_gps: !!latitude,
            hit_count: 1,
            confidence_score: confidence,
            is_verified: !!latitude
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
