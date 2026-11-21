import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceListener, speechSupported } from "../speech.mjs";

// A stand-in for Safari's webkitSpeechRecognition that the test drives by hand.
class FakeRecognition {
  static instances = [];
  constructor() {
    FakeRecognition.instances.push(this);
    this.started = false;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  say(...phrases) {
    this.onresult({ results: phrases.map((transcript) => [{ transcript }]) });
  }
  end() { this.onend(); }
}

function setup() {
  FakeRecognition.instances = [];
  globalThis.webkitSpeechRecognition = FakeRecognition;
  const log = { texts: [], errors: [], states: [], interim: [] };
  const listener = createVoiceListener({
    onText: (text) => log.texts.push(text),
    onInterim: (text) => log.interim.push(text),
    onError: (code) => log.errors.push(code),
    onState: (on) => log.states.push(on),
  });
  return { listener, log, current: () => FakeRecognition.instances.at(-1) };
}

test("support follows the browser", () => {
  delete globalThis.webkitSpeechRecognition;
  assert.equal(speechSupported(), false);
  globalThis.webkitSpeechRecognition = FakeRecognition;
  assert.equal(speechSupported(), true);
});

test("everything said while holding is handed over on release", () => {
  const { listener, log, current } = setup();
  listener.start();
  assert.equal(current().continuous, true);
  current().say("score white", " 32");
  current().say("score white", " 32", " rebound black 4");
  listener.stop();
  assert.equal(current().stopped, true);
  current().end();
  assert.deepEqual(log.texts, ["score white 32 rebound black 4"]);
  assert.deepEqual(log.interim, ["score white 32", "score white 32 rebound black 4"]);
  assert.deepEqual(log.states, [true, false]);
});

test("a session Safari ends on its own restarts while still held", () => {
  const { listener, log, current } = setup();
  listener.start();
  current().say("foul gold 23");
  current().end();
  assert.equal(FakeRecognition.instances.length, 2);
  assert.deepEqual(log.texts, ["foul gold 23"]);
  current().say("steal white 5");
  listener.stop();
  current().end();
  assert.deepEqual(log.texts, ["foul gold 23", "steal white 5"]);
  assert.deepEqual(log.states, [true, true, false]);
});

test("silence and blocked permission are reported", () => {
  const quiet = setup();
  quiet.listener.start();
  quiet.listener.stop();
  quiet.current().end();
  assert.deepEqual(quiet.log.errors, ["no-speech"]);

  const blocked = setup();
  blocked.listener.start();
  blocked.current().onerror({ error: "not-allowed" });
  blocked.current().end();
  assert.deepEqual(blocked.log.errors, ["not-allowed"]);
  assert.equal(FakeRecognition.instances.length, 1);
});
