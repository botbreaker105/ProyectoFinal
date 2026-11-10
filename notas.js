/* -------------------------------------------------------------------------
   NOTAS POR CURSO — se agrupan por curso aunque vengan de materias distintas
   Firestore: notas/{cursoId}/registros/{materiaSlug__trimestreSlug__estudianteSlug}
              { curso, materia, trimestre, estudiante, nota, actualizado }
   El id determinístico hace que reimportar el mismo estudiante+materia+trimestre
   actualice la nota en vez de crear una fila duplicada.

   PERMISOS (ver también firestore.rules):
   - Cualquier docente autenticado puede LEER y exportar notas de cualquier curso.
   - Solo puede ESCRIBIR (importar) notas de un curso que tenga asignado en
     docentes/{uid}.cursos, y nunca si su tipo es "Admin" (Admin es solo lectura).
   La UI oculta/avisa esto, y Firestore lo hace cumplir de todas formas.
   ------------------------------------------------------------------------- */

import {
  collection, doc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField,
  FieldPath, serverTimestamp, where, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, toast, escapeCsv, downloadTextFile } from "./utils.js";
import { state } from "./state.js";
import { loadCursosOptions } from "./admin-cursos.js";
import { GRUPOS_DISPONIBLES } from "./constants.js";

// Caché nombre-de-estudiante -> grupo, para el curso actualmente mostrado en
// la pantalla de Notas. Evita volver a leer Firestore en cada filtro.
let grupoPorEstudianteCache = {};
let cursoGrupoCacheado = null;

async function ensureGrupoMap(cursoId) {
  if (!cursoId) { grupoPorEstudianteCache = {}; cursoGrupoCacheado = null; return; }
  if (cursoGrupoCacheado === cursoId) return;
  try {
    const snap = await getDocs(collection(db, "cursos", cursoId, "estudiantes"));
    grupoPorEstudianteCache = {};
    snap.forEach(d => { grupoPorEstudianteCache[d.data().nombre] = d.data().grupo || ""; });
    cursoGrupoCacheado = cursoId;
  } catch (err) {
    console.error(err);
    grupoPorEstudianteCache = {};
    cursoGrupoCacheado = null;
  }
}

