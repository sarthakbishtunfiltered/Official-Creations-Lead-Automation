// ============================================================
// OFFICIAL CREATIONS — SHARED FUNCTIONS
// ============================================================

// ============================================================
// NAVIGATION PATH FIX
// Removes accidentally duplicated frontend directories.
// Preserves the rest of the deployment path.
// ============================================================

function getNavigationPath(filename) {
  const url = new URL(window.location.href);

  let segments = url.pathname.split("/").filter(Boolean);

  // Remove duplicate consecutive frontend directories.
  const normalized = [];

  for (const segment of segments) {
    if (
      segment === "frontend" &&
      normalized[normalized.length - 1] === "frontend"
    ) {
      continue;
    }

    normalized.push(segment);
  }

  // Remove current filename.
  if (
    normalized.length &&
    normalized[normalized.length - 1].endsWith(".html")
  ) {
    normalized.pop();
  }

  const basePath = "/" + normalized.join("/") + "/";

  return basePath + filename;
}

// ============================================================
// APPLICATION SHELL
// ============================================================

// The rest of the Official Creations ecosystem, linked from the sidebar.
const ECOSYSTEM_LINKS = [
  ["Studio", "https://studio.officialcreations.online"],
  ["Main website", "https://officialcreations.online"],
];

function renderShell(activePage) {
  const items = [
    ["dashboard.html", "Dashboard"],
    ["leads.html", "Leads"],
    ["blacklisted.html", "Blacklisted"],
    ["called-rejected.html", "Called / Rejected"],
    ["settings.html", "Settings"],
  ];

  // Approvals: Owner + anyone flagged "Can Approve". Team: Owner only.
  if (Auth.canApprove()) {
    items.push(["approvals.html", "Approvals"]);
  }

  if (Auth.isOwner()) {
    items.push(["team.html", "Team"]);
  }

  const role = Auth.getRole();

  const roleLabels = {
    owner: "OWNER",
    editor: "EDITOR",
    viewer: "VIEWER",
  };

  const navHtml = items
    .map(([filename, label]) => {
      const active = filename === activePage ? "active" : "";

      const href = getNavigationPath(filename);

      return `
        <a
          href="${href}"
          class="${active}"
        >${label}</a>
      `;
    })
    .join("");

  document.getElementById("shell").innerHTML = `
    <aside class="sidebar">

      <div>
        <p class="brand">Official Creations</p>
        <p class="brand-sub">Lead Automation</p>
      </div>

      <nav class="nav">
        ${navHtml}
      </nav>

      <div class="sidebar-foot">

        <div class="eco-links">
          <div class="eco-title">Ecosystem</div>
          ${ECOSYSTEM_LINKS.map(
            ([label, url]) =>
              `<a href="${url}" target="_blank" rel="noopener">${label} ↗</a>`
          ).join("")}
        </div>

        <div>Signed in</div>

        <span class="role-tag">
          ${roleLabels[role] || "VIEWER"}
        </span>

        <div style="margin-top:10px;">
          <button
            class="btn-quiet"
            id="signOutBtn"
            style="padding:4px 0;"
          >
            Sign out
          </button>
        </div>

        <div class="legal-links">
          <a href="https://officialcreations.online/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
          <span aria-hidden="true">·</span>
          <a href="https://officialcreations.online/terms.html" target="_blank" rel="noopener">Terms of Service</a>
        </div>

      </div>

    </aside>

    <main class="main" id="mainContent"></main>
  `;

  document
    .getElementById("signOutBtn")
    .addEventListener("click", Auth.signOut);
}

// ============================================================
// POLLING
// ============================================================

function startPolling(fn, intervalMs) {
  fn();

  return setInterval(
    fn,
    intervalMs || CONFIG.POLL_INTERVAL_MS
  );
}

// ============================================================
// HTML ESCAPING
// ============================================================

function escapeHtml(str) {
  const div = document.createElement("div");

  div.textContent = str ?? "";

  return div.innerHTML;
}

// ============================================================
// PRIORITY
// ============================================================

function priorityClass(p) {
  const v = (p || "").toLowerCase();

  if (v.includes("high")) return "priority-high";
  if (v.includes("med")) return "priority-med";

  return "priority-low";
}

// ============================================================
// BOOLEAN VALUE
// ============================================================

function truthy(v) {
  const s = String(v).trim().toLowerCase();

  return (
    s === "true" ||
    s === "yes" ||
    s === "1" ||
    s === "✓"
  );
}

// ============================================================
// REAL LEAD VALIDATION
// ============================================================

function isRealLead(row) {
  const businessName = String(
    row["Business Name"] || ""
  ).trim();

  const location = String(
    row["Location"] || ""
  ).trim();

  const phone = String(
    row["Phone"] || ""
  ).trim();

  const instagram = String(
    row["Instagram ID"] || ""
  ).trim();

  const opportunity = String(
    row["Opportunity"] || ""
  ).trim();

  return Boolean(
    businessName &&
    location &&
    (phone || instagram) &&
    opportunity
  );
}
// ============================================================
// TIMESTAMP — "YYYY-MM-DD HH:MM:SS" in the viewer's local time.
// Used by lead actions, the Team page and the Approvals page.
// ============================================================

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowStamp() {
  const d = new Date();

  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  );
}

