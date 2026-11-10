/* =========================================================================
   UTILIDADES — helpers genéricos usados en varias pantallas
   ========================================================================= */

export const $ = (sel) => document.querySelector(sel);

export const show = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
};

let toastTimer;
export const toast = (msg, ms = 2200) => {
  const t = $("#toast");
  t.classList.remove("con-accion");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
};

// Aviso con un botón (por ejemplo "Reintentar").
export function toastAccion(msg, etiqueta, fn, ms = 9000) {
  const t = $("#toast");
  t.innerHTML = "";
  const s = document.createElement("span");
  s.textContent = msg;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "toast-accion";
  b.textContent = etiqueta;
  b.addEventListener("click", () => { t.classList.remove("show"); fn(); });
  t.append(s, b);
  t.classList.add("show", "con-accion");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// Mensaje de error en palabras normales (nada de "revisa la consola").
export function mensajeError(err, que = "guardar esto") {
  const c = err?.code || "";
  if (c === "permission-denied") return `No tienes permiso para ${que}. Avisa a administración.`;
  if (navigator.onLine === false || ["unavailable", "deadline-exceeded"].includes(c)) {
    return "No hay conexión. Revisa tu internet y toca Reintentar.";
  }
  return "Algo salió mal. Toca Reintentar; si sigue igual, avisa a administración.";
}

// Con el modo sin conexión de Firestore, una escritura sin internet NO termina hasta que
// vuelve la señal. Esto espera un momento y, si no hay respuesta, la da por "pendiente"
// (queda guardada en el teléfono y se envía sola). Los errores reales sí se propagan.
export async function guardarSeguro(promesa, ms = 5000) {
  promesa.catch(e => console.warn("Escritura:", e?.code || e));
  const espera = navigator.onLine === false ? 900 : ms;
  let timer;
  const limite = new Promise(res => { timer = setTimeout(() => res("pendiente"), espera); });
  try {
    return await Promise.race([promesa.then(() => "ok"), limite]);
  } finally {
    clearTimeout(timer);
  }
}

// Cuadro de pregunta con botones claros. Devuelve el id del botón elegido
// ("cancelar" si se cierra tocando fuera o con Escape).
export function preguntar({ titulo, texto, botones }) {
  return new Promise(resolve => {
    const fondo = document.createElement("div");
    fondo.className = "dlg-fondo";
    const caja = document.createElement("div");
    caja.className = "dlg";
    caja.setAttribute("role", "dialog");
    caja.setAttribute("aria-modal", "true");
    const h = document.createElement("h3"); h.textContent = titulo;
    const p = document.createElement("p"); p.textContent = texto;
    const fila = document.createElement("div"); fila.className = "dlg-botones";
    const cerrar = (v) => { document.removeEventListener("keydown", onKey); fondo.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") cerrar("cancelar"); };
    botones.forEach(b => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "dlg-btn " + (b.tipo || "suave");
      el.textContent = b.label;
      el.addEventListener("click", () => cerrar(b.id));
      fila.appendChild(el);
    });
    caja.append(h, p, fila);
    fondo.appendChild(caja);
    fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar("cancelar"); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(fondo);
    fila.querySelector(".dlg-btn")?.focus();
  });
}

export const initials = (name) => (name || "?").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

// "hace 5 min" / "hace 3 h" / "ayer" / "hace 4 días" / fecha corta si es más vieja.
export function tiempoRelativo(fecha) {
  if (!fecha) return "";
  const diffMin = Math.floor((Date.now() - fecha.getTime()) / 60000);
  if (diffMin < 1) return "justo ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHoras = Math.floor(diffMin / 60);
  if (diffHoras < 24) return `hace ${diffHoras} h`;
  const diffDias = Math.floor(diffHoras / 24);
  if (diffDias === 1) return "ayer";
  if (diffDias < 7) return `hace ${diffDias} días`;
  return fecha.toLocaleDateString("es-BO", { day: "numeric", month: "short" });
}

export function escapeCsv(value) {
  const v = String(value ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function downloadTextFile(text, filename) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Engancha cada botón .pw-toggle con su input (por data-target) para
// mostrar/ocultar la contraseña con un ícono (no emoji), alternando el
// type del input entre "password" y "text".
export function wirePasswordToggles() {
  document.querySelectorAll(".pw-toggle").forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    btn.addEventListener("click", () => {
      const mostrando = input.type === "text";
      input.type = mostrando ? "password" : "text";
      btn.classList.toggle("showing", !mostrando);
      btn.setAttribute("aria-label", mostrando ? "Mostrar contraseña" : "Ocultar contraseña");
    });
  });
}