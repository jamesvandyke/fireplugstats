import test, { mock } from "node:test";
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
  abort() { this.aborted = true; }
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

test("a release Safari never ends is finished anyway, and the next press works", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { listener, log, current } = setup();
    listener.start();
    current().say("start clock");
    listener.stop();
    // No end event arrives.
    mock.timers.tick(1200);
    assert.deepEqual(log.texts, ["start clock"]);
    assert.equal(FakeRecognition.instances[0].aborted, true);
    listener.start();
    assert.equal(FakeRecognition.instances.length, 2);
    current().say("foul gold 23");
    listener.stop();
    current().end();
    assert.deepEqual(log.texts, ["start clock", "foul gold 23"]);
    // The late timer for the second press does nothing more.
    mock.timers.tick(1200);
    assert.deepEqual(log.texts, ["start clock", "foul gold 23"]);
  } finally {
    mock.timers.reset();
  }
});

test("pressing again before the last session ends starts fresh without losing words", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { listener, log, current } = setup();
    listener.start();
    current().say("score white 32");
    listener.stop();
    listener.start();
    assert.deepEqual(log.texts, ["score white 32"]);
    assert.equal(FakeRecognition.instances.length, 2);
    // The old session's late end event is ignored.
    FakeRecognition.instances[0].end();
    current().say("steal white 5");
    listener.stop();
    current().end();
    assert.deepEqual(log.texts, ["score white 32", "steal white 5"]);
    assert.deepEqual(log.errors, []);
  } finally {
    mock.timers.reset();
  }
});

test("a recognizer that refuses to start is reported", () => {
  const { listener, log } = setup();
  FakeRecognition.prototype.start = function () { throw new Error("busy"); };
  try {
    listener.start();
    assert.deepEqual(log.errors, ["start-failed"]);
    assert.deepEqual(log.states, [false]);
  } finally {
    FakeRecognition.prototype.start = function () { this.started = true; };
  }
});