// ============================================================
// STYLED DROPDOWNS
// Every <select> on the site is upgraded automatically to a styled
// dropdown (search box when there are many options, optgroup
// headings, teammate avatars). The real <select> stays in the page
// -- invisible -- as the single source of truth, so existing code
// that reads select.value or listens for "change" keeps working.
//
// Optional attributes on a <select>:
//   data-placeholder="..."  text shown while the value is empty
//   data-avatar="1"         show a coloured initial for email options
//   data-native="1"         leave this one as a plain native select
// Call syncDropdowns() after setting select.value from code.
// ============================================================

(function () {
  const CHEVRON =
    '<svg class="dd-chev" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">' +
    '<path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK =
    '<svg class="dd-check" width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">' +
    '<path d="M1.5 5.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const COLORS = ["#9C7A2E", "#3F6D4E", "#A6472A", "#4A5F8A", "#7A4E7E", "#2F7D8A"];

  let open = null; // { select, dd, menu, items, active, search }

  function avatar(email) {
    const el = document.createElement("span");
    let hash = 0;
    for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
    el.className = "dd-avatar";
    el.style.background = COLORS[hash % COLORS.length];
    el.textContent = (email.split("@")[0][0] || "?").toUpperCase();
    return el;
  }

  function wantsAvatar(select, value) {
    return select.dataset.avatar === "1" && String(value).includes("@");
  }

  function syncOne(select) {
    const dd = select._dd;
    if (!dd) return;

    const opt = select.options[select.selectedIndex];
    const empty = !opt || opt.value === "";
    const placeholder = select.dataset.placeholder;
    const text = empty && placeholder ? placeholder : opt ? opt.textContent.trim() : "";
    const key = [text, empty, select.disabled, opt ? opt.value : ""].join("|");

    if (dd.key === key) return;
    dd.key = key;

    dd.label.textContent = "";
    if (opt && wantsAvatar(select, opt.value)) dd.label.appendChild(avatar(opt.value));

    const span = document.createElement("span");
    span.className = "dd-text";
    span.textContent = text;
    dd.label.appendChild(span);

    dd.wrap.classList.toggle("is-empty", empty);
    dd.btn.disabled = select.disabled;
  }

  function enhance(select) {
    if (select._dd || select.multiple || select.dataset.native === "1") return;

    const wrap = document.createElement("div");
    wrap.className = "dd";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd-btn";
    btn.setAttribute("aria-haspopup", "listbox");

    const label = document.createElement("span");
    label.className = "dd-label";
    btn.appendChild(label);
    btn.insertAdjacentHTML("beforeend", CHEVRON);
    wrap.appendChild(btn);

    select.insertAdjacentElement("afterend", wrap);
    select.classList.add("dd-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select._dd = { wrap, btn, label, key: null };

    btn.addEventListener("click", () => toggle(select));
    btn.addEventListener("keydown", (e) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        if (!open || open.select !== select) openMenu(select);
      }
    });
    select.addEventListener("change", () => syncOne(select));

    syncOne(select);
  }

  function toggle(select) {
    if (open && open.select === select) closeMenu();
    else openMenu(select);
  }

  function closeMenu(refocus) {
    if (!open) return;
    const { select, menu } = open;
    menu.remove();
    select._dd.wrap.classList.remove("open");
    select._dd.btn.setAttribute("aria-expanded", "false");
    if (refocus !== false && document.contains(select._dd.btn)) select._dd.btn.focus();
    open = null;
  }

  function choose(select, value) {
    closeMenu();
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    syncOne(select);
  }

  function openMenu(select) {
    closeMenu(false);
    const dd = select._dd;
    if (!dd || select.disabled) return;

    const menu = document.createElement("div");
    menu.className = "dd-menu";
    menu.setAttribute("role", "listbox");
    menu.tabIndex = -1;

    let search = null;
    if (select.options.length > 8) {
      search = document.createElement("input");
      search.type = "text";
      search.className = "dd-search";
      search.placeholder = "Search…";
      search.setAttribute("autocomplete", "off");
      menu.appendChild(search);
    }

    const list = document.createElement("div");
    list.className = "dd-list";
    menu.appendChild(list);

    const items = [];
    const groups = [];

    function addOption(opt, group) {
      const el = document.createElement("div");
      el.className = "dd-opt";
      el.setAttribute("role", "option");

      if (opt.value === "__other") el.classList.add("dd-opt-action");
      if (opt.value === select.value) el.classList.add("selected");
      if (opt.disabled) el.classList.add("disabled");

      if (wantsAvatar(select, opt.value)) el.appendChild(avatar(opt.value));

      const text = document.createElement("span");
      text.className = "dd-text";
      text.textContent = opt.textContent.trim();
      el.appendChild(text);
      el.insertAdjacentHTML("beforeend", CHECK);

      const item = { el, value: opt.value, label: text.textContent.toLowerCase(), disabled: opt.disabled, group };
      items.push(item);
      if (group) group.items.push(item);

      el.addEventListener("click", () => {
        if (!item.disabled) choose(select, opt.value);
      });
      el.addEventListener("mousemove", () => setActive(items.indexOf(item), false));

      list.appendChild(el);
    }

    [...select.children].forEach((child) => {
      if (child.tagName === "OPTGROUP") {
        const head = document.createElement("div");
        head.className = "dd-group";
        head.textContent = child.label;
        list.appendChild(head);
        const group = { head, items: [] };
        groups.push(group);
        [...child.children].forEach((o) => addOption(o, group));
      } else if (child.tagName === "OPTION") {
        addOption(child, null);
      }
    });

    const none = document.createElement("div");
    none.className = "dd-empty";
    none.textContent = "No matches";
    none.style.display = "none";
    list.appendChild(none);

    open = { select, dd, menu, items, active: -1, search };
    dd.wrap.classList.add("open");
    dd.btn.setAttribute("aria-expanded", "true");
    document.body.appendChild(menu);

    position(dd, menu, list);

    const selectedIdx = items.findIndex((i) => i.value === select.value && !i.disabled);
    setActive(selectedIdx >= 0 ? selectedIdx : firstVisible(items, 0, 1), true);

    function visibleIdx(from, step) {
      for (let i = from; i >= 0 && i < items.length; i += step) {
        if (!items[i].disabled && items[i].el.style.display !== "none") return i;
      }
      return -1;
    }
    function firstVisible(arr, from, step) { return visibleIdx(from, step); }

    function applyFilter() {
      const q = search.value.trim().toLowerCase();
      items.forEach((i) => (i.el.style.display = !q || i.label.includes(q) ? "" : "none"));
      groups.forEach((g) => (g.head.style.display = g.items.some((i) => i.el.style.display !== "none") ? "" : "none"));
      none.style.display = items.some((i) => i.el.style.display !== "none") ? "none" : "";
      setActive(visibleIdx(0, 1), true);
    }
    if (search) search.addEventListener("input", applyFilter);

    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // do not also close a surrounding modal
        closeMenu();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const n = visibleIdx(open.active + 1, 1);
        if (n !== -1) setActive(n, true);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const n = visibleIdx(open.active - 1, -1);
        if (n !== -1) setActive(n, true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (open.active >= 0) choose(select, items[open.active].value);
      } else if (e.key === "Tab") {
        closeMenu();
      }
    });

    (search || menu).focus();
  }

  function setActive(idx, scroll) {
    if (!open) return;
    open.items.forEach((i) => i.el.classList.remove("active"));
    open.active = idx;
    if (idx < 0 || !open.items[idx]) return;
    const el = open.items[idx].el;
    el.classList.add("active");
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }

  function position(dd, menu, list) {
    const r = dd.btn.getBoundingClientRect();
    menu.style.minWidth = Math.max(r.width, 200) + "px";
    menu.style.left = "0px";
    menu.style.top = "0px";
    list.style.maxHeight = "260px";

    const naturalH = menu.offsetHeight;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const placeAbove = naturalH > below && above > below;
    const avail = placeAbove ? above : below;

    const chrome = naturalH - list.offsetHeight;
    list.style.maxHeight = Math.max(120, Math.min(260, avail - chrome)) + "px";

    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    menu.style.top = (placeAbove ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + "px";
    menu.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)) + "px";
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      if (open && !open.menu.contains(e.target) && !open.dd.wrap.contains(e.target)) closeMenu(false);
    },
    true
  );
  window.addEventListener("resize", () => closeMenu(false));
  window.addEventListener(
    "scroll",
    (e) => {
      if (open && !open.menu.contains(e.target)) closeMenu(false);
    },
    true
  );

  function enhanceAll(root) {
    (root || document).querySelectorAll("select").forEach(enhance);
  }

  function syncAll() {
    document.querySelectorAll("select").forEach((s) => {
      if (s._dd) syncOne(s);
    });
    if (open && !document.contains(open.select)) closeMenu(false);
  }

  window.syncDropdowns = function () {
    enhanceAll();
    syncAll();
  };

  // Upgrade selects the moment they appear (modals, re-rendered tables,
  // filters) -- before the browser paints, so there is no flash.
  const observer = new MutationObserver((records) => {
    const outside = records.some((rec) => {
      const el = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
      return !(el && el.closest && el.closest(".dd, .dd-menu"));
    });
    if (!outside) return;

    enhanceAll();
    syncAll();
    observer.takeRecords(); // ignore the changes we just made ourselves
  });

  function start() {
    enhanceAll();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
