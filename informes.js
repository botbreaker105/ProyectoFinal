/* =========================================================================
   INFORMES PEDIDOS POR EL ASESOR (Paso 3)
   Firestore: informes_solicitud/{id} =
     { cursoId, cursoNombre, asesorId, asesorNombre, mensaje, fechaLimite (AAAA-MM-DD),
       estado: "abierta" | "cerrada", docentes: [{id, nombre}], creado }
   - El asesor/a (ver asesores.js) los pide desde Reportes → pestaña «Asesoría».
   - Cada docente del curso recibe un aviso y ve el pedido en «Pendientes» del inicio.
   - (Paso 4: formulario del docente · Paso 5: consolidado y CSV)
   ========================================================================= */
import {
  collection, query, where, getDocs, getDoc, addDoc, setDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, show, toast, guardarSeguro, escapeCsv, downloadTextFile } from "./utils.js";
import { state } from "./state.js";
import { esc } from "./filiacion.js";
import { crearAviso } from "./notificaciones.js";
import { mejorarSelect } from "./dropdown.js";

let misCursos = []; // cursos de los que soy asesor/a: [{ id, nombre }]

const fmtFecha = (iso) => iso
  ? new Date(iso + "T00:00:00").toLocaleDateString("es-BO", { day: "numeric", month: "long" })
  : "";

