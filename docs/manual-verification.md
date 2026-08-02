# What a green suite does not prove

`npm test` and `npm run db:test` between them cover the pure logic, the RLS
policies and the couple's whole journey against real migrations. Four things
they structurally cannot reach, because Node has no device:

- **Email OTP delivery** — that is Supabase's auth service. The suites insert
  into `auth.users` directly.
- **PostgREST** — statements run over a socket as the `authenticated` role, not
  through supabase-js.
- **Writing to a device calendar** — `packages/device` is inert without a real
  permission grant.
- **The keychain and any live model** — `expo-secure-store` and the BYOK
  suggestion path never run in CI. Nothing in the automated suite has ever held
  a real API key.
- **The `places` Edge Function and any mapping provider** — the suites run with
  no key, which is the supported no-provider path. Nothing automated has ever
  called a provider, gone through `functions.invoke` over PostgREST, or decoded
  a map image on a device. A `btoa` that does not exist in Hermes shipped once
  precisely because Node has one — see G6.

This document is the walk that covers them. It needs a dev build, because
**neither app runs in Expo Go** (see CLAUDE.md — Expo Go segfaults in its own
binary before our JavaScript matters):

```bash
cd apps/two-two-two && npm run ios     # ~5 min the first time
```

Read the accessibility tree with `axe describe-ui` rather than trusting a
screenshot; a stale simulator screenshot is indistinguishable from a frozen
app, and that has already cost one full debugging detour here.

---

## A. The couple's journey

Against a local stack (`supabase start`), on two simulators or a simulator and
a device.

| #   | Do                                          | Expect                                                                                                     |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A1  | Sign in with a real emailed code            | Signed in. This is the OTP path no suite covers.                                                           |
| A2  | Pair the second device with the invite code | Both devices show the couple. The code rotates — reusing it fails.                                         |
| A3  | Set the two devices to different languages  | Each partner's chrome is in their own language, at the same time.                                          |
| A4  | Book a plan on one device                   | It appears on the other without a manual refresh.                                                          |
| A5  | Grant calendar access, then book            | A calendar entry appears titled with the **neutral label only** — no notes, no location, nothing intimate. |

## B. BYOK: the no-key path

The AI-optional rule, checked by eye. **Do this first, before configuring
anything** — it is the state every user is in until they opt in.

| #   | Do                              | Expect                                                         |
| --- | ------------------------------- | -------------------------------------------------------------- |
| B1  | Open Ideas with no key saved    | The curated library and "add your own" work exactly as before. |
| B2  | Look at the suggestion card     | One line pointing at Settings. No form, no button, no error.   |
| B3  | Save a library idea and plan it | Unchanged from before the feature existed.                     |

## C. BYOK: keys in the keychain

| #   | Do                                      | Expect                                                                                       |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1  | Settings → paste a key                  | Masked as you type.                                                                          |
| C2  | Paste something that is not a key, save | Rejected locally with "that does not look like a key", no network call.                      |
| C3  | Save a real key                         | "A key is saved on this phone."                                                              |
| C4  | Toggle to the other provider            | The field **clears**. It must not show the first provider's key.                             |
| C5  | Toggle back                             | Still saved.                                                                                 |
| C6  | Force-quit and reopen                   | Still saved — it is in the keychain, not in memory.                                          |
| C7  | Check the database                      | **No key anywhere.** `plan_ideas`, `ai_usage` and `profiles` contain nothing resembling one. |
| C8  | Look at the partner's device            | No key. Keys are per person and per device.                                                  |
| C9  | Remove the key                          | Back to the B2 state.                                                                        |

## D. BYOK: the form's memory

This is the part with the most moving pieces, and none of it is on disk.

| #   | Do                                              | Expect                                                                           |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| D1  | Enter a location and a budget on **date night** | Both stick.                                                                      |
| D2  | Switch the chip to **trip**                     | Location **stays**; budget is **empty** — a fortnight away is not a £40 evening. |
| D3  | Enter a different budget on trip, switch back   | Each kind shows its own budget; the location is unchanged.                       |
| D4  | Switch to another tab and back                  | All of it survives — the card unmounts, the store does not.                      |
| D5  | Force-quit and reopen                           | All three fields are **empty**. Session-lived, never written to disk.            |
| D6  | Sign out, sign back in                          | Empty. The next person does not inherit the last one's city.                     |

## E. BYOK: generating and saving

| #   | Do                                                      | Expect                                                                                                                               |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Generate with a location and budget filled              | Several ideas, each with a title and a summary, in the language you are reading.                                                     |
| E2  | Generate on Spanish chrome                              | The ideas come back **in Spanish** — the model is told the reader's language, not the couple's.                                      |
| E3  | Save one                                                | A `plan_ideas` row with `source = 'ai'`, your `locale`, and a cost band where the model gave one.                                    |
| E4  | Look at the partner's device, set to the other language | The suggestion is shown **verbatim** with a language label — never machine-translated. Plus "suggested by a model".                  |
| E5  | Generate again                                          | Anything already on the shortlist is dropped from the new list.                                                                      |
| E6  | "Plan it" on a suggestion                               | Opens the plan form prefilled with that title.                                                                                       |
| E7  | Check the outbound request                              | Only the kind, the language, a count and your three fields. **No** plan, check-in, id, couple timezone, shortlist or Supabase token. |

