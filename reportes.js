import {
  collection, doc, addDoc, setDoc, getDocs, query, where, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, toast, guardarSeguro } from "./utils.js";
import { state } from "./state.js";
import { registrarActividad } from "./actividad.js";
import { getComisiones, comisionBadgeClass, comisionActual } from "./comisiones.js";
import { MATERIAS_DISPONIBLES } from "./constants.js";
import { esc, norm, renderFiliacionHTML, snapshotContactos } from "./filiacion.js";

function esAdminActual() {
  return state.currentTeacherDoc?.tipo === "Admin";
}

// Paleta fija: cada materia recibe siempre el mismo color, calculado a
// partir de su nombre (hash simple), sin necesidad de configurarlo a mano.
const PALETA_MATERIAS = [
  "#e57373", "#f2994a", "#f2c94c", "#6fcf97", "#56ccf2",
  "#2f80ed", "#9b51e0", "#eb5757", "#27ae60", "#bb6bd9",
  "#219653", "#2d9cdb"
];
export function colorParaMateria(materia) {
  if (!materia) return "#9aa0a6"; // gris para bitácoras sin materia registrada
  let hash = 0;
  for (let i = 0; i < materia.length; i++) hash = (hash * 31 + materia.charCodeAt(i)) >>> 0;
  return PALETA_MATERIAS[hash % PALETA_MATERIAS.length];
}

// Mapa nombre-de-curso -> id de documento, para poder ubicar el curso
// escrito en #rep-curso y cargar sus estudiantes. Se llena en abrirReportes().
let cursosNombreAId = {};
let estudiantesCursoActual = null; // evita recargar si ya se cargó este curso
let datosEstudiantes = new Map();   // nombre normalizado -> { nombre, filiacion } del curso cargado
let seguimientoSubTabActual = "bitacoras";
const totalEstudiantesPorCursoCache = {}; // cursoId -> cantidad, para el resumen de entregas

export async function abrirReportes() {
  $("#reportes-today").textContent = new Date().toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  switchReporteTab("crear");

  const comisiones = await getComisiones();
  const comisionOptions = comisiones.map(c => `<option value="${c}">${c}</option>`).join("");
  $("#rep-comision").innerHTML = `<option value="">Seleccione una comisión</option>${comisionOptions}`;
  $("#rep-filtro-comision").innerHTML = `<option value="">Todas las comisiones</option>${comisionOptions}`;

  try {
    const cursosSnap = await getDocs(collection(db, "cursos"));
    cursosNombreAId = {};
    cursosSnap.docs.forEach(d => { cursosNombreAId[d.data().nombre || d.id] = d.id; });
    const nombres = Object.keys(cursosNombreAId);
    $("#rep-cursos-datalist").innerHTML = nombres.map(n => `<option value="${n}"></option>`).join("");
    $("#rep-filtro-curso").innerHTML = `<option value="">Todos los cursos</option>` +
      nombres.map(n => `<option value="${n}">${n}</option>`).join("");

    const tabSeguimiento = $("#tab-seguimiento");
    if (esAdminActual()) {
      tabSeguimiento.style.display = "inline-flex";
      $("#seg-filtro-curso").innerHTML = `<option value="">Todos los cursos</option>` +
        cursosSnap.docs.map(d => `<option value="${d.id}">${d.data().nombre || d.id}</option>`).join("");
      $("#seg-filtro-materia").innerHTML = `<option value="">Todas las materias</option>` +
        MATERIAS_DISPONIBLES.map(m => `<option value="${m}">${m}</option>`).join("");
    } else {
      tabSeguimiento.style.display = "none";
    }
  } catch (err) {
    console.error(err);
  }

  estudiantesCursoActual = null;
  datosEstudiantes = new Map();
  $("#rep-estudiantes-datalist").innerHTML = "";
  mostrarFiliacionReporte();
}

