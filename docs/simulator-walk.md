# The simulator walk

A checklist for the parts of these apps no automated suite reaches. Run it
before a release, and after any change to `packages/device`, the propose or
plan screens, the calendar/reminder wiring, or the busy-times view.

It is a manual test because the things it covers cannot be faked convincingly:
a real OTP arriving, PostgREST rejecting a query the socket would have allowed,
a calendar entry appearing in the OS calendar app with the right title and
nothing else. Each is a place where a green suite is not evidence.

## What is already covered, so you can skip it here

`npm test` covers the cadence engine, the domain boundary at the repository
layer, translation parity, and the guard rules. `npm run db:test` covers every
RLS policy statement by statement, and `tests/e2e/journey.test.ts` walks pair →
rotate → refuse a third → two locales → propose → accept → reconcile both
devices' calendar ids → counter → complete against the real migrations.

None of that goes through the network stack or touches a device. What is left
is this document.

## Before you start

**This needs a Mac.** `expo run:ios` compiles the native modules, and there is
no way around a dev build: neither app runs in Expo Go at all — it segfaults in
`worklets::jsi_utils::addMethod` inside its own binary, before any of our
JavaScript matters. Expo Go could not grant calendar, notification or biometric
permissions anyway, so `packages/device` would be inert in it.

1. **A local Supabase stack**, so you can read the OTP out of the local mail
   catcher rather than a real inbox:

   ```bash
   supabase start          # note the API URL and anon key it prints
   ```

   Two things about this that cost time on the walk of 2026-08-04:

   **The mail catcher is Mailpit, not Inbucket.** The UI is still on
   `http://localhost:54324`, but the API is Mailpit's, so anything scripted
   against Inbucket's `/api/v1/mailbox/<name>` returns `File not found`. The
   code lives at:

   ```bash
   curl -s "http://127.0.0.1:54324/api/v1/search?query=to:you@example.test&limit=1"   # -> .messages[0].ID
   curl -s "http://127.0.0.1:54324/api/v1/message/<ID>"                               # -> .Text / .HTML
   ```

   **`supabase start` may refuse this project outright.** `config.toml` pins
   `db.major_version = 16` — deliberately, to match CI and the `postgresql@16`
   the README asks for — and current CLIs reject it:

   ```
   LegacyStartInvalidConfigError: Failed reading config: Invalid db.major_version: 16
   ```

   Do not "fix" this by bumping the pin; that silently desyncs the trio the
   comment in `config.toml` exists to keep together. Use a CLI that still
   accepts 16, or apply `supabase/migrations/*.sql` in filename order straight
   into the running `supabase_db_*` container with `psql -v ON_ERROR_STOP=1`.

   **A stack left over from a previous walk is worse than no stack.** The
   migrations here are edited _in place_ while nothing has shipped — stage 2
   added `profiles.name_payload` to `20260801000100_shared_identity.sql`, the
   _first_ migration — so a database built before that edit can never catch up,
   and the failure surfaces much later as `column "name_payload" ... does not
exist` from a migration that looks unrelated. Always start the walk from a
   database built from scratch. `npm run db:test` never sees this because it
   builds a throwaway database every time.

2. **Both apps' `.env`** — separate from the root one, which only ever points
   at a throwaway Postgres:

   ```bash
   cp apps/intimacy/.env.example apps/intimacy/.env
   cp apps/two-two-two/.env.example apps/two-two-two/.env
   # EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY. Anon key only.
   ```

3. **Two simulators**, because half of what matters here is one partner seeing
   what the other did. A single device cannot show you a realtime update
   arriving, a second calendar id being recorded, or a proposal being answered
   by someone who did not write it.

   ```bash
   cd apps/intimacy && npm run ios        # ~5 min the first time
   cd apps/two-two-two && npm run ios
   ```

   If `pod install` dies with `Unicode Normalization not appropriate for
ASCII-8BIT`, that is CocoaPods on Ruby 4 in a non-UTF-8 shell, and its error
   reporter crashes while formatting the real error. Prefix with
   `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`.

4. **Two email addresses.** Any two strings work against the local stack.

## How to observe

**Read the accessibility tree, not screenshots.**

```bash
axe describe-ui
```

Simulator screenshots lag the running app by whole screens, and a stale one is
indistinguishable from a frozen app — that cost a full debugging detour here,
diagnosing a "dead" pairing screen that had in fact already navigated away. The
tree also gives every element's label and frame, so you get exact tap
coordinates instead of arithmetic on pixel sizes.

