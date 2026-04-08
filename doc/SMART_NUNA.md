# SMART NUNA BOT

## Purpose

The Nuna WhatsApp bot should not behave like a simple form that asks for pickup, asks for drop-off, and confirms a booking.

It should behave like a local logistics decision engine whose job is to turn vague, messy, real-world WhatsApp messages into reliable, bookable trips with as little back-and-forth as possible.

The bot should optimize for:

- accurate pickup and drop-off capture
- minimal friction for the rider
- fewer wrong bookings
- stronger reuse of local landmark knowledge
- continuous learning from every successful trip

Smart does not mean the bot should sound more human.

Smart means the bot should:

- understand messy local location descriptions better
- know when a location is trustworthy
- know when a location is ambiguous
- ask better follow-up questions
- request a GPS pin only when necessary
- reuse user history and known landmarks
- improve its own location database over time

## Core Goal

The main goal of the Nuna bot is:

`Get from messy user message -> trusted pickup/drop-off -> validated trip -> confirmed booking`

The more specific operational goal is:

`Capture accurate trip intent from the way people in Minna naturally speak, then convert that into a reusable, verified location record and a confident booking.`

## Product Definition

Nuna is not just a WhatsApp bot.

It is a location intelligence system for local delivery and ride booking in Minna and Chanchaga.

The bot is the front door into that system.

Every booking should do two things:

1. help complete the current trip
2. make the system smarter for future trips

That means each interaction should contribute to:

- better known landmarks
- better user memory
- better route quality
- fewer future clarification steps

## What Is Wrong With the Current Bot

The current bot is useful, but still basic.

Right now it mostly behaves like:

1. ask for pickup
2. geocode it
3. ask for drop-off
4. geocode it
5. estimate fare
6. ask for confirmation

This is a valid MVP, but it is not yet a smart local booking assistant.

Main weaknesses of the current approach:

- it treats most user input as final too quickly
- it does not have enough ambiguity handling
- it has no strong multiple-choice disambiguation flow
- it does not reuse user history in a meaningful way
- it does not understand local landmark-style phrasing deeply enough
- it does not clearly separate high-confidence and low-confidence bookings
- it does not know when to stop guessing and ask for a pin
- it does not create enough learning signals from failed or corrected searches

## What a Smart Nuna Bot Must Do

A smart Nuna bot should be able to:

- recognize when a typed location is clear enough to trust immediately
- recognize when a result is ambiguous and ask a targeted follow-up question
- present a short list of likely matches when needed
- request a shared WhatsApp pin when text is too weak
- prefer saved local landmarks over generic map results
- reuse a rider's previously confirmed places
- understand Minna-style location descriptions based on landmarks
- validate whether a booking is good enough before confirming it
- store structured signals that make future bookings easier

## Core Intelligence Loop

For every pickup or drop-off input, the bot should decide one of four actions:

- `trust it`
- `suggest options`
- `ask for clarification`
- `request a pin`

This should become the core intelligence loop for location resolution.

## Design Principles

### 1. Ask fewer, better questions

The bot should not ask many open-ended questions.

It should ask one focused question that reduces uncertainty.

Good:

- "Which Bosso location do you mean?"
- "Is it near a junction, bank, school, or market?"
- "Do you mean the same pickup as last time?"

Bad:

- "Can you explain more?"

### 2. Never guess blindly

If the system is not confident, it should not silently choose a location.

It should either:

- suggest top matches
- ask a clarifying question
- ask for a shared pin

### 3. Local knowledge should beat generic maps

The bot should prefer:

1. user-confirmed places
2. verified local landmarks
3. highly used saved locations
4. Mapbox fallback

This is how Nuna becomes more locally accurate than a generic mapping app.

### 4. Every trip should improve the system

Each booking should generate reusable signals:

- original user text
- final selected location
- whether clarification was required
- whether a pin was needed
- whether the user corrected a wrong guess
- confidence score
- source of resolution

## Smart Behavior Rules

The bot should operate based on confidence and action rules.

### High confidence

The bot should trust the location immediately if any of the following is true:

- the user shared a GPS pin
- the location matches an exact verified record in `locations`
- the location strongly matches a previously confirmed user place
- local data and Mapbox strongly agree
- the result is inside the service area and looks operationally safe

Bot action:

- accept the location
- save the resolved place
- move to the next booking step

Example:

`Pickup set to Kpakungu Market. Where is the drop-off?`

