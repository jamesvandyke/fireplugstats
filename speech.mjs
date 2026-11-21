// Hold-to-talk speech recognition with the browser's built-in engine
// (Safari on iPhone uses Apple's speech service). start() when the button is
// pressed, stop() when it's let go; onText gets everything said in between.
//
// Each press gets a fresh recognizer. Safari on iPhone doesn't always report
// the end of a session after stop(), so a release that hasn't ended within
// FINISH_AFTER_MS is finished by hand, and a new press never waits on an old
// session.

export const FINISH_AFTER_MS = 1200;

function Recognition() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
}

export function speechSupported() {
  return Boolean(Recognition());
}

export function createVoiceListener({ onText, onInterim, onError, onState }) {
  let session = null;
  let holding = false;

  function finish(current, { quiet = false } = {}) {
    if (current.done) return;
    current.done = true;
    clearTimeout(current.timer);
    if (session === current) session = null;
    if (current.heard) onText(current.heard);
    else if (!quiet && !current.failed && !holding) onError?.("no-speech");
    // Safari can end a session on its own; keep listening while the button is held.
    if (holding && !current.failed && !session) begin();
    else if (!session) onState?.(false);
  }

  function begin() {
    const SpeechRecognition = Recognition();
    const recognition = new SpeechRecognition();
    const current = { recognition, heard: "", failed: false, done: false, timer: null };
    session = current;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    // Each result event carries everything this session has heard so far.
    recognition.onresult = (event) => {
      current.heard = [...event.results].map((result) => result[0].transcript).join(" ").replace(/\s+/g, " ").trim();
      if (!current.done) onInterim?.(current.heard);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || current.done) return;
      current.failed = true;
      onError?.(event.error);
    };
    recognition.onend = () => finish(current);
    try {
      recognition.start();
    } catch (error) {
      current.failed = true;
      onError?.(error?.name === "NotAllowedError" ? "not-allowed" : "start-failed");
      finish(current, { quiet: true });
      return;
    }
    onState?.(true);
  }

  return {
    start() {
      // A session still winding down from the last press is wrapped up now.
      if (session) {
        const old = session;
        holding = false;
        try { old.recognition.abort(); } catch { /* already stopped */ }
        finish(old, { quiet: true });
      }
      holding = true;
      begin();
    },
    stop() {
      holding = false;
      const current = session;
      if (!current) return;
      try { current.recognition.stop(); } catch { /* already stopped */ }
      current.timer = setTimeout(() => {
        try { current.recognition.abort(); } catch { /* already stopped */ }
        finish(current);
      }, FINISH_AFTER_MS);
    },
  };
}
