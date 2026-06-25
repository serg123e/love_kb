/* love_kb SPA — клиентский рендер вики + поиск. Данные: ./data/pages.json */
(() => {
  "use strict";

  const state = { pages: [], bySlug: new Map(), categories: [], mini: null };
  const el = (id) => document.getElementById(id);
  const main = el("main");
  const sidebar = el("sidebar");
  const searchInput = el("search");
  const resultsBox = el("results");

  // ── тема ───────────────────────────────────────────────────────────────────
  const applyTheme = (t) => {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  };
  applyTheme(localStorage.getItem("theme"));
  el("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const isDark = cur ? cur === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });

  // мобильное меню
  const menuBtn = document.createElement("button");
  menuBtn.className = "icon-btn menu-btn";
  menuBtn.textContent = "☰";
  menuBtn.title = "Меню";
  document.querySelector(".topbar").insertBefore(menuBtn, document.querySelector(".brand"));
  menuBtn.addEventListener("click", () => sidebar.classList.toggle("open"));

  // ── утилиты ──────────────────────────────────────────────────────────────
  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const plain = (md) => (md || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`_|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const catLabel = (key) => {
    const c = state.categories.find((x) => x.key === key);
    return c ? c.label : key;
  };

  // ── загрузка данных ─────────────────────────────────────────────────────
  async function boot() {
    let data;
    try {
      const r = await fetch("./data/pages.json", { cache: "no-cache" });
      data = await r.json();
    } catch (e) {
      main.innerHTML = `<div class="inner"><p class="muted">Не удалось загрузить данные вики.</p></div>`;
      return;
    }
    state.categories = data.categories;
    state.pages = data.pages;
    state.pages.forEach((p) => state.bySlug.set(p.slug, p));

    state.mini = new MiniSearch({
      fields: ["title", "tags", "text"],
      storeFields: ["title", "category", "slug", "type"],
      searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2 },
    });
    state.mini.addAll(state.pages.map((p) => ({
      id: p.slug, slug: p.slug, title: p.title, tags: (p.tags || []).join(" "),
      text: plain(p.md), category: p.category, type: p.type,
    })));

    if (window.marked) marked.setOptions({ gfm: true, breaks: false });
    buildSidebar();
    window.addEventListener("hashchange", route);
    route();
  }

  // ── сайдбар ────────────────────────────────────────────────────────────
  function buildSidebar() {
    const frag = document.createDocumentFragment();
    for (const cat of state.categories) {
      const pages = state.pages
        .filter((p) => p.category === cat.key)
        .sort((a, b) => a.title.localeCompare(b.title, "ru"));
      const group = document.createElement("div");
      group.className = "nav-group";
      const head = document.createElement("button");
      head.className = "nav-head";
      head.innerHTML = `<span>${cat.label}</span><span class="count">${pages.length}</span>`;
      const list = document.createElement("ul");
      list.className = "nav-list";
      for (const p of pages) {
        const li = document.createElement("li");
        li.innerHTML = `<a href="#/p/${encodeURIComponent(p.slug)}" data-slug="${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`;
        list.appendChild(li);
      }
      head.addEventListener("click", () => list.classList.toggle("collapsed-hidden"));
      group.append(head, list);
      frag.appendChild(group);
    }
    sidebar.replaceChildren(frag);
  }

  function setActiveNav(slug) {
    sidebar.querySelectorAll("a.active").forEach((a) => a.classList.remove("active"));
    if (!slug) return;
    const a = sidebar.querySelector(`a[data-slug="${CSS.escape(slug)}"]`);
    if (a) { a.classList.add("active"); a.scrollIntoView({ block: "nearest" }); }
  }

  // ── роутер ─────────────────────────────────────────────────────────────
  function route() {
    sidebar.classList.remove("open");
    hideResults();
    const hash = decodeURIComponent(location.hash || "");
    const m = hash.match(/^#\/p\/(.+)$/);
    if (m) renderPage(m[1]);
    else if (hash === "#/all") renderAll();
    else renderHome();
    window.scrollTo(0, 0);
  }

  function renderHome() {
    setActiveNav(null);
    const cards = state.categories.map((cat) => {
      const pages = state.pages
        .filter((p) => p.category === cat.key)
        .sort((a, b) => a.title.localeCompare(b.title, "ru"));
      const show = cat.key === "topics" ? pages : pages.slice(0, 12);
      const items = show.map((p) =>
        `<li><a href="#/p/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></li>`).join("");
      const more = pages.length > show.length
        ? `<div class="more"><a href="#/all">…ещё ${pages.length - show.length} →</a></div>` : "";
      return `<div class="home-card">
        <h3>${cat.label}</h3>
        <div class="c-count">${pages.length} стр.</div>
        <ul>${items}</ul>${more}</div>`;
    }).join("");

    const total = state.pages.length;
    main.innerHTML = `<div class="inner">
      <div class="hero">
        <h1>❤ Что наука знает о любви</h1>
        <p>Персональная вики по паттерну incremental-вики: природа привязанности (Харлоу),
        теория привязанности (Боулби, Эйнсворт), привязанность у взрослых, нейробиология
        и психология любви. Популярные пересказы сверены с первичной литературой.
        Связи между страницами — через <span class="muted">[[вики-ссылки]]</span>.
        Начни с поиска вверху, открой <a href="#/all">полный каталог (${total} стр.)</a> или выбери раздел.</p>
      </div>
      <div class="home-grid">${cards}</div>
    </div>`;
  }

  function renderAll() {
    setActiveNav(null);
    const blocks = state.categories.map((cat) => {
      const pages = state.pages
        .filter((p) => p.category === cat.key)
        .sort((a, b) => a.title.localeCompare(b.title, "ru"));
      const items = pages.map((p) =>
        `<li><a href="#/p/${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a>` +
        `${p.type ? ` <span class="muted">· ${escapeHtml(p.type)}</span>` : ""}</li>`).join("");
      return `<section class="all-cat">
        <h2>${cat.label} <span class="c-count">(${pages.length})</span></h2>
        <ul class="all-list">${items}</ul></section>`;
    }).join("");

    main.innerHTML = `<div class="inner">
      <div class="crumb"><a href="#/">Главная</a> / Полный каталог</div>
      <h1>Полный каталог (${state.pages.length} стр.)</h1>
      <p class="muted">Все страницы вики по категориям. Для поиска используй строку вверху или <kbd>/</kbd>.</p>
      ${blocks}
    </div>`;
  }

  function renderPage(slug) {
    const p = state.bySlug.get(slug);
    if (!p) {
      main.innerHTML = `<div class="inner"><p class="muted">Страница «${escapeHtml(slug)}» не найдена.</p>
        <p><a href="#/">← на главную</a></p></div>`;
      setActiveNav(null);
      return;
    }
    setActiveNav(slug);
    const tags = (p.tags || []).map((t) => `<span class="pill">${escapeHtml(t)}</span>`).join("");
    const typePill = p.type ? `<span class="pill type">${escapeHtml(p.type)}</span>` : "";
    const body = window.marked ? marked.parse(p.md) : `<pre>${escapeHtml(p.md)}</pre>`;
    const bl = (p.backlinks || []).length
      ? `<div class="backlinks"><h4>Ссылаются сюда (${p.backlinks.length})</h4><ul>${
          p.backlinks.map((b) => `<li><a href="#/p/${encodeURIComponent(b.slug)}">${escapeHtml(b.title)}</a></li>`).join("")
        }</ul></div>`
      : "";

    main.innerHTML = `<div class="inner">
      <div class="crumb"><a href="#/">Главная</a> / ${catLabel(p.category)}</div>
      <div class="page-meta">${typePill}${tags}</div>
      <article class="content">${body}</article>
      ${bl}
    </div>`;
  }

  // ── поиск ──────────────────────────────────────────────────────────────
  let activeRes = -1;
  function runSearch(q) {
    q = q.trim();
    if (!q) { hideResults(); return; }
    const hits = state.mini.search(q, { prefix: true, fuzzy: 0.2 }).slice(0, 25);
    if (!hits.length) {
      resultsBox.innerHTML = `<div class="empty">Ничего не найдено по «${escapeHtml(q)}»</div>`;
      resultsBox.hidden = false; activeRes = -1; return;
    }
    resultsBox.innerHTML = hits.map((h, i) =>
      `<div class="res${i === 0 ? " active" : ""}" data-slug="${escapeHtml(h.slug)}">
        <span class="r-title">${escapeHtml(h.title)}</span>
        <span class="r-meta">${catLabel(h.category)}${h.type ? " · " + escapeHtml(h.type) : ""}</span>
      </div>`).join("");
    resultsBox.hidden = false;
    activeRes = 0;
    resultsBox.querySelectorAll(".res").forEach((node) => {
      node.addEventListener("mousedown", (e) => {
        e.preventDefault();
        go(node.dataset.slug);
      });
    });
  }
  const hideResults = () => { resultsBox.hidden = true; activeRes = -1; };
  function go(slug) {
    searchInput.value = "";
    hideResults();
    location.hash = `#/p/${encodeURIComponent(slug)}`;
  }

  searchInput.addEventListener("input", (e) => runSearch(e.target.value));
  searchInput.addEventListener("focus", (e) => { if (e.target.value) runSearch(e.target.value); });
  searchInput.addEventListener("keydown", (e) => {
    const items = [...resultsBox.querySelectorAll(".res")];
    if (e.key === "ArrowDown" && items.length) {
      e.preventDefault(); activeRes = Math.min(activeRes + 1, items.length - 1); paintActive(items);
    } else if (e.key === "ArrowUp" && items.length) {
      e.preventDefault(); activeRes = Math.max(activeRes - 1, 0); paintActive(items);
    } else if (e.key === "Enter" && items[activeRes]) {
      e.preventDefault(); go(items[activeRes].dataset.slug);
    } else if (e.key === "Escape") { hideResults(); searchInput.blur(); }
  });
  function paintActive(items) {
    items.forEach((n, i) => n.classList.toggle("active", i === activeRes));
    if (items[activeRes]) items[activeRes].scrollIntoView({ block: "nearest" });
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) hideResults();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault(); searchInput.focus();
    }
  });

  boot();
})();
