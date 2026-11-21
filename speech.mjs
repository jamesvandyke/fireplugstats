// Hold-to-talk speech recognition with the browser's built-in engine
// (Safari on iPhone uses Apple's speech service). start() when the button is
// pressed, stop() when it's let go; onText gets everything said in between.

function Recognition() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
}

export function speechSupported() {
  return Boolean(Recognition());
}

export function createVoiceListener({ onText, onInterim, onError, onState }) {
  let recognition = null;
  let holding = false;
  let heard = "";
  let failed = false;

  function begin() {
    const SpeechRecognition = Recognition();
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    heard = "";
    failed = false;

    // In continuous mode each result event carries everything said so far.
    recognition.onresult = (event) => {
      heard = [...event.results].map((result) => result[0].transcript).join(" ").replace(/\s+/g, " ").trim();
      onInterim?.(heard);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      failed = true;
      onError?.(event.error);
    };
    recognition.onend = () => {
      const text = heard;
      recognition = null;
      if (text) onText(text);
      else if (!failed && !holding) onError?.("no-speech");
      // Safari can end a session on its own; keep listening while the button is held.
      if (holding && !failed) begin();
      else onState?.(false);
    };
    recognition.start();
    onState?.(true);
  }

  return {
    start() {
      holding = true;
      if (!recognition) begin();
    },
    stop() {
      holding = false;
      recognition?.stop();
    },
  };
}
