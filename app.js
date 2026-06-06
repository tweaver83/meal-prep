(function(){
const { AISLES, CATEGORY_META } = window.__DATA__;
const MEALS = window.__DATA__.MEALS.slice(); // mutable — custom recipes appended
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STORAGE_KEY = "mealprep:v1";
const RECIPES_KEY = "mealprep:customRecipes:v1";
const AISLE_OPTIONS = Object.keys(AISLES);
const PALETTE = [
  "from-emerald-200 to-teal-200",
  "from-amber-200 to-rose-200",
  "from-sky-200 to-indigo-200",
  "from-orange-200 to-red-200",
  "from-lime-200 to-emerald-200",
  "from-fuchsia-200 to-pink-200",
];

// ───────────────────── State ─────────────────────
const state = {
  page: "browse",            // "browse" | "schedule" | "shopping"
  filter: "all",             // "all" | "vegan" | "high-protein" | "standard"
  // picks: array of { mealId, day } — day optional (null until scheduled)
  picks: [],
  checkedIngredients: {},    // key: `${aisle}::${name}` -> bool
  detailMealId: null,
  editingRecipe: null, // draft object while the editor is open
};

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    picks: state.picks,
    checkedIngredients: state.checkedIngredients,
  }));
}
function saveCustomRecipes() {
  const custom = MEALS.filter((m) => m.custom);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(custom));
}
function load() {
  try {
    const rawRecipes = localStorage.getItem(RECIPES_KEY);
    if (rawRecipes) {
      const custom = JSON.parse(rawRecipes);
      custom.forEach((m) => { if (!MEALS.find((x) => x.id === m.id)) MEALS.push(m); });
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.picks = (data.picks || []).map((p) => ({
      mealId: p.mealId,
      day: p.day ?? null,
      slot: typeof p.slot === "number" ? p.slot : (p.day ? 0 : null),
      leftover: !!p.leftover,
      generated: !!p.generated,
    }));
    state.checkedIngredients = data.checkedIngredients || {};
  } catch {}
}

// ───────────────────── Helpers ─────────────────────
const mealById = (id) => MEALS.find((m) => m.id === id);
const isPicked = (id) => state.picks.some((p) => p.mealId === id);
function togglePick(id) {
  if (isPicked(id)) {
    state.picks = state.picks.filter((p) => p.mealId !== id);
  } else {
    state.picks.push({ mealId: id, day: null, slot: null, leftover: false, generated: false });
  }
  save();
  render();
}

const SLOT_LABELS = { 0: "Tim", 1: "Jess" };
const EAT_OUT_DAY = "Fri";

function suggestions() {
  // Surface meals not yet picked, balanced across categories the user
  // currently picks less of. Returns up to 3 meals.
  const pickedIds = new Set(state.picks.map((p) => p.mealId));
  const counts = { vegan: 0, "high-protein": 0, standard: 0 };
  state.picks.forEach((p) => {
    const m = mealById(p.mealId);
    if (!m) return;
    m.categories.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
  });
  const min = Math.min(counts.vegan, counts["high-protein"], counts.standard);
  const underCats = Object.keys(counts).filter((c) => counts[c] === min);
  const candidates = MEALS.filter((m) => !pickedIds.has(m.id));
  const scored = candidates
    .map((m) => ({ m, score: m.categories.filter((c) => underCats.includes(c)).length }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.m);
}

function shoppingList() {
  const agg = {}; // key: aisle -> { key: {name, unit, qty} }
  state.picks.filter((p) => !p.generated).forEach((pick) => {
    const meal = mealById(pick.mealId);
    if (!meal) return;
    meal.ingredients.forEach((ing) => {
      const aisle = ing.aisle;
      const key = `${ing.name}__${ing.unit}`;
      if (!agg[aisle]) agg[aisle] = {};
      if (!agg[aisle][key]) agg[aisle][key] = { name: ing.name, unit: ing.unit, qty: 0 };
      agg[aisle][key].qty += ing.qty;
    });
  });
  // Sort aisles in a friendly shopping order
  const order = ["produce", "protein", "plantProtein", "dairy", "grains", "frozen", "pantry", "condiment", "spice"];
  return order
    .filter((a) => agg[a])
    .map((aisleKey) => ({
      aisle: AISLES[aisleKey],
      aisleKey,
      items: Object.values(agg[aisleKey]).sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function formatQty(q, unit) {
  // Pretty quantity formatting
  const rounded = Math.round(q * 100) / 100;
  const qStr = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  if (unit === "piece") return `${qStr}`;
  return `${qStr} ${unit}`;
}

// ───────────────────── Renderers ─────────────────────
const root = document.getElementById("root");
let lastPage = null;

function render() {
  const oldContent = root.querySelector(".page");
  const newPage = buildPage();

  if (oldContent && lastPage === state.page) {
    // same page re-render: swap content without animation to avoid jank
    oldContent.replaceWith(newPage);
  } else if (oldContent) {
    // animate out, then in
    oldContent.classList.add("page-exit", "page-exit-active");
    setTimeout(() => {
      oldContent.remove();
      newPage.classList.add("page-enter");
      root.appendChild(newPage);
      requestAnimationFrame(() => {
        newPage.classList.add("page-enter-active");
      });
    }, 220);
  } else {
    root.appendChild(newPage);
  }

  lastPage = state.page;
  renderHeader();
  renderFloatingBar();
  renderDetailModal();
}

function renderHeader() {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";
  const items = [
    { key: "browse", label: "Browse" },
    { key: "schedule", label: "Week" },
    { key: "shopping", label: "Shopping List" },
  ];
  items.forEach(({ key, label }) => {
    const b = document.createElement("button");
    b.className = "nav-btn" + (state.page === key ? " active" : "");
    b.innerHTML = `${label}<span class="indicator"></span>`;
    b.onclick = () => { state.page = key; render(); };
    nav.appendChild(b);
  });
}

function renderFloatingBar() {
  const bar = document.getElementById("floating-bar");
  const count = state.picks.length;
  if (state.page !== "browse" || count === 0 || state.detailMealId || state.editingRecipe) {
    bar.classList.remove("show");
    return;
  }
  bar.classList.add("show");
  bar.innerHTML = `
    <span class="count">${count}</span>
    <span class="text-sm">meal${count === 1 ? "" : "s"} picked for the week</span>
    <button class="bg-white text-gray-900 font-medium text-sm px-4 py-2 rounded-full hover:bg-gray-100 transition">
      Plan week →
    </button>
  `;
  bar.querySelector("button").onclick = () => { state.page = "schedule"; render(); };
}

function buildPage() {
  if (state.page === "browse") return renderBrowse();
  if (state.page === "schedule") return renderSchedule();
  if (state.page === "shopping") return renderShopping();
}

// ───────── Browse ─────────
function renderBrowse() {
  const page = document.createElement("div");
  page.className = "page max-w-6xl mx-auto px-6 pb-24";

  const hero = document.createElement("section");
  hero.className = "pt-10 pb-8";
  hero.innerHTML = `
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <p class="text-sm uppercase tracking-[0.2em] text-emerald-700 font-medium">This week's kitchen</p>
        <h1 class="font-display text-5xl md:text-6xl font-semibold mt-3 leading-tight">Pick what you'll <em class="italic text-emerald-700">actually</em> cook.</h1>
        <p class="text-gray-600 mt-4 max-w-xl text-lg">Browse meals, add what looks good to your week, and we'll build one tidy shopping list. No boxes, no plastic, no waste.</p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button class="btn-ghost" id="auto-pick" title="Pick 2 vegan + 2 classic meals for the week">✨ Auto-pick for me</button>
        <button class="btn-primary" id="new-recipe">+ New recipe</button>
      </div>
    </div>
  `;
  page.appendChild(hero);
  hero.querySelector("#new-recipe").onclick = () => { openRecipeEditor(); };
  hero.querySelector("#auto-pick").onclick = () => { autoPickMeals(); };

  // Filters
  const filters = document.createElement("div");
  filters.className = "flex gap-2 flex-wrap mb-8";
  const filterOptions = [
    { key: "all", label: "All meals" },
    { key: "vegan", label: "🌿 Vegan" },
    { key: "high-protein", label: "💪 High Protein" },
    { key: "standard", label: "🍽️ Classic" },
  ];
  filterOptions.forEach(({ key, label }) => {
    const p = document.createElement("button");
    p.className = "pill" + (state.filter === key ? " active" : "");
    p.textContent = label;
    p.onclick = () => { state.filter = key; render(); };
    filters.appendChild(p);
  });
  page.appendChild(filters);

  // Suggestions row
  const suggested = suggestions();
  if (suggested.length > 0 && state.filter === "all") {
    const sec = document.createElement("section");
    sec.className = "mb-10";
    sec.innerHTML = `
      <div class="flex items-baseline justify-between mb-4">
        <h2 class="font-display text-2xl font-semibold">Maybe try this week</h2>
        <span class="text-sm text-gray-500">Based on what you haven't picked</span>
      </div>
    `;
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5";
    suggested.forEach((m, i) => {
      const tile = mealTile(m);
      tile.style.animationDelay = `${i * 60}ms`;
      tile.classList.add("rise");
      grid.appendChild(tile);
    });
    sec.appendChild(grid);
    page.appendChild(sec);
  }

  // Main grid
  const mainSec = document.createElement("section");
  mainSec.innerHTML = `<h2 class="font-display text-2xl font-semibold mb-4">${state.filter === "all" ? "All meals" : filterOptions.find(f => f.key === state.filter).label}</h2>`;
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5";
  const filtered = state.filter === "all"
    ? MEALS
    : MEALS.filter((m) => m.categories.includes(state.filter));
  filtered.forEach((m, i) => {
    const tile = mealTile(m);
    tile.style.animationDelay = `${Math.min(i, 12) * 40}ms`;
    tile.classList.add("rise");
    grid.appendChild(tile);
  });
  mainSec.appendChild(grid);
  page.appendChild(mainSec);

  return page;
}

function mealTile(meal) {
  const t = document.createElement("div");
  t.className = "tile" + (isPicked(meal.id) ? " is-selected" : "");
  const picked = isPicked(meal.id);
  t.innerHTML = `
    <div class="art bg-gradient-to-br ${meal.color}">
      <span>${meal.emoji}</span>
    </div>
    <div class="selected-ring"></div>
    <button class="quick-add" title="${picked ? "Remove from week" : "Add to week"}" aria-label="${picked ? "Remove from week" : "Add to week"}">
      ${picked
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2d8659" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1f2a20" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`}
    </button>
    <div class="p-5">
      <div class="flex gap-1.5 flex-wrap mb-2">
        ${meal.categories.map((c) => {
          const meta = CATEGORY_META[c];
          return `<span class="cat-chip ${meta.accent}"><span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.label}</span>`;
        }).join("")}
      </div>
      <h3 class="font-display text-xl font-semibold leading-snug">${meal.name}</h3>
      <p class="text-sm text-gray-600 mt-1 line-clamp-2">${meal.blurb}</p>
      <div class="flex items-center gap-4 mt-3 text-xs text-gray-500">
        <span>⏱ ${meal.time} min</span>
        <span>🔥 ${meal.calories} cal</span>
        <span>💪 ${meal.protein}g protein</span>
      </div>
      <div class="mt-3 text-xs text-emerald-700 font-medium opacity-0 group-hover:opacity-100 transition">View recipe →</div>
    </div>
  `;
  t.classList.add("group");
  t.querySelector(".quick-add").onclick = (e) => {
    e.stopPropagation();
    togglePick(meal.id);
  };
  t.onclick = () => {
    state.detailMealId = meal.id;
    renderDetailModal();
  };
  return t;
}

// ───────── Schedule ─────────
function renderSchedule() {
  const page = document.createElement("div");
  page.className = "page max-w-6xl mx-auto px-6 pb-24";

  const header = document.createElement("section");
  header.className = "pt-10 pb-6 flex items-end justify-between flex-wrap gap-4";
  header.innerHTML = `
    <div>
      <p class="text-sm uppercase tracking-[0.2em] text-emerald-700 font-medium">Your week</p>
      <h1 class="font-display text-4xl md:text-5xl font-semibold mt-2">Drag a meal onto a day.</h1>
      <p class="text-gray-600 mt-3 max-w-xl">Or just tap — we'll slot it into the next open night.</p>
    </div>
    <div class="flex gap-2 flex-wrap">
      ${state.picks.length > 0 ? `<button class="btn-ghost" id="share-plan">🔗 Share plan</button>` : ""}
      <button class="btn-primary" id="go-shopping">Build shopping list →</button>
    </div>
  `;
  page.appendChild(header);
  header.querySelector("#go-shopping").onclick = () => { state.page = "shopping"; render(); };
  const shareBtn = header.querySelector("#share-plan");
  if (shareBtn) shareBtn.onclick = () => openShareModal(buildShareUrl());

  if (state.picks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-center py-20 text-gray-500";
    empty.innerHTML = `
      <div class="text-6xl mb-4">🧺</div>
      <p class="text-lg">No meals picked yet.</p>
      <button class="btn-primary mt-6" id="to-browse">Browse meals</button>
    `;
    empty.querySelector("#to-browse").onclick = () => { state.page = "browse"; render(); };
    page.appendChild(empty);
    return page;
  }

  // Days grid — each day has 2 slots (family members may eat different meals)
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-10";
  DAYS.forEach((day) => {
    const card = document.createElement("div");
    card.className = "day-card day-card-2slot flex flex-col";
    card.dataset.day = day;
    const slot0 = state.picks.find((p) => p.day === day && p.slot === 0);
    const slot1 = state.picks.find((p) => p.day === day && p.slot === 1);

    const slotHTML = (pick, slotIdx) => {
      const meal = pick ? mealById(pick.mealId) : null;
      if (day === EAT_OUT_DAY) {
        return `<div class="day-slot day-slot-empty" data-slot="${slotIdx}" style="opacity:0.7">
          <span class="slot-label">${SLOT_LABELS[slotIdx]}</span>
          <span class="text-gray-400 text-xs italic">🍽️ Eating out</span>
        </div>`;
      }
      if (!meal) {
        return `<div class="day-slot day-slot-empty" data-slot="${slotIdx}">
          <span class="slot-label">${SLOT_LABELS[slotIdx]}</span>
          <span class="text-gray-300 text-xs italic">Drop meal</span>
        </div>`;
      }
      const leftoverBadge = pick.leftover ? `<span class="text-[9px] uppercase tracking-wider text-amber-600 font-semibold">♻ Leftover</span>` : "";
      return `<div class="day-slot day-slot-filled" data-slot="${slotIdx}">
        <div class="flex items-center gap-2 min-w-0">
          <div class="w-8 h-8 flex-shrink-0 rounded-lg bg-gradient-to-br ${meal.color} grid place-items-center text-base">${meal.emoji}</div>
          <div class="flex-1 min-w-0">
            <div class="text-[9px] uppercase tracking-wider text-gray-400 font-medium">${SLOT_LABELS[slotIdx]}</div>
            <div class="text-xs font-semibold leading-tight truncate">${meal.name}</div>
            <div class="text-[10px] text-gray-400 mt-0.5">${leftoverBadge || meal.time + " min"}</div>
          </div>
          <button class="clear-slot text-gray-300 hover:text-red-500 transition text-sm leading-none" title="Clear">×</button>
        </div>
      </div>`;
    };

    card.innerHTML = `
      <div class="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2">${day}</div>
      <div class="flex flex-col gap-2 flex-1">
        ${slotHTML(slot0, 0)}
        ${slotHTML(slot1, 1)}
      </div>
    `;

    card.querySelectorAll(".clear-slot").forEach((btn, idx) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const slotIdx = parseInt(btn.closest(".day-slot").dataset.slot, 10);
        const p = state.picks.find((p) => p.day === day && p.slot === slotIdx);
        if (p) { p.day = null; p.slot = null; }
        save(); render();
      };
    });

    // Drag targets — each slot accepts a drop
    card.querySelectorAll(".day-slot").forEach((slotEl) => {
      slotEl.addEventListener("dragover", (e) => { e.preventDefault(); slotEl.classList.add("drag-over"); });
      slotEl.addEventListener("dragleave", () => slotEl.classList.remove("drag-over"));
      slotEl.addEventListener("drop", (e) => {
        e.preventDefault();
        slotEl.classList.remove("drag-over");
        const mealId = e.dataTransfer.getData("text/plain");
        const slotIdx = parseInt(slotEl.dataset.slot, 10);
        assignMealToDay(mealId, day, slotIdx);
      });
    });

    // Click a filled slot to view the recipe
    card.querySelectorAll(".day-slot-filled").forEach((slotEl) => {
      slotEl.style.cursor = "pointer";
      slotEl.addEventListener("click", (e) => {
        if (e.target.closest(".clear-slot")) return;
        const slotIdx = parseInt(slotEl.dataset.slot, 10);
        const p = state.picks.find((p) => p.day === day && p.slot === slotIdx);
        if (p) { state.detailMealId = p.mealId; renderDetailModal(); }
      });
    });
    grid.appendChild(card);
  });
  page.appendChild(grid);

  // Unscheduled row
  const unscheduled = state.picks.filter((p) => !p.day && !p.generated);
  const sec = document.createElement("section");
  sec.innerHTML = `
    <div class="flex items-baseline justify-between mb-4">
      <h2 class="font-display text-2xl font-semibold">Picked meals ${unscheduled.length ? `<span class="text-gray-400 font-sans text-base">(${unscheduled.length} to schedule)</span>` : ""}</h2>
      <button class="btn-ghost text-sm" id="auto-assign">Auto-schedule ✨</button>
    </div>
  `;
  const ug = document.createElement("div");
  ug.className = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4";
  state.picks.filter((p) => !p.generated).forEach((pick) => {
    const meal = mealById(pick.mealId);
    if (!meal) return;
    const chip = document.createElement("div");
    chip.className = "bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition cursor-grab";
    chip.draggable = true;
    const slotTag = pick.day ? `📅 ${pick.day} · Meal ${(pick.slot ?? 0) + 1}` : "Unscheduled";
    chip.innerHTML = `
      <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${meal.color} grid place-items-center text-2xl flex-shrink-0">${meal.emoji}</div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold truncate">${meal.name}</div>
        <div class="text-xs text-gray-500 mt-0.5">${slotTag}</div>
      </div>
      <button class="text-gray-300 hover:text-red-500 transition text-lg leading-none" title="Remove">×</button>
    `;
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", meal.id);
      chip.style.opacity = "0.4";
    });
    chip.addEventListener("dragend", () => { chip.style.opacity = ""; });
    chip.querySelector("button").onclick = (e) => {
      e.stopPropagation();
      togglePick(meal.id);
    };
    ug.appendChild(chip);
  });
  sec.appendChild(ug);
  page.appendChild(sec);
  sec.querySelector("#auto-assign").onclick = () => { autoSchedule(); };

  return page;
}

function autoPickMeals() {
  // Mirror the weekly schedule shape: 2 vegan (Jess) + 2 classic (Tim).
  // Fill gaps only — keep anything already picked.
  const pickedIds = new Set(state.picks.map((p) => p.mealId));
  const isVeganMeal = (m) => m.categories.includes("vegan");
  const isClassicMeal = (m) => m.categories.includes("standard") && !m.categories.includes("vegan");

  const veganHave = state.picks.filter((p) => {
    const m = mealById(p.mealId); return m && isVeganMeal(m);
  }).length;
  const classicHave = state.picks.filter((p) => {
    const m = mealById(p.mealId); return m && isClassicMeal(m);
  }).length;

  const veganNeed = Math.max(0, 2 - veganHave);
  const classicNeed = Math.max(0, 2 - classicHave);

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const veganPool = shuffle(MEALS.filter((m) => isVeganMeal(m) && !pickedIds.has(m.id))).slice(0, veganNeed);
  const classicPool = shuffle(MEALS.filter((m) => isClassicMeal(m) && !pickedIds.has(m.id))).slice(0, classicNeed);

  [...veganPool, ...classicPool].forEach((m) => {
    state.picks.push({ mealId: m.id, day: null, slot: null, leftover: false, generated: false });
  });

  save();
  render();
}

function autoSchedule() {
  // Clear generated leftover entries and reset assignments on the rest
  state.picks = state.picks.filter((p) => !p.generated);
  state.picks.forEach((p) => { p.day = null; p.slot = null; p.leftover = false; });

  const isVegan = (p) => mealById(p.mealId)?.categories.includes("vegan");
  const isClassic = (p) => {
    const m = mealById(p.mealId);
    return m && m.categories.includes("standard") && !m.categories.includes("vegan");
  };

  const veganPicks = state.picks.filter(isVegan);
  const classicPicks = state.picks.filter(isClassic);

  // Jess slot=1, cooks Mon/Wed (vegan). Tim slot=0, cooks Tue/Thu (classic).
  // Each cook covers 2 eating days. Fri = eating out (skipped).
  const plan = [
    { pick: veganPicks[0],   cookDay: "Mon", eatDays: ["Mon", "Tue"], slot: 1 },
    { pick: classicPicks[0], cookDay: "Tue", eatDays: ["Tue", "Wed"], slot: 0 },
    { pick: veganPicks[1],   cookDay: "Wed", eatDays: ["Wed", "Thu"], slot: 1 },
    { pick: classicPicks[1], cookDay: "Thu", eatDays: ["Thu", "Sat"], slot: 0 },
  ];

  plan.forEach(({ pick, eatDays, slot }) => {
    if (!pick) return;
    pick.day = eatDays[0];
    pick.slot = slot;
    pick.leftover = false;
    for (let i = 1; i < eatDays.length; i++) {
      state.picks.push({
        mealId: pick.mealId,
        day: eatDays[i],
        slot,
        leftover: true,
        generated: true,
      });
    }
  });

  // Extra picks beyond the 2-per-person plan stay unscheduled (float days).
  save(); render();
}

function assignMealToDay(mealId, day, slot) {
  // Unschedule whatever currently occupies that exact (day, slot)
  state.picks.forEach((p) => {
    if (p.day === day && p.slot === slot) { p.day = null; p.slot = null; }
  });
  const pick = state.picks.find((p) => p.mealId === mealId);
  if (pick) { pick.day = day; pick.slot = slot; }
  save(); render();
}

// ───────── Shopping List ─────────
function renderShopping() {
  const page = document.createElement("div");
  page.className = "page max-w-5xl mx-auto px-6 pb-24";

  const header = document.createElement("section");
  header.className = "pt-10 pb-6 flex items-end justify-between flex-wrap gap-4";
  header.innerHTML = `
    <div>
      <p class="text-sm uppercase tracking-[0.2em] text-emerald-700 font-medium">Weekend run</p>
      <h1 class="font-display text-4xl md:text-5xl font-semibold mt-2">Everything you need.</h1>
      <p class="text-gray-600 mt-3 max-w-xl">Grouped by aisle so you can sweep the store in one loop. Check items off as you go.</p>
    </div>
    <div class="flex gap-2">
      <button class="btn-ghost" id="print-btn">🖨️ Print</button>
      <button class="btn-primary" id="back-browse">← Edit meals</button>
    </div>
  `;
  page.appendChild(header);
  header.querySelector("#back-browse").onclick = () => { state.page = "browse"; render(); };
  header.querySelector("#print-btn").onclick = () => window.print();

  const list = shoppingList();
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-center py-20 text-gray-500";
    empty.innerHTML = `
      <div class="text-6xl mb-4">🛒</div>
      <p class="text-lg">Your list will appear here.</p>
      <button class="btn-primary mt-6" id="to-browse">Pick some meals</button>
    `;
    empty.querySelector("#to-browse").onclick = () => { state.page = "browse"; render(); };
    page.appendChild(empty);
    return page;
  }

  // Summary
  const totalItems = list.reduce((s, a) => s + a.items.length, 0);
  const summary = document.createElement("div");
  summary.className = "bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-8 flex items-center justify-between flex-wrap gap-4";
  summary.innerHTML = `
    <div>
      <div class="text-sm text-emerald-800 font-medium">${state.picks.length} meals · ${totalItems} ingredients · ${list.length} aisles</div>
      <div class="text-emerald-900 font-display text-lg mt-1">${state.picks.map(p => mealById(p.mealId)?.name).filter(Boolean).join(" · ")}</div>
    </div>
    <button class="btn-ghost text-sm" id="reset-check">Reset checks</button>
  `;
  summary.querySelector("#reset-check").onclick = () => {
    state.checkedIngredients = {};
    save(); render();
  };
  page.appendChild(summary);

  // Aisles
  const grid = document.createElement("div");
  grid.className = "grid grid-cols-1 md:grid-cols-2 gap-5";
  list.forEach((aisle, i) => {
    const card = document.createElement("div");
    card.className = "aisle-card rise";
    card.style.animationDelay = `${i * 50}ms`;
    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-display text-xl font-semibold">${aisle.aisle}</h3>
        <span class="text-xs text-gray-400">${aisle.items.length} item${aisle.items.length === 1 ? "" : "s"}</span>
      </div>
    `;
    const ul = document.createElement("ul");
    aisle.items.forEach((item) => {
      const li = document.createElement("li");
      const key = `${aisle.aisleKey}::${item.name}`;
      const checked = !!state.checkedIngredients[key];
      li.innerHTML = `
        <label class="check-label flex-1">
          <input type="checkbox" ${checked ? "checked" : ""}/>
          <span class="name text-sm">${item.name}</span>
        </label>
        <span class="qty text-sm text-gray-500">${formatQty(item.qty, item.unit)}</span>
      `;
      li.querySelector("input").addEventListener("change", (e) => {
        state.checkedIngredients[key] = e.target.checked;
        save();
      });
      ul.appendChild(li);
    });
    card.appendChild(ul);
    grid.appendChild(card);
  });
  page.appendChild(grid);

  return page;
}

// ───────── Detail modal (optional reveal) ─────────
function renderDetailModal() {
  let modal = document.getElementById("detail-modal");
  renderFloatingBar();
  if (!state.detailMealId) {
    if (modal) modal.remove();
    return;
  }
  const meal = mealById(state.detailMealId);
  if (!meal) return;
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "detail-modal";
    modal.className = "fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm";
    modal.style.opacity = "0";
    modal.style.transition = "opacity 200ms ease";
    document.body.appendChild(modal);
    requestAnimationFrame(() => { modal.style.opacity = "1"; });
  }
  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto shadow-2xl relative">
      <button id="close-x" class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white grid place-items-center shadow-md text-gray-700" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <div class="aspect-[16/9] bg-gradient-to-br ${meal.color} grid place-items-center text-8xl">${meal.emoji}</div>
      <div class="p-7 md:p-8">
        <div class="flex gap-1.5 flex-wrap mb-3">
          ${meal.categories.map((c) => {
            const meta = CATEGORY_META[c];
            return `<span class="cat-chip ${meta.accent}"><span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>${meta.label}</span>`;
          }).join("")}
        </div>
        <h2 class="font-display text-3xl md:text-4xl font-semibold leading-tight">${meal.name}</h2>
        <p class="text-gray-600 mt-2 text-lg">${meal.blurb}</p>
        <div class="flex gap-6 mt-5 text-sm text-gray-600 border-y border-gray-100 py-4">
          <div><div class="text-xs text-gray-400 uppercase tracking-wider">Time</div><div class="font-medium mt-0.5">${meal.time} min</div></div>
          <div><div class="text-xs text-gray-400 uppercase tracking-wider">Calories</div><div class="font-medium mt-0.5">${meal.calories}</div></div>
          <div><div class="text-xs text-gray-400 uppercase tracking-wider">Protein</div><div class="font-medium mt-0.5">${meal.protein}g</div></div>
        </div>

        <div class="grid md:grid-cols-[1fr_1.5fr] gap-8 mt-6">
          <div>
            <h3 class="font-display text-xl font-semibold mb-3">Ingredients</h3>
            <ul class="text-sm text-gray-700 space-y-1.5">
              ${meal.ingredients.map(i => `<li class="flex justify-between gap-2 py-1 border-b border-dashed border-gray-100"><span>${i.name}</span><span class="text-gray-400 whitespace-nowrap">${formatQty(i.qty, i.unit)}</span></li>`).join("")}
            </ul>
          </div>
          <div>
            <h3 class="font-display text-xl font-semibold mb-3">Method</h3>
            <ol class="space-y-3 text-sm text-gray-700 leading-relaxed">
              ${(meal.steps || []).map((s, i) => `
                <li class="flex gap-3">
                  <span class="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center font-semibold text-xs">${i + 1}</span>
                  <span class="pt-1">${s}</span>
                </li>
              `).join("")}
            </ol>
          </div>
        </div>

        ${meal.source ? `
          <div class="mt-6 pt-5 border-t border-gray-100 text-sm text-gray-500">
            Inspired by <a href="${meal.source.url}" target="_blank" rel="noopener" class="text-emerald-700 font-medium hover:underline">${meal.source.name} →</a>
          </div>
        ` : ""}

        <div class="flex gap-2 mt-6 sticky bottom-0 bg-white pt-4 -mx-7 px-7 md:-mx-8 md:px-8 border-t border-gray-100">
          <button class="btn-primary flex-1" id="toggle-pick">${isPicked(meal.id) ? "✓ Added to week · Remove" : "+ Add to week"}</button>
          <button class="btn-ghost" id="close-modal">Close</button>
        </div>
      </div>
    </div>
  `;
  modal.querySelector("#close-x").onclick = () => { state.detailMealId = null; renderDetailModal(); };
  modal.querySelector("#toggle-pick").onclick = () => {
    togglePick(meal.id);
    state.detailMealId = null;
    renderDetailModal();
  };
  modal.querySelector("#close-modal").onclick = () => {
    state.detailMealId = null;
    renderDetailModal();
  };
  modal.onclick = (e) => {
    if (e.target === modal) {
      state.detailMealId = null;
      renderDetailModal();
    }
  };
}

// ───────── Recipe URL import (schema.org/Recipe JSON-LD) ─────────
function parseRecipeFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  let recipe = null;
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent);
      const candidates = Array.isArray(data) ? data : (data["@graph"] || [data]);
      for (const c of candidates) {
        const t = c && c["@type"];
        const types = Array.isArray(t) ? t : [t];
        if (types.includes("Recipe")) { recipe = c; break; }
      }
      if (recipe) break;
    } catch {}
  }
  if (!recipe) return null;

  const parseIso = (d) => {
    if (!d || typeof d !== "string") return 0;
    const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : 0;
  };
  const toNum = (v) => { const n = parseFloat(String(v || "").replace(/[^\d.]/g, "")); return isFinite(n) ? n : 0; };

  const name = (recipe.name || "").toString().trim();
  const description = (recipe.description || "").toString().trim().slice(0, 240);
  const totalMin = parseIso(recipe.totalTime) || (parseIso(recipe.cookTime) + parseIso(recipe.prepTime));
  const nutrition = recipe.nutrition || {};
  const calories = toNum(nutrition.calories);
  const protein = toNum(nutrition.proteinContent);

  const rawIngs = Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [];
  const ingredients = rawIngs.map((line) => {
    const s = String(line).trim();
    const m = s.match(/^([\d./\s]+)\s*([a-zA-Z]+)?\s+(.+)$/);
    if (m) {
      const qtyStr = m[1].trim();
      const qty = qtyStr.includes("/") ? qtyStr.split(/\s+/).reduce((acc, p) => {
        if (p.includes("/")) { const [a, b] = p.split("/").map(Number); return acc + a / b; }
        return acc + Number(p);
      }, 0) : parseFloat(qtyStr);
      const unit = (m[2] || "piece").toLowerCase();
      const unitMap = { g: "g", gram: "g", grams: "g", ml: "ml", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", cup: "cup", cups: "cup", clove: "clove", cloves: "clove", can: "can", cans: "can", slice: "slice", slices: "slice" };
      return { name: m[3].trim(), qty: isFinite(qty) ? qty : 1, unit: unitMap[unit] || "piece", aisle: "produce" };
    }
    return { name: s, qty: 1, unit: "piece", aisle: "produce" };
  }).filter((i) => i.name);

  let steps = [];
  const ri = recipe.recipeInstructions;
  if (Array.isArray(ri)) {
    steps = ri.map((x) => typeof x === "string" ? x : (x.text || x.name || "")).filter(Boolean);
  } else if (typeof ri === "string") {
    steps = ri.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  }

  const result = {};
  if (name) result.name = name;
  if (description) result.blurb = description;
  if (totalMin) result.time = totalMin;
  if (calories) result.calories = Math.round(calories);
  if (protein) result.protein = Math.round(protein);
  if (ingredients.length) result.ingredients = ingredients;
  if (steps.length) result.steps = steps;
  return Object.keys(result).length ? result : null;
}

// ───────── Recipe editor ─────────
function openRecipeEditor(existing) {
  state.editingRecipe = existing || {
    id: "custom-" + Date.now().toString(36),
    name: "",
    categories: ["standard"],
    emoji: "🍽️",
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    blurb: "",
    time: 30, calories: 500, protein: 25,
    ingredients: [{ name: "", qty: 1, unit: "g", aisle: "produce" }],
    steps: [""],
    sourceUrl: "",
    custom: true,
  };
  renderRecipeEditor();
}

function renderRecipeEditor() {
  let modal = document.getElementById("recipe-editor");
  renderFloatingBar();
  if (!state.editingRecipe) { if (modal) modal.remove(); return; }
  const r = state.editingRecipe;
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "recipe-editor";
    modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm";
    document.body.appendChild(modal);
  }
  const cats = ["standard", "vegan", "high-protein"];
  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto shadow-2xl">
      <div class="p-6 md:p-8">
        <h2 class="font-display text-3xl font-semibold mb-1">New recipe</h2>
        <p class="text-sm text-gray-500 mb-5">Saved locally — available for picks &amp; auto-schedule.</p>
        <div class="grid grid-cols-[auto_1fr] gap-3 items-start">
          <input id="f-emoji" class="text-3xl w-16 h-16 text-center rounded-2xl border border-gray-200" value="${r.emoji}" maxlength="2" />
          <input id="f-name" placeholder="Recipe name" class="w-full px-3 py-3 rounded-xl border border-gray-200 font-display text-lg" value="${r.name.replace(/"/g,'&quot;')}" />
        </div>
        <textarea id="f-blurb" placeholder="One-line description" class="w-full px-3 py-2 mt-3 rounded-xl border border-gray-200 text-sm" rows="2">${r.blurb}</textarea>

        <div class="mt-3">
          <div class="flex gap-2">
            <input id="f-url" type="url" placeholder="Paste a recipe URL (optional)" class="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm" value="${(r.sourceUrl||'').replace(/"/g,'&quot;')}"/>
            <button id="f-import" class="btn-ghost text-sm whitespace-nowrap">Import ↓</button>
          </div>
          <div id="f-import-msg" class="text-xs text-gray-500 mt-1"></div>
        </div>

        <div class="flex gap-2 flex-wrap mt-4">
          ${cats.map((c) => `<label class="pill cursor-pointer ${r.categories.includes(c) ? "active" : ""}"><input type="checkbox" class="hidden" data-cat="${c}" ${r.categories.includes(c) ? "checked" : ""}/>${CATEGORY_META[c].label}</label>`).join("")}
        </div>

        <div class="grid grid-cols-3 gap-3 mt-4">
          <label class="text-xs text-gray-500">Time (min)<input id="f-time" type="number" class="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200" value="${r.time}"/></label>
          <label class="text-xs text-gray-500">Calories<input id="f-cal" type="number" class="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200" value="${r.calories}"/></label>
          <label class="text-xs text-gray-500">Protein (g)<input id="f-prot" type="number" class="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200" value="${r.protein}"/></label>
        </div>

        <h3 class="font-display text-xl font-semibold mt-6 mb-2">Ingredients</h3>
        <div id="f-ings" class="space-y-2"></div>
        <button id="f-add-ing" class="btn-ghost text-sm mt-2">+ Add ingredient</button>

        <h3 class="font-display text-xl font-semibold mt-6 mb-2">Steps</h3>
        <div id="f-steps" class="space-y-2"></div>
        <button id="f-add-step" class="btn-ghost text-sm mt-2">+ Add step</button>

        <div class="flex gap-2 mt-8 sticky bottom-0 bg-white pt-4 border-t border-gray-100">
          <button class="btn-primary flex-1" id="f-save">Save recipe</button>
          <button class="btn-ghost" id="f-cancel">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const ingsEl = modal.querySelector("#f-ings");
  const stepsEl = modal.querySelector("#f-steps");
  const drawIngs = () => {
    ingsEl.innerHTML = r.ingredients.map((ing, i) => `
      <div class="grid grid-cols-[1fr_70px_70px_110px_auto] gap-2">
        <input data-i="${i}" data-k="name" placeholder="Name" class="px-2 py-2 rounded-lg border border-gray-200 text-sm" value="${(ing.name||'').replace(/"/g,'&quot;')}"/>
        <input data-i="${i}" data-k="qty" type="number" step="0.1" class="px-2 py-2 rounded-lg border border-gray-200 text-sm" value="${ing.qty}"/>
        <select data-i="${i}" data-k="unit" class="px-2 py-2 rounded-lg border border-gray-200 text-sm">${["g","ml","tbsp","tsp","cup","clove","piece","can","slice"].map(u=>`<option ${u===ing.unit?"selected":""}>${u}</option>`).join("")}</select>
        <select data-i="${i}" data-k="aisle" class="px-2 py-2 rounded-lg border border-gray-200 text-sm">${AISLE_OPTIONS.map(a=>`<option value="${a}" ${a===ing.aisle?"selected":""}>${AISLES[a]}</option>`).join("")}</select>
        <button data-rm-ing="${i}" class="text-gray-300 hover:text-red-500 text-lg px-2">×</button>
      </div>
    `).join("");
    ingsEl.querySelectorAll("input,select").forEach((el) => {
      el.oninput = el.onchange = () => {
        const i = +el.dataset.i; const k = el.dataset.k;
        r.ingredients[i][k] = k === "qty" ? parseFloat(el.value) || 0 : el.value;
      };
    });
    ingsEl.querySelectorAll("[data-rm-ing]").forEach((b) => {
      b.onclick = () => { r.ingredients.splice(+b.dataset.rmIng, 1); drawIngs(); };
    });
  };
  const drawSteps = () => {
    stepsEl.innerHTML = r.steps.map((s, i) => `
      <div class="flex gap-2 items-start">
        <span class="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 grid place-items-center font-semibold text-xs flex-shrink-0 mt-1">${i+1}</span>
        <textarea data-si="${i}" rows="2" class="flex-1 px-2 py-2 rounded-lg border border-gray-200 text-sm">${s}</textarea>
        <button data-rm-step="${i}" class="text-gray-300 hover:text-red-500 text-lg px-2">×</button>
      </div>
    `).join("");
    stepsEl.querySelectorAll("textarea").forEach((el) => {
      el.oninput = () => { r.steps[+el.dataset.si] = el.value; };
    });
    stepsEl.querySelectorAll("[data-rm-step]").forEach((b) => {
      b.onclick = () => { r.steps.splice(+b.dataset.rmStep, 1); drawSteps(); };
    });
  };
  drawIngs(); drawSteps();

  modal.querySelector("#f-add-ing").onclick = () => { r.ingredients.push({ name: "", qty: 1, unit: "g", aisle: "produce" }); drawIngs(); };
  modal.querySelector("#f-add-step").onclick = () => { r.steps.push(""); drawSteps(); };
  modal.querySelectorAll("[data-cat]").forEach((cb) => {
    cb.onchange = () => {
      const c = cb.dataset.cat;
      if (cb.checked && !r.categories.includes(c)) r.categories.push(c);
      if (!cb.checked) r.categories = r.categories.filter((x) => x !== c);
      cb.closest("label").classList.toggle("active", cb.checked);
    };
  });
  modal.querySelector("#f-import").onclick = async () => {
    const url = modal.querySelector("#f-url").value.trim();
    const msg = modal.querySelector("#f-import-msg");
    if (!url) { msg.textContent = "Paste a recipe URL first."; return; }
    r.sourceUrl = url;
    msg.innerHTML = `<span class="text-emerald-700">Fetching…</span>`;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      const parsed = parseRecipeFromHtml(html);
      if (!parsed) throw new Error("No recipe data found on the page");
      Object.assign(r, parsed);
      state.editingRecipe = r;
      renderRecipeEditor();
      document.querySelector("#f-import-msg").innerHTML = `<span class="text-emerald-700">✓ Imported — review &amp; save.</span>`;
    } catch (e) {
      msg.innerHTML = `<span class="text-amber-600">Couldn't auto-import (${e.message}). URL saved — fill the rest manually.</span>`;
    }
  };
  modal.querySelector("#f-cancel").onclick = () => { state.editingRecipe = null; renderRecipeEditor(); };
  modal.querySelector("#f-save").onclick = () => {
    r.name = modal.querySelector("#f-name").value.trim();
    r.emoji = modal.querySelector("#f-emoji").value.trim() || "🍽️";
    r.blurb = modal.querySelector("#f-blurb").value.trim();
    r.time = parseInt(modal.querySelector("#f-time").value, 10) || 0;
    r.calories = parseInt(modal.querySelector("#f-cal").value, 10) || 0;
    r.protein = parseInt(modal.querySelector("#f-prot").value, 10) || 0;
    r.sourceUrl = modal.querySelector("#f-url").value.trim();
    if (r.sourceUrl) {
      try { r.source = { name: new URL(r.sourceUrl).hostname.replace(/^www\./, ""), url: r.sourceUrl }; } catch {}
    } else { delete r.source; }
    r.ingredients = r.ingredients.filter((i) => i.name.trim());
    r.steps = r.steps.filter((s) => s.trim());
    if (!r.name) { modal.querySelector("#f-name").focus(); return; }
    if (r.categories.length === 0) r.categories = ["standard"];
    const idx = MEALS.findIndex((m) => m.id === r.id);
    if (idx >= 0) MEALS[idx] = r; else MEALS.push(r);
    saveCustomRecipes();
    state.editingRecipe = null;
    renderRecipeEditor();
    render();
  };
}