### Medium confidence

The bot has likely matches, but should not assume one is correct.

Cases:

- multiple similar landmarks
- fuzzy match with reasonable confidence
- good but not definitive Mapbox result
- area is known, but exact point is unclear

Bot action:

- show 2 or 3 top options
- ask the user to choose one

Example:

`I found these locations:`
`1. Bosso Market Main Gate`
`2. Bosso Low Cost Market Area`
`3. Bosso Roundabout`
`Reply with 1, 2, or 3. You can also send a pin.`

### Low confidence

The bot sees some signal, but not enough to offer reliable choices.

Cases:

- broad area only
- weak text
- partially recognizable landmark phrasing
- low-confidence map result

Bot action:

- ask one targeted clarification question

Example:

`Which Bosso location do you mean? Near a market, bank, school, or junction?`

### Very low confidence

The system cannot trust the input.

Cases:

- no useful local or Mapbox result
- place is outside service area
- repeated ambiguous responses
- text is too vague to map

Bot action:

- request a shared WhatsApp pin

Example:

`I'm not certain of that location. Please share a WhatsApp pin so I can place it correctly.`

## Bot State Machine

The bot should be implemented as a state machine instead of a loose sequence of chat steps.

This creates predictable behavior and makes smarter flows easier to build and maintain.

### State: `IDLE`

Meaning:

- no active booking session exists

Bot prompt:

- ask for pickup

Example:

`Where should we pick up from? You can type a place or share a pin.`

Transition:

- user starts booking -> `WAITING_FOR_PICKUP`

### State: `WAITING_FOR_PICKUP`

Meaning:

- bot is waiting for pickup input

Input types:

- plain text
- shared pin
- user-history reference
- vague landmark text

Resolver outcomes:

- high confidence -> save pickup -> `WAITING_FOR_DROPOFF`
- medium confidence -> `AWAITING_PICKUP_SELECTION`
- low confidence -> `AWAITING_PICKUP_CLARIFICATION`
- very low confidence -> `AWAITING_PICKUP_PIN`

### State: `AWAITING_PICKUP_SELECTION`

Meaning:

- the bot found multiple likely pickup options

Bot behavior:

- show top 2 or 3 options
- ask user to reply with a number

Valid outcomes:

- valid option chosen -> save pickup -> `WAITING_FOR_DROPOFF`
- user sends pin -> resolve and continue
- unclear reply -> retry once, then ask for pin

### State: `AWAITING_PICKUP_CLARIFICATION`

Meaning:

- the bot needs one more detail to identify pickup

Bot behavior:

- ask one focused follow-up question

Valid outcomes:

- useful clarification -> rerun resolver
- "same as last time" -> use history if confidence is high
- still weak after retry -> `AWAITING_PICKUP_PIN`

### State: `AWAITING_PICKUP_PIN`

Meaning:

- the bot needs a shared pin to proceed safely

Bot behavior:

- explicitly request a WhatsApp pin

Valid outcomes:

- pin received -> save pickup -> `WAITING_FOR_DROPOFF`
- repeated weak text -> stay in pin-request mode
- persistent failure -> possible manual review path later

### State: `WAITING_FOR_DROPOFF`

Meaning:

- bot is waiting for drop-off input

Same logic as pickup.

Resolver outcomes:

- high confidence -> save drop-off -> `VALIDATING_TRIP`
- medium confidence -> `AWAITING_DROPOFF_SELECTION`
- low confidence -> `AWAITING_DROPOFF_CLARIFICATION`
- very low confidence -> `AWAITING_DROPOFF_PIN`

### State: `AWAITING_DROPOFF_SELECTION`

Meaning:

- multiple likely drop-off matches found

Behavior:

- same pattern as pickup selection

### State: `AWAITING_DROPOFF_CLARIFICATION`

Meaning:

- one more detail is needed for drop-off

Behavior:

- same pattern as pickup clarification

### State: `AWAITING_DROPOFF_PIN`

Meaning:

- bot needs a shared pin for drop-off

Behavior:

- same pattern as pickup pin request

### State: `VALIDATING_TRIP`

Meaning:

- pickup and drop-off are resolved
- the bot must validate booking quality before asking for final confirmation

Checks:

- pickup exists
- drop-off exists
- pickup has coordinates
- drop-off has coordinates
- both are inside service area
- pickup and drop-off are not accidentally identical
- route calculation succeeds
- fare calculation succeeds
- distance is operationally reasonable

