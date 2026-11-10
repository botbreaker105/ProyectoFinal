/* =========================================================================
   INICIO DOCENTE — clases del día, asistencia y bitácora
   ========================================================================= */
import {
  collection, query, where, getDocs, doc, getDoc, setDoc,
  addDoc, serverTimestamp, updateDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, show, toast, toastAccion, mensajeError, guardarSeguro, initials, tiempoRelativo } from "./utils.js";
import { state } from "./state.js";
import { registrarActividad } from "./actividad.js";
import { colorParaMateria } from "./reportes.js";

// ---- Cambios sin guardar + avisos de "sin conexión" ----
const MSG_PENDIENTE = "Sin conexión: guardado en tu teléfono. Se enviará cuando vuelva internet.";
let huboPendiente = false;
const sucio = { asistencia: false, log: false, tarea: false };
export const hayCambiosSinGuardar = () => sucio.asistencia || sucio.log || sucio.tarea;
export function descartarCambios() { sucio.asistencia = sucio.log = sucio.tarea = false; }
const enPantallaClase = () => !!document.querySelector("#screen-class.active");
document.addEventListener("click", (e) => {
  if (enPantallaClase() && e.target.closest(".status-btn, .ser-btn, #btn-todos-presentes")) sucio.asistencia = true;
});
document.addEventListener("input", (e) => {
  if (!enPantallaClase()) return;
  if (e.target.id === "log-texto") sucio.log = !!e.target.value.trim();
  if (/^tarea-/.test(e.target.id)) {
    sucio.tarea = !!($("#tarea-fecha").value || $("#tarea-texto").value.trim() || $("#tarea-nombre").value.trim());
  }
});
window.addEventListener("beforeunload", (e) => {
  if (hayCambiosSinGuardar()) { e.preventDefault(); e.returnValue = ""; }
});


// Un docente puede tener varias materias asignadas, cada una con su propia
// lista de cursos (state.currentTeacherDoc.materias). Para etiquetar la
// bitácora con la materia correcta (no solo la "materia principal" del
// curso), buscamos cuál de las materias asignadas a este docente incluye
// el curso actual.
function materiaDocenteParaCurso(cursoId) {
  const materias = state.currentTeacherDoc?.materias || [];
  const match = materias.find(m => (m.cursos || []).includes(cursoId));
  return match?.materia || state.activeClass?.materia || "";
}

// ASISTENCIA POR DOCENTE: cada docente guarda su propia asistencia de un curso
// en un día (así, dos docentes del mismo curso no se pisan). Id: cursoId_fecha_uid.
// Los registros viejos tenían un solo documento por curso y día (cursoId_fecha):
// se siguen leyendo, pero solo cuentan para el docente que los guardó.
const asistenciaDocId = (cursoId, fecha, uid) => `${cursoId}_${fecha}_${uid}`;

async function leerAsistenciaDia(cursoId, fecha) {
  const uid = state.currentUser.uid;
  let data = null;
  try {
    const s = await getDoc(doc(db, "asistencia", asistenciaDocId(cursoId, fecha, uid)));
    if (s.exists()) data = s.data();
  } catch (err) { console.error(err); }
  if (!data) {
    try {
      const s = await getDoc(doc(db, "asistencia", `${cursoId}_${fecha}`));
      if (s.exists() && s.data().docenteId === uid) data = s.data();
    } catch (err) { /* sin registro viejo, o sin permiso: no pasa nada */ }
  }
  return { exists: () => !!data, data: () => data };
}

// Aviso a administración: "[docente] subió un registro". `completo` = vino de
// «Registrar todo», así que si no hay tarea significa que no se dio tarea.
function emitirRegistro(partes, completo = false) {
  const c = state.activeClass;
  if (!c) return;
  registrarActividad({
    tipo: "registro",
    cursoId: c.id,
    cursoNombre: c.nombre || c.id,
    materia: materiaDocenteParaCurso(c.id),
    completo,
    ...(partes.asistencia ? { asistencia: partes.asistencia } : {}),
    ...(partes.log ? { log: partes.log } : {}),
    ...(partes.tarea ? { tarea: partes.tarea } : {})
  });
}

export async function loadTeacherHome(uid) {
  // Docente
  const teacherSnap = await getDocs(query(collection(db, "docentes"), where("__name__", "==", uid)));
  state.currentTeacherDoc = teacherSnap.docs[0]?.data() || { nombre: state.currentUser.email, materia: "" };

  $("#home-initials").textContent = initials(state.currentTeacherDoc.nombre);
  $("#home-name").textContent = state.currentTeacherDoc.nombre;
  const materiasNombres = (state.currentTeacherDoc.materias || []).map(m => m.materia);
  $("#home-role").textContent = materiasNombres.length
    ? materiasNombres.join(" · ")
    : (state.currentTeacherDoc.materia || "Docente");
  $("#admin-panel").style.display = state.currentTeacherDoc.tipo === "Admin" ? "block" : "none";

  const today = new Date();
  $("#today-line").textContent = today.toLocaleDateString("es-BO", { weekday:"long", day:"numeric", month:"long" }).toUpperCase();

  // Cursos del docente
  const cursoIds = state.currentTeacherDoc.cursos || [];
  state.classesToday = [];
  for (const cid of cursoIds) {
    const cSnap = await getDocs(query(collection(db, "cursos"), where("__name__", "==", cid)));
    const cData = cSnap.docs[0]?.data();
    if (cData) state.classesToday.push({ id: cid, ...cData });
  }
  renderRail();
  await loadActividadReciente(uid);
  renderPendientes().catch(err => console.warn(err));
}

// "Pendientes de hoy": asistencia sin tomar y reuniones/citaciones por confirmar.
const fechaLocalISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function renderPendientes() {
  const box = $("#pendientes-card");
  if (!box) return;
  if (!state.currentUser || !state.currentTeacherDoc || state.currentTeacherDoc.tipo === "Admin") {
    box.style.display = "none";
    return;
  }
  const items = [];
  const ahora = new Date();
  const hhmm = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
  const hoy = hoyISO();
  for (const c of state.classesToday) {
    if (c.hora_inicio && c.hora_inicio > hhmm) continue; // la clase aún no empieza
    let ya = false;
    try { ya = (await leerAsistenciaDia(c.id, hoy)).exists(); } catch (err) { /* se asume que falta */ }
    if (!ya) items.push({ texto: `Falta tomar la asistencia de ${c.nombre}`, boton: "Tomar ahora", accion: () => openClass(c) });
  }
  try {
    const snap = await getDocs(query(collection(db, "notificaciones"), where("destinatarioId", "==", state.currentUser.uid)));
    const hoyL = fechaLocalISO(), manL = fechaLocalISO(new Date(Date.now() + 86400000));
    snap.docs.map(d => d.data())
      .filter(a => a.confirmar && !a.confirmada && a.fecha && a.fecha >= hoyL)
      .sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || "")))
      .forEach(a => {
        const cuando = a.fecha === hoyL ? "hoy" : a.fecha === manL ? "mañana" : fmtFecha(a.fecha, { day: "numeric", month: "long" });
        items.push({ texto: `${a.titulo} — ${cuando}${a.hora ? " a las " + a.hora : ""}`, boton: "Ver", accion: () => $("#btn-notif").click() });
      });
  } catch (err) { /* sin avisos: no pasa nada */ }

  if (!items.length) {
    if (state.classesToday.length) {
      box.innerHTML = `<div class="pend-ok">✓ Estás al día. No tienes nada pendiente.</div>`;
      box.style.display = "block";
    } else box.style.display = "none";
    return;
  }
  box.innerHTML = `<div class="pend-titulo">Pendientes de hoy</div>`;
  items.forEach(it => {
    const row = document.createElement("div");
    row.className = "pend-row";
    row.innerHTML = `<span class="pend-dot"></span><span class="pend-texto">${esc(it.texto)}</span>`;
    const b = document.createElement("button");
    b.type = "button"; b.className = "pend-btn"; b.textContent = it.boton;
    b.addEventListener("click", it.accion);
    row.appendChild(b);
    box.appendChild(row);
  });
  box.style.display = "block";
}

