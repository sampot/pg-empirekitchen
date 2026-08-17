import { describe, it, expect } from "vitest";
import {
  RECIPES,
  SHIFT_SECONDS,
  START_CASH,
  EXPAND_COST,
  EXPAND_MIN_DAYS,
  STAFF_ROLES,
  createGame,
  step,
  startShift,
  startCook,
  serveOrder,
  researchRecipe,
  hireStaff,
  upgradeKitchen,
  expandShop,
  summarize,
  scoreOf,
  staffCount,
  cookCapacity,
  activeCooks,
  spawnInterval,
  nextResearchable,
  canExpand,
  recipe,
  makeRng,
} from "./game.js";
import { mergeMeta, EMPTY_META } from "./persist.js";

function playShift(s, seconds = SHIFT_SECONDS, dt = 0.5) {
  let cur = startShift(s);
  let elapsed = 0;
  while (elapsed < seconds && cur.phase === "shift" && cur.outcome === "playing") {
    cur = step(cur, dt);
    elapsed += dt;
  }
  return cur;
}

describe("createGame", () => {
  it("starts in planning with starter menu and staff", () => {
    const s = createGame({ seed: 42 });
    expect(s.phase).toBe("plan");
    expect(s.cash).toBe(START_CASH);
    expect(s.unlocked).toEqual(["rice-ball", "dim-sum"]);
    expect(staffCount(s, "cook")).toBe(1);
    expect(staffCount(s, "server")).toBe(1);
    expect(s.outcome).toBe("playing");
  });

  it("serializes cleanly", () => {
    expect(() => JSON.stringify(createGame({ seed: 1 }))).not.toThrow();
  });
});

describe("shift simulation", () => {
  it("spawns orders during shift", () => {
    let s = startShift(createGame({ seed: 5 }));
    s = step(s, 12);
    expect(s.orders.length).toBeGreaterThan(0);
    expect(s.shift.elapsed).toBeGreaterThan(0);
  });

  it("ends shift after duration and charges wages", () => {
    const s = createGame({ seed: 8 });
    const cashBefore = s.cash;
    const out = playShift(s);
    expect(out.phase).toBe("plan");
    expect(out.day).toBe(2);
    expect(out.cash).toBeLessThan(cashBefore);
  });

  it("spawn interval shrinks with reputation and servers", () => {
    const low = spawnInterval(createGame({ seed: 1 }));
    const rich = createGame({ seed: 2 });
    rich.reputation = 95;
    rich.staff.push({ id: 9, role: "server", shopId: 0 });
    expect(spawnInterval(rich)).toBeLessThan(low);
  });
});

describe("kitchen actions", () => {
  it("startCook moves queued order to cooking when capacity allows", () => {
    let s = startShift(createGame({ seed: 3 }));
    s = step(s, 8);
    const id = s.orders[0]?.id;
    expect(id).toBeTruthy();
    s = startCook(s, id);
    expect(s.orders[0].status).toBe("cooking");
    expect(activeCooks(s)).toBe(1);
  });

  it("blocks cooking when stations full", () => {
    let s = startShift(createGame({ seed: 11 }));
    s = step(s, 20);
    const ids = s.orders.filter((o) => o.status === "queued").map((o) => o.id);
    for (const id of ids) s = startCook(s, id);
    const cap = cookCapacity(s);
    expect(activeCooks(s)).toBeLessThanOrEqual(cap);
    if (ids.length > cap) {
      const extra = s.orders.find((o) => o.id === ids[cap]);
      expect(["queued", "cooking"]).toContain(extra?.status);
    }
  });

  it("serveOrder pays cash and clears ready ticket", () => {
    let s = startShift(createGame({ seed: 4 }));
    s = step(s, 6);
    const id = s.orders[0].id;
    s = startCook(s, id);
    const def = recipe(s.orders[0].recipeId);
    s = step(s, def.cookTime + 2);
    const cash = s.cash;
    s = serveOrder(s, id);
    expect(s.cash).toBeGreaterThan(cash);
    expect(s.shift.served).toBe(1);
    expect(s.orders.find((o) => o.id === id)).toBeUndefined();
  });

  it("expired orders hurt reputation", () => {
    let s = startShift(createGame({ seed: 6 }));
    s = step(s, 6);
    const id = s.orders[0].id;
    const def = recipe(s.orders[0].recipeId);
    const rep = s.reputation;
    s = step(s, def.patience + 5);
    expect(s.reputation).toBeLessThan(rep);
    expect(s.shift.failed).toBeGreaterThan(0);
  });
});