Outcomes:

- valid -> `AWAITING_CONFIRMATION`
- needs correction -> ask targeted correction question
- unreliable -> request pin for the weak leg

### State: `AWAITING_CONFIRMATION`

Meaning:

- the trip is resolved and ready for final user confirmation

Bot behavior:

- summarize pickup
- summarize drop-off
- show distance
- show fare
- ask for confirmation

Example:

`Pickup: Kpakungu Market`
`Drop-off: Top Medical Pharmacy, Bosso`
`Distance: 4.8km`
`Fare: N1000`
`Reply Confirm to book.`

Valid outcomes:

- `Confirm` -> `BOOKED`
- `Change pickup` -> `WAITING_FOR_PICKUP`
- `Change drop-off` -> `WAITING_FOR_DROPOFF`
- `Cancel` -> `IDLE`

### State: `BOOKED`

Meaning:

- booking is finalized
- trip is stored
- session can be cleared

Bot response:

`Booking confirmed. A driver will be assigned soon.`

## Location Resolution Engine

The current webhook flow should evolve so that location input is not treated as final immediately.

Instead, all pickup and drop-off messages should pass through a dedicated resolver that returns:

- resolved candidates
- confidence
- source
- reason
- recommended next action

Suggested return shape:

```ts
type ResolutionAction =
  | "accept"
  | "select"
  | "clarify"
  | "request_pin";

type ResolutionConfidence = "high" | "medium" | "low" | "very_low";

interface LocationCandidate {
  id?: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  source: "user_history" | "local_exact" | "local_fuzzy" | "mapbox" | "pin";
  score: number;
  isVerified?: boolean;
}

interface LocationResolutionResult {
  action: ResolutionAction;
  confidence: ResolutionConfidence;
  candidates: LocationCandidate[];
  selected?: LocationCandidate;
  reason: string;
  suggestedPrompt?: string;
}
```

This resolver should be the decision engine for the bot.

## Resolution Order

For each incoming location input, the resolver should process in this order:

1. detect if the user sent a pin
2. check whether the user referenced a recent or saved place
3. check exact local `locations` match
4. check local alias and fuzzy matches
5. parse local landmark-style phrasing
6. query Mapbox only if local confidence is not good enough
7. score confidence
8. choose action

## Smarter Local Understanding

The resolver should understand the kinds of descriptions people naturally use in Minna.

Examples:

- opposite GTBank Bosso Road
- beside Total filling station
- after the roundabout
- close to the mosque
- same place as last time
- near Top Medical

The system does not need full AI reasoning to improve significantly.

A strong early version can combine:

- normalization
- alias matching
- keyword extraction
- fuzzy search
- user history
- known nearby landmarks

### Location language patterns to support

- `opposite`
- `beside`
- `after`
- `before`
- `near`
- `close to`
- `junction`
- `roundabout`
- `market`
- `filling station`
- `school`
- `bank`
- `mosque`
- `church`

These should help drive structured local search.

## User Memory

One of the biggest upgrades to perceived intelligence is memory.

The bot should remember:

- user's recent pickups
- user's recent drop-offs
- user's frequent places
- optional labeled places such as home and work
- recent completed route pairs

The bot should be able to say:

- `Use your usual pickup at Tunga?`
- `Same drop-off as your last trip?`

This should be implemented carefully so that memory helps reduce friction without causing wrong assumptions.

Suggested rules:

- only auto-suggest history if confidence is high
- prefer recent and frequent places
- do not silently use history if current text points elsewhere

## Clarification Strategy

Clarification must be short and focused.

The bot should ask only the next best question.

Good clarification prompts:

- `Which Bosso location do you mean?`
- `Is it near a market, school, bank, or junction?`
- `Do you mean the same pickup as your last order?`

Bad clarification prompts:

- long paragraphs
- multiple unrelated questions at once
- open-ended "describe more" messages

## Multiple-Choice Selection

When confidence is medium, the bot should prefer options instead of more free text.

Pattern:

```text
I found these locations:
1. Kpakungu Market Entrance
2. Kpakungu Roundabout
3. Kpakungu Central Area

Reply with 1, 2, or 3. You can also send a pin.
```

Rules:

- show no more than 3 options
- keep labels short and recognizable
- allow pin fallback at any time
- after one failed selection, simplify and ask again

## Pin Request Strategy

The bot should request a shared pin when:

