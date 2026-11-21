# Voice input plan

Status: draft for review, updated 2026-11-21 with James's answers. No code yet.

Target device: iPhone 16, Safari (home screen or tab both fine). Hold-to-talk. Teams are named by jersey color.

## Goal

Let the scorekeeper log plays by talking instead of tapping, for example:

> "score white 32", "miss black 4", "rebound green 17", "foul gold 23", "steal blue 5", "timeout", "start clock"

When the spoken play is a shot, the app shows the half court so the scorekeeper can tap where it was taken, the same way a shot is logged today.

Voice is an extra way in, not a replacement. Every voice command ends up calling the same code the buttons call (`saveDraft`, `saveRebound`, `saveSub`, `toggleClock`), so stats, the box score, live links, undo and saved games keep working with no changes to the event format, apart from the new timeout event below.

## How it works for the scorekeeper

1. A mic button sits in the scorebar next to the clock. Hold it while talking and let go when done (hold-to-talk). It glows while the mic is on. One hold can hold several plays ("rebound green 17, foul gold 23").
2. Each phrase is turned into a command and shown in a banner under the scorebar, such as "Made shot, White #32 (Paige)". If a phrase can't be understood, the banner shows what was heard in red and nothing is logged.
3. Plays that don't need a location (rebound, foul, steal, timeout, clock) are saved right away. The banner gives a few seconds to tap Undo, and saying "undo" works too.
4. Every field goal needs a tap on the court. Shots open the Location step on the half court with the player and result already filled in, and a label on top of the court says which shot the tap is for, such as "Tap for: White #32, made".
   - "score white 32": tap the court, and points (2 or 3) come from the spot, exactly as today. Saved on tap.
   - "miss black 4": tap the court, then the Rebound step opens as it does now. Saying "rebound green 17" (or tapping) finishes it; "no rebound" skips it.
   - "free throw white 32 made/missed" skips the court entirely.
5. Shots stack. If more shots are said before the court is tapped, they wait in a queue. The label shows the shot the next tap is for plus a count ("2 more waiting"), and each tap places the oldest waiting shot. Plays that don't need a location (rebound, foul, timeout and so on) save immediately and are not held up by the queue, but they keep the game time they were said at, so the play-by-play stays in order.
   - A rebound said while its missed shot is still waiting for a tap is attached to that miss when the miss is placed.
   - A waiting shot can be dropped with an X on the label or by saying "cancel".

## Commands (first version)

| Say | Does |
| --- | --- |
| score / made / bucket `<team> <number>` [three / two] | Made field goal, opens the court |
| miss / missed `<team> <number>` | Missed field goal, opens the court, then rebound |
| free throw `<team> <number>` made / missed | Free throw, no court |
| rebound / board `<team> <number>` | Rebound (attaches to the pending miss if there is one) |
| no rebound / skip | Skip the pending rebound |
| foul `<team> <number>` | Foul |
| steal `<team> <number>` | Steal |
| sub `<team> <in number>` for `<out number>` | Substitution |
| timeout `<team>` | Team timeout (new event, see below) |
| ref timeout / official timeout | Official's timeout, no team |
| start clock / stop clock / clock | Start, stop or toggle the clock |
| undo | Undo the last play |

Word order is forgiving: "white 32 score" and "score 32 white" parse the same.

## Naming teams by voice

Games store each team's name and a hex color, and the examples use color words ("white", "gold"). A team can be named three ways, in this order:

1. Its team name ("Hornets", "Fireplugs"), matched loosely.
2. "home" / "away".
3. A color word. Each team's hex color is matched to the nearest common color name (white, black, gray, red, orange, gold/yellow, green, teal, blue, navy, purple, maroon, pink). If both teams land on the same color name, color words are turned off for that game and the banner says to use names.

If a team is left out ("score 32"), the app uses the only team with #32 on the court. If both have a #32, it asks which.