// Muestra la pestaña «Asesoría» solo si el usuario es asesor/a de algún curso.
export async function prepararAsesoria() {
  const uid = state.currentUser?.uid;
  misCursos = [];
  try {
    if (uid) {
      const snap = await getDocs(query(collection(db, "cursos"), where("asesorId", "==", uid)));
      misCursos = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || d.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
  } catch (err) { console.warn("No se pudo comprobar si eres asesor/a:", err); }
  $("#tab-asesoria").style.display = misCursos.length ? "inline-flex" : "none";
  return misCursos.length > 0;
}

export async function cargarAsesoria() {
  const sel = $("#inf-curso");
  sel.innerHTML = misCursos.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  $("#inf-fecha").min = new Date().toISOString().slice(0, 10);
  $("#inf-status").textContent = "";
  await pintarLista();
}

async function docentesDelCurso(cursoId) {
  const snap = await getDocs(query(collection(db, "docentes"), where("cursos", "array-contains", cursoId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.tipo !== "Admin" && d.aprobado !== false && !["pendiente", "rechazado", "inactivo"].includes(d.estado))
    .map(d => ({ id: d.id, nombre: d.nombre || "" }));
}

async function pedirInforme() {
  const uid = state.currentUser?.uid;
  const status = $("#inf-status");
  const cursoId = $("#inf-curso").value;
  const curso = misCursos.find(c => c.id === cursoId);
  const mensaje = $("#inf-mensaje").value.trim();
  const fechaLimite = $("#inf-fecha").value;
  const rojo = (t) => { status.style.color = "var(--red-500)"; status.textContent = t; };
  if (!curso) return rojo("Elige el curso.");

  const btn = $("#btn-pedir-informe");
  btn.disabled = true;
  status.style.color = "var(--ink-soft)";
  status.textContent = "Enviando pedido…";
  try {
    let docentes = [], avisoParcial = false;
    try { docentes = await docentesDelCurso(cursoId); } catch (err) { console.warn(err); avisoParcial = true; }

    await addDoc(collection(db, "informes_solicitud"), {
      cursoId, cursoNombre: curso.nombre,
      asesorId: uid, asesorNombre: state.currentTeacherDoc?.nombre || "",
      mensaje, fechaLimite: fechaLimite || "",
      estado: "abierta", docentes, creado: serverTimestamp()
    });

    const texto = `${state.currentTeacherDoc?.nombre || "El asesor"} pide un informe rápido del curso ${curso.nombre}` +
      `${fechaLimite ? ", antes del " + fmtFecha(fechaLimite) : ""}.${mensaje ? " " + mensaje : ""}`;
    await Promise.all(docentes.map(d => crearAviso(d.id, "informe", `Informe pedido: ${curso.nombre}`, texto)));

    status.style.color = "var(--green-600)";
    status.textContent = avisoParcial
      ? "Pedido creado. No se pudo leer la lista de docentes, así que no se enviaron avisos individuales; igual lo verán en «Pendientes» de su inicio."
      : `Pedido enviado a ${docentes.length} docente(s) del curso ${curso.nombre}.`;
    toast("Informe solicitado");
    $("#inf-mensaje").value = "";
    $("#inf-fecha").value = "";
    pintarLista();
  } catch (err) {
    console.error(err);
    rojo("No se pudo enviar el pedido. Revisa la consola (¿reglas de Firestore?).");
  } finally {
    btn.disabled = false;
  }
}

async function pintarLista() {
  const box = $("#inf-lista");
  box.innerHTML = `<div class="empty-state">Cargando…</div>`;
  try {
    const snap = await getDocs(query(collection(db, "informes_solicitud"), where("asesorId", "==", state.currentUser.uid)));
    const filas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.creado?.toMillis?.() || 0) - (a.creado?.toMillis?.() || 0));
    if (!filas.length) { box.innerHTML = `<div class="empty-state">Todavía no has pedido ningún informe.</div>`; return; }
    box.innerHTML = "";
    filas.forEach(f => {
      const abierta = f.estado !== "cerrada";
      const row = document.createElement("div");
      row.className = "reporte-card";
      row.innerHTML = `
        <div class="reporte-top">
          <div class="reporte-field"><b>${esc(f.cursoNombre || f.cursoId)}</b> · ${abierta ? "Abierto" : "Cerrado"}</div>
        </div>
        <div class="reporte-meta">${f.creado?.toDate ? esc(f.creado.toDate().toLocaleString("es-BO")) : ""}${f.fechaLimite ? " · límite: " + esc(fmtFecha(f.fechaLimite)) : ""}</div>
        ${f.mensaje ? `<div class="reporte-field">${esc(f.mensaje)}</div>` : ""}
        <div class="reporte-field">Docentes avisados: ${(f.docentes || []).length}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
          <button type="button" class="m-remove inf-ver">Ver informes</button>
          <button type="button" class="m-remove inf-csv">Descargar CSV para imprimir</button>
          <button type="button" class="m-remove inf-cerrar">${abierta ? "Cerrar pedido" : "Reabrir"}</button>
        </div>
        <div class="inf-detalle" style="margin-top:10px;"></div>`;
      row.querySelector(".inf-ver").addEventListener("click", () => verInformes(f, row.querySelector(".inf-detalle")));
      row.querySelector(".inf-csv").addEventListener("click", () => descargarCSVInforme(f));
      row.querySelector(".inf-cerrar").addEventListener("click", async () => {
        try {
          await updateDoc(doc(db, "informes_solicitud", f.id), { estado: abierta ? "cerrada" : "abierta" });
          pintarLista();
        } catch (err) { console.error(err); toast("No se pudo actualizar. Revisa la consola."); }
      });
      box.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar tus pedidos.</div>`;
  }
}

// Para el inicio del docente: pedidos abiertos de los cursos que tiene asignados.
export async function informesPendientesDe(cursos) {
  const ids = (cursos || []).slice(0, 30);
  if (!ids.length) return [];
  // Una consulta por curso (las reglas de Firestore verifican cada curso por separado).
  const snaps = await Promise.all(ids.map(id => getDocs(query(collection(db, "informes_solicitud"),
    where("cursoId", "==", id), where("estado", "==", "abierta"))).catch(() => null)));
  return snaps.filter(Boolean).flatMap(sn => sn.docs.map(d => ({ id: d.id, ...d.data() })))
    .sort((a, b) => (a.fechaLimite || "9999").localeCompare(b.fechaLimite || "9999"));
}

export function initInformesUI() {
  mejorarSelect($("#inf-curso"));
  $("#btn-pedir-informe")?.addEventListener("click", pedirInforme);
  $("#btn-enviar-informe")?.addEventListener("click", guardarInforme);
}

/* =========================================================================
   PASO 4 — formulario rápido del docente (versión mínima)
   Por estudiante: faltas (número) y tareas no presentadas / notas bajas (texto corto).
   Se guarda en informes_solicitud/{id}/respuestas/{uid}:
     { docenteId, docenteNombre, materia, filas: [{ nombre, faltas, tareas }], actualizado }
   Solo se guardan las filas con algo escrito; las demás se entienden "sin novedad".
   ========================================================================= */
let informeActual = null;

export async function abrirInforme(pedido) {
  informeActual = pedido;
  const uid = state.currentUser.uid;
  $("#informe-titulo").textContent = `Informe · ${pedido.cursoNombre || pedido.cursoId}`;
  $("#informe-detalle").textContent =
    `${pedido.asesorNombre || "El asesor"} pide: ${pedido.mensaje || "faltas y tareas no presentadas de cada estudiante"}` +
    `${pedido.fechaLimite ? " (antes del " + fmtFecha(pedido.fechaLimite) + ")" : ""}.`;
  $("#informe-status").textContent = "";
  const lista = $("#informe-lista");
  lista.innerHTML = `<div class="empty-state">Cargando estudiantes…</div>`;
  show("#screen-informe");
  try {
    const [estSnap, previa] = await Promise.all([
      getDocs(collection(db, "cursos", pedido.cursoId, "estudiantes")),
      getDoc(doc(db, "informes_solicitud", pedido.id, "respuestas", uid)).catch(() => null)
    ]);
    const guardado = new Map(((previa && previa.exists() && previa.data().filas) || []).map(f => [f.nombre, f]));
    const nombres = estSnap.docs.map(d => d.data().nombre).filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
    if (!nombres.length) { lista.innerHTML = `<div class="empty-state">Este curso no tiene estudiantes cargados.</div>`; return; }
    lista.innerHTML = nombres.map((n, i) => {
      const g = guardado.get(n) || {};
      return `
        <div class="reporte-card" data-nombre="${esc(n)}">
          <div class="reporte-field"><b>${i + 1}. ${esc(n)}</b></div>
          <div style="display:flex; gap:10px; margin-top:8px;">
            <div style="width:90px; flex:none;">
              <label class="field-label" style="margin-top:0;">Faltas</label>
              <input type="number" min="0" inputmode="numeric" class="inf-faltas" value="${g.faltas ? esc(g.faltas) : ""}" style="margin-bottom:0;" />
            </div>
            <div style="flex:1; min-width:0;">
              <label class="field-label" style="margin-top:0;">Tareas no presentadas / notas bajas</label>
              <input type="text" class="inf-tareas" maxlength="120" value="${esc(g.tareas || "")}" placeholder="Ej.: Tarea 3, Examen 1 (45)" style="margin-bottom:0;" />
            </div>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    console.error(err);
    lista.innerHTML = `<div class="empty-state">No se pudo cargar el curso. Revisa tu conexión e inténtalo de nuevo.</div>`;
  }
}

async function guardarInforme() {
  const p = informeActual;
  if (!p) return;
  const status = $("#informe-status");
  const filas = [...document.querySelectorAll("#informe-lista .reporte-card")].map(card => ({
    nombre: card.dataset.nombre,
    faltas: Math.max(0, parseInt(card.querySelector(".inf-faltas").value, 10) || 0),
    tareas: card.querySelector(".inf-tareas").value.trim()
  })).filter(f => f.faltas || f.tareas);
  const materia = (state.currentTeacherDoc?.materias || [])
    .filter(m => (m.cursos || []).includes(p.cursoId)).map(m => m.materia).join(" / ");
  const btn = $("#btn-enviar-informe");
  btn.disabled = true;
  try {
    const estado = await guardarSeguro(setDoc(doc(db, "informes_solicitud", p.id, "respuestas", state.currentUser.uid), {
      docenteId: state.currentUser.uid,
      docenteNombre: state.currentTeacherDoc?.nombre || "",
      materia, filas, actualizado: serverTimestamp()
    }));
    toast(estado === "pendiente" ? "Sin conexión: se enviará cuando haya internet" : "Informe enviado", 3000);
    $("#btn-back-informe").click();
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo enviar el informe. Revisa tu conexión (o si el asesor ya cerró el pedido).";
  } finally {
    btn.disabled = false;
  }
}

/* =========================================================================
   PASO 5 — consolidado para el asesor: lista por materia/docente + CSV para imprimir
   ========================================================================= */
async function leerRespuestas(informeId) {
  const snap = await getDocs(collection(db, "informes_solicitud", informeId, "respuestas"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.materia || "").localeCompare(b.materia || "", "es"));
}

async function verInformes(f, box) {
  box.innerHTML = `<div class="empty-state">Cargando informes…</div>`;
  try {
    const resp = await leerRespuestas(f.id);
    const respondieron = new Set(resp.map(r => r.docenteId));
    const faltan = (f.docentes || []).filter(d => !respondieron.has(d.id)).map(d => d.nombre || "(sin nombre)");
    const total = (f.docentes || []).length;
    let html = `<div class="reporte-field"><b>Respondieron ${resp.length}${total ? " de " + total : ""}</b></div>`;
    if (!resp.length) html += `<div class="empty-state">Todavía nadie respondió.</div>`;
    resp.forEach(r => {
      const filas = r.filas || [];
      html += `
        <details class="reporte-card" style="margin-top:8px;">
          <summary style="cursor:pointer;"><b>${esc(r.materia || "Sin materia")}</b> · ${esc(r.docenteNombre || "")} — ${filas.length} estudiante(s) con novedades</summary>
          <div style="margin-top:8px;">${filas.length ? filas.map(x =>
            `<div class="roster-row"><div class="roster-name">${esc(x.nombre)}</div><div class="hint-text" style="margin:0;">${x.faltas ? "Faltas: " + esc(x.faltas) : ""}${x.faltas && x.tareas ? " · " : ""}${esc(x.tareas || "")}</div></div>`
          ).join("") : `<div class="empty-state">Sin novedades.</div>`}</div>
        </details>`;
    });
    if (faltan.length) html += `<div class="hint-text" style="margin-top:8px;">Sin responder: ${esc(faltan.join(", "))}</div>`;
    box.innerHTML = html;
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudieron cargar los informes.</div>`;
  }
}

// Una fila por estudiante, para imprimir: faltas, tareas/notas bajas por materia y firma de los padres.
async function descargarCSVInforme(f) {
  toast("Preparando CSV…");
  try {
    const [estSnap, resp] = await Promise.all([
      getDocs(collection(db, "cursos", f.cursoId, "estudiantes")),
      leerRespuestas(f.id)
    ]);
    const nombres = estSnap.docs.map(d => d.data().nombre).filter(Boolean).sort((a, b) => a.localeCompare(b, "es"));
    if (!nombres.length) { toast("Este curso no tiene estudiantes cargados."); return; }
    const rows = [["N°", "Estudiante", "Faltas (total)", "Faltas por materia", "Tareas no presentadas / notas bajas", "Firma de padres o tutor"]];
    nombres.forEach((n, i) => {
      let total = 0;
      const faltas = [], tareas = [];
      resp.forEach(r => {
        const fila = (r.filas || []).find(x => x.nombre === n);
        if (!fila) return;
        const etiqueta = r.materia || r.docenteNombre || "Materia";
        if (fila.faltas) { total += fila.faltas; faltas.push(`${etiqueta}: ${fila.faltas}`); }
        if (fila.tareas) tareas.push(`${etiqueta}: ${fila.tareas}`);
      });
      rows.push([i + 1, n, total || "", faltas.join("; "), tareas.join(" | "), ""]);
    });
    const csv = rows.map(r => r.map(escapeCsv).join(",")).join("\n");
    downloadTextFile(csv, `informe_asesoria_${f.cursoNombre || f.cursoId}_${new Date().toISOString().slice(0, 10)}.csv`);
    toast("CSV descargado");
  } catch (err) {
    console.error(err);
    toast("No se pudo preparar el CSV. Revisa la consola.");
  }
}