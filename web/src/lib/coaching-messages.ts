const ENCOURAGEMENT_TEMPLATES = [
  "Looking better, {name}!",
  "Great adjustment, {name}.",
  "Nice correction, {name}!",
  "That's it, {name}! Much better form.",
  "Good work fixing that, {name}.",
  "You're improving, {name}! Keep it up.",
  "Excellent adjustment, {name}!",
  "Way to go, {name}!",
];

export function pickEncouragementLine(fullName: string): string {
  const firstName = fullName.split(" ")[0] || fullName;
  const idx = Math.floor(Math.random() * ENCOURAGEMENT_TEMPLATES.length);
  return ENCOURAGEMENT_TEMPLATES[idx].replace("{name}", firstName);
}

export interface DivergenceForPrompt {
  side: string;
  part: string;
  delta_x: number;
  delta_y: number;
  distance: number;
}

export function formatDivergencesForPrompt(divergences: DivergenceForPrompt[]): string {
  const top = divergences
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 3);

  return top
    .map((d) => {
      const dirs: string[] = [];
      if (Math.abs(d.delta_x) > 0.03) dirs.push(`${d.delta_x > 0 ? "right" : "left"} by ${Math.abs(d.delta_x).toFixed(2)}`);
      if (Math.abs(d.delta_y) > 0.03) dirs.push(`${d.delta_y > 0 ? "down" : "up"} by ${Math.abs(d.delta_y).toFixed(2)}`);
      const direction = dirs.length > 0 ? dirs.join(", ") : `off by ${d.distance.toFixed(2)}`;
      return `${d.side} ${d.part}: ${direction}`;
    })
    .join("; ");
}