// Muestra (o esconde) los contactos de padres/tutor del estudiante escrito en el reporte.
export function mostrarFiliacionReporte() {
  const box = $("#rep-filiacion");
  const est = datosEstudiantes.get(norm($("#rep-estudiante").value));
  if (!est) { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  box.innerHTML = `<div class="field-label" style="margin-top:0;">Contacto de la familia</div>${renderFiliacionHTML(est.filiacion)}`;
}

// Se llama cuando el profe escribe/cambia el curso en #rep-curso.
// Si el texto coincide con un curso conocido, carga sus estudiantes en el
// datalist de #rep-estudiante (el navegador filtra por substring al escribir).
export async function cargarEstudiantesDeCurso(cursoTexto) {
  const nombreCurso = cursoTexto.trim();
  const cursoId = cursosNombreAId[nombreCurso];

  if (!cursoId) {
    estudiantesCursoActual = null;
    datosEstudiantes = new Map();
    $("#rep-estudiantes-datalist").innerHTML = "";
    mostrarFiliacionReporte();
    return;
  }
  if (estudiantesCursoActual === cursoId) { mostrarFiliacionReporte(); return; } // ya cargado

  try {
    const snap = await getDocs(collection(db, "cursos", cursoId, "estudiantes"));
    const nombres = snap.docs.map(d => d.data().nombre).filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
    $("#rep-estudiantes-datalist").innerHTML = nombres.map(n => `<option value="${n}"></option>`).join("");
    datosEstudiantes = new Map(snap.docs.map(d => {
      const e = d.data();
      return [norm(e.nombre), { nombre: e.nombre, filiacion: e.filiacion || null }];
    }));
    estudiantesCursoActual = cursoId;
    mostrarFiliacionReporte();
  } catch (err) {
    console.error(err);
  }
}

export function switchReporteTab(tab) {
  $("#tab-crear-reporte").classList.toggle("active", tab === "crear");
  $("#tab-historial-reportes").classList.toggle("active", tab === "historial");
  $("#tab-seguimiento").classList.toggle("active", tab === "seguimiento");
  $("#panel-crear-reporte").style.display = tab === "crear" ? "block" : "none";
  $("#panel-historial-reportes").style.display = tab === "historial" ? "block" : "none";
  $("#panel-seguimiento").style.display = tab === "seguimiento" ? "block" : "none";
  if (tab === "historial") loadReportesHistorial();
  if (tab === "seguimiento" && esAdminActual()) switchSeguimientoSubTab(seguimientoSubTabActual);
}

export function switchSeguimientoSubTab(sub) {
  seguimientoSubTabActual = sub;
  $("#seg-tab-bitacoras").classList.toggle("active", sub === "bitacoras");
  $("#seg-tab-tareas").classList.toggle("active", sub === "tareas");
  $("#seg-tab-asistencia").classList.toggle("active", sub === "asistencia");
  $("#seguimiento-bitacoras-list").style.display = sub === "bitacoras" ? "block" : "none";
  $("#seguimiento-tareas-list").style.display = sub === "tareas" ? "block" : "none";
  $("#seguimiento-asistencia-list").style.display = sub === "asistencia" ? "block" : "none";
  if (sub === "bitacoras") loadSeguimientoBitacoras();
  if (sub === "tareas") loadSeguimientoTareas();
  if (sub === "asistencia") loadSeguimientoAsistencia();
}

// Los dos filtros (curso, materia) son compartidos por ambas sub-pestañas;
// al cambiar cualquiera, se recarga la que esté activa en ese momento.
export function recargarSeguimientoActivo() {
  switchSeguimientoSubTab(seguimientoSubTabActual);
}

export async function guardarReporte() {
  const comision = $("#rep-comision").value;
  const estudiante = $("#rep-estudiante").value.trim();
  const curso = $("#rep-curso").value.trim();
  const tipo = $("#rep-tipo").value.trim();
  const descripcion = $("#rep-descripcion").value.trim();
  const accion = $("#rep-accion").value.trim();
  const status = $("#rep-status");

  if (!comision || !estudiante || !curso || !descripcion) {
    status.style.color = "var(--red-500)";
    status.textContent = "Completa al menos comisión, estudiante, curso y descripción.";
    return;
  }

  const contactos = snapshotContactos(datosEstudiantes.get(norm(estudiante))?.filiacion);
  try {
    const refReporte = doc(collection(db, "reportes"));
    const estadoRep = await guardarSeguro(setDoc(refReporte, {
      comision, estudiante, curso, tipo, descripcion, accion,
      ...(contactos.length ? { contactos } : {}),
      docenteId: state.currentUser.uid,
      docenteNombre: state.currentTeacherDoc?.nombre || "",
      creado: serverTimestamp()
    }));
    // Aviso para administración (con los datos del reporte, para verlo sin otra lectura).
    registrarActividad({
      tipo: "reporte", reporteId: refReporte.id,
      comision, estudiante, curso, tipoReporte: tipo, descripcion, accion,
      ...(contactos.length ? { contactos } : {})
    });
    status.style.color = "var(--green-600)";
    status.textContent = estadoRep === "pendiente" ? "Sin conexión: guardado en tu teléfono; se enviará cuando vuelva internet." : "Reporte guardado.";
    toast(estadoRep === "pendiente" ? "Sin conexión: se enviará cuando haya internet" : "Reporte guardado", estadoRep === "pendiente" ? 5000 : 2200);
    ["rep-estudiante", "rep-curso", "rep-tipo", "rep-descripcion", "rep-accion"].forEach(id => $(`#${id}`).value = "");
    $("#rep-comision").value = "";
    $("#rep-estudiantes-datalist").innerHTML = "";
    estudiantesCursoActual = null;
    datosEstudiantes = new Map();
    mostrarFiliacionReporte();
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo guardar el reporte. Revisa tu conexión e inténtalo de nuevo.";
  }
}

export async function loadSeguimientoBitacoras() {
  const box = $("#seguimiento-bitacoras-list");
  if (!esAdminActual()) {
    box.innerHTML = `<div class="empty-state">Solo administración puede ver este seguimiento.</div>`;
    return;
  }
  box.innerHTML = `<div class="empty-state">Cargando bitácoras…</div>`;

  const cursoFiltro = $("#seg-filtro-curso").value;
  const materiaFiltro = $("#seg-filtro-materia").value;

  try {
    const snap = await getDocs(query(collection(db, "bitacora"), limit(300)));
    let entradas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    entradas.sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0));

    if (cursoFiltro) entradas = entradas.filter(e => e.cursoId === cursoFiltro);
    if (materiaFiltro) entradas = entradas.filter(e => e.materia === materiaFiltro);

    if (!entradas.length) {
      box.innerHTML = `<div class="empty-state">No hay bitácoras con estos filtros.</div>`;
      return;
    }

    box.innerHTML = "";
    entradas.forEach(e => {
      const when = e.creado?.toDate ? e.creado.toDate().toLocaleString("es-BO") : e.fecha;
      const color = colorParaMateria(e.materia);
      const card = document.createElement("div");
      card.className = "reporte-card";
      card.style.borderLeft = `5px solid ${color}`;
      card.innerHTML = `
        <div class="reporte-top">
          <div class="reporte-field"><b>${e.cursoNombre || e.cursoId}</b>${e.docenteNombre ? " · " + e.docenteNombre : ""}</div>
          <span style="background:${color}; color:#fff; border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600;">${e.materia || "Sin materia"}</span>
        </div>
        <div class="reporte-meta">${when}${e.tipo ? " · " + e.tipo : ""}</div>
        <div class="reporte-field">${e.texto || ""}</div>
      `;
      box.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar el seguimiento. Revisa tu conexión e inténtalo de nuevo.</div>`;
  }
}

export async function loadSeguimientoTareas() {
  const box = $("#seguimiento-tareas-list");
  if (!esAdminActual()) {
    box.innerHTML = `<div class="empty-state">Solo administración puede ver este seguimiento.</div>`;
    return;
  }
  box.innerHTML = `<div class="empty-state">Cargando tareas…</div>`;

  const cursoFiltro = $("#seg-filtro-curso").value;
  const materiaFiltro = $("#seg-filtro-materia").value;

  try {
    // Si hay un curso elegido, traemos cuántos estudiantes tiene para poder
    // mostrar "X/N entregaron"; con "todos los cursos" solo mostramos el
    // conteo de entregados, sin denominador (evita leer todos los cursos).
    let totalEstudiantesCurso = null;
    if (cursoFiltro) {
      if (!(cursoFiltro in totalEstudiantesPorCursoCache)) {
        const estSnap = await getDocs(collection(db, "cursos", cursoFiltro, "estudiantes"));
        totalEstudiantesPorCursoCache[cursoFiltro] = estSnap.size;
      }
      totalEstudiantesCurso = totalEstudiantesPorCursoCache[cursoFiltro];
    }

    const snap = await getDocs(query(collection(db, "tareas"), limit(300)));
    let tareas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    tareas.sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0));

    if (cursoFiltro) tareas = tareas.filter(t => t.cursoId === cursoFiltro);
    if (materiaFiltro) tareas = tareas.filter(t => t.materia === materiaFiltro);

    if (!tareas.length) {
      box.innerHTML = `<div class="empty-state">No hay tareas con estos filtros.</div>`;
      return;
    }

    box.innerHTML = "";
    tareas.forEach(t => {
      const entregados = Object.values(t.entregas || {}).filter(Boolean).length;
      const resumenEntregas = totalEstudiantesCurso != null
        ? `${entregados}/${totalEstudiantesCurso} entregaron`
        : `${entregados} entregado(s)`;
      const entregaFmt = t.fechaEntrega
        ? new Date(t.fechaEntrega + "T00:00:00").toLocaleDateString("es-BO", { day: "numeric", month: "long" })
        : "";
      const color = colorParaMateria(t.materia);
      const card = document.createElement("div");
      card.className = "reporte-card";
      card.style.borderLeft = `5px solid ${color}`;
      card.innerHTML = `
        <div class="reporte-top">
          <div class="reporte-field"><b>${t.cursoNombre || t.cursoId}</b>${t.docenteNombre ? " · " + t.docenteNombre : ""}</div>
          <span style="background:${color}; color:#fff; border-radius:999px; padding:2px 10px; font-size:12px; font-weight:600;">${t.materia || "Sin materia"}</span>
        </div>
        <div class="reporte-meta">Entrega: ${entregaFmt} · ${resumenEntregas}</div>
        <div class="reporte-field">${t.texto || ""}</div>
      `;
      box.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar las tareas. Revisa tu conexión e inténtalo de nuevo.</div>`;
  }
}

// Caché nombre-de-estudiante por curso, para no volver a leer Firestore
// cada vez que se despliega otra tarjeta del mismo curso.
const estudiantesPorCursoCache = {};
async function obtenerEstudiantesDeCurso(cursoId) {
  if (!estudiantesPorCursoCache[cursoId]) {
    const snap = await getDocs(collection(db, "cursos", cursoId, "estudiantes"));
    estudiantesPorCursoCache[cursoId] = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || "" }));
  }
  return estudiantesPorCursoCache[cursoId];
}