// "Carga de tareas": para el curso elegido, cuenta cuántas tareas tiene
// pendientes cada estudiante SUMANDO las de todos los docentes/materias de
// ese curso (no solo las de quien mira la pantalla) — por eso la lectura de
// "tareas" en firestore.rules permite a cualquier docente asignado a ese
// curso leerlas, no solo a quien las creó.
// "Carga de tareas": una barra por CURSO (los tuyos; Admin ve todos), no por
// estudiante. Suma, para cada curso, las tareas pendientes de TODOS los
// docentes/materias que dan clase ahí — por eso "tareas" en firestore.rules
// se puede leer por cualquier docente asignado a ese curso, no solo por
// quien las creó. El número mostrado es el promedio de tareas pendientes
// por estudiante, para que un curso con más estudiantes no se vea "más
// cargado" solo por tener más gente.
export async function renderCargaTareas() {
  const titulo = $("#carga-tareas-titulo");
  const hint = $("#carga-tareas-hint");
  const card = $("#carga-tareas-card");

  titulo.style.display = "block";
  hint.style.display = "block";
  card.style.display = "block";
  card.innerHTML = `<div class="empty-state">Cargando…</div>`;

  try {
    let cursos; // [{id, nombre}]
    if (esAdminActual()) {
      const snap = await getDocs(collection(db, "cursos"));
      cursos = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || d.id }));
    } else {
      const cursosSnap = await getDocs(collection(db, "cursos"));
      const misIds = new Set(cursosAsignadosActual());
      cursos = cursosSnap.docs
        .filter(d => misIds.has(d.id))
        .map(d => ({ id: d.id, nombre: d.data().nombre || d.id }));
    }

    if (!cursos.length) {
      card.innerHTML = `<div class="empty-state">No tienes cursos asignados todavía.</div>`;
      return;
    }

    const filas = (await Promise.all(cursos.map(async (c) => {
      const [estSnap, tareasSnap] = await Promise.all([
        getDocs(collection(db, "cursos", c.id, "estudiantes")),
        getDocs(query(collection(db, "tareas"), where("cursoId", "==", c.id)))
      ]);
      const totalEstudiantes = estSnap.size;
      const estudianteIds = estSnap.docs.map(d => d.id);
      const tareas = tareasSnap.docs.map(d => d.data());
      if (!totalEstudiantes || !tareas.length) return { nombre: c.nombre, tareas: tareas.length, promedio: 0, sinDatos: true };

      const totalPendientes = tareas.reduce((acc, t) =>
        acc + estudianteIds.filter(id => !(t.entregas && t.entregas[id])).length, 0);
      const promedio = totalPendientes / totalEstudiantes;
      return { nombre: c.nombre, tareas: tareas.length, promedio, sinDatos: false };
    }))).sort((a, b) => b.promedio - a.promedio); // más cargados primero

    const maxPromedio = Math.max(...filas.map(f => f.promedio), 1);

    card.innerHTML = "";
    filas.forEach(f => {
      const pct = f.sinDatos ? 0 : Math.round((f.promedio / maxPromedio) * 100);
      const nivel = f.promedio >= 3 ? "alta" : f.promedio >= 1 ? "media" : "baja";
      const numTexto = f.sinDatos ? "sin tareas" : `${f.promedio.toFixed(1)} prom.`;
      const row = document.createElement("div");
      row.className = "carga-row";
      row.innerHTML = `
        <div class="carga-nombre">${f.nombre}</div>
        <div class="carga-track"><div class="carga-fill ${nivel}" style="width:${pct}%;"></div></div>
        <div class="carga-num">${numTexto}</div>
      `;
      card.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    card.innerHTML = `<div class="empty-state">No se pudo cargar la carga de tareas. Revisa la consola.</div>`;
  }
}

function slugify(text) {
  return String(text ?? "")
    .trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "na";
}

function esAdminActual() {
  return state.currentTeacherDoc?.tipo === "Admin";
}

function cursosAsignadosActual() {
  return state.currentTeacherDoc?.cursos || [];
}

// Materias que el usuario puede ver en un curso. Admin: todas (null). Docente: solo las
// materias que da en ese curso (docentes/{uid}.materias); si no hay ninguna configurada, no se filtra.
function materiasPermitidas(cursoId) {
  if (esAdminActual()) return null;
  const d = state.currentTeacherDoc || {};
  const lista = (d.materias || [])
    .filter(m => !cursoId || (m.cursos || []).includes(cursoId))
    .map(m => m.materia);
  if (!lista.length && d.materia) lista.push(d.materia);
  return lista.length ? new Set(lista.map(slugify)) : null;
}
const materiaVisible = (cursoId, materia) => {
  const ok = materiasPermitidas(cursoId);
  return !ok || ok.has(slugify(materia));
};
// Cursos que el usuario puede ver: Admin todos; docente solo los suyos.
const cursoVisible = (cursoId) => esAdminActual() || cursosAsignadosActual().includes(cursoId);

// Un docente puede escribir notas en un curso solo si lo tiene asignado y
// no es Admin. cursoId vacío ("todos los cursos") nunca habilita escritura.
function puedeEscribirNotasEn(cursoId) {
  if (!cursoId || esAdminActual()) return false;
  return cursosAsignadosActual().includes(cursoId);
}

// Actualiza el aviso de permisos y muestra/oculta la tarjeta de importación
// según el curso elegido y el rol del usuario actual.
export function actualizarPermisoNotasUI() {
  const cursoId = $("#notas-curso").value;
  const hint = $("#notas-permiso-hint");
  const importCard = $("#notas-import-card");

  if (esAdminActual()) {
    importCard.style.display = "none";
    hint.style.color = "var(--ink-soft)";
    hint.textContent = "Como administración puedes ver y exportar las notas, pero no agregarlas.";
    return;
  }

  importCard.style.display = "block";
  if (!cursoId) {
    hint.style.color = "var(--ink-soft)";
    hint.textContent = "Elige un curso arriba para ver o importar sus notas.";
  } else if (puedeEscribirNotasEn(cursoId)) {
    hint.style.color = "var(--green-600)";
    hint.textContent = `Puedes importar y corregir notas del curso ${cursoId}.`;
  } else {
    hint.style.color = "var(--red-500)";
    hint.textContent = `El curso ${cursoId} no está asignado a ti, así que no puedes agregarle notas.`;
  }
}

