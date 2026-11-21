// Hold-to-talk speech recognition with the browser's built-in engine
// (Safari on iPhone uses Apple's speech service).
//
// Safari on iPhone only delivers words for the first recognition session on a
// page: later sessions start ("listening") but never report results. So one
// recognizer is started on the first press and left running, and the button
// only marks which words count: those heard between press and release (plus
// TAIL_MS after release, for words still being finalized). Anything heard while
// the button is up is ignored. If the engine stops on its own it is restarted
// on the next press (or right away while the button is held).

export const TAIL_MS = 900;

function Recognition() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
}

export function speechSupported() {
  return Boolean(Recognition());
}

function words(text) {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

export function createVoiceListener({ onText, onInterim, onError, onState, onDebug }) {
  const log = (message) => onDebug?.(message);
  let recognition = null;
  let running = false;
  let holding = false;
  let heard = []; // every word the current engine session has heard
  let baseline = 0; // how many of those were heard before this press
  let carried = []; // words from this press heard by an earlier engine session
  let tail = null; // timer that finishes a release

  const pressWords = () => [...carried, ...heard.slice(baseline)];
  const active = () => holding || tail !== null;

  function engine() {
    if (recognition) return recognition;
    const SpeechRecognition = Recognition();
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    for (const name of ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"]) {
      recognition.addEventListener?.(name, () => log(name));
    }
    // Each result event carries everything this session has heard so far.
    recognition.onresult = (event) => {
      heard = words([...event.results].map((result) => result[0].transcript).join(" "));
      log(`result ${event.results.length}${active() ? "" : " (ignored, button up)"} "${heard.join(" ")}"`);
      if (active()) onInterim?.(pressWords().join(" "));
    };
    recognition.onerror = (event) => {
      log(`error ${event.error}`);
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (active() || ["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) onError?.(event.error);
    };
    recognition.onend = () => {
      log("end");
      running = false;
      if (active()) carried = pressWords();
      heard = [];
      baseline = 0;
      if (holding) run();
    };
    return recognition;
  }

  function run() {
    try {
      engine().start();
      running = true;
      log("start() called");
    } catch (error) {
      log(`start() threw ${error?.name || error}`);
      // Already running is fine; anything else means no mic.
      if (error?.name === "InvalidStateError") running = true;
      else {
        holding = false;
        onState?.(false);
        onError?.(error?.name === "NotAllowedError" ? "not-allowed" : "start-failed");
      }
    }
  }

  function finishPress() {
    clearTimeout(tail);
    tail = null;
    const text = pressWords().join(" ");
    carried = [];
    baseline = heard.length;
    onState?.(false);
    if (text) onText(text);
    else onError?.("no-speech");
  }

  return {
    start() {
      if (tail !== null) finishPress();
      holding = true;
      carried = [];
      baseline = heard.length;
      onState?.(true);
      if (!running) run();
    },
    stop() {
      if (!holding) return;
      holding = false;
      tail = setTimeout(finishPress, TAIL_MS);
    },
    // Turns the mic off, e.g. when the page is hidden; the next press starts it again.
    shutdown() {
      if (!recognition || !running) return;
      log("shutdown");
      try { recognition.abort(); } catch { /* already stopped */ }
    },
  };
}
