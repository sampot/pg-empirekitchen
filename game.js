/**
 * 總舖師傳奇 — 餐廳經營核心（純邏輯，不碰 DOM）。
 *
 * 班次內：訂單倒數、排菜出餐；班次外：研發菜色、雇人、升級廚房、展店。
 * 破產或名聲歸零即敗；資金與條件達標開第二間店即勝。
 */

export const SHIFT_SECONDS = 75;
export const START_CASH = 120;
export const EXPAND_COST = 480;
export const EXPAND_MIN_RECIPES = 4;
export const EXPAND_MIN_REP = 55;
export const EXPAND_MIN_DAYS = 5;
export const MAX_KITCHEN = 4;
export const MAX_STAFF_PER_ROLE = 6;

/** 菜色目錄：tier 愈高研發費與售價愈高。 */
export const RECIPES = [
  { id: "rice-ball", name: "飯糰", icon: "rice-ball", tier: 0, researchCost: 0, cookTime: 4, price: 12, patience: 20 },
  { id: "dim-sum", name: "點心", icon: "dim-sum", tier: 0, researchCost: 0, cookTime: 5, price: 15, patience: 22 },
  { id: "fries", name: "黃金薯", icon: "fries", tier: 1, researchCost: 30, cookTime: 5, price: 16, patience: 22 },
  { id: "burger", name: "手工堡", icon: "burger", tier: 1, researchCost: 45, cookTime: 7, price: 22, patience: 24 },
  { id: "ramen", name: "陽春麵", icon: "ramen", tier: 2, researchCost: 55, cookTime: 8, price: 26, patience: 26 },
  { id: "sushi", name: "握壽司", icon: "sushi-salmon", tier: 2, researchCost: 70, cookTime: 9, price: 32, patience: 28 },
  { id: "hotpot", name: "小火鍋", icon: "bowl-soup", tier: 3, researchCost: 90, cookTime: 11, price: 38, patience: 30 },
  { id: "steak", name: "鐵板排", icon: "steak", tier: 3, researchCost: 110, cookTime: 13, price: 48, patience: 32 },
];

export const STAFF_ROLES = {
  cook: { label: "廚師", wage: 8, hireCost: 25 },
  server: { label: "外場", wage: 6, hireCost: 18 },
};

const recipeById = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function recipe(id) {
  return recipeById[id] ?? null;
}

export function nextResearchable(unlocked) {
  return RECIPES.find((r) => !unlocked.includes(r.id) && r.researchCost > 0) ?? null;
}

export function createGame({ seed = 1 } = {}) {
  const rng = makeRng(seed);
  return {
    seed,
    rngState: Math.floor(rng() * 1e9),
    cash: START_CASH,
    day: 1,
    reputation: 62,
    phase: "plan",
    msg: "研發菜色、雇人後開始今日班次。",
    shops: [{ id: 0, name: "灶腳本店", kitchenLevel: 1 }],
    unlocked: ["rice-ball", "dim-sum"],
    staff: [
      { id: 1, role: "cook", shopId: 0 },
      { id: 2, role: "server", shopId: 0 },
    ],
    orders: [],
    shift: null,
    spawnTimer: 6,
    nextOrderId: 1,
    nextStaffId: 3,
    lifetime: { served: 0, failed: 0, revenue: 0, shifts: 0 },
    outcome: "playing",
  };
}

function clone(state) {
  return structuredClone(state);
}

function rngFrom(state) {
  const rng = makeRng(state.seed ^ state.rngState);
  const value = rng();
  state.rngState = (state.rngState + Math.floor(value * 997)) >>> 0;
  return value;
}

export function staffCount(state, role) {
  return state.staff.filter((s) => s.role === role).length;
}

export function cookCapacity(state, shopId = 0) {
  const shop = state.shops.find((s) => s.id === shopId);
  const level = shop?.kitchenLevel ?? 1;
  return Math.max(1, staffCount(state, "cook") + level - 1);
}