export async function loadNotasCursoSelect() {
  const previo = $("#notas-curso").value;
  await loadCursosOptions("#notas-curso", "Todos los cursos");
  const sel = $("#notas-curso");
  // Un docente solo ve sus cursos (sin la opción "Todos los cursos"); Admin ve todos.
  if (!esAdminActual()) {
    [...sel.options].forEach(o => { if (o.value === "" || !cursoVisible(o.value)) o.remove(); });
    if (!sel.options.length) sel.innerHTML = `<option value="">No tienes cursos asignados</option>`;
  }
  // Se conserva el curso que ya estaba elegido; si no, se abre el primero para ver la tabla enseguida.
  const hay = (v) => v && [...sel.options].some(o => o.value === v);
  sel.value = hay(previo) ? previo : ([...sel.options].find(o => o.value)?.value || "");
  $("#notas-grupo-filtro").innerHTML = `<option value="">Todos los grupos</option>` +
    GRUPOS_DISPONIBLES.map(g => `<option value="${g}">${g}</option>`).join("");
  gb.cursoId = ""; // fuerza releer las tareas de Firestore al abrir la pantalla
  actualizarPermisoNotasUI();
  await refreshNotasMateriaYTrimestreFiltro();
  await renderNotasTabla();
  await renderCargaTareas();
}

// Recalcula materias y trimestres disponibles en los filtros según el curso
// elegido (o según todos los cursos, si no hay curso seleccionado).
export async function refreshNotasMateriaYTrimestreFiltro() {
  const cursoId = $("#notas-curso").value;
  const filtroMateria = $("#notas-materia-filtro");
  const filtroTrimestre = $("#notas-trimestre-filtro");
  const materiasEncontradas = new Set();
  const trimestresEncontrados = new Set();
  try {
    const cursoIds = cursoId ? [cursoId] : (await getDocs(collection(db, "cursos"))).docs.map(d => d.id).filter(cursoVisible);
    for (const cId of cursoIds) {
      const snap = await getDocs(collection(db, "notas", cId, "registros"));
      snap.forEach(d => {
        const n = d.data();
        if (!materiaVisible(cId, n.materia)) return;
        if (n.materia) materiasEncontradas.add(n.materia);
        if (n.trimestre) trimestresEncontrados.add(n.trimestre);
      });
      try {
        const tSnap = await getDocs(tareasQuery(cId));
        tSnap.forEach(d => {
          const t = d.data();
          if (!materiaVisible(cId, t.materia)) return;
          if (t.materia) materiasEncontradas.add(t.materia);
          if (t.trimestre) trimestresEncontrados.add(String(t.trimestre));
        });
      } catch (err) {
        console.error(err);
      }
    }
  } catch (err) {
    console.error(err);
  }
  const materiaActual = filtroMateria.value;
  filtroMateria.innerHTML = `<option value="">Todas las materias</option>` +
    [...materiasEncontradas].sort().map(m => `<option value="${m}">${m}</option>`).join("");
  if ([...materiasEncontradas].includes(materiaActual)) filtroMateria.value = materiaActual;

  const trimestreActual = filtroTrimestre.value;
  filtroTrimestre.innerHTML = `<option value="">Todos los trimestres</option>` +
    [...trimestresEncontrados].sort().map(t => `<option value="${t}">Trimestre ${t}</option>`).join("");
  if ([...trimestresEncontrados].includes(trimestreActual)) filtroTrimestre.value = trimestreActual;
}

// Repinta las dos tablas de la pantalla: la nueva (por tarea) y la de notas importadas por CSV.
export async function renderNotasTabla() {
  await Promise.all([renderNotasTablaCsv(), renderGradebook()]);
}

