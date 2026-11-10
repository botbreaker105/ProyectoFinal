/* =========================================================================
   DROPDOWNS CON EL ESTILO DEL SITIO
   - crearDropdown(host, opts)   componente base (botón + panel con lista).
   - mejorarSelect(select)       reemplaza un <select> nativo SIN romper el
                                 código existente: el <select> sigue en el DOM
                                 (oculto) y manda: .value, "change" y el
                                 relleno con innerHTML funcionan igual.
   - mejorarDatalist(input)      reemplaza la lista nativa de un <input list>
                                 por un panel propio (el input se sigue
                                 escribiendo y dispara "input"/"change").
   ========================================================================= */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const FLECHA = `<svg class="dd-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

// buscar: true | false | "auto" (el buscador aparece solo si hay más de 8 opciones)
export function crearDropdown(host, { placeholder = "Selecciona", opciones = [], buscar = false, valor = "", onChange } = {}) {
  let opts = opciones, value = valor, activo = -1;
  host.classList.add("dd");
  host.innerHTML = `
    <button type="button" class="dd-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="dd-label"></span>${FLECHA}
    </button>
    <div class="dd-panel" role="listbox" hidden>
      ${buscar ? `<input class="dd-search" type="text" placeholder="Buscar…" autocomplete="off" aria-label="Buscar">` : ""}
      <div class="dd-list"></div>
    </div>`;
  const trigger = host.querySelector(".dd-trigger");
  const label = host.querySelector(".dd-label");
  const panel = host.querySelector(".dd-panel");
  const lista = host.querySelector(".dd-list");
  const search = host.querySelector(".dd-search");
  const buscadorVisible = () => !!search && !(buscar === "auto" && opts.length <= 8);

  const pintarLabel = () => {
    const sel = opts.find(o => o.value === value);
    label.textContent = sel ? sel.label : placeholder;
    label.classList.toggle("placeholder", !sel || sel.value === "");
  };
  const visibles = () => {
    const q = buscadorVisible() ? norm(search.value.trim()) : "";
    return q ? opts.filter(o => norm(o.label + " " + (o.sub || "")).includes(q)) : opts;
  };
  const pintarLista = () => {
    const vis = visibles();
    if (!vis.length) { lista.innerHTML = `<div class="dd-empty">Sin resultados</div>`; return; }
    lista.innerHTML = vis.map((o, i) => `
      <button type="button" class="dd-item${o.value === value ? " sel" : ""}${i === activo ? " act" : ""}" role="option" data-v="${esc(o.value)}">
        <span class="dd-item-label">${esc(o.label)}</span>
        ${o.sub ? `<span class="dd-item-sub">${esc(o.sub)}</span>` : ""}
      </button>`).join("");
  };
  const cerrar = () => {
    panel.hidden = true; host.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
  };
  const abrir = () => {
    document.querySelectorAll(".dd.open").forEach(d => d !== host && d.querySelector(".dd-trigger").click());
    if (search) { search.value = ""; search.style.display = buscadorVisible() ? "" : "none"; }
    activo = -1; pintarLista();
    panel.hidden = false; host.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    if (buscadorVisible()) search.focus();
    lista.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  const elegir = (v) => {
    value = v; pintarLabel(); cerrar();
    if (onChange) onChange(v);
  };

  trigger.addEventListener("click", () => (panel.hidden ? abrir() : cerrar()));
  lista.addEventListener("click", (e) => {
    const it = e.target.closest(".dd-item");
    if (it) elegir(it.dataset.v);
  });
  if (search) search.addEventListener("input", () => { activo = -1; pintarLista(); });
  host.addEventListener("keydown", (e) => {
    if (panel.hidden) return;
    const vis = visibles();
    if (e.key === "Escape") { cerrar(); trigger.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      activo = Math.max(0, Math.min(vis.length - 1, activo + (e.key === "ArrowDown" ? 1 : -1)));
      pintarLista();
      lista.querySelector(".act")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activo >= 0 && vis[activo]) {
      e.preventDefault(); elegir(vis[activo].value);
    }
  });
  document.addEventListener("click", (e) => { if (!host.contains(e.target)) cerrar(); });

  pintarLabel();
  return {
    get value() { return value; },
    set(v) { value = v; pintarLabel(); },
    setOptions(arr) { opts = arr; if (!opts.some(o => o.value === value)) value = ""; pintarLabel(); },
    setDisabled(d) { trigger.disabled = !!d; host.classList.toggle("disabled", !!d); if (d) cerrar(); },
    reset() { value = ""; pintarLabel(); }
  };
}

/* --------------------------- <select> nativo --------------------------- */
export function mejorarSelect(sel) {
  if (!sel || sel.dataset.dd) return null;
  sel.dataset.dd = "1";
  const host = document.createElement("div");
  host.style.marginBottom = getComputedStyle(sel).marginBottom; // respeta el margen que ya tenía
  sel.insertAdjacentElement("afterend", host);
  sel.classList.add("dd-native");
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");

  const nativo = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const leer = () => [...sel.options].map(o => ({ value: o.value, label: o.textContent.trim() }));
  const dd = crearDropdown(host, {
    opciones: leer(), valor: nativo.get.call(sel), buscar: "auto",
    onChange: (v) => {
      nativo.set.call(sel, v);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const sync = () => {
    dd.setOptions(leer());
    dd.set(nativo.get.call(sel));
    dd.setDisabled(sel.disabled);
  };
  // El código existente hace `sel.value = x`: se intercepta para refrescar el panel.
  Object.defineProperty(sel, "value", {
    configurable: true,
    get() { return nativo.get.call(this); },
    set(v) { nativo.set.call(this, v); sync(); }
  });
  // ...y rellena con innerHTML / option.remove(): se observa para refrescar.
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
  sync();
  return dd;
}

/* ------------------------ <input list="..."> nativo ------------------------ */
export function mejorarDatalist(input) {
  const listId = input?.getAttribute("list");
  if (!input || !listId || input.dataset.dd) return null;
  const datalist = document.getElementById(listId);
  if (!datalist) return null;
  input.dataset.dd = "1";
  input.removeAttribute("list");
  input.setAttribute("autocomplete", "off");

  const wrap = document.createElement("div");
  wrap.className = "dd dd-combo";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const panel = document.createElement("div");
  panel.className = "dd-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="dd-list"></div>`;
  wrap.appendChild(panel);
  const lista = panel.querySelector(".dd-list");
  let activo = -1, items = [];

  const calcular = () => {
    const q = norm(input.value.trim());
    items = [...datalist.options].map(o => o.value).filter(v => v && (!q || norm(v).includes(q))).slice(0, 60);
  };
  const pintar = () => {
    calcular();
    if (!items.length) { panel.hidden = true; wrap.classList.remove("open"); return; }
    lista.innerHTML = items.map((v, i) =>
      `<button type="button" class="dd-item${i === activo ? " act" : ""}${v === input.value ? " sel" : ""}" data-v="${esc(v)}"><span class="dd-item-label">${esc(v)}</span></button>`
    ).join("");
    panel.hidden = false; wrap.classList.add("open");
  };
  const cerrar = () => { panel.hidden = true; wrap.classList.remove("open"); activo = -1; };
  const elegir = (v) => {
    input.value = v;
    cerrar();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  input.addEventListener("focus", () => { activo = -1; pintar(); });
  input.addEventListener("input", () => { activo = -1; pintar(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (panel.hidden) { pintar(); return; }
      e.preventDefault();
      activo = Math.max(0, Math.min(items.length - 1, activo + (e.key === "ArrowDown" ? 1 : -1)));
      pintar();
      lista.querySelector(".act")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && !panel.hidden && activo >= 0) {
      e.preventDefault(); elegir(items[activo]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      cerrar();
    }
  });
  lista.addEventListener("click", (e) => {
    const it = e.target.closest(".dd-item");
    if (it) elegir(it.dataset.v);
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) cerrar(); });
  return { cerrar };
}
