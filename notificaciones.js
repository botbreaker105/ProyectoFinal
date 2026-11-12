/* =========================================================================
   NOTIFICACIONES — campana con contador + pantalla de avisos.
   - Admin: ve las SOLICITUDES de registro pendientes (docentes/{uid}.estado
     == "pendiente") y puede aceptarlas o rechazarlas. Puede quitar cursos
     de lo que pidió el docente antes de aceptar.
   - Todos (Admin y Docente): ven sus AVISOS personales, guardados en
     Firestore: notificaciones/{id} =
       { destinatarioId, tipo, titulo, texto, leida, creado }
   Al aceptar/rechazar una solicitud se le crea un aviso al docente.
   ========================================================================= */
import {
  collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp, writeBatch, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, show, toast, initials, tiempoRelativo } from "./utils.js";
import { state } from "./state.js";
import { esc } from "./filiacion.js";
import { crearDropdown } from "./dropdown.js";
import { leerActividad, marcarActividadLeida, noLeida } from "./actividad.js";
import { comisionActual } from "./comisiones.js";

const esAdmin = () => state.currentTeacherDoc?.tipo === "Admin";

async function leerSolicitudes() {
  if (!esAdmin()) return [];
  const snap = await getDocs(query(collection(db, "docentes"), where("estado", "==", "pendiente")));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.aprobado !== true) // ya aprobadas a mano (aprobado = true) no son solicitudes
    .sort((a, b) => (a.creado?.toMillis?.() || 0) - (b.creado?.toMillis?.() || 0));
}

async function leerAvisos() {
  const uid = state.currentUser?.uid;
  if (!uid) return [];
  try {
    const snap = await getDocs(query(collection(db, "notificaciones"), where("destinatarioId", "==", uid)));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0))
      .slice(0, 50);
  } catch (err) {
    console.warn("No se pudieron leer los avisos (¿reglas de Firestore?):", err);
    return [];
  }
}