Several checks below are specifically about an accessibility label rather than
a visual, because that is where the meaning lives: a busy chip is marked with a
coloured dot and no text, so `accessibilityLabel` is the only thing that says
what the dot means.

`axe describe-ui` is verbose enough to bury the answer. Flattening it to one
line per element makes the whole walk tractable, and gives tap coordinates:

```bash
axe describe-ui --udid "$UDID" | jq -r '
  [.. | objects | select(has("AXLabel"))] | .[]
  | select((.AXLabel // "") != "" or (.AXValue // "") != "")
  | "\(.type) | \(.AXLabel // "-") | \(.AXValue // "-") | \((.frame.x + .frame.width/2)|floor),\((.frame.y + .frame.height/2)|floor)"'
```

**Sheets scroll, and elements below the fold still report coordinates.** The
propose and plan sheets put their submit button at y≈990 on an 874-tall screen;
tapping that y does nothing and looks exactly like a dead button. Check the
reported y against the screen height and scroll first.

**One dev-client, one Metro port.** The dev client reuses the last bundler URL
it was given and ignores a `?url=` pointing somewhere else, so running the two
apps on 8081 and 8082 silently serves _the intimacy bundle to Two22_ — which
reads as a branding bug ("Us" in the 2-2-2 app) and is not one. Run one Metro at
a time on 8081 and restart it against the other app when you switch.

---

## 1. Sign-in and pairing

The e2e suite inserts into `auth.users` directly, so nothing automated has ever
exercised the actual auth service.

- [ ] **A real code arrives and works.** Enter an email in the intimacy app,
      read the OTP from Mailpit (`http://localhost:54324`), enter it. You land
      on the pairing screen, not the tabs.
- [ ] **The connected-apps notice appears once.** After pairing, the "Us and
      Two22" modal shows. Dismiss it, force-quit, relaunch — it does not return.
- [ ] **The code rotates.** Pair the second simulator with the code from the
      first. Check the first app's pairing screen: the code it now shows is
      different from the one you just used.
- [ ] **A third person is refused.** Sign in as a third address and try the
      current code. You get the `couple_full` message, in the app's language —
      not a raw Postgres error.

## 2. The second install

This is the one that shipped broken and was fixed in #10. It only reproduces
when an app is installed against an _already paired_ account.

- [ ] **No second pairing.** The 2-2-2 app, signed in with an account already
      paired via the intimacy app, goes straight to the tabs. It never asks for
      a code.
- [ ] **Cadences are seeded anyway.** The Today tab shows three clocks — date
      night, getaway, trip. An empty rhythm screen here is the regression.
- [ ] **Seeding is idempotent.** Force-quit and relaunch. Still three, not six.
- [ ] **The notice explains itself.** The connected-apps modal appears in this
      app too, and Settings carries the same card permanently.

## 3. Discretion on the device

Invariant 3, and the part of it no test can see.

- [ ] **The calendar entry says nothing.** Book a plan in the intimacy app, let
      it sync, then open the OS **Calendar** app. The event's title is the
      neutral label (default `Us`, editable in Settings → Privacy) and there is
      no note, no location, and nothing else.
- [ ] **Changing the label rewrites the entry.** Set a different label in
      Settings, return to the tabs, and confirm the existing event's title
      follows.
- [ ] **The 2-2-2 entry is deliberately different.** A 2-2-2 plan writes its
      real title — there is nothing to conceal about a trip to Tahoe. Both apps
      write into the same device calendar; that is intentional.