async function renderNotasTablaCsv() {
  const cursoId = $("#notas-curso").value;
  const materiaFiltro = $("#notas-materia-filtro").value;
  const trimestreFiltro = $("#notas-trimestre-filtro").value;
  const grupoFiltro = $("#notas-grupo-filtro").value;
  const card = $("#notas-tabla-card");
  const tbody = $("#notas-tabla tbody");

  if (!cursoId) {
    card.style.display = "none";
    $("#notas-tabla-titulo").style.display = "none";
    state.notasCache = [];
    return;
  }

  card.style.display = "block";
  $("#notas-tabla-titulo").style.display = "block";
  tbody.innerHTML = `<tr><td colspan="5" class="empty" style="border-right:none;">Cargando notas…</td></tr>`;
  try {
    await ensureGrupoMap(cursoId);
    const snap = await getDocs(collection(db, "notas", cursoId, "registros"));
    let filas = snap.docs.map(d => d.data());
    filas = filas.filter(f => {
      const grupoEstudiante = grupoPorEstudianteCache[f.estudiante] || "";
      if (!materiaVisible(cursoId, f.materia)) return false;
      if (materiaFiltro && f.materia !== materiaFiltro) return false;
      if (trimestreFiltro && f.trimestre !== trimestreFiltro) return false;
      if (grupoFiltro && grupoEstudiante !== grupoFiltro) return false;
      return true;
    });
    filas.sort((a, b) => (a.estudiante || "").localeCompare(b.estudiante || ""));
    state.notasCache = filas;

    if (!filas.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty" style="border-right:none;">Sin notas para este filtro todavía.</td></tr>`;
      return;
    }
    tbody.innerHTML = filas.map(f => `
      <tr>
        <td style="text-align:left;">${f.estudiante || ""}</td>
        <td>${grupoPorEstudianteCache[f.estudiante] || "—"}</td>
        <td>${f.materia || ""}</td>
        <td>${f.trimestre || ""}</td>
        <td>${f.nota ?? ""}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty" style="border-right:none;">No se pudieron cargar las notas.</td></tr>`;
  }
}

/* =========================================================================
   NOTAS POR TAREA — tabla tipo Excel dentro de la pantalla Notas
   Firestore: notas/{cursoId}/tareas/{tareaId}
              { cursoId, nombre, materia, trimestre, sobre, docenteId,
                docenteNombre, notas: { [estudianteId]: número }, creado, actualizado }
   Una FILA = una tarea (nombre al inicio de la fila); una COLUMNA = un estudiante.
   - Docente: ve y edita solo sus propias tareas, en los cursos que tiene asignados.
   - Admin: ve todas las tareas de todas las materias del curso elegido (solo lectura).
   La nota se guarda sola al salir de la casilla (o con Enter).
   ========================================================================= */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

let gb = { cursoId: "", estudiantes: [], tareas: [], visibles: [] };

// Admin lee todo el curso; un docente solo sus tareas (lo exige también firestore.rules).
function tareasQuery(cursoId) {
  const col = collection(db, "notas", cursoId, "tareas");
  return esAdminActual() ? col : query(col, where("docenteId", "==", state.currentUser.uid));
}

const millisCreado = (t) => t.creado?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
const fmtNota = (n) => String(Math.round(n * 10) / 10);

function puedeEditarTarea(t) {
  return !esAdminActual()
    && t.docenteId === state.currentUser?.uid
    && puedeEscribirNotasEn(gb.cursoId);
}

function materiasDelDocenteEnCurso(cursoId) {
  const ms = (state.currentTeacherDoc?.materias || [])
    .filter(m => (m.cursos || []).includes(cursoId))
    .map(m => m.materia);
  if (ms.length) return ms;
  return [state.currentTeacherDoc?.materia || "General"];
}

function actualizarGbControles(cursoId) {
  const hint = $("#gb-hint");
  if (esAdminActual()) {
    hint.textContent = "Estás viendo las notas de todas las materias de este curso. Como administración solo puedes mirar, no editar.";
  } else if (puedeEscribirNotasEn(cursoId)) {
    const ms = (state.currentTeacherDoc?.materias || []).filter(m => (m.cursos || []).includes(cursoId)).map(m => m.materia);
    hint.textContent = `${ms.length ? "Tu materia aquí: " + ms.join(", ") + ". " : ""}Cada fila es un estudiante y cada columna una tarea o evaluación. Toca una casilla para corregir una nota (se guarda sola al salir). Las tareas nuevas se crean desde tu clase, en Inicio.`;
  } else {
    hint.textContent = "No tienes este curso asignado, así que aquí no tienes tareas con notas.";
  }
}

export async function renderGradebook() {
  const cursoId = $("#notas-curso").value;
  const titulo = $("#gb-titulo");
  const card = $("#gb-card");
  if (!cursoId) {
    titulo.style.display = card.style.display = "none";
    gb = { cursoId: "", estudiantes: [], tareas: [], visibles: [] };
    return;
  }
  titulo.style.display = "block";
  card.style.display = "block";

  // Si es el mismo curso y solo cambió un filtro, repintamos desde la caché.
  if (gb.cursoId === cursoId) { pintarGradebook(); return; }

  actualizarGbControles(cursoId);
  const tabla = $("#gb-tabla");
  tabla.innerHTML = `<tbody><tr><td class="gb-msg">Cargando notas…</td></tr></tbody>`;
  try {
    const [estSnap, tSnap] = await Promise.all([
      getDocs(collection(db, "cursos", cursoId, "estudiantes")),
      getDocs(tareasQuery(cursoId))
    ]);
    if ($("#notas-curso").value !== cursoId) return; // cambió de curso mientras cargaba
    gb.cursoId = cursoId;
    gb.estudiantes = estSnap.docs
      .map(d => ({ id: d.id, nombre: d.data().nombre || "", grupo: d.data().grupo || "" }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    gb.tareas = tSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => millisCreado(a) - millisCreado(b)); // la más nueva queda abajo
    pintarGradebook();
  } catch (err) {
    console.error(err);
    tabla.innerHTML = `<tbody><tr><td class="gb-msg">No se pudieron cargar las notas por tarea. Revisa la consola (¿ya agregaste las reglas de Firestore nuevas?).</td></tr></tbody>`;
  }
}

function pintarGradebook() {
  const tabla = $("#gb-tabla");
  const materiaF = $("#notas-materia-filtro").value;
  const trimestreF = $("#notas-trimestre-filtro").value;
  const grupoF = $("#notas-grupo-filtro").value;

  const ests = gb.estudiantes.filter(e => !grupoF || e.grupo === grupoF);
  const tareas = gb.tareas.filter(t =>
    (!materiaF || t.materia === materiaF) &&
    (!trimestreF || String(t.trimestre) === trimestreF));
  gb.visibles = tareas;

  const mensaje = (txt) => { tabla.innerHTML = `<tbody><tr><td class="gb-msg">${txt}</td></tr></tbody>`; };
  if (!ests.length) { mensaje("Este curso no tiene estudiantes para este filtro."); return; }
  if (!tareas.length) {
    mensaje(esAdminActual()
      ? "Todavía no hay tareas con notas en este curso para este filtro."
      : "Aún no hay tareas con notas aquí. Crea una tarea desde tu clase (Inicio → tu clase → Nueva tarea) y aparecerá en esta tabla.");
    return;
  }

  // Trimestres presentes; sin filtro y con más de uno, se agrega un promedio por trimestre.
  const trimestres = [...new Set(tareas.map(t => String(t.trimestre || "")))]
    .sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, "es", { numeric: true }));
  const separar = !trimestreF && trimestres.length > 1;
  const cols = separar
    ? [...tareas].sort((a, b) => trimestres.indexOf(String(a.trimestre || "")) - trimestres.indexOf(String(b.trimestre || "")))
    : tareas;
  const grupos = separar
    ? [...trimestres.map(tr => ({ g: tr || "__sin", label: tr ? `Prom. T${tr}` : "Prom. s/trim." })), { g: "all", label: "General" }]
    : [{ g: "all", label: "Promedio" }];

  // Cabecera de cada tarea/evaluación: nombre, datos y (si es tuya) Eliminar.
  const cabeceraTarea = (t) => {
    const edit = puedeEditarTarea(t);
    const entrega = t.fechaEntrega
      ? new Date(t.fechaEntrega + "T00:00:00").toLocaleDateString("es-BO", { day: "numeric", month: "short" }) : "";
    const meta = [t.materia, t.trimestre ? "T" + t.trimestre : "", "/" + (t.sobre || 100), entrega].filter(Boolean).join(" · ");
    return `<th class="gb-tcol" scope="col">
      ${t.tipo === "evaluacion" ? `<span class="tipo-eval">Evaluación</span>` : ""}
      <div class="gb-tname">${esc(t.nombre)}</div>
      <div class="gb-tmeta">${esc(meta)}</div>
      ${edit ? `<button type="button" class="gb-del" data-del="${esc(t.id)}">Eliminar</button>` : ""}
    </th>`;
  };

  const celda = (t, e) => {
    const sobre = t.sobre || 100;
    const v = t.notas?.[e.id];
    return puedeEditarTarea(t)
      ? `<td><input type="number" inputmode="decimal" min="0" max="${sobre}" step="any"
           data-tarea="${esc(t.id)}" data-est="${esc(e.id)}" value="${v ?? ""}"
           aria-label="Nota de ${esc(e.nombre)} en ${esc(t.nombre)}"></td>`
      : `<td>${v ?? "—"}</td>`;
  };

  const head = `<thead><tr><th class="gb-first" scope="col">Estudiante</th>${
    cols.map(cabeceraTarea).join("")
  }${grupos.map(g => `<th class="gb-prom-col" scope="col">${esc(g.label)}<div class="gb-tmeta">/100</div></th>`).join("")}</tr></thead>`;

  const filaEst = (e) => `<tr><th class="gb-first" scope="row">${esc(e.nombre)}</th>${
    cols.map(t => celda(t, e)).join("")
  }${grupos.map(g => `<td class="gb-prom-col" data-prom="${esc(e.id)}" data-grupo="${esc(g.g)}"></td>`).join("")}</tr>`;

  tabla.innerHTML = head + `<tbody>${ests.map(filaEst).join("")}</tbody>`;
  actualizarPromedios();
}