// ---------------------------------------------------------------------------
// ACTIVIDAD RECIENTE — una tarjeta por clase (curso + día) que junta bitácora,
// tareas y asistencia. Tiene filtro por fecha y, al tocar una tarjeta, abre
// la pantalla de detalle (#screen-detalle).
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const TIPOS_REGISTRO = {
  clase: "Clase regular",
  evaluacion: "Evaluación",
  proyecto: "Trabajo / proyecto",
  incidencia: "Incidencia / Irregularidad"
};
const ETIQUETA_ASISTENCIA = { P: "Presente", F: "Falta", A: "Atraso", L: "Licencia" };

let actividadDias = [];      // clases-día ya agrupadas (todas, sin filtrar)
let filtroActividad = "todo"; // todo | hoy | 7 | 14 | 30 | rango

// Las fechas se guardan en formato YYYY-MM-DD calculado con toISOString (UTC),
// igual que saveAttendance/saveLog; aquí usamos el mismo criterio para que coincidan.
const fechaDeCreado = (ts) => ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : "";
const hoyISO = () => new Date().toISOString().slice(0, 10);
const isoHaceDias = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const fmtFecha = (iso, opts) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("es-BO", opts) : "";
const fmtHora = (ts) => ts?.toDate ? ts.toDate().toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" }) : "";

function materiaDeCurso(cursoId) {
  const m = (state.currentTeacherDoc?.materias || []).find(x => (x.cursos || []).includes(cursoId));
  return m?.materia || state.classesToday.find(c => c.id === cursoId)?.materia || "";
}

function contarAsistencia(registros) {
  const v = Object.values(registros || {});
  return {
    p: v.filter(x => x === "P").length,
    f: v.filter(x => x === "F").length,
    a: v.filter(x => x === "A").length,
    l: v.filter(x => x === "L").length
  };
}

