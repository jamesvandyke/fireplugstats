import test from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, readableTextColor, textColorFor } from "../colors.mjs";

const PAPER = "#fffaf2";

test("a team color that already reads on the page is kept", () => {
  assert.equal(readableTextColor("#0f766e"), "#0f766e");
  assert.equal(readableTextColor("#b45309"), "#b45309");
});

test("white and pale team colors are darkened until they read on the page", () => {
  for (const color of ["#ffffff", "#fffaf2", "#fde047", "#a5f3fc"]) {
    const ink = readableTextColor(color);
    assert.notEqual(ink, color);
    assert.ok(contrastRatio(ink, PAPER) >= 4.5, `${color} -> ${ink}`);
  }
});

test("text on a team-colored background is dark on light colors and white on dark ones", () => {
  assert.equal(textColorFor("#ffffff"), "#111827");
  assert.equal(textColorFor("#0f766e"), "#ffffff");
});
