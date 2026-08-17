import {
  RECIPES,
  SHIFT_SECONDS,
  STAFF_ROLES,
  EXPAND_COST,
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
  resetGame,
  recipe,
} from "./game.js";
import { loadSave, saveSave, mergeMeta, EMPTY_META } from "./persist.js";
import { GameAudio } from "./audio.js";

const $ = (sel) => document.querySelector(sel);
const audio = new GameAudio();

let state = createGame({ seed: Date.now() % 99991 });
let meta = { ...EMPTY_META };
let lastFrame = 0;
let rafId = 0;
let running = false;
let saveTimer = 0;
let prevFailed = 0;

function showToast(text) {
  const el = $("#toast");
  if (el) el.textContent = text ?? state.msg;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

async function flushSave() {
  const payload = {
    state,
    meta: mergeMeta(meta, { ...state, score: scoreOf(state) }),
  };
  meta = payload.meta;
  await saveSave(payload, () => showToast("存檔同步失敗（仍可繼續玩）"));
}

function setState(next, { sfx } = {}) {
  const beforeFailed = state.shift?.failed ?? 0;
  state = next;
  if (sfx) audio[sfx]?.();
  if ((state.shift?.failed ?? 0) > beforeFailed) audio.fail();
  if (state.outcome === "won") audio.win();
  if (state.outcome === "lost") audio.lose();
  render();
  scheduleSave();
}

function stat(label, value) {
  return `<div class="stat"><small>${label}</small><b>${value}</b></div>`;
}

function renderHud(v) {
  const hud = $("#hud");
  if (!hud) return;
  hud.innerHTML = [
    stat("資金", `$${v.cash}`),
    stat("第幾天", `${v.day}`),
    stat("名聲", `${v.reputation}`),
    stat("分店", `${v.shops}`),
    stat("廚師", `${v.cooks}`),
    stat("外場", `${v.servers}`),
    stat("菜色", `${v.unlocked}/${RECIPES.length}`),
    stat("分數", `${v.score}`),
  ].join("");
}

function renderOrders() {
  const root = $("#orders");
  if (!root) return;
  root.innerHTML = "";
  if (state.phase !== "shift") {
    root.innerHTML = `<p class="order-meta">班次外：規劃人力與菜單，再按「開班」。</p>`;
    return;
  }
  if (!state.orders.length) {
    root.innerHTML = `<p class="order-meta">等待客人點餐…</p>`;
    return;
  }
  for (const order of state.orders) {
    const def = recipe(order.recipeId);
    const pct = Math.max(0, Math.min(100, (order.patience / order.maxPatience) * 100));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `order ${order.status}${pct < 35 ? " urgent" : ""}`;
    btn.innerHTML = `
      <img src="./assets/food/${def?.icon ?? "rice-ball"}.png" alt="" width="52" height="52" />
      <span class="order-body">
        <p class="order-title">${def?.name ?? "未知"} · $${order.payment}</p>
        <div class="patience"><i style="width:${pct}%"></i></div>
        <span class="order-meta">${orderLabel(order)}</span>
      </span>`;
    btn.addEventListener("click", () => onOrderTap(order.id));
    root.appendChild(btn);
  }
}

function orderLabel(order) {
  if (order.status === "queued") return "點一下排菜";
  if (order.status === "cooking") {
    const def = recipe(order.recipeId);
    const left = Math.max(0, (def?.cookTime ?? 1) - order.cookProgress);
    return `烹調中 · 約 ${left.toFixed(1)} 秒`;
  }
  if (order.status === "ready") return "點一下出餐";
  return order.status;
}

function onOrderTap(orderId) {
  if (state.phase !== "shift") return;
  const target = state.orders.find((o) => o.id === orderId);
  if (!target) return;
  if (target.status === "queued") {
    setState(startCook(state, orderId), { sfx: "cook" });
    return;
  }
  if (target.status === "ready") {
    setState(serveOrder(state, orderId), { sfx: "serve" });
  }
}

function renderPlan(v) {
  const root = $("#plan-actions");
  if (!root) return;
  root.innerHTML = "";
  const shiftBtn = mkBtn(
    state.phase === "shift" ? "班次進行中" : "開班營業",
    () => {
      if (state.phase === "shift") return;
      audio.confirm();
      setState(startShift(state));
    },
    state.phase === "shift" || state.outcome !== "playing",
  );
  shiftBtn.classList.add("primary");
  root.appendChild(shiftBtn);

  const research = v.nextRecipe;
  root.appendChild(
    mkBtn(
      research ? `研發「${research.name}」 $${research.researchCost}` : "菜單已全",
      () => setState(researchRecipe(state), { sfx: "confirm" }),
      !research || state.phase !== "plan" || state.cash < research.researchCost,
    ),
  );

  root.appendChild(
    mkBtn(`雇廚師 $${STAFF_ROLES.cook.hireCost}`, () => setState(hireStaff(state, "cook"), { sfx: "confirm" }), state.phase !== "plan"),
  );
  root.appendChild(
    mkBtn(`雇外場 $${STAFF_ROLES.server.hireCost}`, () => setState(hireStaff(state, "server"), { sfx: "confirm" }), state.phase !== "plan"),
  );

  const upCost = 40 + (state.shops[0]?.kitchenLevel ?? 1) * 35;
  root.appendChild(
    mkBtn(`升級廚房 $${upCost}`, () => setState(upgradeKitchen(state), { sfx: "confirm" }), state.phase !== "plan" || state.cash < upCost),
  );

  const expandDisabled = state.phase !== "plan" || !v.expandReady;
  root.appendChild(
    mkBtn(`展店（勝利） $${EXPAND_COST}`, () => setState(expandShop(state), { sfx: "confirm" }), expandDisabled),
  );
}

function mkBtn(label, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener("click", onClick);
  return b;
}

function renderRecipes() {
  const root = $("#recipes");
  if (!root) return;
  root.innerHTML = "";
  for (const r of RECIPES) {
    const unlocked = state.unlocked.includes(r.id);
    const div = document.createElement("div");
    div.className = `recipe${unlocked ? "" : " locked"}`;
    div.innerHTML = `<img src="./assets/food/${r.icon}.png" alt="" width="36" height="36" /><span>${r.name}${unlocked ? "" : " 🔒"}</span>`;
    root.appendChild(div);
  }
}

function renderOverlay() {
  const overlay = $("#overlay");
  if (!overlay) return;
  if (state.outcome === "playing") {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  $("#overlay-title").textContent = state.outcome === "won" ? "展店成功！" : "餐廳結束";
  $("#overlay-msg").textContent = state.msg;
}

function renderShiftTimer(v) {
  const el = $("#shift-timer");
  if (!el) return;
  if (state.phase !== "shift" || !state.shift) {
    el.textContent = "";
    return;
  }
  const left = Math.max(0, SHIFT_SECONDS - v.shiftElapsed);
  el.textContent = `剩 ${Math.ceil(left)} 秒 · 出餐 ${v.shiftServed} · 逾時 ${v.shiftFailed}`;
}

function render() {
  const v = summarize({ ...state, score: scoreOf(state) });
  renderHud(v);
  showToast(state.msg);
  renderOrders();
  renderPlan(v);
  renderRecipes();
  renderShiftTimer(v);
  renderOverlay();
}

function tick(now) {
  if (!running) return;
  if (document.visibilityState === "hidden") {
    rafId = requestAnimationFrame(tick);
    return;
  }
  if (!lastFrame) lastFrame = now;
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.phase === "shift" && state.outcome === "playing") {
    const before = state.shift?.elapsed ?? 0;
    state = step(state, dt);
    renderShiftTimer(summarize({ ...state, score: scoreOf(state) }));
    if ((state.shift?.elapsed ?? 0) < before || state.phase !== "shift" || state.outcome !== "playing") {
      if (state.outcome === "won") audio.win();
      if (state.outcome === "lost") audio.lose();
      render();
      scheduleSave();
    } else {
      renderOrders();
    }
  }
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (running) return;
  running = true;
  lastFrame = 0;
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function suspend() {
  stopLoop();
  audio.suspend();
}

function resume() {
  if ($("#play")?.hidden) return;
  startLoop();
  audio.resume();
}

async function boot() {
  await globalThis.PG.ready;
  const saved = await loadSave();
  if (saved?.state?.outcome === "playing") {
    state = saved.state;
    meta = { ...EMPTY_META, ...(saved.meta ?? {}) };
  } else if (saved?.meta) {
    meta = { ...EMPTY_META, ...saved.meta };
  }

  $("#sound-btn")?.addEventListener("click", () => {
    audio.setEnabled(!audio.enabled);
    $("#sound-btn").setAttribute("aria-pressed", String(audio.enabled));
    $("#sound-btn").textContent = audio.enabled ? "♫" : "🔇";
    audio.ui();
  });

  $("#start-btn")?.addEventListener("click", async () => {
    audio.unlock();
    audio.resumeBgm();
    $("#intro").hidden = true;
    $("#play").hidden = false;
    render();
    startLoop();
  });

  $("#overlay-btn")?.addEventListener("click", () => {
    audio.ui();
    state = resetGame(state);
    setState(state);
    renderOverlay();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") suspend();
    else resume();
  });
  window.addEventListener("pagehide", suspend);
}

boot();