export async function loadActividadReciente(uid) {
  const box = $("#recent-card");
  box.innerHTML = `<div class="empty-state">Cargando…</div>`;
  try {
    const cursoIds = state.classesToday.map(c => c.id);
    const [bitSnap, tareasSnap, ...asisSnaps] = await Promise.all([
      getDocs(query(collection(db, "bitacora"), where("docenteId", "==", uid))),
      getDocs(query(collection(db, "tareas"), where("docenteId", "==", uid))),
      // asistencia: misma consulta por cursoId que ya usa loadAsistenciaHistory
      ...cursoIds.map(id =>
        getDocs(query(collection(db, "asistencia"), where("cursoId", "==", id))).catch(() => null)
      )
    ]);

    const mapa = new Map();
    const dia = (cursoId, fecha, base = {}) => {
      const key = `${cursoId}_${fecha}`;
      if (!mapa.has(key)) {
        mapa.set(key, {
          key, cursoId, fecha,
          cursoNombre: base.cursoNombre || state.classesToday.find(c => c.id === cursoId)?.nombre || cursoId,
          materia: base.materia || materiaDeCurso(cursoId),
          bitacoras: [], tareas: [], asistencia: null, ultimo: 0
        });
      }
      return mapa.get(key);
    };

    bitSnap.docs.forEach(d => {
      const b = d.data();
      const fecha = b.fecha || fechaDeCreado(b.creado);
      if (!fecha || !b.cursoId) return;
      const x = dia(b.cursoId, fecha, b);
      x.bitacoras.push(b);
      x.ultimo = Math.max(x.ultimo, b.creado?.toMillis?.() || 0);
    });

    tareasSnap.docs.forEach(d => {
      const t = { id: d.id, ...d.data() };
      const fecha = t.fechaEntrega || fechaDeCreado(t.creado);
      if (!fecha || !t.cursoId || fecha > hoyLocalISO()) return; // una tarea aparece el día de su entrega
      const x = dia(t.cursoId, fecha, t);
      x.tareas.push(t);
      x.ultimo = Math.max(x.ultimo, t.creado?.toMillis?.() || 0);
    });

    // La asistencia es por docente: solo se muestra la que tomé yo.
    asisSnaps.forEach(snap => snap?.docs.forEach(d => {
      const r = d.data();
      if (!r.fecha || !r.cursoId || r.docenteId !== uid) return;
      dia(r.cursoId, r.fecha, r).asistencia = r.registros || {};
    }));

    actividadDias = [...mapa.values()]
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.ultimo - a.ultimo);
    renderActividadLista();
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar la actividad reciente.</div>`;
  }
}

function diasFiltrados() {
  let desde = "", hasta = "";
  if (filtroActividad === "hoy") { desde = hasta = hoyISO(); }
  else if (["7", "14", "30"].includes(filtroActividad)) { desde = isoHaceDias(Number(filtroActividad)); }
  else if (filtroActividad === "rango") { desde = $("#act-desde").value; hasta = $("#act-hasta").value; }
  return actividadDias.filter(d => (!desde || d.fecha >= desde) && (!hasta || d.fecha <= hasta));
}

function renderActividadLista() {
  const box = $("#recent-card");
  if (!actividadDias.length) {
    box.innerHTML = `<div class="empty-state">Aún no registras actividad.</div>`;
    return;
  }
  const lista = diasFiltrados();
  if (!lista.length) {
    box.innerHTML = `<div class="empty-state">No hay clases registradas en ese período.</div>`;
    return;
  }
  box.innerHTML = "";
  lista.forEach(d => box.appendChild(renderDiaCard(d)));
}

function renderDiaCard(d) {
  const color = colorParaMateria(d.materia);
  const chips = [];
  if (d.asistencia) {
    const { p, f, a, l } = contarAsistencia(d.asistencia);
    chips.push(`Asistencia: ${p} P · ${f} F · ${a} A${l ? ` · ${l} L` : ""}`);
  }
  if (d.bitacoras.length) chips.push(`${d.bitacoras.length} ${d.bitacoras.length === 1 ? "registro" : "registros"}`);
  if (d.tareas.length) chips.push(`${d.tareas.length} ${d.tareas.length === 1 ? "entrega de tarea" : "entregas de tarea"}`);

  const preview = (d.bitacoras[0]?.texto || d.tareas[0]?.texto || "").slice(0, 110);
  const fechaCorta = fmtFecha(d.fecha, { weekday: "short", day: "numeric", month: "short" });

  const card = document.createElement("div");
  card.className = "reporte-card clickable";
  card.style.borderLeft = `5px solid ${color}`;
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  card.innerHTML = `
    <div class="reporte-top">
      <div class="reporte-field" style="margin-top:0;"><b>${esc(d.cursoNombre)}</b>${d.materia ? " · " + esc(d.materia) : ""}</div>
      <span class="reporte-meta" style="white-space:nowrap; margin:0; text-transform:capitalize;">${esc(fechaCorta)}</span>
    </div>
    ${preview ? `<div class="reporte-field">${esc(preview)}${preview.length >= 110 ? "…" : ""}</div>` : ""}
    <div class="act-chips">${chips.map(c => `<span class="act-chip">${esc(c)}</span>`).join("")}</div>
  `;
  const abrir = () => openDetalle(d);
  card.addEventListener("click", abrir);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
  return card;
}

// Pantalla de detalle de una clase: asistencia por alumno, lo que se trabajó
// y las tareas de ese día con quién entregó y quién no.
async function openDetalle(d) {
  const fechaLarga = fmtFecha(d.fecha, { weekday: "long", day: "numeric", month: "long" });
  $("#detalle-fecha").textContent = fechaLarga;
  $("#detalle-fecha").style.textTransform = "capitalize";
  $("#detalle-materia").textContent = (d.materia || "CLASE").toUpperCase();
  $("#detalle-curso").textContent = d.cursoNombre;
  const body = $("#detalle-body");
  body.innerHTML = `<div class="empty-state">Cargando…</div>`;
  show("#screen-detalle");
  window.scrollTo(0, 0);

  try {
    const [estSnap, asisSnap, filasNotas] = await Promise.all([
      getDocs(collection(db, "cursos", d.cursoId, "estudiantes")),
      leerAsistenciaDia(d.cursoId, d.fecha),
      cargarFilasNotas(d.cursoId)
    ]);
    const estudiantes = estSnap.docs
      .map(s => ({ id: s.id, nombre: s.data().nombre || "" }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const fila = (est, extra = "") => `
      <div class="roster-row">
        <div class="roster-avatar">${esc(initials(est.nombre))}</div>
        <div class="roster-name">${esc(est.nombre)}</div>
        ${extra}
      </div>`;

    // ---- Asistencia ----
    let html = `<p class="section-title" style="margin-top:0;">Asistencia</p>`;
    if (asisSnap.exists()) {
      const reg = asisSnap.data().registros || {};
      const { p, f, a, l } = contarAsistencia(reg);
      html += `
        <div class="attendance-summary">
          <span class="summary-chip"><i style="background:var(--sello-verde)"></i>${p} presente</span>
          <span class="summary-chip"><i style="background:var(--sello-rojo)"></i>${f} falta</span>
          <span class="summary-chip"><i style="background:var(--sello-ocre)"></i>${a} atraso</span>
          <span class="summary-chip"><i style="background:var(--sello-azul)"></i>${l} licencia</span>
        </div>
        <div class="card">
          ${estudiantes.length
            ? estudiantes.map(est => {
                const c = reg[est.id];
                return fila(est, `<div class="estado-${c ? c.toLowerCase() : "x"}">${ETIQUETA_ASISTENCIA[c] || "—"}</div>`);
              }).join("")
            : `<div class="empty-state">Este curso no tiene estudiantes cargados.</div>`}
        </div>`;
    } else {
      html += `<div class="card"><div class="empty-state">No se tomó asistencia ese día.</div></div>`;
    }

    // ---- Lo que se trabajó ----
    html += `<p class="section-title">Registro de la clase</p><div class="card">`;
    if (d.bitacoras.length) {
      const orden = [...d.bitacoras].sort((a, b) => (a.creado?.toMillis?.() || 0) - (b.creado?.toMillis?.() || 0));
      html += orden.map(b => {
        const hora = fmtHora(b.creado);
        return `
          <div class="log-entry">
            <div class="log-meta">${esc(TIPOS_REGISTRO[b.tipo] || b.tipo || "Registro")}${hora ? " · " + hora : ""}</div>
            <div class="log-text" style="white-space:pre-wrap;">${esc(b.texto)}</div>
          </div>`;
      }).join("");
    } else {
      html += `<div class="empty-state">Sin registro de la clase ese día.</div>`;
    }
    html += `</div>`;

    // ---- Tareas que se entregan ese día: quién entregó, quién no y su nota ----
    html += `<p class="section-title">Tareas que se entregan este día</p><div class="card">`;
    if (d.tareas.length) {
      html += d.tareas.map(t => {
        const ent = t.entregas || {};
        const filaNota = filasNotas[t.id];
        const si = estudiantes.filter(e => ent[e.id]);
        const no = estudiantes.filter(e => !ent[e.id]);
        const entrega = t.fechaEntrega ? fmtFecha(t.fechaEntrega, { day: "numeric", month: "long" }) : "sin fecha";
        const vacio = (txt) => `<div class="hint-text" style="margin:0;">${txt}</div>`;
        const nota = (e) => {
          const v = filaNota?.notas?.[e.id];
          return typeof v === "number"
            ? `<div class="hint-text" style="margin:0; font-weight:700;">${v}/${filaNota.sobre || 100}</div>` : "";
        };
        return `
          <div class="log-entry">
            <div class="log-meta">Entrega: ${esc(entrega)}</div>
            <div class="log-text">${t.nombre ? `<b>${esc(t.nombre)}</b><br>` : ""}${esc(t.texto)}</div>
            ${estudiantes.length ? `
              <div class="det-sub" style="color:var(--sello-verde);">Entregaron (${si.length})</div>
              ${si.length ? si.map(e => fila(e, nota(e))).join("") : vacio("Nadie ha entregado todavía.")}
              <div class="det-sub" style="color:var(--sello-rojo);">No entregaron (${no.length})</div>
              ${no.length ? no.map(e => fila(e, nota(e))).join("") : vacio("Todos entregaron.")}
            ` : vacio("Este curso no tiene estudiantes cargados.")}
          </div>`;
      }).join("");
    } else {
      html += `<div class="empty-state">No se entregaban tareas ese día.</div>`;
    }
    html += `</div>`;

    body.innerHTML = html;
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="empty-state">No se pudo cargar el detalle de la clase.</div>`;
  }
}

// Engancha los filtros de fecha y el botón volver del detalle (se llama una vez desde main.js).
export function initActividadUI() {
  document.querySelectorAll("#actividad-filtros [data-rango]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#actividad-filtros [data-rango]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filtroActividad = btn.dataset.rango;
      $("#actividad-rango").style.display = filtroActividad === "rango" ? "flex" : "none";
      renderActividadLista();
    });
  });
  $("#act-desde").addEventListener("change", renderActividadLista);
  $("#act-hasta").addEventListener("change", renderActividadLista);
  $("#btn-back-detalle").addEventListener("click", () => show("#screen-home"));
}

function renderRail() {
  const rail = $("#class-rail");
  rail.innerHTML = "";
  if (!state.classesToday.length) {
    rail.innerHTML = `<div class="empty-state" style="padding:20px 8px;">No tienes cursos asignados.</div>`;
    return;
  }
  state.classesToday.forEach(c => {
    const pill = document.createElement("button");
    pill.className = "rail-pill";
    pill.innerHTML = `
      <span class="dot-status"></span>
      <div class="curso">${c.nombre}</div>
      <div class="hora">${c.hora_inicio || "--:--"} – ${c.hora_fin || "--:--"} · ${c.materia || ""}</div>
    `;
    pill.addEventListener("click", () => openClass(c));
    rail.appendChild(pill);
  });
}