// Crea un aviso para otro usuario. Nunca rompe el flujo principal si falla.
export async function crearAviso(destinatarioId, tipo, titulo, texto) {
  try {
    await addDoc(collection(db, "notificaciones"), {
      destinatarioId, tipo, titulo, texto, leida: false, creado: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("No se pudo crear el aviso:", err);
    return false;
  }
}

function pintarBadge(n) {
  const b = $("#notif-badge");
  if (!b) return;
  b.textContent = n > 9 ? "9+" : String(n);
  b.style.display = n > 0 ? "flex" : "none";
}

// Cuántas cosas pendientes hay de cada tipo (el contador de la campana es la suma).
const cnt = { sol: 0, act: 0, avisos: 0 };
const repintar = () => pintarBadge(cnt.sol + cnt.act + cnt.avisos);

async function leerActividadAdmin() {
  if (!esAdmin()) return [];
  try { return await leerActividad(40); }
  catch (err) { console.warn("No se pudo leer la actividad (¿reglas de Firestore?):", err); return []; }
}

export async function actualizarBadgeNotificaciones() {
  try {
    const uid = state.currentUser?.uid;
    const [sol, avisos, act] = await Promise.all([leerSolicitudes().catch(() => []), leerAvisos(), leerActividadAdmin()]);
    cnt.sol = sol.length;
    cnt.avisos = avisos.filter(a => !a.leida).length;
    cnt.act = act.filter(e => noLeida(e, uid)).length;
    repintar();
  } catch (err) {
    console.error(err);
  }
}

export async function abrirNotificaciones() {
  const admin = esAdmin();
  $("#notif-solicitudes-wrap").style.display = admin ? "block" : "none";
  $("#notif-actividad-wrap").style.display = admin ? "block" : "none";
  $("#notif-enviar-wrap").style.display = admin ? "block" : "none";
  $("#notif-enviadas-wrap").style.display = admin ? "block" : "none";
  $("#notif-enviadas").innerHTML = `<div class="empty-state">Cargando…</div>`;
  $("#notif-solicitudes").innerHTML = `<div class="empty-state">Cargando…</div>`;
  $("#notif-actividad").innerHTML = `<div class="empty-state">Cargando…</div>`;
  $("#notif-avisos").innerHTML = `<div class="empty-state">Cargando…</div>`;
  show("#screen-notificaciones");
  window.scrollTo(0, 0);

  const [sol, avisos, act, env] = await Promise.all([
    leerSolicitudes().catch(err => { console.error(err); return null; }),
    leerAvisos(),
    leerActividadAdmin(),
    admin ? leerEnviadas() : []
  ]);
  if (admin) { renderSolicitudes(sol); renderActividad(act); renderEnviadas(env); }
  renderAvisos(avisos);
  cnt.sol = sol?.length || 0;
  cnt.avisos = 0; // los avisos quedan leídos al abrir la pantalla
  cnt.act = admin ? act.filter(e => noLeida(e, state.currentUser.uid)).length : 0;
  repintar();
}

/* ------------------------------ SOLICITUDES ------------------------------ */
function renderSolicitudes(lista) {
  const box = $("#notif-solicitudes");
  if (lista === null) { box.innerHTML = `<div class="empty-state">No se pudieron cargar las solicitudes.</div>`; return; }
  $("#notif-sol-count").textContent = lista.length ? `(${lista.length})` : "";
  if (!lista.length) { box.innerHTML = `<div class="card"><div class="empty-state">No hay solicitudes pendientes.</div></div>`; return; }
  box.innerHTML = "";
  lista.forEach(s => box.appendChild(tarjetaSolicitud(s)));
}

function tarjetaSolicitud(s) {
  const materias = s.materiasSolicitadas || [];
  const pideAdmin = s.rolSolicitado === "Admin";
  const card = document.createElement("div");
  card.className = "sol-card";
  const cuando = s.creado?.toDate ? tiempoRelativo(s.creado.toDate()) : "";
  card.innerHTML = `
    <div class="sol-top">
      <div class="roster-avatar">${esc(initials(s.nombre))}</div>
      <div style="flex:1; min-width:0;">
        <div class="sol-nombre">${esc(s.nombre || "Sin nombre")}</div>
        <div class="sol-meta">@${esc(s.usuario || "")}${cuando ? " · " + esc(cuando) : ""}</div>
      </div>
    </div>
    ${pideAdmin ? `<div class="sol-materias"><div class="sol-materia">
      <div class="sol-materia-nombre">Pide acceso de administración</div>
      <div class="hint-text" style="margin:0;">Rol indicado: <b>${esc(s.rol || "—")}</b>. Si aceptas, tendrá permisos de Admin sobre toda la app. Acepta solo si conoces a esta persona.</div>
    </div></div>` : `
    <div class="sol-materias">
      ${materias.length ? materias.map((m, i) => `
        <div class="sol-materia">
          <div class="sol-materia-nombre">${esc(m.materia)}</div>
          <div class="sol-chips">
            ${(m.cursos || []).map(c => `<button type="button" class="sol-chip on" data-m="${i}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}
          </div>
        </div>`).join("") : `<div class="hint-text" style="margin:0;">No pidió ninguna materia.</div>`}
    </div>
    <p class="hint-text" style="margin:8px 0 0;">Toca un curso para quitarlo antes de aceptar.</p>
`}
    <div class="sol-actions">
      <button type="button" class="btn-outline sol-rechazar">Rechazar</button>
      <button type="button" class="btn-save sol-aceptar">Aceptar</button>
    </div>
  `;
  card.querySelectorAll(".sol-chip").forEach(ch => ch.addEventListener("click", () => ch.classList.toggle("on")));

  const botones = card.querySelectorAll(".sol-actions button");
  const bloquear = (v) => botones.forEach(b => b.disabled = v);

  card.querySelector(".sol-aceptar").addEventListener("click", async () => {
    if (pideAdmin) {
      if (!window.confirm(`¿Dar acceso de ADMINISTRACIÓN a ${s.nombre}? Podrá ver y cambiar todo.`)) return;
      bloquear(true);
      try {
        await updateDoc(doc(db, "docentes", s.id), { tipo: "Admin", estado: "activo", aprobado: true, materia: "", materias: [], cursos: [] });
        await crearAviso(s.id, "solicitud_aprobada", "Solicitud aprobada", "Ya puedes entrar con acceso de administración.");
        toast(`${s.nombre} ahora es Admin`);
        card.remove();
        await refrescarTrasResolver();
      } catch (err) {
        console.error(err);
        toast("No se pudo aceptar. Si sigue igual, avisa a quien administra la app.");
        bloquear(false);
      }
      return;
    }
    // Lo que queda marcado = lo que se concede.
    const concedidas = materias
      .map((m, i) => ({
        materia: m.materia,
        cursos: [...card.querySelectorAll(`.sol-chip.on[data-m="${i}"]`)].map(c => c.dataset.c)
      }))
      .filter(m => m.cursos.length);
    if (!concedidas.length) { toast("Deja al menos un curso marcado, o rechaza la solicitud"); return; }
    const cursos = [...new Set(concedidas.flatMap(m => m.cursos))];
    bloquear(true);
    try {
      await updateDoc(doc(db, "docentes", s.id), {
        tipo: "Docente",
        estado: "activo",
        aprobado: true,
        materia: concedidas[0].materia,
        materias: concedidas,
        cursos
      });
      await crearAviso(s.id, "solicitud_aprobada", "Solicitud aprobada",
        `Ya puedes entrar. Materias asignadas: ${concedidas.map(m => `${m.materia} (${m.cursos.join(", ")})`).join(" · ")}`);
      toast(`${s.nombre} fue aceptado/a`);
      card.remove();
      await refrescarTrasResolver();
    } catch (err) {
      console.error(err);
      toast("No se pudo aceptar. Si sigue igual, avisa a quien administra la app.");
      bloquear(false);
    }
  });

  card.querySelector(".sol-rechazar").addEventListener("click", async () => {
    if (!window.confirm(`¿Rechazar la solicitud de ${s.nombre}?`)) return;
    bloquear(true);
    try {
      await updateDoc(doc(db, "docentes", s.id), { estado: "rechazado", aprobado: false });
      await crearAviso(s.id, "solicitud_rechazada", "Solicitud no aprobada",
        "Administración no aprobó tu solicitud. Habla con administración si crees que es un error.");
      toast("Solicitud rechazada");
      card.remove();
      await refrescarTrasResolver();
    } catch (err) {
      console.error(err);
      toast("No se pudo rechazar. Si sigue igual, avisa a quien administra la app.");
      bloquear(false);
    }
  });
  return card;
}

async function refrescarTrasResolver() {
  const restantes = await leerSolicitudes().catch(() => []);
  renderSolicitudes(restantes);
  cnt.sol = restantes.length;
  repintar();
}

/* --------------------------------- AVISOS -------------------------------- */
const ICONO_AVISO = {
  solicitud_aprobada: "✓", solicitud_rechazada: "✕",
  aviso: "i", evento: "★", reunion: "◷", citacion: "✉", reporte_asesor: "!", informe: "▤"
};
const fmtFechaAviso = (iso) => iso
  ? new Date(iso + "T00:00:00").toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })
  : "";

function renderAvisos(avisos) {
  const box = $("#notif-avisos");
  if (!avisos.length) { box.innerHTML = `<div class="empty-state">No tienes avisos.</div>`; return; }
  box.innerHTML = avisos.map(a => `
    <div class="aviso${a.leida ? "" : " nuevo"}">
      <div class="aviso-ico ${esc(a.tipo || "")}">${ICONO_AVISO[a.tipo] || "•"}</div>
      <div style="flex:1; min-width:0;">
        <div class="aviso-titulo">${esc(a.titulo || "Aviso")}</div>
        <div class="aviso-texto">${esc(a.texto || "")}</div>
        ${(a.fecha || a.lugar) ? `<div class="aviso-evento">
          ${a.fecha ? `<span>${esc(fmtFechaAviso(a.fecha))}${a.hora ? " · " + esc(a.hora) : ""}</span>` : ""}
          ${a.lugar ? `<span>${esc(a.lugar)}</span>` : ""}
        </div>` : ""}
        ${a.confirmar ? (a.confirmada
          ? `<div class="aviso-ok">✓ Confirmaste que lo viste</div>`
          : `<button type="button" class="btn-entendido" data-id="${esc(a.id)}">Entendido</button>`) : ""}
        <div class="sol-meta">${a.remitenteNombre ? "De: " + esc(a.remitenteNombre) + " · " : ""}${a.privado ? "Privado · " : ""}${a.creado?.toDate ? esc(tiempoRelativo(a.creado.toDate())) : ""}</div>
      </div>
    </div>`).join("");
  box.querySelectorAll(".btn-entendido").forEach(btn => btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "notificaciones", btn.dataset.id), { confirmada: true, confirmadaEn: serverTimestamp(), leida: true });
      const ok = document.createElement("div");
      ok.className = "aviso-ok";
      ok.textContent = "✓ Confirmaste que lo viste";
      btn.replaceWith(ok);
      toast("Gracias, quedó confirmado");
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast("No se pudo confirmar. Revisa tu conexión e inténtalo de nuevo.");
    }
  }));
  // Se marcan como leídos al abrir la pantalla (si las reglas lo impiden, solo avisa en consola).
  avisos.filter(a => !a.leida).forEach(a =>
    updateDoc(doc(db, "notificaciones", a.id), { leida: true, leidaEn: serverTimestamp() }).catch(e => console.warn(e))
  );
}

export function initNotificacionesUI() {
  initComposer();
  $("#btn-back-actdet").addEventListener("click", abrirNotificaciones);
  $("#btn-notif").addEventListener("click", abrirNotificaciones);
  $("#btn-back-notif").addEventListener("click", () => {
    show("#screen-home");
    actualizarBadgeNotificaciones();
  });
}


/* =========================================================================
   ENVIAR NOTIFICACIÓN (solo Admin) — a todos los docentes o a uno en privado
   ========================================================================= */
const TIPOS_NOTIF = [
  { value: "aviso",    label: "Aviso general",  sub: "Un comunicado simple" },
  { value: "evento",   label: "Evento",         sub: "Con fecha, hora y lugar" },
  { value: "reunion",  label: "Reunión",        sub: "Programar una reunión" },
  { value: "citacion", label: "Citación",       sub: "Normalmente para un docente en privado" }
];
const TIPOS_CON_FECHA = ["evento", "reunion", "citacion"];
const TODOS = "__todos__";

let ddTipo = null, ddDest = null, docentesEnvio = null;

async function cargarDocentesEnvio() {
  if (docentesEnvio) return docentesEnvio;
  const snap = await getDocs(collection(db, "docentes"));
  docentesEnvio = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.id !== state.currentUser?.uid && !["pendiente", "rechazado", "inactivo"].includes(d.estado))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  return docentesEnvio;
}

function opcionesDestino(docs) {
  return [
    { value: TODOS, label: `Todos los docentes (${docs.length})`, sub: "Mensaje general para todos" },
    ...docs.map(d => ({
      value: d.id,
      label: d.nombre || d.usuario || "Sin nombre",
      sub: (d.materias || []).map(m => m.materia).join(" · ") || d.materia || "Docente"
    }))
  ];
}

function actualizarCamposTipo() {
  const conFecha = TIPOS_CON_FECHA.includes(ddTipo.value);
  $("#notif-fecha-row").style.display = conFecha ? "flex" : "none";
  $("#notif-lugar-wrap").style.display = conFecha ? "block" : "none";
}

function initComposer() {
  ddTipo = crearDropdown($("#dd-notif-tipo"), {
    placeholder: "Tipo de notificación", opciones: TIPOS_NOTIF, valor: "aviso",
    onChange: actualizarCamposTipo
  });
  ddDest = crearDropdown($("#dd-notif-dest"), { placeholder: "¿A quién se la envías?", buscar: true });

  $("#btn-nueva-notif").addEventListener("click", async () => {
    const form = $("#notif-form");
    const abrir = form.style.display === "none";
    form.style.display = abrir ? "block" : "none";
    $("#btn-nueva-notif").textContent = abrir ? "Cerrar" : "+ Nueva notificación";
    if (!abrir) return;
    actualizarCamposTipo();
    try { ddDest.setOptions(opcionesDestino(await cargarDocentesEnvio())); }
    catch (err) { console.error(err); toast("No se pudo cargar la lista de docentes"); }
  });
  $("#btn-enviar-notif").addEventListener("click", enviarNotificacion);
}

async function enviarNotificacion() {
  const status = $("#notif-enviar-status");
  const rojo = (t) => { status.style.color = "var(--sello-rojo)"; status.textContent = t; };
  const tipo = ddTipo.value, dest = ddDest.value;
  const titulo = $("#notif-titulo").value.trim();
  const texto = $("#notif-texto").value.trim();
  const fecha = $("#notif-fecha").value, hora = $("#notif-hora").value;
  const lugar = $("#notif-lugar").value.trim();
  const conFecha = TIPOS_CON_FECHA.includes(tipo);

  if (!tipo) return rojo("Elige el tipo de notificación.");
  if (!dest) return rojo("Elige a quién se la envías.");
  if (!titulo) return rojo("Ponle un título.");
  if (tipo !== "citacion" && !texto && !conFecha) return rojo("Escribe el mensaje.");
  if ((tipo === "evento" || tipo === "reunion") && !fecha) return rojo("Elige la fecha.");

  const docs = await cargarDocentesEnvio().catch(() => []);
  const destinatarios = dest === TODOS ? docs : docs.filter(d => d.id === dest);
  if (!destinatarios.length) return rojo("No hay docentes a quienes enviar.");
  if (dest === TODOS && !window.confirm(`¿Enviar «${titulo}» a ${destinatarios.length} docentes?`)) return;

  const btn = $("#btn-enviar-notif");
  btn.disabled = true;
  status.style.color = "var(--ink-soft)";
  status.textContent = "Enviando…";
  try {
    const envioId = doc(collection(db, "notificaciones")).id; // agrupa lo enviado a varios docentes
    const base = {
      envioId,
      confirmar: ["reunion", "citacion", "evento"].includes(tipo),
      tipo, titulo, texto,
      ...(conFecha && fecha ? { fecha } : {}),
      ...(conFecha && hora ? { hora } : {}),
      ...(conFecha && lugar ? { lugar } : {}),
      privado: dest !== TODOS,
      remitenteId: state.currentUser.uid,
      remitenteNombre: state.currentTeacherDoc?.nombre || "Administración"
    };
    for (let i = 0; i < destinatarios.length; i += 400) {
      const batch = writeBatch(db);
      destinatarios.slice(i, i + 400).forEach(d => {
        batch.set(doc(collection(db, "notificaciones")), {
          ...base, destinatarioId: d.id, destinatarioNombre: d.nombre || d.usuario || "", leida: false, creado: serverTimestamp()
        });
      });
      await batch.commit();
    }
    status.style.color = "var(--sello-verde)";
    status.textContent = dest === TODOS
      ? `Enviada a ${destinatarios.length} docentes.`
      : `Enviada a ${destinatarios[0].nombre || "el docente"}.`;
    toast("Notificación enviada");
    leerEnviadas().then(renderEnviadas).catch(() => {});
    ["#notif-titulo", "#notif-texto", "#notif-fecha", "#notif-hora", "#notif-lugar"].forEach(s => { $(s).value = ""; });
    ddDest.reset();
  } catch (err) {
    console.error(err);
    rojo("No se pudo enviar. Si sigue igual, avisa a quien administra la app.");
  } finally {
    btn.disabled = false;
  }
}


/* =========================================================================
   ACTIVIDAD DE DOCENTES (solo Admin): reportes y registros de clase
   ========================================================================= */
const TIPOS_REGISTRO_LBL = {
  clase: "Clase regular", evaluacion: "Evaluación",
  proyecto: "Trabajo / proyecto", incidencia: "Incidencia / Irregularidad"
};
const ETIQUETA_ASIS = { P: "Presente", F: "Falta", A: "Atraso", L: "Licencia" };
let actividadCache = [];

const contar = (reg) => {
  const v = Object.values(reg || {});
  return { P: v.filter(x => x === "P").length, F: v.filter(x => x === "F").length,
           A: v.filter(x => x === "A").length, L: v.filter(x => x === "L").length };
};
const horaDe = (ts) => ts?.toDate ? ts.toDate().toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }) : "";
const cuandoDe = (ts) => ts?.toDate ? ts.toDate().toLocaleString("es-BO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const corto = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

function renderActividad(lista) {
  actividadCache = lista;
  const box = $("#notif-actividad");
  const uid = state.currentUser.uid;
  const sinLeer = lista.filter(e => noLeida(e, uid)).length;
  $("#notif-act-count").textContent = sinLeer ? `(${sinLeer} nuevas)` : "";
  if (!lista.length) { box.innerHTML = `<div class="empty-state">Todavía no hay actividad de docentes.</div>`; return; }
  box.innerHTML = lista.map(e => {
    const nuevo = noLeida(e, uid) ? " nuevo" : "";
    const quien = `<b>${esc(e.docenteNombre || "Un docente")}</b>`;
    const meta = [horaDe(e.creado), e.creado?.toDate ? tiempoRelativo(e.creado.toDate()) : ""].filter(Boolean).join(" · ");
    if (e.tipo === "reporte") {
      return `
        <div class="aviso clic${nuevo}" role="button" tabindex="0" data-id="${esc(e.id)}">
          <div class="aviso-ico reporte">!</div>
          <div style="flex:1; min-width:0;">
            <div class="aviso-titulo">${quien} hizo un reporte</div>
            <div class="aviso-texto">${esc(e.estudiante || "")} · ${esc(e.curso || "")}</div>
            <div class="act-chips">
              ${e.comision ? `<span class="act-chip">${esc(comisionActual(e.comision))}</span>` : ""}
              ${e.tipoReporte ? `<span class="act-chip">${esc(e.tipoReporte)}</span>` : ""}
            </div>
            <div class="sol-meta">${esc(meta)}</div>
          </div>
        </div>`;
    }
    const chips = [];
    if (e.asistencia) {
      const c = contar(e.asistencia.registros);
      chips.push(`Asistencia: ${c.P} P · ${c.F} F · ${c.A} A${c.L ? ` · ${c.L} L` : ""}`);
    }
    if (e.tarea) chips.push("Tarea: sí");
    else if (e.completo) chips.push("Sin tarea");
    return `
      <div class="aviso clic${nuevo}" role="button" tabindex="0" data-id="${esc(e.id)}">
        <div class="aviso-ico registro">≡</div>
        <div style="flex:1; min-width:0;">
          <div class="aviso-titulo">${quien} subió un registro</div>
          <div class="aviso-texto">${esc(e.cursoNombre || e.cursoId || "")}${e.materia ? " · " + esc(e.materia) : ""}${e.log?.texto ? `<br>«${esc(corto(e.log.texto, 90))}»` : ""}</div>
          <div class="act-chips">${chips.map(c => `<span class="act-chip">${esc(c)}</span>`).join("")}</div>
          <div class="sol-meta">${esc(meta)}</div>
        </div>
      </div>`;
  }).join("");
  box.querySelectorAll(".aviso.clic").forEach(el => {
    const abrir = () => abrirDetalleActividad(el.dataset.id);
    el.addEventListener("click", abrir);
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } });
  });
}

async function abrirDetalleActividad(id) {
  const e = actividadCache.find(x => x.id === id);
  if (!e) return;
  const uid = state.currentUser.uid;
  if (noLeida(e, uid)) {
    e.leidoPor = [...(e.leidoPor || []), uid];
    marcarActividadLeida(id, uid);
    cnt.act = Math.max(0, cnt.act - 1);
    repintar();
  }
  const esReporte = e.tipo === "reporte";
  $("#actdet-sub").textContent = (e.docenteNombre || "Docente").toUpperCase();
  $("#actdet-fecha").textContent = cuandoDe(e.creado);
  $("#actdet-titulo").textContent = esReporte ? "Reporte" : "Registro de clase";
  const body = $("#actdet-body");
  body.innerHTML = `<div class="empty-state">Cargando…</div>`;
  show("#screen-actividad-detalle");
  window.scrollTo(0, 0);
  body.innerHTML = esReporte ? detalleReporteHTML(e) : await detalleRegistroHTML(e);
}

const campo = (titulo, valor) => valor
  ? `<div class="det-campo"><div class="det-campo-t">${esc(titulo)}</div><div class="det-campo-v" style="white-space:pre-wrap;">${esc(valor)}</div></div>` : "";

function detalleReporteHTML(e) {
  const contactos = (e.contactos || []).map(c =>
    `<div class="roster-row"><div class="roster-name">${esc(c.rol)}${c.parentesco ? " · " + esc(c.parentesco) : ""}: ${esc(c.nombre || "—")}</div><div class="hint-text" style="margin:0;">${esc(c.telefono || "")}</div></div>`
  ).join("");
  return `
    <div class="card">
      ${campo("Estudiante", e.estudiante)}
      ${campo("Curso", e.curso)}
      ${campo("Comisión", e.comision ? comisionActual(e.comision) : "")}
      ${campo("Tipo", e.tipoReporte)}
      ${campo("Descripción", e.descripcion)}
      ${campo("Acción tomada", e.accion)}
      ${campo("Reportado por", e.docenteNombre)}
    </div>
    ${contactos ? `<p class="section-title">Contactos</p><div class="card">${contactos}</div>` : ""}`;
}

async function detalleRegistroHTML(e) {
  let html = `<div class="card">
    ${campo("Curso", e.cursoNombre || e.cursoId)}
    ${campo("Materia", e.materia)}
    ${campo("Docente", e.docenteNombre)}
    ${campo("Hora del registro", cuandoDe(e.creado))}
  </div>`;

  if (e.asistencia) {
    const reg = e.asistencia.registros || {};
    const c = contar(reg);
    let nombres = {};
    try {
      const snap = await getDocs(collection(db, "cursos", e.cursoId, "estudiantes"));
      snap.docs.forEach(d => { nombres[d.id] = d.data().nombre || ""; });
    } catch (err) { console.warn(err); }
    const ids = Object.keys(reg).sort((a, b) => (nombres[a] || a).localeCompare(nombres[b] || b, "es"));
    html += `<p class="section-title">Asistencia</p>
      <div class="attendance-summary">
        <span class="summary-chip"><i style="background:var(--sello-verde)"></i>${c.P} presente</span>
        <span class="summary-chip"><i style="background:var(--sello-rojo)"></i>${c.F} falta</span>
        <span class="summary-chip"><i style="background:var(--sello-ocre)"></i>${c.A} atraso</span>
        <span class="summary-chip"><i style="background:var(--sello-azul)"></i>${c.L} licencia</span>
      </div>
      <div class="card">${ids.map(id => {
        const cod = reg[id];
        return `<div class="roster-row"><div class="roster-avatar">${esc(initials(nombres[id] || "?"))}</div><div class="roster-name">${esc(nombres[id] || id)}</div><div class="estado-${cod ? cod.toLowerCase() : "x"}">${ETIQUETA_ASIS[cod] || "—"}</div></div>`;
      }).join("") || `<div class="empty-state">Sin estudiantes.</div>`}</div>`;
  }

  if (e.log) {
    html += `<p class="section-title">Descripción de la clase</p><div class="card">
      <div class="log-meta">${esc(TIPOS_REGISTRO_LBL[e.log.tipo] || e.log.tipo || "Registro")}</div>
      <div class="log-text" style="white-space:pre-wrap;">${esc(e.log.texto)}</div></div>`;
  }

  html += `<p class="section-title">Tarea</p><div class="card">`;
  if (e.tarea) {
    html += `
      <div class="log-meta">${e.tarea.tipo === "evaluacion" ? "Evaluación" : "Tarea"}${e.tarea.fechaEntrega ? " · entrega: " + esc(fmtFechaAviso(e.tarea.fechaEntrega)) : ""}${e.tarea.trimestre ? " · trimestre " + esc(e.tarea.trimestre) : ""}</div>
      <div class="log-text">${e.tarea.nombre ? `<b>${esc(e.tarea.nombre)}</b><br>` : ""}${esc(e.tarea.texto)}</div>`;
  } else {
    html += `<div class="empty-state">${e.completo ? "No se dio tarea en este registro." : "Este envío no incluyó tarea."}</div>`;
  }
  return html + `</div>`;
}


/* =========================================================================
   ENVIADAS (solo Admin): quién ya leyó y quién ya confirmó cada envío
   ========================================================================= */
async function leerEnviadas() {
  const uid = state.currentUser?.uid;
  try {
    const snap = await getDocs(query(collection(db, "notificaciones"), where("remitenteId", "==", uid), limit(300)));
    const grupos = new Map();
    snap.docs.forEach(d => {
      const a = d.data();
      const key = a.envioId || d.id;
      if (!grupos.has(key)) grupos.set(key, { id: key, tipo: a.tipo, titulo: a.titulo, fecha: a.fecha, hora: a.hora, confirmar: !!a.confirmar, privado: !!a.privado, creado: a.creado, filas: [] });
      const g = grupos.get(key);
      if ((a.creado?.toMillis?.() || 0) > (g.creado?.toMillis?.() || 0)) g.creado = a.creado;
      g.filas.push({ nombre: a.destinatarioNombre || "(docente)", leida: !!a.leida, confirmada: !!a.confirmada });
    });
    return [...grupos.values()].sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0)).slice(0, 15);
  } catch (err) {
    console.warn("No se pudieron leer los envíos (¿reglas de Firestore?):", err);
    return null;
  }
}

function renderEnviadas(lista) {
  const box = $("#notif-enviadas");
  if (lista === null) { box.innerHTML = `<div class="empty-state">No se pudieron cargar los envíos.</div>`; return; }
  $("#notif-env-count").textContent = "";
  if (!lista.length) { box.innerHTML = `<div class="empty-state">Todavía no enviaste notificaciones.</div>`; return; }
  box.innerHTML = lista.map(g => {
    const total = g.filas.length;
    const leyeron = g.filas.filter(f => f.leida || f.confirmada).length;
    const confirmaron = g.filas.filter(f => f.confirmada).length;
    const base = g.confirmar ? confirmaron : leyeron;
    const pct = total ? Math.round((base / total) * 100) : 0;
    const para = g.privado ? esc(g.filas[0]?.nombre || "") : `Todos los docentes (${total})`;
    const filas = [...g.filas].sort((a, b) => Number(a.confirmada) + Number(a.leida) - (Number(b.confirmada) + Number(b.leida)) || a.nombre.localeCompare(b.nombre, "es"))
      .map(f => `<div class="env-fila"><span>${esc(f.nombre)}</span><span class="env-estado ${f.confirmada ? "ok" : f.leida ? "leyo" : "no"}">${f.confirmada ? "Confirmó ✓" : f.leida ? "Leyó" : "Sin leer"}</span></div>`).join("");
    return `
      <details class="env-card">
        <summary>
          <div class="aviso-titulo">${esc(g.titulo || "Aviso")}</div>
          <div class="sol-meta">${esc(TIPOS_NOTIF.find(t => t.value === g.tipo)?.label || "Aviso")} · Para: ${para}${g.creado?.toDate ? " · " + esc(tiempoRelativo(g.creado.toDate())) : ""}</div>
          <div class="env-barra"><div style="width:${pct}%"></div></div>
          <div class="env-resumen">Leyeron ${leyeron} de ${total}${g.confirmar ? ` · Confirmaron ${confirmaron} de ${total}` : ""}</div>
        </summary>
        <div class="env-lista">${filas}</div>
      </details>`;
  }).join("");
}