Later, if colors don't match what kids call their jerseys, Manage Teams can get an optional "Voice name" field per team. Not in the first version.

## Hearing numbers

Speech engines return numbers as digits ("32"), words ("thirty two") or homophones ("for", "to", "too", "won", "ate"). The parser normalizes all of these, and anything after a team word is checked against that team's roster. A number not on the roster is rejected rather than guessed, and the banner shows the roster numbers that sound closest. Numbers like 0 and 00 ("zero", "oh", "double oh") are handled.

## Speech engine

**Recommended: the browser's built-in Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).**

- Free, no server changes, no API keys, works over the app's existing HTTPS.
- Supported in Safari on iPhone/iPad (uses Apple's speech service, needs a network connection) and Chrome on Android and desktop. Not in Firefox.
- Continuous listening with interim results, so the banner can show words as they're said.
- The mic button is hidden on browsers without support.

Known risks to test early on a real phone in a gym:

- iOS has been unreliable with speech recognition in home-screen (standalone) PWAs. If it fails there, the fallback is using the site in a Safari tab during games.
- Hold-to-talk keeps each recording short, which avoids iOS cutting recognition off after silence and keeps crowd noise out between plays.
- On iOS, recognition only gets the final words a moment after the button is released, so the banner may lag by about a second.
- Gym noise and the crowd yelling numbers.

**Fallback if Web Speech isn't good enough:** record short clips and send them to a cloud transcription service from `server.js`. That adds cost, an API key on DigitalOcean and latency, so it's only worth doing if phase 1 testing shows the built-in engine can't keep up.

## Code changes

- `voice.mjs` (new): pure parser, `parseCommand(text, game) -> command | { error }`. Holds the number normalizer, the color-name table, and team/roster matching. No DOM, so it can be tested with `node --test`.
- `voice-ui` part of `app.js` (or a small `voice-controller.mjs`): owns the `SpeechRecognition` instance, the mic button and banner, and maps each command onto the existing draft/step functions.
- `app.js`: small refactors so voice and taps share code, e.g. `beginShot(team, player, made)` that fills `draft` and calls `setStep("location")`; a pending-shot queue with the "Tap for" label on the court; a timeout event.
- New timeout event: `{ action: "timeout", team: "Hornets" | "Opponent" | null, period, time }` with no player; `team: null` is an official's timeout. Tap users get Timeout and Ref Timeout buttons too. `actionText` and the play list in `app.js` and `watch.js` need to handle a missing player (right now `playerLabel` assumes one). Box score and summary ignore it. Timeouts also stop the clock.
- `index.html` / `styles.css`: mic button, banner, "Tap for" label and queue count on the court. Bump the `styles.css`, `app.js` and `sw.js` cache versions and add `voice.mjs` to the service worker's asset list.
- `test/voice.test.mjs`: table-driven tests for every example phrase, number homophones, color matching (including pale and near-identical colors), word order, and rejection of numbers not on the roster.

## Phases

1. **Parser and tests.** `voice.mjs` and its tests only. A hidden text box on the Track tab (`?voice=text`) lets us type commands to try the flow on any browser.
2. **Mic and banner.** Web Speech wiring, mic button, banner with undo, no-location commands (rebound, foul, steal, timeout, clock, undo). Test on James's phone at a practice or a game.
3. **Shots.** Score/miss opening the court, the "Tap for" label, stacked shots, the miss to rebound hand-off, free throws.
4. **Polish from real use.** Optional voice names in Manage Teams, extra synonyms from what the engine actually hears.

Each phase is its own PR off this branch, merged only when James says so.

## Decisions (from James, 2026-11-21)

1. Device: iPhone 16 in Safari; home screen or tab are both fine, so whichever works better wins.
2. Hold-to-talk.
3. Timeouts belong to a team, plus an official's timeout with no team.
4. Teams are named by jersey color.
5. Every field goal requires a tap; shots can stack, and the court shows which shot the tap is for.