async function openClass(curso) {
  state.activeClass = curso;
  state.rosterState = {};
  state.serState = {};   // { studentId: "V" | "A" | "R" } — calificación del Ser (opcional)
  descartarCambios();
  salirEdicionLog();
  $("#class-materia").textContent = curso.materia || "CLASE";
  $("#class-nombre").textContent = curso.nombre;
  $("#class-hora").textContent = `${curso.hora_inicio || "--:--"} – ${curso.hora_fin || "--:--"}`;

  const rosterCard = $("#roster-card");
  rosterCard.innerHTML = `<div class="empty-state">Cargando estudiantes…</div>`;

  const studentsSnap = await getDocs(collection(db, "cursos", curso.id, "estudiantes"));
  rosterCard.innerHTML = "";
  state.cursoEstudiantesActual = studentsSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || "" }));
  if (studentsSnap.empty) {
    rosterCard.innerHTML = `<div class="empty-state">Este curso no tiene estudiantes cargados.</div>`;
  } else {
    studentsSnap.forEach(sDoc => {
      const s = sDoc.data();
      state.rosterState[sDoc.id] = "P";
      const row = document.createElement("div");
      row.className = "roster-row has-ser";
      row.innerHTML = `
        <div class="roster-avatar">${initials(s.nombre)}</div>
        <div class="roster-name">${s.nombre}</div>
        <div class="status-group" data-student="${sDoc.id}">
          <button class="status-btn active" type="button" data-code="P" aria-label="Presente"><b>P</b><small>Presente</small></button>
          <button class="status-btn" type="button" data-code="F" aria-label="Falta"><b>F</b><small>Falta</small></button>
          <button class="status-btn" type="button" data-code="A" aria-label="Atraso"><b>A</b><small>Atraso</small></button>
          <button class="status-btn" type="button" data-code="L" aria-label="Licencia"><b>L</b><small>Licencia</small></button>
        </div>
        <div class="ser-line" data-student="${sDoc.id}">
          <span class="ser-label">Ser</span>
          <button class="ser-btn" type="button" data-ser="V">Bien</button>
          <button class="ser-btn" type="button" data-ser="A">Regular</button>
          <button class="ser-btn" type="button" data-ser="R">Mal</button>
        </div>
      `;
      rosterCard.appendChild(row);
    });
  }
  // Si ya tomaste asistencia hoy en este curso, se carga para que puedas corregirla.
  let aviso = $("#asist-previa-aviso");
  if (!aviso) {
    aviso = document.createElement("p");
    aviso.id = "asist-previa-aviso";
    aviso.className = "hint-text previa-aviso";
    rosterCard.parentNode.insertBefore(aviso, rosterCard);
  }
  aviso.style.display = "none";
  try {
    const previa = await leerAsistenciaDia(curso.id, hoyISO());
    if (previa.exists()) {
      const d = previa.data();
      Object.entries(d.registros || {}).forEach(([id, cod]) => {
        if (!(id in state.rosterState)) return;
        state.rosterState[id] = cod;
        rosterCard.querySelectorAll(`.status-group[data-student="${id}"] .status-btn`)
          .forEach(b => b.classList.toggle("active", b.dataset.code === cod));
      });
      Object.entries(d.ser || {}).forEach(([id, v]) => {
        state.serState[id] = v;
        rosterCard.querySelector(`.ser-line[data-student="${id}"] .ser-btn[data-ser="${v}"]`)?.classList.add("active");
      });
      aviso.textContent = "✓ Ya tomaste asistencia hoy. Puedes corregirla y guardar de nuevo.";
      aviso.style.display = "block";
    }
  } catch (err) { console.warn(err); }
  attachRosterHandlers();
  attachSerHandlers();
  updateAttendanceSummary();
  await loadLogHistory(curso.id);
  await loadTareasHistory(curso.id, state.cursoEstudiantesActual);
  await loadAsistenciaHistory(curso.id, state.cursoEstudiantesActual);
  show("#screen-class");
}

function attachRosterHandlers() {
  document.querySelectorAll(".status-group").forEach(group => {
    const sid = group.dataset.student;
    group.querySelectorAll(".status-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        group.querySelectorAll(".status-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.rosterState[sid] = btn.dataset.code;
        updateAttendanceSummary();
      });
    });
  });
}

// Calificación del Ser: verde = bien, amarillo = regular, rojo = mal.
// Tocar de nuevo el botón activo lo quita (el Ser es opcional).
function attachSerHandlers() {
  document.querySelectorAll(".ser-line").forEach(line => {
    const sid = line.dataset.student;
    line.querySelectorAll(".ser-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const yaActivo = btn.classList.contains("active");
        line.querySelectorAll(".ser-btn").forEach(b => b.classList.remove("active"));
        if (yaActivo) { delete state.serState[sid]; return; }
        btn.classList.add("active");
        state.serState[sid] = btn.dataset.ser;
      });
    });
  });
}

function updateAttendanceSummary() {
  const vals = Object.values(state.rosterState);
  $("#cnt-p").textContent = vals.filter(v => v === "P").length;
  $("#cnt-f").textContent = vals.filter(v => v === "F").length;
  $("#cnt-a").textContent = vals.filter(v => v === "A").length;
  $("#cnt-l").textContent = vals.filter(v => v === "L").length;
}

export async function saveAttendance({ silent = false, collect = null } = {}) {
  if (!state.activeClass) return false;
  if (!silent) huboPendiente = false;
  const fecha = new Date().toISOString().slice(0,10);
  const docId = asistenciaDocId(state.activeClass.id, fecha, state.currentUser.uid);
  try {
    const estadoAsis = await guardarSeguro(setDoc(doc(db, "asistencia", docId), {
      cursoId: state.activeClass.id,
      cursoNombre: state.activeClass.nombre,
      fecha,
      docenteId: state.currentUser.uid,
      docenteNombre: state.currentTeacherDoc?.nombre || "",
      registros: state.rosterState,
      ser: state.serState || {},
      actualizado: serverTimestamp()
    }));
    huboPendiente ||= estadoAsis === "pendiente";
    sucio.asistencia = false;
    const resumenAsistencia = { fecha, registros: { ...state.rosterState } };
    if (collect) collect.asistencia = resumenAsistencia; else emitirRegistro({ asistencia: resumenAsistencia });
    if (!silent) { toast(huboPendiente ? MSG_PENDIENTE : "Asistencia guardada", huboPendiente ? 5000 : 2200); renderPendientes().catch(() => {}); }
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) toastAccion(mensajeError(err), "Reintentar", () => saveAttendance());
    return false;
  }
}

export async function saveLog({ silent = false, collect = null } = {}) {
  if (!state.activeClass) return false;
  if (!silent) huboPendiente = false;
  const texto = $("#log-texto").value.trim();
  if (!texto) { if (!silent) toast("Escribe qué se trabajó en la clase"); return false; }
  try {
    const edit = state.editandoLog;
    let estadoLog;
    if (edit) {
      estadoLog = await guardarSeguro(updateDoc(doc(db, "bitacora", edit.id), {
        tipo: $("#log-tipo").value, texto, editado: serverTimestamp()
      }));
      huboPendiente ||= estadoLog === "pendiente";
      sucio.log = false;
      salirEdicionLog();
      if (!silent) toast(huboPendiente ? MSG_PENDIENTE : "Registro corregido", huboPendiente ? 5000 : 2200);
      await loadLogHistory(state.activeClass.id);
      return true;
    }
    estadoLog = await guardarSeguro(setDoc(doc(collection(db, "bitacora")), {
      cursoId: state.activeClass.id,
      cursoNombre: state.activeClass.nombre,
      materia: materiaDocenteParaCurso(state.activeClass.id),
      docenteId: state.currentUser.uid,
      docenteNombre: state.currentTeacherDoc?.nombre || "",
      fecha: new Date().toISOString().slice(0,10),
      tipo: $("#log-tipo").value,
      texto,
      creado: serverTimestamp()
    }));
    huboPendiente ||= estadoLog === "pendiente";
    sucio.log = false;
    const resumenLog = { tipo: $("#log-tipo").value, texto, fecha: new Date().toISOString().slice(0,10) };
    $("#log-texto").value = "";
    if (collect) collect.log = resumenLog; else emitirRegistro({ log: resumenLog });
    if (!silent) toast(huboPendiente ? MSG_PENDIENTE : "Entrada guardada en la bitácora", huboPendiente ? 5000 : 2200);
    await loadLogHistory(state.activeClass.id);
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) toastAccion(mensajeError(err), "Reintentar", () => saveLog());
    return false;
  }
}

