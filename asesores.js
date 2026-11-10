/* =========================================================================
   ASESORES DE CURSO — administración asigna un docente como asesor/a de un curso.
   Firestore: cursos/{cursoId}.asesorId (uid del docente) y .asesorNombre
   Solo puede ser asesor un docente que ya tiene ese curso asignado.
   (Paso 1: asignar y ver. Los reportes e informes al asesor vienen en los pasos siguientes.)
   ========================================================================= */
import { collection, getDocs, doc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, toast } from "./utils.js";
import { loadCursosOptions } from "./admin-cursos.js";
import { mejorarSelect } from "./dropdown.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

let docentes = [];   // [{ id, nombre, cursos: [...] }] — docentes activos (no Admin)

async function cargarDocentes() {
  const snap = await getDocs(collection(db, "docentes"));
  docentes = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.tipo !== "Admin" && d.aprobado !== false && !["pendiente", "rechazado", "inactivo"].includes(d.estado))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
}

function llenarDocentes() {
  const cursoId = $("#ase-curso").value;
  const sel = $("#ase-docente");
  if (!cursoId) { sel.innerHTML = `<option value="">Primero elige un curso</option>`; return; }
  const delCurso = docentes.filter(d => (d.cursos || []).includes(cursoId));
  sel.innerHTML = delCurso.length
    ? `<option value="">Selecciona un docente</option>` + delCurso.map(d => `<option value="${esc(d.id)}">${esc(d.nombre || d.id)}</option>`).join("")
    : `<option value="">Ningún docente tiene el curso ${esc(cursoId)} asignado</option>`;
}

async function pintarLista() {
  const box = $("#ase-lista");
  try {
    const snap = await getDocs(collection(db, "cursos"));
    const filas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.asesorId)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!filas.length) { box.innerHTML = `<div class="empty-state">Todavía no hay asesores asignados.</div>`; return; }
    box.innerHTML = "";
    filas.forEach(c => {
      const row = document.createElement("div");
      row.className = "materia-entry";
      row.innerHTML = `
        <div>
          <div class="m-name">${esc(c.nombre || c.id)}</div>
          <div class="m-cursos">Asesor/a: ${esc(c.asesorNombre || c.asesorId)}</div>
        </div>
        <button class="m-remove" type="button">Quitar</button>`;
      row.querySelector(".m-remove").addEventListener("click", () => quitarAsesor(c.id));
      box.appendChild(row);
    });
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar la lista de asesores.</div>`;
  }
}

async function asignarAsesor() {
  const cursoId = $("#ase-curso").value;
  const uid = $("#ase-docente").value;
  const status = $("#ase-status");
  const docente = docentes.find(d => d.id === uid);
  if (!cursoId || !docente) {
    status.style.color = "var(--red-500)";
    status.textContent = "Elige un curso y un docente.";
    return;
  }
  try {
    await updateDoc(doc(db, "cursos", cursoId), { asesorId: uid, asesorNombre: docente.nombre || "" });
    status.style.color = "var(--green-600)";
    status.textContent = `${docente.nombre} es ahora asesor/a del curso ${cursoId}.`;
    toast("Asesor asignado");
    pintarLista();
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo asignar. Revisa la consola (¿reglas de Firestore?).";
  }
}

async function quitarAsesor(cursoId) {
  try {
    await updateDoc(doc(db, "cursos", cursoId), { asesorId: deleteField(), asesorNombre: deleteField() });
    toast(`Asesor quitado de ${cursoId}`);
    pintarLista();
  } catch (err) {
    console.error(err);
    toast("No se pudo quitar. Revisa la consola.");
  }
}

// Se llama al abrir la pantalla de administración.
export async function cargarAsesores() {
  await loadCursosOptions("#ase-curso", "Selecciona un curso");
  try { await cargarDocentes(); } catch (err) { console.error(err); docentes = []; }
  llenarDocentes();
  pintarLista();
}

export function initAsesoresUI() {
  mejorarSelect($("#ase-curso"));
  mejorarSelect($("#ase-docente"));
  $("#ase-curso").addEventListener("change", llenarDocentes);
  $("#btn-asignar-asesor").addEventListener("click", asignarAsesor);
}