export function activeCooks(state) {
  return state.orders.filter((o) => o.status === "cooking").length;
}

export function cookSpeed(state, shopId = 0) {
  const shop = state.shops.find((s) => s.id === shopId);
  const bonus = 1 + (shop?.kitchenLevel ?? 1) * 0.12 + staffCount(state, "cook") * 0.04;
  return bonus;
}

export function spawnInterval(state) {
  const rep = state.reputation / 100;
  const servers = staffCount(state, "server");
  const base = 9 - rep * 3 - servers * 0.35;
  return Math.max(3.2, base);
}

export function pickRecipe(state) {
  const pool = state.unlocked;
  if (!pool.length) return "rice-ball";
  const roll = rngFrom(state);
  const weighted = pool.map((id) => {
    const r = recipe(id);
    return { id, w: 1 + (r?.tier ?? 0) * 0.35 + roll * 0.2 };
  });
  const total = weighted.reduce((n, x) => n + x.w, 0);
  let cursor = roll * total;
  for (const item of weighted) {
    cursor -= item.w;
    if (cursor <= 0) return item.id;
  }
  return pool[pool.length - 1];
}

export function spawnOrder(state) {
  const recipeId = pickRecipe(state);
  const def = recipe(recipeId);
  if (!def) return state;
  const id = state.nextOrderId++;
  const patience = def.patience + staffCount(state, "server") * 0.8;
  state.orders.push({
    id,
    recipeId,
    shopId: 0,
    status: "queued",
    patience,
    maxPatience: patience,
    cookProgress: 0,
    payment: def.price,
  });
  state.msg = `新單：${def.name}`;
  return state;
}

export function dailyWages(state) {
  return state.staff.reduce((sum, s) => sum + STAFF_ROLES[s.role].wage, 0);
}

export function checkLose(state) {
  if (state.cash < 0) {
    state.outcome = "lost";
    state.phase = "lost";
    state.msg = "資金見底，餐廳倒閉。";
    return true;
  }
  if (state.reputation <= 0) {
    state.outcome = "lost";
    state.phase = "lost";
    state.msg = "名聲掃地，沒人再上門。";
    return true;
  }
  return false;
}

export function startShift(state) {
  if (state.phase !== "plan" || state.outcome !== "playing") return state;
  const s = clone(state);
  s.phase = "shift";
  s.orders = [];
  s.spawnTimer = 4;
  s.shift = { elapsed: 0, served: 0, failed: 0, revenue: 0 };
  s.msg = "班次開始！點單排菜、完成後出餐。";
  s.lifetime.shifts += 1;
  return s;
}

