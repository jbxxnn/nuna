# Live Tracking Options For Riders

## Goal

This note compares the main ways Nuna can support live rider tracking later.

The decision should be based on real operating conditions in Minna:

- riders may not keep a browser tab open consistently
- device quality and battery discipline will vary
- network quality will vary
- operations need something reliable enough to help customers and ops, not just something impressive in demos

## Current Baseline

Current implementation is browser-based:

- rider opens `/rider`
- browser asks for location permission
- browser sends location updates to the backend every 30 seconds
- `/track/[token]` polls and shows the last known rider position

This is good as a first step, but it is not strong background tracking.

## Option 1: Keep Browser-Based Tracking

### What it is

Use the current web app only.

Rider tracking works while:

- the rider keeps `/rider` open
- location permission is granted
- the browser is active enough to keep running timers and geolocation calls

### Pros

- fastest to ship
- cheapest to maintain
- no app store process
- no new mobile stack required
- works immediately on Android phones with WhatsApp users

### Cons

- tracking may slow down or stop when the browser is minimized
- tracking may stop when the phone screen turns off
- some phones aggressively pause background browser activity
- location permission UX is weaker than a dedicated app
- customers may see stale rider positions

### Best use

- MVP
- early rollout
- ops assistance, not guaranteed customer-grade live tracking

## Option 2: Progressive Web App (PWA)

### What it is

Turn the rider web app into an installable PWA.

This improves:

- home screen access
- app-like feel
- some foreground persistence
- re-engagement

### Pros

- better UX than a normal browser tab
- easier for riders to reopen
- still cheaper than full native
- same codebase can be reused heavily
- useful step before native investment

### Cons

- background geolocation support is still limited, especially on iPhone
- not equal to a real native app for persistent tracking
- install flow can still confuse less technical riders
- device-specific behavior can still be inconsistent

### Best use

- better rider experience than plain browser
- moderate improvement, not full reliability

## Option 3: Mobile Wrapper / Hybrid App

### What it is

Wrap the existing rider app in a mobile shell using tools like:

- Capacitor
- React Native WebView style wrapper

This can allow better access to device APIs and more controlled app behavior.

### Pros

- faster than building a full native app from scratch
- can reuse much of the current UI and logic
- better access to mobile permissions
- can improve location behavior over plain web

### Cons

- still more complex than web/PWA
- background location can still be tricky and platform-specific
- app store packaging and updates become necessary
- debugging hybrid mobile behavior is harder than debugging web

### Best use

- middle ground if browser/PWA is not enough
- useful if the team wants faster mobile packaging without a full native rewrite

## Option 4: Full Native Rider App

### What it is

Build a dedicated mobile rider app.

Possible approaches:

- React Native
- Flutter
- native Android first

### Pros

- best option for reliable live tracking
- strongest control over background location behavior
- better notification support
- better offline handling
- better battery and permission tuning
- strongest long-term rider experience

### Cons

- highest build cost
- highest maintenance cost
- mobile release process is slower
- requires stronger QA discipline
- more engineering overhead

### Best use

- production-grade live rider tracking
- large enough rider volume to justify the cost
- customer-facing tracking reliability as a core product promise

## Option 5: Assisted Tracking Instead Of Full Live Tracking

### What it is

Do not depend on continuous background tracking.

Instead, update rider position only at key moments:

- when rider opens `/rider`
- when rider accepts a trip
- when rider starts moving
- when rider marks picked up
- when rider marks completed

### Pros

- much more realistic for low-discipline device usage
- easier on battery
- easier on permissions
- easier to explain to riders
- still useful for ops and customers

### Cons

- not true live tracking
- customer map movement will look step-based, not continuous
- ETA quality will be weaker

### Best use

- pragmatic fallback for your market
- useful if riders are unlikely to maintain always-on tracking

## Recommended Path For Nuna

### Phase 1

Keep the current browser-based tracking.

Use it as:

- best-effort live location
- useful when the rider is active on `/rider`

Do not promise perfect live tracking yet.

### Phase 2

Add assisted tracking behavior on top of browser tracking:

- update location on assignment accept
- update on status changes
- update on manual rider actions

This gives you a more reliable minimum signal even when continuous tracking fails.

### Phase 3

If rider usage proves strong enough, move to a PWA or mobile wrapper.

This is the likely next practical step before full native.

### Phase 4

If customer live tracking becomes a major product promise, invest in a proper native rider app.

That is the first option that can reasonably be treated as production-grade continuous tracking.

## Decision Summary

### Cheapest

- browser-based tracking

### Best short-term value

- browser-based tracking plus assisted tracking events

### Best middle-ground upgrade

- PWA or mobile wrapper

### Best long-term reliability

- native rider app

## Product Recommendation

For Nuna right now:

1. keep browser live tracking as a best-effort signal
2. add assisted location updates on rider actions
3. do not market it as perfect live tracking yet
4. revisit native only after usage proves the need

That path fits your current rider behavior and avoids overengineering too early.
