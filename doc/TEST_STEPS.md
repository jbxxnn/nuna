# NUNA TEST STEPS

## Purpose

This document defines the manual test flow for the current Nuna system.

It is focused on:

- WhatsApp bot behavior
- smart location resolution
- retry and recovery behavior
- validation and manual review
- operator dashboard review flow

This is intended to help test the current build in Twilio sandbox and local/staging environments.

## Test Setup

Before testing, confirm the following:

- Supabase is reachable
- `locations`, `trips`, `session_states`, `user_saved_places`, and `location_resolution_events` exist
- Twilio sandbox is configured to point to the webhook
- `TWILIO_AUTH_TOKEN` is set
- `TWILIO_SKIP_SIGNATURE_VALIDATION` is set appropriately
  - `false` for real Twilio sandbox requests
  - `true` only for manual/local non-Twilio POST testing
- Mapbox token is configured if route and geocoding behavior should be tested
- `/nuna` dashboard is accessible

## Recommended Test Order

Run tests in this order:

1. webhook reachability and signature validation
2. happy-path booking
3. ambiguity and clarification flow
4. pin fallback flow
5. user memory flow
6. validation and manual review flow
7. retry limit and recovery flow
8. ops dashboard review actions

## 1. Webhook And Signature Validation

### Test 1.1: Real Twilio sandbox request

Steps:

- send a message from WhatsApp sandbox user to the Twilio sandbox number
- use a simple trigger like `Hi`

Expected:

- request is accepted
- webhook does not return 403
- bot replies with pickup prompt

### Test 1.2: Invalid signature request

Steps:

- send a manual POST request to the webhook without a valid Twilio signature
- make sure `TWILIO_SKIP_SIGNATURE_VALIDATION=false`

Expected:

- webhook returns `403`
- request is rejected

### Test 1.3: Local bypass mode

Steps:

- set `TWILIO_SKIP_SIGNATURE_VALIDATION=true`
- send a manual POST request

Expected:

- webhook accepts request for local/manual testing

## 2. Happy Path Booking

### Test 2.1: Exact pickup and drop-off

Steps:

- send `Hi`
- send a known landmark for pickup
- send a known landmark for drop-off
- send `Confirm`

Expected:

- trip is created
- pickup is saved
- drop-off is saved
- route/fare is calculated if possible
- trip status becomes `confirmed`
- session state is cleared

Check:

- `trips`
- `session_states`
- `location_resolution_events`

### Test 2.2: GPS pin pickup and drop-off

Steps:

- start booking
- share a WhatsApp pin for pickup
- share a WhatsApp pin for drop-off
- confirm

Expected:

- both locations resolve with high confidence
- `is_gps` should be true for new saved locations created from pins
- trip completes successfully

## 3. Clarification Flow

### Test 3.1: Ambiguous text input

Steps:

- start booking
- send a broad place like `Bosso`

Expected:

- bot should not accept blindly
- bot should ask for clarification
- if local candidates exist, bot should suggest likely matches
- session should move to clarification mode

Check:

- `session_states.current_step`
- `session_states.pending_candidates`
- `location_resolution_events.action_taken='clarify'`

### Test 3.2: Candidate reply by number

Steps:

- trigger a clarification prompt with numbered options
- reply with `1`

Expected:

- bot should resolve using the stored candidate
- bot should continue to next step

### Test 3.3: Candidate reply by text

Steps:

- trigger a clarification prompt
- reply using the suggested place name text

Expected:

- bot should match the candidate
- bot should continue to next step

## 4. Pin Fallback Flow

### Test 4.1: Weak text requires pin

Steps:

- start booking
- send vague input like `that junction near my house`

Expected:

- bot should request a WhatsApp pin
- session should move to pin state

### Test 4.2: Pin recovery

Steps:

- after pin request, send a WhatsApp pin

Expected:

- bot should resolve successfully
- booking flow should continue

## 5. User Memory Flow

### Test 5.1: Save pickup as home

Steps:

- complete a booking until confirmation stage
- send `save pickup as home`

Expected:

- current pickup is saved to `user_saved_places` with label `home`
- bot acknowledges save
- booking remains open for final confirmation