- [ ] **The reminder is empty of content.** Book something ~2h10m out so the
      intimacy reminder (120 minutes' lead) fires. The banner reads `Us` /
      `A quiet reminder.` — no kind, no title, no partner name. 2-2-2's lead is
      180 minutes and its copy is `Two22` / `Something's coming up.`
- [ ] **Reminders are local.** Put the device in airplane mode after the plan
      is booked; the notification still fires. It is composed on this device,
      which is also why each partner gets it in their own language.
- [ ] **The lock actually locks.** Enable Face ID in Settings → Privacy,
      background the intimacy app, return. You are asked to authenticate before
      any content renders. Cancel, and you see the locked screen, not the tabs.
      (A device with a passcode but no biometrics must still be offered this.)

## 4. Two partners, one couple

Everything here needs both simulators.

- [ ] **Each partner reads their own language.** Set one profile to `es` and
      leave the other `en`. Both look at the same plan: the chrome differs, the
      partner-written title is byte-identical in both. It is never translated.
- [ ] **A proposal arrives without a refresh.** Propose from A; B's screen shows
      it without being touched. This is the realtime path, and it is the one
      thing PostgREST-vs-socket differences would break silently.
- [ ] **Countering reads as one thread.** Answer with a different time from B.
      A sees a single negotiation, not two unrelated suggestions, and the plan
      stays `proposed` until someone says yes.
- [ ] **Both phones record their own event id.** Accept, then check
      `plans.calendar_event_ids` — two entries, one per profile. Each phone
      returns its own identifier for the same logical event.
- [ ] **A "not tonight" is styled like a "yes".** Check in on both devices with
      different answers. The options carry equal weight, there is no counter
      anywhere, and nothing marks the no as a failure.

## 5. Free/busy, and the three sources

Added in #10 and #13. The point of these is that each source can be absent and
the screen still works.

- [ ] **A refused calendar permission does not break the screen.** Deny calendar
      access in the intimacy app, open **Suggest a time**. You still get
      suggestions, and they avoid times this app's own plans already occupy.
      Offering nothing at all is the regression that #13 fixed.
- [ ] **Granting it sharpens rather than unlocks.** The prompt reads "Allow
      calendar access and these get sharper", and the suggestion list is
      rendered either way. Add an unrelated event to the device calendar in the
      evening band, grant access, and confirm that window stops being offered.
- [ ] **A proposed time blocks.** Propose a window in the intimacy app and leave
      it unanswered. It stops being offered in that app immediately, even though
      no calendar entry exists for it — `BOOKED` is `['scheduled']` on purpose,
      so the busy view is the only thing that knows.
- [ ] **Cross-app busy is off by default.** On a fresh 2-2-2 install, the
      unanswered intimacy proposal above marks nothing. Settings → Calendar
      access shows "Avoid times you are busy elsewhere" switched **off**.
- [ ] **Turning it on marks the chip.** Enable it, reopen the plan screen. The
      clashing chip carries a dot, and `axe describe-ui` reports its label as
      `<time> — already booked`. Confirm the label names a _time_ and never what
      fills it.
- [ ] **A mark is never a block.** Tap the marked chip. It selects normally and
      saves. Overlapping deliberately is allowed.
- [ ] **Trips mark only their departure day.** Book something mid-week, then
      choose a 14-night trip. Only chips whose _first_ day clashes are marked —
      not all fourteen. Switch to a 2-hour date night over the same booking and
      that chip still marks.

## 6. Keys, and the four ways a device gets one

Added with the encryption stages. None of this is reachable from `npm test` or
`npm run db:test`: the keychain is a native module, the routing is app-level
wiring around a pure function, and Realtime is a websocket the SQL suite never
opens.

**Turn the poll off before you test any of it.** Both waiting screens re-ask
every `POLL_MS` (5s, `packages/auth/src/invite.tsx`) on top of the realtime
subscription, which will hide a dead socket completely. Raise it to something
large for the walk and put it back afterwards. A partner's device appearing
after five seconds rather than one is the _only_ symptom you would get, and
`tests/guards/realtime-subscriptions.test.ts` cannot tell you either — it holds
the publication and the handler lists together, not delivery.

- [ ] **The keychain accepts both accessibility values.** `key-vault.ts` stores
      the device secret `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and the couple key
      `AFTER_FIRST_UNLOCK`. A rejected value shows up as a write that throws
      or, worse, a read that returns null — which is indistinguishable from a
      device that was never approved. The check is a cold start: force-quit a
      device that holds the key and relaunch. Landing on `(tabs)` means both
      items were written _and_ read back.
- [ ] **Cold start with a key lands on the tabs.** As above. `routeIntent` is
      unit-tested; the `useSegments`/`useRouter` wiring in `app/_layout.tsx` is
      not.
- [ ] **A keyless device lands on `/unlock`, never on a tab.** A tab mounting
      without the key means every query meets `MissingCoupleKeyError` inside a
      mapper. **Deleting the app does not produce a keyless device** — iOS
      keychain items outlive app deletion, so `expo-secure-store` comes back
      populated and the app returns straight to the tabs, still signed in. Use
      `xcrun simctl erase <udid>` (or a simulator that has never had the app).
      This is the single easiest way to conclude the routing is broken when it
      is not, or to "pass" this box without testing anything.
- [ ] **The partner's device appears without a tap.** With the poll raised:
      found on A, join on B. B's card should appear on A within a second or
      two. If it only arrives on the poll, the subscription is not being
      delivered and everything below is untested.
- [ ] **The twelve characters match on both phones.** B's `/unlock` screen and
      A's approval card must read the same. They will, by construction —
      `safetyNumber` sorts the two public keys before hashing, so it is a
      _pairwise_ value and both sides compute the same one — which is why the
      check is worth doing: a mismatch means the pair is wrong, not the code.
- [ ] **More than one number on `/unlock` is correct.** The screen lists one
      number per device that _could_ approve this one, so a couple with three
      other devices shows three. Find the one on the phone in your hand.
- [ ] **Approving unlocks the other phone with no tap on it.** B moves from
      `/unlock` to the tabs on the `couple_key_wraps` event alone.
- [ ] **Settings shows the same panel.** `InvitePanel` is the same card on the
      pairing screen and in Settings.

### Your own second install

The invariant most at risk from encryption: `expo-secure-store` is scoped per
bundle, so the second app is a _keyless device of yours_, not a second pairing.

- [ ] **No second pairing.** Install the other app, sign in with the same
      account. It finds the couple already connected and never asks for a code.
- [ ] **It is yours, not a partner's.** It appears on the first app's approval
      card headed "Another of your devices" (`isMine`), with "Remove this
      device" offered — a partner's card has neither.
- [ ] **After approval it cold-starts into its own tabs**, with its three
      clocks seeded.

### Recovery

- [ ] **The derivation is visible, not a dead tap.** Saving a code and redeeming
      one both run `scryptAsync` (N = 2¹⁴). It takes ~5s on a simulator; the
      button must report `In progress` / `busy` for the whole of it. If the tap
      reads as dead, `scrypt` has been swapped back for the blocking form.
- [ ] **A code is shown exactly once.** Nothing stores it and the envelope
      cannot be turned back into it.
- [ ] **Recovery is per person.** The envelope is keyed by `profile_id`, so a
      partner's code will not let this device in. Save the code on the account
      you intend to recover.
- [ ] **A recovered device never appears on the partner's approve screen.** It
      wraps the key to _itself_, so the partner is never asked. Check
      `couple_key_wraps.wrapped_by` — it is the recovering person, where an
      approved device carries the partner.
- [ ] **The device list agrees afterwards.** Every device reads "Can read your
      shared history", and no approval card is left behind.

## 7. Places, after the merge

`plan_places` was sealed in the encryption merge and had never run on a device.

- [ ] **A hand-typed venue round-trips.** Attach one to a getaway. It stores
      `provider = 'manual'` with a sealed `payload`, and reads back on the plan.
- [ ] **The address is off by default.** `share_with_calendar` is `false` unless
      the "Put the address in the calendar entry" control is switched on.
- [ ] **A plan dated today shows in neither list.** "Coming up" is future-only
      and "Earlier" is completed-only, so a plan whose start has passed
      unanswered is invisible in both. Pick a future date deliberately when
      setting these up, and treat the gap itself as a question for the plans
      screen rather than for this walk.

## 8. The domain boundary, from outside

- [ ] **2-2-2 never shows an intimacy plan.** Its Plans tab lists only its own.
      With both apps open, edit an intimacy plan's notes from the other
      simulator: 2-2-2 must not refetch or flicker. The realtime subscription is
      filtered on `domain`, and this is the only place you can watch that hold.
- [ ] **Nothing intimate is reachable in 2-2-2.** No check-in state, no
      intimacy title, no count of anything from the other app.

## When something fails

Write down what you saw before you start fixing it — a manual result that is
not recorded may as well not have happened.

If the failure is in the boundary or in discretion, treat it as a release
blocker rather than a bug: those two are why the apps are shaped the way they
are.

If it reproduces without a device — a wrong translation key, a cadence off by a
day, a policy that lets the wrong row through — it belongs in an automated
suite instead, and the fix should include the test that would have caught it.

## Recording the result

Note the date, the two SDK/simulator versions, and which boxes you actually
ticked in the PR description. "Walked the simulator" without a list is not a
claim anyone can check later — including you.