// Trimestre sugerido según el mes (editable luego en la tarjeta de la tarea).
function trimestreSugerido() {
  const m = new Date().getMonth() + 1;
  return m <= 4 ? "1" : m <= 8 ? "2" : "3";
}

// Crea al instante la fila de la tarea en Notas (vacía) para que ya aparezca
// en la tabla sin esperar a que se guarden notas. Si falla (p. ej. cuenta
// Admin), la tarea igual queda creada.
async function crearFilaNotas(tareaId, t) {
  try {
    await guardarSeguro(setDoc(doc(db, "notas", t.cursoId, "tareas", tareaId), {
      cursoId: t.cursoId,
      nombre: nombreTarea(t),
      materia: t.materia || "General",
      tipo: t.tipo,
      trimestre: t.trimestre,
      sobre: 100,
      fechaEntrega: t.fechaEntrega,
      docenteId: t.docenteId,
      docenteNombre: t.docenteNombre,
      notas: {},
      creado: serverTimestamp(),
      actualizado: serverTimestamp()
    }));
  } catch (err) {
    console.warn("No se pudo crear la fila en Notas:", err);
  }
}

export async function saveTarea({ silent = false, collect = null } = {}) {
  if (!state.activeClass) return false;
  if (!silent) huboPendiente = false;
  const fechaEntrega = $("#tarea-fecha").value;
  const texto = $("#tarea-texto").value.trim();
  if (!fechaEntrega || !texto) { if (!silent) toast("Elige una fecha y describe la tarea"); return false; }
  try {
    const datosTarea = {
      cursoId: state.activeClass.id,
      cursoNombre: state.activeClass.nombre,
      materia: materiaDocenteParaCurso(state.activeClass.id),
      docenteId: state.currentUser.uid,
      docenteNombre: state.currentTeacherDoc?.nombre || "",
      nombre: $("#tarea-nombre").value.trim(),
      fechaEntrega,
      texto,
      entregas: {},
      tipo: $("#tarea-tipo").value || "tarea",
      trimestre: $("#tarea-trimestre").value || trimestreSugerido(),
      creado: serverTimestamp()
    };
    const refTarea = doc(collection(db, "tareas"));
    const estadoTarea = await guardarSeguro(setDoc(refTarea, datosTarea));
    huboPendiente ||= estadoTarea === "pendiente";
    sucio.tarea = false;
    await crearFilaNotas(refTarea.id, datosTarea);
    const resumenTarea = {
      nombre: datosTarea.nombre, texto: datosTarea.texto, fechaEntrega: datosTarea.fechaEntrega,
      tipo: datosTarea.tipo, trimestre: datosTarea.trimestre
    };
    if (collect) collect.tarea = resumenTarea; else emitirRegistro({ tarea: resumenTarea });
    $("#tarea-tipo").value = "tarea";
    $("#tarea-nombre").value = "";
    $("#tarea-fecha").value = "";
    $("#tarea-texto").value = "";
    if (!silent) toast(huboPendiente ? MSG_PENDIENTE : (datosTarea.tipo === "evaluacion" ? "Evaluación registrada" : "Tarea asignada"), huboPendiente ? 5000 : 2200);
    await loadTareasHistory(state.activeClass.id, state.cursoEstudiantesActual);
    return true;
  } catch (err) {
    console.error(err);
    if (!silent) toastAccion(mensajeError(err), "Reintentar", () => saveTarea());
    return false;
  }
}

// Guarda de una vez: asistencia (siempre) + registro de clase y tarea (si
// están escritos). Si la tarea está a medias, avisa y no guarda nada.
export async function saveTodo() {
  if (!state.activeClass) return;
  const btn = $("#btn-save-all");
  const hayLog = !!$("#log-texto").value.trim();
  const fechaT = $("#tarea-fecha").value;
  const textoT = $("#tarea-texto").value.trim();
  const hayTarea = !!(fechaT && textoT);

  if ((fechaT || textoT || $("#tarea-nombre").value.trim()) && !hayTarea) {
    toast("La tarea está incompleta: falta la fecha o la descripción");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Guardando…";
  huboPendiente = false;
  const resultados = [];
  const collect = {}; // lo que se guardó bien, para avisar a administración UNA sola vez
  resultados.push(["Asistencia", await saveAttendance({ silent: true, collect })]);
  if (hayLog) resultados.push(["Registro de clase", await saveLog({ silent: true, collect })]);
  if (hayTarea) resultados.push(["Tarea", await saveTarea({ silent: true, collect })]);
  if (Object.keys(collect).length) emitirRegistro(collect, true);
  await loadAsistenciaHistory(state.activeClass.id, state.cursoEstudiantesActual);

  const fallidos = resultados.filter(([, ok]) => !ok).map(([n]) => n);
  if (fallidos.length) {
    toastAccion(`No se guardó: ${fallidos.join(", ")}. Revisa tu conexión y toca Reintentar.`, "Reintentar", saveTodo);
    btn.textContent = "Registrar todo y guardar";
  } else {
    toast(huboPendiente ? MSG_PENDIENTE : `Guardado: ${resultados.map(([n]) => n).join(" + ")}`, huboPendiente ? 5000 : 2200);
    renderPendientes().catch(() => {});
    btn.textContent = "✓ Guardado";
    btn.classList.add("ok");
    setTimeout(() => { btn.textContent = "Registrar todo y guardar"; btn.classList.remove("ok"); }, 2200);
  }
  btn.disabled = false;
}

async function loadTareasHistory(cursoId, estudiantes = []) {
  const histCard = $("#tareas-history");
  histCard.innerHTML = `<div class="empty-state">Cargando…</div>`;
  try {
    // Igual que en loadLogHistory: cursoId + docenteId (dos igualdades),
    // así cada docente solo ve sus propias tareas para ese curso.
    const q = query(
      collection(db, "tareas"),
      where("cursoId", "==", cursoId),
      where("docenteId", "==", state.currentUser.uid)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      histCard.innerHTML = `<div class="empty-state">Sin tareas todavía.</div>`;
      return;
    }
    // Se ordenan por fecha de entrega (la más reciente primero): lo que se recibe hoy queda arriba.
    const tareas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fechaEntrega || "").localeCompare(a.fechaEntrega || "")
        || (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0))
      .slice(0, 12);
    const filasNotas = await cargarFilasNotas(cursoId);

    histCard.innerHTML = "";
    tareas.forEach(t => histCard.appendChild(renderTareaCard(t, estudiantes, filasNotas[t.id])));
  } catch (err) {
    console.error(err);
    histCard.innerHTML = `<div class="empty-state">No se pudo cargar las tareas.</div>`;
  }
}