- no usable result is found
- multiple attempts remain ambiguous
- the location appears outside service area
- the area is too broad for safe booking
- repeated clarification still fails

The pin request should be framed as an accuracy improvement, not an error.

Good message:

`Please share a WhatsApp pin so I can place that correctly.`

## Booking Validation Rules

Before final confirmation, Nuna should validate the trip.

Validation checks:

- pickup resolved
- drop-off resolved
- both have coordinates
- both fall inside allowed service area
- route exists
- distance is greater than a minimum threshold
- route is not absurdly long
- fare was computed successfully

The bot should not confirm bad or uncertain trips too easily.

Possible special cases:

- pickup and drop-off look identical
- route is very short and may be accidental
- route is too long for current service scope
- geocoding is weak on one side of the trip

In those cases the bot should pause and ask for correction or a pin.

## Service Area Logic

The bot should know whether a location is:

- inside service area
- near service boundary
- outside service area

Recommended behavior:

- inside -> continue
- near boundary -> warn and verify
- outside -> politely refuse or request a nearby landmark

This will prevent unreliable bookings from locations outside current operations.

## Data Nuna Should Learn From Every Booking

Each resolved location should store:

- original raw user message
- normalized message
- final chosen location label
- final coordinates
- source of resolution
- confidence level
- whether user selected from options
- whether clarification was needed
- whether a pin was required
- whether the user corrected a proposed match
- whether the place later became verified

Each trip should store:

- pickup confidence
- drop-off confidence
- whether route succeeded
- whether fare calculation succeeded
- whether the user needed help multiple times

These signals are critical for future optimization.

## Suggested Data Model Changes

The current schema is not fully visible in the repo, but this smart bot direction will likely need additional fields or tables.

### `locations`

Suggested additions:

- `normalized_text`
- `alias_texts` or alias relation table
- `source`
- `last_used_at`
- `service_area_status`
- `selection_count`
- `clarification_count`
- `pin_confirmation_count`

### `trips`

Suggested additions:

- `pickup_confidence`
- `dropoff_confidence`
- `pickup_resolution_source`
- `dropoff_resolution_source`
- `needs_manual_review`
- `validation_notes`

### `session_states`

Suggested additions:

- `pending_candidates`
- `pending_resolution_type`
- `retry_count`
- `last_prompt_type`
- `context_payload`

### New table: `user_saved_places`

Suggested columns:

- `id`
- `user_id`
- `label`
- `location_id`
- `is_home`
- `is_work`
- `use_count`
- `last_used_at`

### New table: `location_aliases`

Suggested columns:

- `id`
- `location_id`
- `alias_text`
- `source`
- `confidence`

### Optional analytics table: `location_resolution_events`

Suggested columns:

- `id`
- `user_id`
- `trip_id`
- `stage`
- `input_text`
- `action_taken`
- `confidence`
- `resolution_source`
- `selected_location_id`
- `was_corrected`

## Conversational Style

The bot should sound:

- short
- clear
- operational
- locally useful

It should avoid:

- excessive politeness
- long explanations
- unnecessary personality
- too much text at once

Examples of the right tone:

- `Pickup set to Kpakungu Market.`
- `Where is the drop-off?`
- `I found 3 matches. Reply with 1, 2, or 3.`
- `Please share a pin so I can place that correctly.`

## Example Smart Flows

### Flow A: High-confidence typed landmark

User:

`Kpakungu Market`

Bot:

`Pickup set to Kpakungu Market. Where is the drop-off?`

Reason:

- exact or strong verified match

### Flow B: Ambiguous area name

User:

`Bosso`

Bot:

`Which Bosso location do you mean?`
`1. Bosso Market`
`2. Bosso Low Cost`
`3. Bosso Roundabout`
`Reply with 1, 2, or 3. You can also send a pin.`

Reason:

- broad area with multiple likely candidates

### Flow C: Weak landmark phrasing

User:

`Opposite GTBank`

Bot:

`Which area is that in? Bosso Road, Tunga, or another area?`

Reason:

- recognizable landmark but incomplete area context

### Flow D: No reliable result

User:

`That junction near my house`

Bot:

`Please share a WhatsApp pin so I can place that correctly.`

Reason:

- vague text with low confidence

### Flow E: User memory

User:

`same place as last time`

Bot:

`Use your last pickup at Tunga Central Mosque? Reply Yes or No.`

Reason:

- history-based shortcut

## Execution Plan

Implementation should happen in phases.