// ───────── Share a plan via link (no backend) ─────────
// Picks live in localStorage, which is private to one browser. To get a plan
// from one person to another we encode it into the URL hash they can open.
// The hash (not a query string) keeps the payload client-side and works on
// static hosting like GitHub Pages.
function encodePlan(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodePlan(code) {
  let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function buildShareUrl() {
  // Bundle only the custom recipes a pick references, so they resolve on the
  // recipient's device (built-in meals already exist there, keyed by id).
  const referenced = new Set(state.picks.map((p) => p.mealId));
  const recipes = MEALS.filter((m) => m.custom && referenced.has(m.id));
  const code = encodePlan({ v: 1, picks: state.picks, recipes });
  return location.origin + location.pathname + "#plan=" + code;
}

// A shared link is untrusted input. The renderers build HTML with innerHTML,
// so neutralise the text sinks before we store an incoming recipe: strip angle
// brackets from free-text fields and keep the color to a known palette class.
function sanitizeRecipe(m) {
  if (!m || typeof m !== "object" || !m.id) return null;
  const scrub = (s) => (typeof s === "string" ? s.replace(/[<>]/g, "") : s);
  m.name = scrub(m.name) || "Untitled";
  m.blurb = scrub(m.blurb);
  m.emoji = scrub(typeof m.emoji === "string" ? m.emoji : "🍽️");
  m.sourceUrl = scrub(m.sourceUrl);
  if (!PALETTE.includes(m.color)) m.color = PALETTE[0];
  if (Array.isArray(m.ingredients)) m.ingredients.forEach((i) => { if (i && typeof i === "object") { i.name = scrub(i.name); i.unit = scrub(i.unit); } });
  m.steps = Array.isArray(m.steps) ? m.steps.map(scrub) : [];
  m.custom = true;
  return m;
}

// Merge an incoming plan into ours. Dedupe by meal so the same dish never
// appears twice; if an incoming meal lands on a day+slot we've already filled,
// bring it in unscheduled rather than silently hiding it behind our pick.
function mergePlan(incomingPicks, incomingRecipes) {
  (incomingRecipes || []).forEach((raw) => {
    const m = sanitizeRecipe(raw);
    if (m && !MEALS.find((x) => x.id === m.id)) MEALS.push(m);
  });
  saveCustomRecipes();

  const have = new Set(state.picks.map((p) => p.mealId));
  const occupied = new Set(
    state.picks.filter((p) => p.day != null && p.slot != null).map((p) => `${p.day}::${p.slot}`)
  );
  let added = 0;
  (incomingPicks || []).forEach((p) => {
    if (!p || !p.mealId || have.has(p.mealId) || !mealById(p.mealId)) return;
    let day = p.day ?? null;
    let slot = typeof p.slot === "number" ? p.slot : null;
    if (day != null && slot != null) {
      const key = `${day}::${slot}`;
      if (occupied.has(key)) { day = null; slot = null; } else occupied.add(key);
    }
    state.picks.push({ mealId: p.mealId, day, slot, leftover: !!p.leftover, generated: !!p.generated });
    have.add(p.mealId);
    added++;
  });
  save();
  return added;
}

function overlay() {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm";
  modal.style.opacity = "0";
  modal.style.transition = "opacity 200ms ease";
  document.body.appendChild(modal);
  requestAnimationFrame(() => { modal.style.opacity = "1"; });
  return modal;
}
function dismissOverlay(modal) {
  modal.style.opacity = "0";
  setTimeout(() => modal.remove(), 200);
}

function openShareModal(url) {
  const modal = overlay();
  const long = url.length > 6000;
  const n = state.picks.length;
  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-lg w-full shadow-2xl relative p-7 md:p-8">
      <button id="s-close" class="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 hover:bg-gray-100 grid place-items-center shadow-md text-gray-700" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <div class="text-4xl mb-3">🔗</div>
      <h2 class="font-display text-3xl font-semibold leading-tight">Share your plan</h2>
      <p class="text-gray-600 mt-2">Send this link to whoever you're cooking with. Opening it loads your ${n} pick${n === 1 ? "" : "s"} into their browser.</p>
      <div class="flex gap-2 mt-5">
        <input id="s-url" type="text" readonly value="${url.replace(/"/g, "&quot;")}" class="flex-1 min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 font-mono"/>
        <button id="s-copy" class="btn-primary whitespace-nowrap">Copy</button>
      </div>
      <p id="s-msg" class="text-xs ${long ? "text-amber-600" : "text-gray-500"} mt-2 min-h-[1rem]">${long ? "Heads up: this is a long link (lots of custom recipes) — some chat apps may cut it off." : ""}</p>
    </div>
  `;
  const input = modal.querySelector("#s-url");
  const msg = modal.querySelector("#s-msg");
  modal.querySelector("#s-copy").onclick = async () => {
    input.focus(); input.select(); input.setSelectionRange(0, 99999);
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; }
    catch { try { ok = document.execCommand("copy"); } catch { ok = false; } }
    msg.innerHTML = ok
      ? `<span class="text-emerald-700">✓ Copied to clipboard</span>`
      : `<span class="text-amber-600">Select the link and press Ctrl/⌘+C.</span>`;
  };
  modal.querySelector("#s-close").onclick = () => dismissOverlay(modal);
  modal.onclick = (e) => { if (e.target === modal) dismissOverlay(modal); };
}

function openImportModal(payload) {
  const count = Array.isArray(payload.picks) ? payload.picks.length : 0;
  const modal = overlay();
  modal.innerHTML = `
    <div class="bg-white rounded-3xl max-w-lg w-full shadow-2xl relative p-7 md:p-8">
      <div class="text-4xl mb-3">📨</div>
      <h2 class="font-display text-3xl font-semibold leading-tight">A meal plan was shared with you</h2>
      <p class="text-gray-600 mt-2">It has <strong>${count}</strong> meal${count === 1 ? "" : "s"}. Add them to your week? Your current picks stay — anything that overlaps a filled day comes in unscheduled.</p>
      <div class="flex gap-2 mt-6">
        <button id="i-add" class="btn-primary flex-1">Add to my week</button>
        <button id="i-cancel" class="btn-ghost">Not now</button>
      </div>
    </div>
  `;
  modal.querySelector("#i-add").onclick = () => {
    mergePlan(payload.picks, payload.recipes);
    dismissOverlay(modal);
    state.page = "schedule";
    render();
  };
  modal.querySelector("#i-cancel").onclick = () => dismissOverlay(modal);
}

function handleIncomingPlan() {
  const m = (location.hash || "").match(/[#&]plan=([^&]+)/);
  if (!m) return;
  let payload = null;
  try { payload = decodePlan(m[1]); } catch {}
  // Clear the hash either way so a refresh won't re-prompt and the URL stays tidy.
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  if (payload && Array.isArray(payload.picks) && payload.picks.length) openImportModal(payload);
}

// ───────────────────── Boot ─────────────────────
load();
render();
handleIncomingPlan();
})();