describe("management", () => {
  it("researchRecipe unlocks next tier for a cost", () => {
    const s = createGame({ seed: 1 });
    const next = nextResearchable(s.unlocked);
    const out = researchRecipe(s);
    expect(out.unlocked).toContain(next.id);
    expect(out.cash).toBe(s.cash - next.researchCost);
  });

  it("researchRecipe refuses when broke", () => {
    const s = createGame({ seed: 1 });
    s.cash = 0;
    const count = s.unlocked.length;
    const out = researchRecipe(s);
    expect(out.unlocked.length).toBe(count);
    expect(out.msg).toMatch(/需要/);
  });

  it("hireStaff adds staff and costs hire fee", () => {
    const s = createGame({ seed: 2 });
    const cash = s.cash;
    const out = hireStaff(s, "cook");
    expect(staffCount(out, "cook")).toBe(2);
    expect(out.cash).toBe(cash - STAFF_ROLES.cook.hireCost);
  });

  it("upgradeKitchen increases level until cap", () => {
    let s = createGame({ seed: 2 });
    s.cash = 500;
    s = upgradeKitchen(s);
    expect(s.shops[0].kitchenLevel).toBe(2);
    s.shops[0].kitchenLevel = 4;
    const out = upgradeKitchen(s);
    expect(out.shops[0].kitchenLevel).toBe(4);
    expect(out.msg).toMatch(/最高/);
  });

  it("expandShop wins when requirements met", () => {
    let s = createGame({ seed: 99 });
    s.cash = EXPAND_COST + 100;
    s.day = 6;
    s.reputation = 80;
    s.unlocked = RECIPES.slice(0, 4).map((r) => r.id);
    s = expandShop(s);
    expect(s.outcome).toBe("won");
    expect(s.shops.length).toBe(2);
  });

  it("expandShop blocked without enough recipes", () => {
    const s = createGame({ seed: 1 });
    s.cash = 999;
    s.day = 10;
    s.reputation = 90;
    const out = expandShop(s);
    expect(out.outcome).toBe("playing");
    expect(out.msg).toMatch(/至少研發/);
  });

  it("canExpand reflects all gates", () => {
    let s = createGame({ seed: 1 });
    expect(canExpand(s)).toBe(false);
    s.cash = EXPAND_COST;
    s.day = EXPAND_MIN_DAYS;
    s.reputation = 60;
    s.unlocked = RECIPES.slice(0, 4).map((r) => r.id);
    expect(canExpand(s)).toBe(true);
  });
});

describe("lose conditions", () => {
  it("bankruptcy ends the run", () => {
    let s = createGame({ seed: 1 });
    s.cash = -1;
    s = startShift(s);
    s = step(s, 0.1);
    expect(s.outcome).toBe("lost");
  });

  it("zero reputation ends the run", () => {
    let s = startShift(createGame({ seed: 12 }));
    s.reputation = 1;
    for (let i = 0; i < 8; i++) {
      s = step(s, 8);
      for (const o of [...s.orders]) {
        if (o.status === "queued") s = startCook(s, o.id);
      }
      s = step(s, 40);
    }
    if (s.reputation <= 0) expect(s.outcome).toBe("lost");
  });
});

describe("summarize & persist", () => {
  it("summarize exposes HUD fields", () => {
    const v = summarize(createGame({ seed: 7 }));
    expect(v.cash).toBe(START_CASH);
    expect(v.unlocked).toBe(2);
    expect(v.nextRecipe).toBeTruthy();
  });

  it("scoreOf grows with progress", () => {
    const a = scoreOf(createGame({ seed: 1 }));
    let s = createGame({ seed: 1 });
    s.lifetime.revenue = 200;
    s.unlocked = RECIPES.map((r) => r.id);
    const b = scoreOf(s);
    expect(b).toBeGreaterThan(a);
  });

  it("mergeMeta tracks best score", () => {
    const meta = mergeMeta(EMPTY_META, { outcome: "won", score: 500 });
    expect(meta.bestScore).toBe(500);
    expect(meta.wins).toBe(1);
  });
});

describe("rng", () => {
  it("makeRng is deterministic", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });
});