// Fecha de hoy en hora local (las fechas de entrega vienen de <input type="date">, también locales).
const hoyLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const esAdminHome = () => state.currentTeacherDoc?.tipo === "Admin";
const nombreTarea = (t) => String(t.nombre || "").trim() || String(t.texto || "").trim().slice(0, 40);

// Filas de notas ya guardadas para este docente en un curso: notas/{cursoId}/tareas/{tareaId}.
// El id de la fila es el mismo id de la tarea asignada, así que cada tarea tiene como máximo una fila en Notas.
// Se consulta por docenteId (no por id suelto) para cumplir las reglas de Firestore aunque la fila aún no exista.
async function cargarFilasNotas(cursoId) {
  const filas = {};
  if (esAdminHome()) return filas;
  try {
    const snap = await getDocs(query(
      collection(db, "notas", cursoId, "tareas"),
      where("docenteId", "==", state.currentUser.uid)
    ));
    snap.forEach(d => { filas[d.id] = d.data(); });
  } catch (err) {
    console.error(err);
  }
  return filas;
}

// Tarjeta de una tarea (colapsada con <details>; se abre sola el día de la entrega).
// Por estudiante: nota + botón Entregó/Pendiente. "Guardar notas" sube las notas a
// la tabla de Notas, donde la tarea aparece como una fila con su nombre.
function renderTareaCard(tarea, estudiantes, filaInicial) {
  const entregas = tarea.entregas || {};
  let fila = filaInicial || null;
  const puedeCalificar = !esAdminHome() && estudiantes.length > 0;
  const totalEntregados = () => estudiantes.filter(e => entregas[e.id]).length;
  const totalCalificados = () => estudiantes.filter(e => typeof fila?.notas?.[e.id] === "number").length;
  const resumenTxt = () =>
    `${totalEntregados()}/${estudiantes.length} entregaron` +
    (puedeCalificar ? ` · ${totalCalificados()} con nota` : "") +
    ` · toca para ver el detalle`;
  const pasoPara = (sobre) => (sobre <= 20 ? 0.5 : 1); // paso del control deslizante

  const entregaFmt = tarea.fechaEntrega
    ? new Date(tarea.fechaEntrega + "T00:00:00").toLocaleDateString("es-BO", { day: "numeric", month: "long" })
    : "";
  const esHoy = tarea.fechaEntrega === hoyLocalISO();

  const wrapper = document.createElement("details");
  wrapper.className = "log-entry";
  if (esHoy) wrapper.open = true; // el día de la entrega ya queda lista para revisar

  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.innerHTML = `
    <div class="log-meta">${tarea.tipo === "evaluacion" ? `<span class="tipo-eval">Evaluación</span> ` : ""}Entrega: ${esc(entregaFmt)}${esHoy ? " · HOY" : ""}${tarea.materia ? " · " + esc(tarea.materia) : ""}</div>
    <div class="log-text">${tarea.nombre ? `<b>${esc(tarea.nombre)}</b><br>` : ""}${esc(tarea.texto)}</div>
    <div class="log-meta" data-role="resumen-entregas" style="margin-top:4px;">${resumenTxt()}</div>
  `;
  wrapper.appendChild(summary);
  const actualizarResumen = () => {
    summary.querySelector("[data-role='resumen-entregas']").textContent = resumenTxt();
  };

  // ---- Arriba: trimestre y "Nota sobre" (define el rango de los controles deslizantes) ----
  let cfg = null;
  const sobreActual = () => Math.max(1, Number(cfg?.querySelector("[data-role='sobre']").value) || 100);
  if (puedeCalificar) {
    cfg = document.createElement("div");
    cfg.style.cssText = "margin-top:12px; padding-top:12px; border-top:1px solid var(--linea);";
    const trimestreActual = String(fila?.trimestre || "1");
    cfg.innerHTML = `
      <div style="display:flex; gap:12px;">
        <div style="flex:1;">
          <label class="field-label">Nota sobre</label>
          <input class="text-input" data-role="sobre" type="number" min="1" inputmode="decimal" value="${fila?.sobre || 100}" style="margin-bottom:0;" />
        </div>
        <div style="flex:1;">
          <label class="field-label">Trimestre</label>
          <select data-role="trimestre" style="margin-bottom:0;">
            ${["1", "2", "3"].map(t => `<option value="${t}"${t === trimestreActual ? " selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
      </div>
      <p class="hint-text" style="margin:10px 0 0;">Mueve el control deslizante (va de 0 a la nota máxima) o escribe la nota y pulsa Enter para pasar al siguiente. Con una nota mayor que 0, el alumno pasa solo a «Entregó».</p>
    `;
    wrapper.appendChild(cfg);
  }

  const lista = document.createElement("div");
  lista.style.marginTop = "10px";
  if (!estudiantes.length) {
    lista.innerHTML = `<div class="empty-state">Este curso no tiene estudiantes cargados.</div>`;
  } else {
    const sobreInicial = fila?.sobre || 100;
    estudiantes.forEach(est => {
      const entrego = !!entregas[est.id];
      const nota = fila?.notas?.[est.id];
      const hayNota = typeof nota === "number";
      const row = document.createElement("div");
      row.className = "roster-row tarea-row";
      row.innerHTML = `
        <div class="roster-avatar">${esc(initials(est.nombre))}</div>
        <div class="roster-name">${esc(est.nombre)}</div>
        <button class="status-btn${entrego ? " active" : ""}" data-role="toggle-entrega" style="min-width:96px;">
          ${entrego ? "Entregó" : "Pendiente"}
        </button>
        ${puedeCalificar ? `
          <div class="tarea-nota-line">
            <input class="nota-slider${hayNota ? "" : " sin-nota"}" type="range" min="0" max="${sobreInicial}"
              step="${pasoPara(sobreInicial)}" value="${hayNota ? Math.min(nota, sobreInicial) : 0}"
              aria-label="Nota de ${esc(est.nombre)}">
            <input class="nota-input" type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off"
              placeholder="Nota" data-nota-est="${esc(est.id)}" value="${hayNota ? nota : ""}"
              aria-label="Nota de ${esc(est.nombre)} (escribir)">
          </div>` : ""}
      `;

      const btn = row.querySelector("[data-role='toggle-entrega']");
      btn.addEventListener("click", async () => {
        const nuevoValor = !entregas[est.id];
        btn.disabled = true;
        try {
          await updateDoc(doc(db, "tareas", tarea.id), { [`entregas.${est.id}`]: nuevoValor });
          entregas[est.id] = nuevoValor;
          btn.classList.toggle("active", nuevoValor);
          btn.textContent = nuevoValor ? "Entregó" : "Pendiente";
          actualizarResumen();
        } catch (err) {
          console.error(err);
          toast("No se pudo actualizar. Intenta de nuevo.");
        } finally {
          btn.disabled = false;
        }
      });

      const casilla = row.querySelector("input[data-nota-est]");
      const slider = row.querySelector(".nota-slider");
      if (casilla && slider) {
        const leer = () => {
          const raw = casilla.value.trim().replace(",", ".");
          const n = Number(raw);
          return { hay: raw !== "" && Number.isFinite(n), n };
        };
        // casilla -> control deslizante (el valor escrito manda; el control solo lo refleja)
        const sincronizar = () => {
          let { hay, n } = leer();
          // Tope: lo escrito no puede pasar de "Nota sobre" ni bajar de 0
          if (hay && n > sobreActual()) { n = sobreActual(); casilla.value = String(n); }
          else if (hay && n < 0) { n = 0; casilla.value = "0"; }
          slider.value = hay ? Math.min(Math.max(n, 0), Number(slider.max)) : 0;
          slider.classList.toggle("sin-nota", !hay);
          casilla.classList.toggle("nota-fuera", hay && (n < 0 || n > sobreActual()));
        };
        // Una nota mayor que 0 marca solo al alumno como "Entregó" (un 0 no cambia el estado).
        const marcarEntregoSiCorresponde = async () => {
          const { hay, n } = leer();
          if (!hay || n <= 0 || entregas[est.id]) return;
          try {
            await updateDoc(doc(db, "tareas", tarea.id), { [`entregas.${est.id}`]: true });
            entregas[est.id] = true;
            btn.classList.add("active");
            btn.textContent = "Entregó";
            actualizarResumen();
          } catch (err) {
            console.error(err);
            toast("No se pudo marcar como entregado. Intenta de nuevo.");
          }
        };
        casilla.addEventListener("input", sincronizar);
        casilla.addEventListener("change", () => { sincronizar(); marcarEntregoSiCorresponde(); });
        slider.addEventListener("input", () => {
          casilla.value = slider.value;      // mientras se arrastra, la casilla muestra el valor
          slider.classList.remove("sin-nota");
          casilla.classList.remove("nota-fuera");
        });
        slider.addEventListener("change", marcarEntregoSiCorresponde); // al soltar
      }
      lista.appendChild(row);
    });
  }
  // Enter pasa a la nota del siguiente estudiante, para ir de arriba abajo sin tocar nada más.
  lista.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("input[data-nota-est]")) return;
    e.preventDefault();
    const casillas = [...lista.querySelectorAll("input[data-nota-est]")];
    const siguiente = casillas[casillas.indexOf(e.target) + 1];
    if (siguiente) { siguiente.focus(); siguiente.select(); } else { e.target.blur(); }
  });
  wrapper.appendChild(lista);

  // Al cambiar "Nota sobre", todos los controles deslizantes toman el nuevo rango.
  if (cfg) {
    cfg.querySelector("[data-role='sobre']").addEventListener("input", (ev) => {
      if (!ev.target.value) return; // mientras el campo está vacío, no se toca nada
      const sobre = sobreActual();
      lista.querySelectorAll(".nota-slider").forEach(sl => { sl.max = sobre; sl.step = pasoPara(sobre); });
      lista.querySelectorAll("input[data-nota-est]").forEach(c => c.dispatchEvent(new Event("input")));
    });
  }

  // Una cuenta Admin no puede escribir notas (así lo exigen las reglas de Firestore):
  // en vez de ocultar los controles en silencio, se explica por qué no están.
  if (esAdminHome() && estudiantes.length) {
    const aviso = document.createElement("p");
    aviso.className = "hint-text";
    aviso.textContent = "Estás con una cuenta de administración: aquí solo ves las entregas. Para poner notas, entra con una cuenta de docente.";
    wrapper.appendChild(aviso);
  }

  // ---- Abajo: guardar ----
  if (puedeCalificar) {
    const pie = document.createElement("div");
    pie.innerHTML = `
      <button class="btn-save" type="button" data-role="guardar-notas" style="margin-top:12px;">Guardar notas</button>
      <p class="hint-text" data-role="notas-estado">${fila ? "Estas notas ya aparecen en la tabla de Notas." : "Al guardar, esta tarea aparece como una fila en la tabla de Notas."}</p>
    `;
    wrapper.appendChild(pie);

    pie.querySelector("[data-role='guardar-notas']").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      const sobre = sobreActual();
      const trimestre = cfg.querySelector("[data-role='trimestre']").value;
      const paraGuardar = {};   // lo que se escribe en Firestore (vacío = borrar nota)
      const locales = {};       // copia local, solo números
      let invalida = null;
      lista.querySelectorAll("input[data-nota-est]").forEach(inp => {
        const id = inp.dataset.notaEst;
        const raw = inp.value.trim().replace(",", ".");
        if (raw === "") { paraGuardar[id] = deleteField(); return; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > sobre) { invalida = invalida || inp; return; }
        paraGuardar[id] = n;
        locales[id] = n;
      });
      if (invalida) { toast(`Las notas deben estar entre 0 y ${sobre}`); invalida.focus(); return; }
      if (!Object.keys(locales).length && !fila) { toast("Escribe al menos una nota"); return; }

      btn.disabled = true;
      try {
        const datos = {
          cursoId: tarea.cursoId,
          nombre: nombreTarea(tarea),
          materia: tarea.materia || "General",
          trimestre, sobre,
          tipo: tarea.tipo || "tarea",
          fechaEntrega: tarea.fechaEntrega || "",
          docenteId: state.currentUser.uid,
          docenteNombre: state.currentTeacherDoc?.nombre || "",
          notas: paraGuardar,
          actualizado: serverTimestamp()
        };
        if (!fila) datos.creado = serverTimestamp(); // solo la primera vez, para que la fila quede en su lugar
        await setDoc(doc(db, "notas", tarea.cursoId, "tareas", tarea.id), datos, { merge: true });
        fila = { ...(fila || {}), trimestre, sobre, notas: locales };
        actualizarResumen();
        pie.querySelector("[data-role='notas-estado']").textContent = "Estas notas ya aparecen en la tabla de Notas.";
        toast("Notas guardadas");
      } catch (err) {
        console.error(err);
        toast("No se pudieron guardar las notas. Si sigue igual, avisa a quien administra la app.");
      } finally {
        btn.disabled = false;
      }
    });
  }
  return wrapper;
}

// Cada docente ve solo la asistencia que tomó él en este curso. La consulta
// sigue acotada por cursoId (lo que ya permiten las reglas de Firestore) y se
// filtra por docenteId en el cliente. Cada tarjeta, al desplegarse, muestra
// el detalle Presente/Falta/Atraso por estudiante.
async function loadAsistenciaHistory(cursoId, estudiantes = []) {
  const box = $("#asistencia-history");
  box.innerHTML = `<div class="empty-state">Cargando…</div>`;
  try {
    const snap = await getDocs(query(collection(db, "asistencia"), where("cursoId", "==", cursoId)));
    const registros = snap.docs
      .map(d => d.data())
      .filter(r => r.docenteId === state.currentUser.uid) // solo la asistencia que tomé yo
      .sort((a, b) => (b.actualizado?.toMillis?.() || 0) - (a.actualizado?.toMillis?.() || 0))
      .slice(0, 10);
    if (!registros.length) {
      box.innerHTML = `<div class="empty-state">Sin registros todavía.</div>`;
      return;
    }

    box.innerHTML = "";
    registros.forEach(r => box.appendChild(renderAsistenciaCard(r, estudiantes)));
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar la asistencia.</div>`;
  }
}

function renderAsistenciaCard(registro, estudiantes) {
  const valores = Object.values(registro.registros || {});
  const p = valores.filter(v => v === "P").length;
  const f = valores.filter(v => v === "F").length;
  const a = valores.filter(v => v === "A").length;
  const l = valores.filter(v => v === "L").length;
  const fechaFmt = registro.fecha
    ? new Date(registro.fecha + "T00:00:00").toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })
    : "";

  const wrapper = document.createElement("details");
  wrapper.className = "log-entry";

  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.innerHTML = `
    <div class="log-meta" style="text-transform:capitalize;">${fechaFmt}</div>
    <div class="log-text">${p} presentes · ${f} faltas · ${a} atrasos${l ? ` · ${l} con licencia` : ""}</div>
  `;
  wrapper.appendChild(summary);

  const lista = document.createElement("div");
  lista.style.cssText = "margin-top:10px; padding-top:10px; border-top:1px solid var(--linea);";
  const etiqueta = { P: "Presente", F: "Falta", A: "Atraso", L: "Licencia" };
  if (!estudiantes.length) {
    lista.innerHTML = `<div class="empty-state">Este curso no tiene estudiantes cargados.</div>`;
  } else {
    lista.innerHTML = estudiantes.map(est => {
      const codigo = registro.registros?.[est.id] || "—";
      const ser = registro.ser?.[est.id];
      const serTxt = { V: "Ser: bien", A: "Ser: regular", R: "Ser: mal" }[ser] || "";
      return `<div class="roster-row"><div class="roster-name">${est.nombre}</div><div class="hint-text" style="margin:0;">${ser ? `<span class="ser-dot ${ser}" title="${serTxt}"></span>` : ""}${etiqueta[codigo] || codigo}</div></div>`;
    }).join("");
  }
  wrapper.appendChild(lista);

  return wrapper;
}