// Promedio por estudiante, llevado a /100 para poder promediar tareas con distinto "sobre".
// Cada celda indica su grupo: "all" = todas las tareas que se ven; o un trimestre concreto.
function actualizarPromedios() {
  document.querySelectorAll("#gb-tabla [data-prom]").forEach(td => {
    const estId = td.dataset.prom;
    const grupo = td.dataset.grupo || "all";
    const tareas = grupo === "all" ? gb.visibles : gb.visibles.filter(t => String(t.trimestre || "") === (grupo === "__sin" ? "" : grupo));
    const pts = [];
    tareas.forEach(t => {
      const v = t.notas?.[estId];
      if (typeof v === "number") pts.push(v / (t.sobre || 100) * 100);
    });
    td.textContent = pts.length ? fmtNota(pts.reduce((a, b) => a + b, 0) / pts.length) : "—";
  });
}

async function guardarCelda(input) {
  const t = gb.tareas.find(x => x.id === input.dataset.tarea);
  if (!t) return;
  const estId = input.dataset.est;
  const previo = t.notas?.[estId];
  const sobre = t.sobre || 100;
  const raw = input.value.trim().replace(",", ".");
  const n = raw === "" ? null : Number(raw);

  if (n !== null && (!Number.isFinite(n) || n < 0 || n > sobre)) {
    toast(`La nota debe estar entre 0 y ${sobre}`);
    input.value = previo ?? "";
    return;
  }
  if ((previo ?? null) === n) return; // sin cambios

  input.classList.add("saving");
  try {
    await updateDoc(
      doc(db, "notas", gb.cursoId, "tareas", t.id),
      new FieldPath("notas", estId), n === null ? deleteField() : n,
      "actualizado", serverTimestamp()
    );
    t.notas = t.notas || {};
    if (n === null) delete t.notas[estId]; else t.notas[estId] = n;
    input.classList.add("saved");
    setTimeout(() => input.classList.remove("saved"), 900);
    actualizarPromedios();
  } catch (err) {
    console.error(err);
    input.value = previo ?? "";
    toast("No se pudo guardar la nota. Intenta de nuevo.");
  } finally {
    input.classList.remove("saving");
  }
}