export function endShift(state) {
  const s = clone(state);
  const snap = s.shift ?? { served: 0, failed: 0, revenue: 0 };
  const wages = dailyWages(s);
  s.cash -= wages;
  s.day += 1;
  s.phase = "plan";
  s.orders = [];
  s.shift = null;
  s.spawnTimer = spawnInterval(s);
  s.reputation = clamp(s.reputation - snap.failed * 2 + Math.floor(snap.served / 3), 0, 100);
  s.lifetime.served += snap.served;
  s.lifetime.failed += snap.failed;
  s.lifetime.revenue += snap.revenue;
  s.msg = wages > 0 ? `收工。今日收入 $${snap.revenue}，薪資 -$${wages}。` : "收工。整理明日菜單與人力。";
  checkLose(s);
  return s;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function step(state, dt) {
  if (state.phase !== "shift" || state.outcome !== "playing") return state;
  const s = clone(state);
  s.shift.elapsed += dt;
  s.spawnTimer -= dt;
  if (s.spawnTimer <= 0) {
    spawnOrder(s);
    s.spawnTimer = spawnInterval(s);
  }

  for (const order of s.orders) {
    if (order.status === "queued" || order.status === "cooking" || order.status === "ready") {
      order.patience -= dt;
      if (order.patience <= 0 && order.status !== "ready") {
        order.status = "expired";
        s.shift.failed += 1;
        s.reputation = clamp(s.reputation - 4, 0, 100);
        s.msg = `「${recipe(order.recipeId)?.name ?? "?"}」逾時，客人離席。`;
      }
    }
    if (order.status === "cooking") {
      const def = recipe(order.recipeId);
      order.cookProgress += dt * cookSpeed(s, order.shopId);
      if (def && order.cookProgress >= def.cookTime) {
        order.status = "ready";
        s.msg = `「${def.name}」出爐，快出餐！`;
      }
    }
  }

  s.orders = s.orders.filter((o) => o.status !== "expired" && o.status !== "done");

  if (s.shift.elapsed >= SHIFT_SECONDS) {
    const wages = dailyWages(s);
    s.cash -= wages;
    s.day += 1;
    s.phase = "plan";
    s.lifetime.served += s.shift.served;
    s.lifetime.failed += s.shift.failed;
    s.lifetime.revenue += s.shift.revenue;
    s.reputation = clamp(s.reputation + Math.floor(s.shift.served / 4) - s.shift.failed * 2, 0, 100);
    s.msg = `第 ${s.day - 1} 天收工：+$${s.shift.revenue}，薪資 -$${wages}。`;
    s.shift = null;
    s.orders = [];
    checkLose(s);
    return s;
  }

  checkLose(s);
  return s;
}

export function startCook(state, orderId) {
  if (state.phase !== "shift" || state.outcome !== "playing") return state;
  const s = clone(state);
  const order = s.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "queued") {
    s.msg = order?.status === "cooking" ? "這單已在煮。" : "只能對等候中的單排菜。";
    return s;
  }
  if (activeCooks(s) >= cookCapacity(s, order.shopId)) {
    s.msg = "爐口滿載，稍後再排。";
    return s;
  }
  order.status = "cooking";
  order.cookProgress = 0;
  const def = recipe(order.recipeId);
  s.msg = def ? `開做「${def.name}」。` : "開始料理。";
  return s;
}

export function serveOrder(state, orderId) {
  if (state.phase !== "shift" || state.outcome !== "playing") return state;
  const s = clone(state);
  const order = s.orders.find((o) => o.id === orderId);
  if (!order || order.status !== "ready") {
    s.msg = "只有出爐完成的菜才能出餐。";
    return s;
  }
  const pay = order.payment;
  s.cash += pay;
  s.shift.served += 1;
  s.shift.revenue += pay;
  s.reputation = clamp(s.reputation + 1, 0, 100);
  order.status = "done";
  s.orders = s.orders.filter((o) => o.id !== orderId);
  s.msg = `出餐 +$${pay}。`;
  return s;
}

export function researchRecipe(state) {
  if (state.phase !== "plan" || state.outcome !== "playing") return state;
  const next = nextResearchable(state.unlocked);
  if (!next) {
    const s = clone(state);
    s.msg = "菜單已全部研發。";
    return s;
  }
  if (state.cash < next.researchCost) {
    const s = clone(state);
    s.msg = `研發「${next.name}」需要 $${next.researchCost}。`;
    return s;
  }
  const s = clone(state);
  s.cash -= next.researchCost;
  s.unlocked.push(next.id);
  s.reputation = clamp(s.reputation + 2, 0, 100);
  s.msg = `研發成功：${next.name} 上架！`;
  return s;
}

export function hireStaff(state, role) {
  if (state.phase !== "plan" || state.outcome !== "playing") return state;
  const spec = STAFF_ROLES[role];
  if (!spec) return state;
  if (staffCount(state, role) >= MAX_STAFF_PER_ROLE) {
    const s = clone(state);
    s.msg = `${spec.label}已滿編。`;
    return s;
  }
  if (state.cash < spec.hireCost) {
    const s = clone(state);
    s.msg = `雇用${spec.label}需要 $${spec.hireCost}。`;
    return s;
  }
  const s = clone(state);
  s.cash -= spec.hireCost;
  s.staff.push({ id: s.nextStaffId++, role, shopId: 0 });
  s.msg = `新${spec.label}報到（日薪 $${spec.wage}）。`;
  return s;
}