async function loadLogHistory(cursoId) {
  const histCard = $("#log-history");
  histCard.innerHTML = `<div class="empty-state">Cargando…</div>`;
  try {
    const uid = state.currentUser.uid;
    // Filtramos por cursoId Y docenteId (dos igualdades, no requiere índice
    // compuesto) para que cada docente solo vea sus propias entradas — un
    // curso puede tener varios docentes (distintas materias) y las reglas
    // de Firestore ahora exigen que la consulta ya venga acotada a "las
    // mías", no solo a "las de este curso". Ordenamos/recortamos en el
    // cliente para no depender tampoco de un índice de orderBy.
    const q = query(
      collection(db, "bitacora"),
      where("cursoId", "==", cursoId),
      where("docenteId", "==", uid)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      histCard.innerHTML = `<div class="empty-state">Sin registros todavía.</div>`;
      return;
    }
    const entradas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0))
      .slice(0, 10);

    // Traemos también las tareas de este curso/docente una sola vez, para
    // poder mostrar "qué se asignó ese día" al desplegar cada tarjeta sin
    // hacer una consulta nueva por cada una.
    const tareasSnap = await getDocs(query(
      collection(db, "tareas"),
      where("cursoId", "==", cursoId),
      where("docenteId", "==", uid)
    ));
    const tareasDelCurso = tareasSnap.docs.map(d => d.data());

    histCard.innerHTML = "";
    entradas.forEach(e => histCard.appendChild(renderRegistroCard(e, cursoId, tareasDelCurso)));
  } catch (err) {
    console.error(err);
    histCard.innerHTML = `<div class="empty-state">No se pudo cargar el historial.</div>`;
  }
}