export async function loadSeguimientoAsistencia() {
  const box = $("#seguimiento-asistencia-list");
  if (!esAdminActual()) {
    box.innerHTML = `<div class="empty-state">Solo administración puede ver este seguimiento.</div>`;
    return;
  }
  box.innerHTML = `<div class="empty-state">Cargando asistencia…</div>`;

  const cursoFiltro = $("#seg-filtro-curso").value;
  // La asistencia se guarda por docente, curso y día (sin materia), así que
  // el filtro de materia no aplica acá — solo se usa el de curso.

  try {
    const snap = await getDocs(query(collection(db, "asistencia"), limit(300)));
    let registros = snap.docs.map(d => d.data());
    registros.sort((a, b) => (b.actualizado?.toMillis?.() || 0) - (a.actualizado?.toMillis?.() || 0));

    if (cursoFiltro) registros = registros.filter(r => r.cursoId === cursoFiltro);

    if (!registros.length) {
      box.innerHTML = `<div class="empty-state">No hay asistencia registrada con estos filtros.</div>`;
      return;
    }

    box.innerHTML = "";
    registros.forEach(r => box.appendChild(renderAsistenciaAdminCard(r)));
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar la asistencia. Revisa tu conexión e inténtalo de nuevo.</div>`;
  }
}

// Tarjeta desplegable (toca para ver el detalle Presente/Falta/Atraso por
// estudiante, cargado perezosamente la primera vez que se abre).
function renderAsistenciaAdminCard(r) {
  const valores = Object.values(r.registros || {});
  const p = valores.filter(v => v === "P").length;
  const f = valores.filter(v => v === "F").length;
  const a = valores.filter(v => v === "A").length;
  const l = valores.filter(v => v === "L").length;
  const fechaFmt = r.fecha
    ? new Date(r.fecha + "T00:00:00").toLocaleDateString("es-BO", { weekday: "long", day: "numeric", month: "long" })
    : "";

  const wrapper = document.createElement("details");
  wrapper.className = "reporte-card";

  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.innerHTML = `
    <div class="reporte-top">
      <div class="reporte-field"><b>${r.cursoNombre || r.cursoId}</b>${r.docenteNombre ? " · " + r.docenteNombre : ""}</div>
    </div>
    <div class="reporte-meta" style="text-transform:capitalize;">${fechaFmt}</div>
    <div class="reporte-field">${p} presentes · ${f} faltas · ${a} atrasos${l ? ` · ${l} con licencia` : ""} — toca para ver el detalle</div>
  `;
  wrapper.appendChild(summary);

  const detalle = document.createElement("div");
  detalle.style.cssText = "margin-top:10px; padding-top:10px; border-top:1px solid var(--linea);";
  detalle.innerHTML = `<div class="empty-state">Cargando estudiantes…</div>`;
  wrapper.appendChild(detalle);

  let cargado = false;
  wrapper.addEventListener("toggle", async () => {
    if (!wrapper.open || cargado) return;
    cargado = true;
    try {
      const estudiantes = await obtenerEstudiantesDeCurso(r.cursoId);
      const etiqueta = { P: "Presente", F: "Falta", A: "Atraso", L: "Licencia" };
      detalle.innerHTML = estudiantes.length
        ? estudiantes.map(est => {
            const codigo = r.registros?.[est.id] || "—";
            return `<div class="roster-row"><div class="roster-name">${est.nombre}</div><div class="hint-text" style="margin:0;">${etiqueta[codigo] || codigo}</div></div>`;
          }).join("")
        : `<div class="empty-state">Este curso no tiene estudiantes cargados.</div>`;
    } catch (err) {
      console.error(err);
      detalle.innerHTML = `<div class="empty-state">No se pudo cargar el detalle.</div>`;
    }
  });

  return wrapper;
}

export async function loadReportesHistorial() {
  const box = $("#reportes-list");
  box.innerHTML = `<div class="empty-state">Cargando reportes…</div>`;

  const esAdmin = esAdminActual();
  try {
    const q = esAdmin
      ? query(collection(db, "reportes"), limit(200))
      : query(collection(db, "reportes"), where("docenteId", "==", state.currentUser.uid), limit(200));
    const snap = await getDocs(q);

    let reportes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    reportes.sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0));

    if (state.reportesFiltro.curso) reportes = reportes.filter(r => r.curso === state.reportesFiltro.curso);
    if (state.reportesFiltro.comision) reportes = reportes.filter(r => comisionActual(r.comision) === state.reportesFiltro.comision);

    if (!reportes.length) {
      box.innerHTML = `<div class="empty-state">No hay reportes${esAdmin ? "" : " tuyos"} con estos filtros.</div>`;
      return;
    }

    box.innerHTML = "";
    reportes.forEach(r => {
      const when = r.creado?.toDate ? r.creado.toDate().toLocaleString("es-BO") : "";
      const card = document.createElement("div");
      card.className = "reporte-card";
      card.innerHTML = `
        <div class="reporte-top">
          <div>
            <div class="reporte-field"><b>${r.estudiante}</b> · ${r.curso}</div>
          </div>
          <span class="${comisionBadgeClass(r.comision)}">${comisionActual(r.comision)}</span>
        </div>
        <div class="reporte-meta">${when}${esAdmin && r.docenteNombre ? " · " + r.docenteNombre : ""}</div>
        ${r.tipo ? `<div class="reporte-field"><b>Tipo:</b> ${r.tipo}</div>` : ""}
        <div class="reporte-field"><b>Descripción:</b> ${r.descripcion}</div>
        ${r.accion ? `<div class="reporte-field"><b>Acción propuesta:</b> ${r.accion}</div>` : ""}
        ${(r.contactos || []).length ? `<div class="reporte-field"><b>Contacto:</b> ${r.contactos.map(c =>
          `${esc(c.rol)}${c.parentesco ? " (" + esc(c.parentesco) + ")" : ""}: ${esc(c.nombre) || "—"}${c.telefono ? " · " + esc(c.telefono) : ""}`).join(" — ")}</div>` : ""}
      `;
      box.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar el historial. Revisa tu conexión e inténtalo de nuevo.</div>`;
  }
}

// Dropdowns con el estilo del sitio (los <select> y listas nativas siguen en el
// DOM y mandan el valor, así el resto del código no cambia).
import { mejorarSelect, mejorarDatalist } from "./dropdown.js";
["#rep-comision", "#rep-tipo", "#rep-filtro-curso", "#rep-filtro-comision", "#seg-filtro-curso", "#seg-filtro-materia"]
  .forEach(s => mejorarSelect($(s)));
["#rep-curso", "#rep-estudiante"].forEach(s => mejorarDatalist($(s)));