## F. BYOK: when it goes wrong

None of these may show English to a Spanish reader, and none may show the
provider's own error text.

| #   | Do                                         | Expect                                                          |
| --- | ------------------------------------------ | --------------------------------------------------------------- |
| F1  | Save a deliberately wrong key, generate    | "That key was refused." (`unauthorized`)                        |
| F2  | Airplane mode, generate                    | "Could not reach the service." (`network`)                      |
| F3  | An out-of-credit account                   | "That account is out of credit." (`quota`)                      |
| F4  | Type nonsense in the model field, generate | "That model is not available." (`model_unavailable`)            |
| F5  | Repeat F1–F4 on Spanish chrome             | Every message in Spanish.                                       |
| F6  | Generate, then leave the tab mid-flight    | No crash, no state set after unmount, no error shown on return. |

## G. Places: the no-provider path

**Do this first, with `GOOGLE_MAPS_API_KEY` unset.** It is the state every
install is in until somebody configures one, and the state the whole suite runs
in.

| #   | Do                                                      | Expect                                                                                               |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| G1  | Open Plans and Ideas                                    | No search box, no map, no error, no "unavailable" notice anywhere. The screens look normal.          |
| G2  | Book a getaway and type a place by hand                 | Saved. It shows on the plan with the name exactly as typed.                                          |
| G3  | Tap **Open in Maps**                                    | The phone's own maps app opens on that name. No key was involved.                                    |
| G4  | Tap **Find somewhere to stay** on the getaway           | Airbnb opens with the check-in and check-out already set to the plan's nights.                       |
| G5  | Check G4's dates against the plan in a non-UTC timezone | The nights match the couple's calendar dates, not UTC's. An evening departure is the same day.       |
| G6  | Confirm no map thumbnail appears and nothing is logged  | A missing map is silent by design — which is why the `btoa` bug hid. G6 only proves the no-key path. |

## H. Places: with a provider configured

`supabase secrets set GOOGLE_MAPS_API_KEY=…` (or `supabase/functions/.env`
locally), then restart the stack.

| #   | Do                                                      | Expect                                                                                                   |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| H1  | Reopen the app, go to Ideas                             | A search card is now present. This is `op: 'capabilities'` over `functions.invoke` — no suite covers it. |
| H2  | Type a town in the suggestion card, then look at search | The town is already filled in. It is asked once per screen, not twice.                                   |
| H3  | Search for a venue, save it to the shortlist            | Saved. **Tap Plan it** — the booking screen shows that venue, with its address.                          |
| H4  | Complete that booking, then open Plans                  | A map thumbnail appears. If it does not, the decode path is broken again — check G6's note.              |
| H5  | Search for a getaway near a town                        | Results show a drive time. Anything the provider could not route to is still listed, not hidden.         |
| H6  | Search on Spanish chrome                                | Every label and every error in Spanish; the venue's own name and address left exactly as returned.       |
| H7  | Search ~100 times in a day                              | "That's enough searching for one day", in the reader's language — never a provider error.                |
| H8  | Unzip the built app and grep it                         | No `maps.googleapis.com`, no key. `npx expo export` then grep the `.hbc`.                                |

## I. Places: the calendar opt-in

| #   | Do                                                             | Expect                                                                                     |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| I1  | Book a plan with a place, leave the toggle off, grant calendar | The entry has a title and a time. **No address.**                                          |
| I2  | Turn the toggle on from the Plans screen                       | Within a pass, the same entry now carries the address — no duplicate entry appears.        |
| I3  | Turn it back off                                               | The address is gone from the entry again.                                                  |
| I4  | Rename the plan, or change its place                           | The existing entry updates. It does not go stale and does not duplicate.                   |
| I5  | Remove the place entirely                                      | The entry loses its address; the plan keeps its entry.                                     |
| I6  | Do I2 on the **intimacy** app                                  | Not applicable — it passes no `calendarLocationFor`, and its entries must stay label-only. |

---

## If something here fails

A failure in **B** is the most serious: it means the app has stopped working
for someone with no key, which is the state most users are in.
`tests/guards/ai-optional.test.ts` enforces the code-level rule, but only the B
column proves the rendering.

A failure in **G** is the same class of serious, for the same reason: it means
the app has stopped working for someone with no mapping key, which is again the
state most people are in. `tests/guards/maps-optional.test.ts` enforces the
code-level rule; only the G column proves the rendering.

A failure in **C7**, **C8**, **E7**, **H8** or any row in **I** is a privacy
regression rather than a bug. Stop and fix it before anything else — **I1** and
**H8** especially: one puts a couple's whereabouts on a shared computer, the
other puts a billable key in everyone's hands.
