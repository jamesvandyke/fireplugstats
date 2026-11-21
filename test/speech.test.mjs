import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createVoiceListener, speechSupported, TAIL_MS } from "../speech.mjs";

// A stand-in for Safari's webkitSpeechRecognition that the test drives by hand.
// Like Safari's, its results are cumulative for the whole session.
class FakeRecognition {
  static instances = [];
  constructor() {
    FakeRecognition.instances.push(this);
    this.starts = 0;
    this.running = false;
    this.transcripts = [];
  }
  start() {
    if (this.running) {
      const error = new Error("already started");
      error.name = "InvalidStateError";
      throw error;
    }
    this.running = true;
    this.starts += 1;
    this.transcripts = [];
  }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; this.end(); }
  hear(text) {
    this.transcripts.push(text);
    this.onresult({ results: this.transcripts.map((transcript) => [{ transcript }]) });
  }
  // Revises the last result, as interim results do.
  revise(text) {
    this.transcripts[this.transcripts.length - 1] = text;
    this.onresult({ results: this.transcripts.map((transcript) => [{ transcript }]) });
  }
  end() {
    this.running = false;
    this.onend();
  }
}

function setup() {
  FakeRecognition.instances = [];
  globalThis.webkitSpeechRecognition = FakeRecognition;
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  const log = { texts: [], errors: [], states: [], interim: [] };
  const listener = createVoiceListener({
    onText: (text) => log.texts.push(text),
    onInterim: (text) => log.interim.push(text),
    onError: (code) => log.errors.push(code),
    onState: (on) => log.states.push(on),
  });
  const engine = () => FakeRecognition.instances[0];
  const release = () => { listener.stop(); mock.timers.tick(TAIL_MS); };
  return { listener, log, engine, release };
}

test.afterEach(() => mock.timers.reset());

test("support follows the browser", () => {
  delete globalThis.webkitSpeechRecognition;
  assert.equal(speechSupported(), false);
  globalThis.webkitSpeechRecognition = FakeRecognition;
  assert.equal(speechSupported(), true);
});

test("one engine serves every press, and only words said while held count", () => {
  const { listener, log, engine, release } = setup();
  listener.start();
  engine().hear("start clock");
  release();
  engine().hear("crowd noise number twelve");
  listener.start();
  engine().hear("foul gold 23");
  release();
  listener.start();
  engine().hear("steal white 5");
  release();
  assert.deepEqual(log.texts, ["start clock", "foul gold 23", "steal white 5"]);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(engine().starts, 1);
  assert.equal(engine().stopped, undefined);
  assert.deepEqual(log.errors, []);
});

test("words finalized just after release still count", () => {
  const { listener, log, engine } = setup();
  listener.start();
  engine().hear("score white");
  listener.stop();
  engine().revise("score white 32");
  mock.timers.tick(TAIL_MS);
  assert.deepEqual(log.texts, ["score white 32"]);
  assert.deepEqual(log.states, [true, false]);
});

test("a press during the last one's tail finishes it first", () => {
  const { listener, log, engine } = setup();
  listener.start();
  engine().hear("miss black 4");
  listener.stop();
  listener.start();
  engine().hear("rebound white 17");
  listener.stop();
  mock.timers.tick(TAIL_MS);
  assert.deepEqual(log.texts, ["miss black 4", "rebound white 17"]);
});

test("an engine that stops on its own restarts on the next press", () => {
  const { listener, log, engine, release } = setup();
  listener.start();
  engine().hear("start clock");
  release();
  engine().end();
  listener.start();
  assert.equal(engine().starts, 2);
  engine().hear("timeout white");
  release();
  assert.deepEqual(log.texts, ["start clock", "timeout white"]);
});

test("an engine that stops while held restarts and keeps the words", () => {
  const { listener, log, engine, release } = setup();
  listener.start();
  engine().hear("foul gold 23");
  engine().end();
  assert.equal(engine().starts, 2);
  engine().hear("steal white 5");
  release();
  assert.deepEqual(log.texts, ["foul gold 23 steal white 5"]);
});

test("silence and blocked permission are reported", () => {
  const quiet = setup();
  quiet.listener.start();
  quiet.release();
  assert.deepEqual(quiet.log.errors, ["no-speech"]);

  const blocked = setup();
  blocked.listener.start();
  blocked.engine().onerror({ error: "not-allowed" });
  assert.deepEqual(blocked.log.errors, ["not-allowed"]);
});

test("a recognizer that refuses to start is reported", () => {
  const { listener, log } = setup();
  const original = FakeRecognition.prototype.start;
  FakeRecognition.prototype.start = function () { throw new Error("busy"); };
  try {
    listener.start();
    assert.deepEqual(log.errors, ["start-failed"]);
    assert.deepEqual(log.states, [true, false]);
  } finally {
    FakeRecognition.prototype.start = original;
  }
});

test("shutdown turns the mic off until the next press", () => {
  const { listener, log, engine, release } = setup();
  listener.start();
  engine().hear("start clock");
  release();
  listener.shutdown();
  assert.equal(engine().aborted, true);
  listener.start();
  assert.equal(engine().starts, 2);
  engine().hear("stop clock");
  release();
  assert.deepEqual(log.texts, ["start clock", "stop clock"]);
});