### Test 5.2: Use home

Steps:

- start a new booking
- send `use home`

Expected:

- pickup resolves immediately from saved place memory
- resolution source should reflect user history

### Test 5.3: Same pickup as last time

Steps:

- create a completed trip first
- start a new booking
- send `same pickup as last time`

Expected:

- bot resolves pickup using most recent trip pickup

### Test 5.4: Same dropoff as last time

Steps:

- reach drop-off stage in a new trip
- send `same dropoff as last time`

Expected:

- bot resolves drop-off using most recent trip drop-off

## 6. Validation And Manual Review

### Test 6.1: Outside service area

Steps:

- use or simulate a drop-off clearly outside Minna service bounds

Expected:

- bot should not proceed directly to confirmation
- bot should request a clearer landmark or pin
- trip should be marked for manual review if necessary

### Test 6.2: Pickup and drop-off too close

Steps:

- use nearly identical pickup and drop-off

Expected:

- bot should flag the trip for review
- booking may still continue, but `needs_manual_review` should be true

### Test 6.3: Route calculation failure

Steps:

- simulate a case where route calculation cannot complete

Expected:

- trip may still proceed
- trip should be flagged for manual review
- validation note should be stored

## 7. Retry Limit And Recovery

### Test 7.1: Clarification retry limit

Steps:

- trigger clarification
- reply with weak or unusable text repeatedly until retry limit is hit

Expected:

- bot should stop looping
- trip should be flagged for manual review
- session should reset to the relevant leg
- user should get a recovery message asking for a very clear landmark or pin

### Test 7.2: Pin retry limit

Steps:

- trigger pin request
- keep sending non-pin weak replies until retry limit is hit

Expected:

- bot should stop repeating pin request forever
- manual review should be flagged
- session should recover cleanly

## 8. Ops Dashboard Review Flow

### Test 8.1: Flagged trip appears in Ops tab

Steps:

- create a trip that gets flagged for manual review
- open `/nuna`
- go to `Ops`

Expected:

- trip appears in manual review queue
- validation note is visible

### Test 8.2: Save operator note

Steps:

- open a flagged trip in `Ops`
- enter a note
- click `Save Note`

Expected:

- note is appended to `validation_notes`
- trip remains flagged

### Test 8.3: Resolve review

Steps:

- open a flagged trip
- optionally enter a note
- click `Resolve Review`

Expected:

- `needs_manual_review` becomes false
- trip disappears from flagged queue
- if note was entered, resolved note is retained

### Test 8.4: Analytics visibility

Steps:

- after several tests, open `Ops`

Expected:

- ambiguity hotspot panel shows repeated clarification landmarks
- event outcomes show counts for clarify, request_pin, accept, retry failures, and related events

## Database Checks

After major test runs, verify these tables:

- `trips`
- `locations`
- `session_states`
- `user_saved_places`
- `location_resolution_events`

Things to confirm:

- confidence fields are being written
- source fields are being written
- retry failures are logged
- validation notes are meaningful
- saved places are not polluted with command phrases like `use home`

## Bug Checklist

Log a bug if any of these happen:

- bot accepts clearly wrong location without clarification
- bot loops endlessly on clarification
- bot loops endlessly on pin request
- candidate `1/2/3` reply does not resolve correctly
- `use home` or `use work` fails when saved place exists
- `same pickup/dropoff as last time` resolves wrong leg
- trip is invalid but still confirmed without review
- flagged trip does not appear in dashboard
- review action does not update dashboard state
- invalid webhook request is accepted when signature validation is enabled

## Suggested Pass Criteria

The build is in good shape for continued beta testing if:

- happy path works consistently
- clarification works for common ambiguous landmarks
- pin fallback works reliably
- saved place memory works
- retry loops stop safely
- flagged trips appear in ops dashboard
- review actions work correctly
- invalid webhook requests are rejected in secure mode

## Next Step After Manual Testing

After this checklist is stable, convert the highest-value cases into automated tests:

- resolver tests
- webhook session flow tests
- validation tests
- saved place memory tests
- retry limit tests
