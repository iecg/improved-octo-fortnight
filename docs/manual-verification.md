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

This document is the walk that covers them. It needs a dev build, because
**neither app runs in Expo Go** (see CLAUDE.md — Expo Go segfaults in its own
binary before our JavaScript matters):

```bash
cd apps/intimacy    && npm run ios     # sections A and G
cd apps/two-two-two && npm run ios     # sections B-F and G
```

~5 min the first time, per app. Section A is the intimacy app's flow and
section B-F the 2-2-2 app's; section G needs both installed, which is the
point of it.

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
| A6  | **Refuse** calendar access, then propose    | Suggestions still appear, drawn from the app's own plans and the server's busy view. An offer to grant access, never a dead screen. |
| A7  | Reschedule a booked plan                    | The existing calendar entry **moves**. No second entry, and none left at the old time.                     |
| A8  | Grant reminders, book something 3h+ out     | A reminder fires ahead of it, in this device's language, saying nothing about the plan.                    |
| A9  | Pick each of the three rituals in turn      | Each has its own countdown on Today, and booking one resets only that one.                                 |

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

---

## G. The two apps meeting

The cross-app surface. Needs both apps installed, signed in to the same
account — the thing no suite can stand up, and a privacy surface besides.

| #   | Do                                                          | Expect                                                                                                          |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| G1  | Install the second app on a paired account                   | It finds the couple already connected, seeds its own cadences, and shows the "one account, both apps" notice once. |
| G2  | Open Two22 Settings without touching anything                | "Avoid times you are busy elsewhere" is **off**. This is the default every user starts at.                       |
| G3  | Book an evening in the intimacy app, then open Two22's booking screen | Nothing is marked. The feed is gated and the switch is still off.                                     |
| G4  | Turn the switch on, then look again                          | That evening now reads as busy — **and nothing says what it is**. No title, no kind, no notes.                   |
| G5  | Turn it back off with the booking screen still open          | The marks disappear without reopening the screen.                                                               |
| G6  | Unpair from either app                                       | Both apps return to pairing. The old invite code no longer works.                                               |

## If something here fails

A failure in **B** is the most serious: it means the app has stopped working
for someone with no key, which is the state most users are in.
`tests/guards/ai-optional.test.ts` enforces the code-level rule, but only the B
column proves the rendering.

A failure in **C7**, **C8** or **E7** is a privacy regression rather than a
bug. Stop and fix it before anything else.
