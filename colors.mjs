// Team color helpers. Shared by the summary page and the tests.

const PAPER = "#fffaf2";

function rgb(color) {
  const hex = String(color).replace(/[^0-9a-f]/gi, "").slice(0, 6).padEnd(6, "0");
  return [0, 2, 4].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

function hex(channels) {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(channels) {
  const [r, g, b] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [light, dark] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Dark or white text, whichever reads on a team-colored background.
export function textColorFor(background) {
  const [r, g, b] = rgb(background);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111827" : "#ffffff";
}

// The team color, darkened just enough to read as text on the page. A white or
// pale team color becomes a gray or deeper shade of itself.
export function readableTextColor(color, background = PAPER, minRatio = 4.5) {
  let channels = rgb(color);
  while (contrastRatio(hex(channels), background) < minRatio && channels.some((value) => value > 0)) {
    channels = channels.map((value) => value * 0.9);
  }
  return hex(channels);
}