export function upgradeKitchen(state, shopId = 0) {
  if (state.phase !== "plan" || state.outcome !== "playing") return state;
  const s = clone(state);
  const shop = s.shops.find((sh) => sh.id === shopId);
  if (!shop) return s;
  if (shop.kitchenLevel >= MAX_KITCHEN) {
    s.msg = "廚房已是最高等級。";
    return s;
  }
  const cost = 40 + shop.kitchenLevel * 35;
  if (s.cash < cost) {
    s.msg = `升級廚房需要 $${cost}。`;
    return s;
  }
  s.cash -= cost;
  shop.kitchenLevel += 1;
  s.msg = `廚房升到 Lv.${shop.kitchenLevel}，出餐更快。`;
  return s;
}

export function expandShop(state) {
  if (state.phase !== "plan" || state.outcome !== "playing") return state;
  const s = clone(state);
  if (s.shops.length >= 2) {
    s.outcome = "won";
    s.phase = "won";
    s.msg = "第二間分店開張，總舖師傳奇達成！";
    return s;
  }
  if (s.cash < EXPAND_COST) {
    s.msg = `展店需要 $${EXPAND_COST}。`;
    return s;
  }
  if (s.unlocked.length < EXPAND_MIN_RECIPES) {
    s.msg = `至少研發 ${EXPAND_MIN_RECIPES} 道菜（目前 ${s.unlocked.length}）。`;
    return s;
  }
  if (s.reputation < EXPAND_MIN_REP) {
    s.msg = `名聲需 ≥ ${EXPAND_MIN_REP}（目前 ${s.reputation}）。`;
    return s;
  }
  if (s.day < EXPAND_MIN_DAYS) {
    s.msg = `至少經營 ${EXPAND_MIN_DAYS} 天（目前第 ${s.day} 天）。`;
    return s;
  }
  s.cash -= EXPAND_COST;
  s.shops.push({ id: 1, name: "帝國分店", kitchenLevel: 1 });
  s.outcome = "won";
  s.phase = "won";
  s.msg = "第二間店點亮招牌，總舖師傳奇達成！";
  return s;
}

export function canExpand(state) {
  return (
    state.shops.length < 2 &&
    state.cash >= EXPAND_COST &&
    state.unlocked.length >= EXPAND_MIN_RECIPES &&
    state.reputation >= EXPAND_MIN_REP &&
    state.day >= EXPAND_MIN_DAYS
  );
}

export function summarize(state) {
  const shift = state.shift;
  return {
    cash: state.cash,
    day: state.day,
    reputation: state.reputation,
    phase: state.phase,
    outcome: state.outcome,
    msg: state.msg,
    shops: state.shops.length,
    kitchen: state.shops[0]?.kitchenLevel ?? 1,
    unlocked: state.unlocked.length,
    cooks: staffCount(state, "cook"),
    servers: staffCount(state, "server"),
    orders: state.orders.length,
    shiftElapsed: shift?.elapsed ?? 0,
    shiftServed: shift?.served ?? 0,
    shiftFailed: shift?.failed ?? 0,
    shiftRevenue: shift?.revenue ?? 0,
    nextRecipe: nextResearchable(state.unlocked),
    expandReady: canExpand(state),
    score: scoreOf(state),
  };
}

export function scoreOf(state) {
  return (
    state.lifetime.revenue +
    state.unlocked.length * 25 +
    state.shops.length * 200 +
    state.reputation * 2
  );
}

export function resetGame(state, seed = Date.now() % 99991) {
  return createGame({ seed });
}
