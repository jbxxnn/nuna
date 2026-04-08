import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateTwiMLResponse } from '@/lib/twilio';
import { hybridGeocode, reverseGeocode } from '@/lib/geocoding';
import { getDrivingRoute, calculateSuggestedPrice } from '@/lib/maps/directions';

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
        
        if (lat && lng) {
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
      }

      // 2. Check if we should reuse an existing location record
      const { data: existingLoc } = await supabaseAdmin
        .from('locations')
        .select('id, hit_count, latitude, longitude')
        .eq('raw_text', locationName.trim().toLowerCase())
        .maybeSingle();

      let locationId;
      let dropoffLat = lat;
      let dropoffLng = lng;

      if (existingLoc) {
        if (!dropoffLat && existingLoc.latitude) {
            dropoffLat = existingLoc.latitude;
            dropoffLng = existingLoc.longitude;
        }
        
        await supabaseAdmin
          .from('locations')
          .update({ hit_count: (existingLoc.hit_count || 1) + 1 })
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

      // 3. Pricing & Distance Brain
      let routeMsg = "Got it! ✅ Your trip has been recorded. Thank you for using Nuna!";
      let distanceMeters = 0;
      let estimatedPrice = 0;
      let hasRoute = false;

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

          if (pickup?.latitude && pickup?.longitude && dropoffLat && dropoffLng) {
            console.log(`Calculating route: [${pickup.longitude}, ${pickup.latitude}] to [${dropoffLng}, ${dropoffLat}]`);
            
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

      await supabaseAdmin.from('trips').update({
        dropoff_location_id: locationId,
        distance_meters: distanceMeters > 0 ? distanceMeters : null,
        estimated_price: estimatedPrice > 0 ? estimatedPrice : null,
        status: 'pending'
      }).eq('id', session.current_trip_id);

      await supabaseAdmin.from('session_states').update({
        current_step: 'WAITING_FOR_CONFIRMATION',
        updated_at: new Date().toISOString()
      }).eq('phone_number', phone);

      // If we couldn't get a route, give a simpler message
      if (!hasRoute) {
        routeMsg = "Got it! ✅ I've saved your drop-off. Type *'Confirm'* to finalize your booking!";
      }

      return new NextResponse(
        generateTwiMLResponse(routeMsg),
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // Phase 4: Handle Confirmation
    if (session.current_step === 'WAITING_FOR_CONFIRMATION') {
      await supabaseAdmin.from('trips').update({
        status: 'confirmed'
      }).eq('id', session.current_trip_id);

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
