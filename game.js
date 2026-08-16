/** pg-empirekitchen — 總舖師傳奇 (料理經營生涯) */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deep(o) { return JSON.parse(JSON.stringify(o)); }


export function createGame({ seed = 1 } = {}) {
  return { seed, turn: 0, score: 0, level: 1, meter: 0, resources: 10, flags: {}, log: ["總舖師：研發／營業"], outcome: "playing", msg: "總舖師：研發／營業" };
}
export function getLegalActions(s) {
  if (s.outcome !== "playing") return [];
  return ["cook","research","hire","expand"];
}
export function applyAction(state, action) {
  const s = deep(state);
  if (s.outcome !== "playing") return s;
  const rnd = mulberry32(s.seed + s.turn * 19);
  s.turn++;
  
  s.flags.recipes = s.flags.recipes ?? 1;
  s.flags.staff = s.flags.staff ?? 1;
  s.flags.shops = s.flags.shops ?? 1;
  if (action === "cook") { s.resources += 2 * s.flags.staff * s.flags.shops; s.score += 10; s.msg = "尖峰出餐"; }
  else if (action === "research") { s.resources -= 3; s.flags.recipes++; s.meter += 15; s.msg = "新菜單"; }
  else if (action === "hire") { s.resources -= 4; s.flags.staff++; s.msg = "雇用助手"; }
  else { if (s.resources >= 8) { s.resources -= 8; s.flags.shops++; s.msg = "第二間店！"; s.meter += 30; } else s.msg = "資金不足"; }
  if (s.flags.shops >= 2 && s.flags.recipes >= 4) { s.level = 5; s.meter = 100; }

  if (s.resources < 0) s.resources = 0;
  if (s.outcome === "playing" && s.level >= 5 && s.meter >= 100) {
    s.outcome = "won";
    s.msg = "目標達成！";
  }
  if (s.outcome === "playing" && (s.resources <= 0 && s.meter < 20 && s.turn > 8)) {
    s.outcome = "lost";
    s.msg = "資源崩盤";
  }
  return s;
}
export function summarize(s) {
  return { turn: s.turn, level: s.level, meter: s.meter, score: s.score, resources: s.resources, msg: s.msg, outcome: s.outcome, flags: s.flags };
}
export function getOutcome(s) { return s.outcome; }