// Tarjeta desplegable: al tocarla, muestra la asistencia tomada ese día
// (documento determinístico cursoId_fecha, una sola lectura) y las tareas
// que se entregan ese día — "todo lo que se hizo en esa hora".
// La carga es perezosa (solo la primera vez que se abre cada tarjeta).
function renderRegistroCard(entrada, cursoId, tareasDelCurso) {
  const when = entrada.creado?.toDate ? entrada.creado.toDate().toLocaleString("es-BO") : entrada.fecha;

  const wrapper = document.createElement("details");
  wrapper.className = "log-entry";

  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.innerHTML = `<div class="log-meta">${esc(when)} · ${esc(entrada.tipo)}${entrada.editado ? " · corregido" : ""}</div><div class="log-text">${esc(entrada.texto)}</div>`;
  wrapper.appendChild(summary);

  const detalle = document.createElement("div");
  detalle.style.cssText = "margin-top:10px; padding-top:10px; border-top:1px solid var(--linea);";
  detalle.innerHTML = `<div class="empty-state">Toca para ver la asistencia y tareas de ese día…</div>`;
  wrapper.appendChild(detalle);

  // Lo de hoy se puede corregir sin pedir ayuda a administración.
  if (entrada.id && entrada.fecha === hoyISO()) {
    const btnEd = document.createElement("button");
    btnEd.type = "button";
    btnEd.className = "btn-outline btn-editar";
    btnEd.textContent = "Corregir este registro";
    btnEd.addEventListener("click", () => entrarEdicionLog(entrada));
    wrapper.appendChild(btnEd);
  }

  let cargado = false;
  wrapper.addEventListener("toggle", async () => {
    if (!wrapper.open || cargado) return;
    cargado = true;

    const tareasDia = tareasDelCurso.filter(t => t.fechaEntrega === entrada.fecha);

    let asistenciaHtml = `<div class="log-meta">No se registró asistencia ese día.</div>`;
    try {
      const asisSnap = await leerAsistenciaDia(cursoId, entrada.fecha);
      if (asisSnap.exists()) {
        const valores = Object.values(asisSnap.data().registros || {});
        const p = valores.filter(v => v === "P").length;
        const f = valores.filter(v => v === "F").length;
        const a = valores.filter(v => v === "A").length;
        const l = valores.filter(v => v === "L").length;
        asistenciaHtml = `<div class="log-meta"><b>Asistencia:</b> ${p} presentes · ${f} faltas · ${a} atrasos${l ? ` · ${l} con licencia` : ""}</div>`;
      }
    } catch (err) {
      console.error(err);
      asistenciaHtml = `<div class="log-meta">No se pudo cargar la asistencia de ese día.</div>`;
    }

    const tareasHtml = tareasDia.length
      ? tareasDia.map(t => `<div class="log-meta"><b>Tarea que se entrega:</b> ${esc(t.texto)}</div>`).join("")
      : `<div class="log-meta">No se entregaban tareas ese día.</div>`;

    detalle.innerHTML = asistenciaHtml + tareasHtml;
  });

  return wrapper;
}

// "Todos presentes": deja a todo el curso en Presente de un toque
// (después solo corriges a quien faltó, llegó tarde o tiene licencia).
document.getElementById("btn-todos-presentes")?.addEventListener("click", () => {
  document.querySelectorAll(".status-group").forEach(group => {
    group.querySelectorAll(".status-btn").forEach(b => b.classList.toggle("active", b.dataset.code === "P"));
    state.rosterState[group.dataset.student] = "P";
  });
  updateAttendanceSummary();
  toast("Todos marcados como presentes");
});

/* ------------------- corregir un registro de clase de hoy ------------------- */
function entrarEdicionLog(entrada) {
  state.editandoLog = { id: entrada.id };
  $("#log-tipo").value = entrada.tipo || "clase";
  $("#log-texto").value = entrada.texto || "";
  sucio.log = false;
  let aviso = $("#log-edit-aviso");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "log-edit-aviso";
    aviso.className = "hint-text previa-aviso";
    $("#log-texto").parentNode.insertBefore(aviso, $("#log-texto"));
  }
  aviso.innerHTML = `Estás corrigiendo un registro de hoy. <button type="button" class="link-btn" id="btn-cancelar-edicion">Cancelar</button>`;
  aviso.style.display = "block";
  aviso.querySelector("#btn-cancelar-edicion").addEventListener("click", () => { salirEdicionLog(); $("#log-texto").value = ""; sucio.log = false; });
  $("#log-texto").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#log-texto").focus();
  toast("Corrige el texto y toca «Guardar en registro»");
}

function salirEdicionLog() {
  state.editandoLog = null;
  const aviso = $("#log-edit-aviso");
  if (aviso) aviso.style.display = "none";
}