async function eliminarTareaNotas(id) {
  const t = gb.tareas.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`¿Eliminar la tarea «${t.nombre}» y todas sus notas? No se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "notas", gb.cursoId, "tareas", id));
    gb.tareas = gb.tareas.filter(x => x.id !== id);
    pintarGradebook();
    toast("Tarea eliminada");
  } catch (err) {
    console.error(err);
    toast("No se pudo eliminar la tarea.");
  }
}

// Se llama una vez desde main.js.
export function initGradebookUI() {
  const tabla = $("#gb-tabla");
  // Tope: una casilla no deja escribir más que el "sobre" de su tarea
  tabla.addEventListener("input", (e) => {
    if (!e.target.matches("input[data-tarea]") || e.target.value === "") return;
    const max = gb.tareas.find(x => x.id === e.target.dataset.tarea)?.sobre || 100;
    const v = Number(e.target.value);
    if (v > max) e.target.value = String(max);
    else if (v < 0) e.target.value = "0";
  });
  tabla.addEventListener("change", (e) => {
    if (e.target.matches("input[data-tarea]")) guardarCelda(e.target);
  });
  tabla.addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (b) eliminarTareaNotas(b.dataset.del);
  });
  // Enter baja a la casilla de abajo (misma columna), como en una hoja de cálculo.
  tabla.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("input[data-est]")) return;
    e.preventDefault();
    const col = [...tabla.querySelectorAll("input[data-est]")].filter(i => i.dataset.est === e.target.dataset.est);
    const next = col[col.indexOf(e.target) + 1];
    e.target.blur();
    if (next) next.focus();
  });
}

export function importNotasCSV() {
  const status = $("#notas-import-status");

  if (esAdminActual()) {
    status.style.color = "var(--red-500)";
    status.textContent = "Administración no puede importar notas, solo verlas y exportarlas.";
    return;
  }

  const fileInput = $("#notas-csv-file");
  const file = fileInput.files[0];
  if (!file) {
    status.style.color = "var(--red-500)";
    status.textContent = "Selecciona un archivo CSV primero.";
    return;
  }
  status.style.color = "var(--ink-soft)";
  status.textContent = "Leyendo archivo…";

  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const todasLasFilas = results.data.map(row => ({
        curso: (row.curso || row.Curso || row.CURSO || "").trim(),
        materia: (row.materia || row.Materia || row.MATERIA || "").trim(),
        trimestre: (row.trimestre || row.Trimestre || row.TRIMESTRE || "").toString().trim(),
        nombre: (row.nombre || row.Nombre || row.NOMBRE || row.estudiante || "").trim(),
        nota: (row.nota || row.Nota || row.NOTA || "").toString().trim()
      })).filter(f => f.curso && f.materia && f.trimestre && f.nombre);

      if (!todasLasFilas.length) {
        status.style.color = "var(--red-500)";
        status.textContent = "No se encontraron filas válidas. Revisa que las columnas se llamen 'curso', 'materia', 'trimestre', 'nombre' y 'nota'.";
        return;
      }

      // Solo se procesan filas de cursos que el docente tiene asignados;
      // el resto se omite y se avisa (Firestore también lo bloquearía).
      const misCursos = new Set(cursosAsignadosActual());
      const filas = todasLasFilas.filter(f => misCursos.has(f.curso));
      const omitidas = todasLasFilas.length - filas.length;

      if (!filas.length) {
        status.style.color = "var(--red-500)";
        status.textContent = "Ninguna fila corresponde a un curso que tengas asignado. No se importó nada.";
        return;
      }

      status.textContent = "Importando…";
      let totalNotas = 0;
      const cursosTocados = new Set();
      try {
        for (const f of filas) {
          const regId = `${slugify(f.materia)}__${slugify(f.trimestre)}__${slugify(f.nombre)}`;
          await setDoc(doc(db, "notas", f.curso, "registros", regId), {
            curso: f.curso,
            materia: f.materia,
            trimestre: f.trimestre,
            estudiante: f.nombre,
            nota: f.nota,
            actualizado: serverTimestamp()
          }, { merge: true });
          totalNotas++;
          cursosTocados.add(f.curso);
        }
        status.style.color = "var(--green-600)";
        status.textContent = `Listo: ${totalNotas} nota(s) importadas en ${cursosTocados.size} curso(s).` +
          (omitidas ? ` Se omitieron ${omitidas} fila(s) de cursos que no tienes asignados.` : "");
        fileInput.value = "";
        toast("Notas importadas");
        await refreshNotasMateriaYTrimestreFiltro();
        await renderNotasTabla();
      } catch (err) {
        console.error(err);
        status.style.color = "var(--red-500)";
        status.textContent = "Ocurrió un error durante la importación (revisa que el curso esté asignado a tu usuario). Revisa la consola.";
      }
    },
    error: (err) => {
      console.error(err);
      status.style.color = "var(--red-500)";
      status.textContent = "No se pudo leer el archivo CSV.";
    }
  });
}

export async function exportNotasCSV() {
  const cursoId = $("#notas-curso").value;
  const materiaFiltro = $("#notas-materia-filtro").value;
  const trimestreFiltro = $("#notas-trimestre-filtro").value;
  const grupoFiltro = $("#notas-grupo-filtro").value;
  const status = $("#notas-export-status");
  status.style.color = "var(--ink-soft)";
  status.textContent = "Preparando exportación…";
  try {
    const rows = [["curso", "materia", "trimestre", "nombre", "grupo", "nota"]];
    const cursoIds = cursoId ? [cursoId] : (await getDocs(collection(db, "cursos"))).docs.map(d => d.id).filter(cursoVisible);

    for (const cId of cursoIds) {
      if (grupoFiltro) await ensureGrupoMap(cId);
      const snap = await getDocs(collection(db, "notas", cId, "registros"));
      snap.forEach(d => {
        const n = d.data();
        if (!materiaVisible(cId, n.materia)) return;
        if (materiaFiltro && n.materia !== materiaFiltro) return;
        if (trimestreFiltro && n.trimestre !== trimestreFiltro) return;
        const grupoEstudiante = grupoPorEstudianteCache[n.estudiante] || "";
        if (grupoFiltro && grupoEstudiante !== grupoFiltro) return;
        rows.push([cId, n.materia || "", n.trimestre || "", n.estudiante || "", grupoEstudiante, n.nota ?? ""]);
      });
    }

    if (rows.length === 1) {
      status.style.color = "var(--amber-500)";
      status.textContent = "No hay notas que coincidan con el filtro elegido.";
      return;
    }

    const csv = rows.map(r => r.map(escapeCsv).join(",")).join("\n");
    const sufijo = [cursoId || "todos", materiaFiltro ? slugify(materiaFiltro) : "todas-materias", trimestreFiltro ? `t${slugify(trimestreFiltro)}` : "todos-trimestres"].join("_");
    downloadTextFile(csv, `notas_${sufijo}_${new Date().toISOString().slice(0, 10)}.csv`);
    status.style.color = "var(--green-600)";
    status.textContent = `Listo: ${rows.length - 1} nota(s) exportadas.`;
    toast("CSV de notas descargado");
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo exportar. Revisa la consola.";
  }
}

// Dropdowns con el estilo del sitio (el <select> nativo sigue en el DOM y manda el valor).
import { mejorarSelect } from "./dropdown.js";
["#notas-curso", "#notas-materia-filtro", "#notas-trimestre-filtro", "#notas-grupo-filtro"]
  .forEach(s => mejorarSelect($(s)));