The goal is to improve intelligence without destabilizing the working booking flow.

## Phase 1: Refactor Into a Resolver-Based Architecture

Objective:

- stop handling location input directly inside the webhook
- introduce a dedicated location resolution layer

Tasks:

- create a `resolveLocationInput()` service
- return structured result with action, candidates, confidence, and reason
- centralize all pickup and drop-off resolution through that service
- keep existing happy path working

Deliverables:

- resolver module
- typed result object
- webhook integration

Success criteria:

- current booking flow still works
- all location decisions come from the resolver

## Phase 2: Expand Session State Machine

Objective:

- move beyond only pickup -> drop-off -> confirm

Tasks:

- add explicit states for:
  - pickup selection
  - pickup clarification
  - pickup pin request
  - drop-off selection
  - drop-off clarification
  - drop-off pin request
  - validation
- store temporary candidates and retry context in session state

Deliverables:

- expanded session state definitions
- webhook transition logic

Success criteria:

- bot can pause for clarification and resume safely

## Phase 3: Add Local Fuzzy Matching and Option Selection

Objective:

- improve local text understanding before using Mapbox

Tasks:

- normalize location text more aggressively
- add fuzzy search across local landmarks
- rank candidates using verification and hit count
- return up to 3 likely options
- support numeric reply selection

Deliverables:

- fuzzy search helper
- ranking logic
- selection handling in session flow

Success criteria:

- fewer wrong direct matches
- more successful booking resolution from local data

## Phase 4: Add Targeted Clarification Logic

Objective:

- ask better follow-up questions when the input is partially useful

Tasks:

- classify partial matches
- generate question prompts based on ambiguity type
- distinguish broad-area ambiguity from landmark ambiguity

Deliverables:

- clarification prompt generator
- ambiguity reason taxonomy

Success criteria:

- bot asks fewer generic questions
- users can recover from vague inputs quickly

## Phase 5: Add User Memory

Objective:

- reduce repeated typing for returning riders

Tasks:

- create `user_saved_places` or equivalent memory structure
- identify recent and frequent places
- support phrases like:
  - same as last time
  - home
  - work
- suggest recent places when confidence is high

Deliverables:

- user-memory lookup
- saved-place logic
- safe suggestion rules

Success criteria:

- repeat customers complete bookings faster

## Phase 6: Add Service Area and Validation Rules

Objective:

- stop weak or invalid bookings before confirmation

Tasks:

- define service area boundaries
- add inside / boundary / outside checks
- validate pickup/drop-off pair quality
- check route success before final confirmation
- flag suspicious trips

Deliverables:

- service area helper
- trip validation function
- manual review flags

Success criteria:

- fewer bad confirmations
- stronger operational reliability

## Phase 7: Improve Learning and Analytics

Objective:

- make the system measurably smarter over time

Tasks:

- log resolution events
- track failure and correction patterns
- track which locations cause frequent ambiguity
- identify duplicate landmarks
- identify high-value recurring routes

Deliverables:

- resolution analytics schema
- dashboards or admin queries later

Success criteria:

- team can see where the bot struggles
- improvements become data-driven

## Recommended Technical Work Breakdown

### Backend

- create resolver service
- create ranking and confidence system
- create session transition handlers
- add history lookup
- add service area validation
- add analytics logging

### Database

- extend session state support
- add user memory storage
- add alias support
- add resolution event storage

### Admin Dashboard

- show ambiguous/unverified places
- show correction hotspots
- show most reused landmarks
- show unresolved bookings or manual review items

## Priority Order

Recommended order of execution:

1. resolver architecture
2. session state expansion
3. fuzzy local search
4. selection and clarification flow
5. user memory
6. validation and service area checks
7. analytics and optimization

This order improves intelligence quickly while preserving the current MVP.

## Practical Definition of Success

The smart Nuna bot is successful when:

- users can book using the way they naturally describe places in Minna
- the bot asks fewer total questions per successful booking
- the bot requests a pin only when truly needed
- repeat riders finish booking faster than first-time riders
- the local `locations` database becomes more useful than generic geocoding over time
- wrong or risky bookings decrease

## Final Direction

The Nuna bot should evolve from a simple booking script into a local location-resolution engine.

Its intelligence should come from:

- confidence-based decision making
- local landmark knowledge
- user memory
- precise clarification
- operational validation
- continuous learning from real usage

This is the path that makes Nuna genuinely useful and defensible in Minna.
