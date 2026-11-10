/* -------------------------------------------------------------------------
   AGREGAR DATOS MANUALMENTE (sin CSV) — cursos, estudiantes y diagnóstico
   ------------------------------------------------------------------------- */
import {
  collection, query, where, getDocs, doc, setDoc,
  addDoc, serverTimestamp, deleteDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, firebaseConfig } from "./firebase.js";
import { MATERIAS_DISPONIBLES, CURSOS_DISPONIBLES } from "./constants.js";
import { $, toast } from "./utils.js";
import { state } from "./state.js";

export function fillMateriaSelect(selectEl) {
  selectEl.innerHTML = `<option value="">Selecciona una materia</option>` +
    MATERIAS_DISPONIBLES.map(m => `<option value="${m}">${m}</option>`).join("");
}

export async function loadCursosOptions(selectId, placeholder = "Selecciona un curso") {
  const sel = $(selectId);
  sel.innerHTML = `<option value="">Cargando cursos…</option>`;
  try {
    const snap = await getDocs(collection(db, "cursos"));
    if (snap.empty) {
      sel.innerHTML = `<option value="">No hay cursos todavía — crea uno arriba</option>`;
      return;
    }
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      snap.docs.map(d => `<option value="${d.id}">${d.data().nombre || d.id}</option>`).join("");
  } catch (err) {
    console.error(err);
    sel.innerHTML = `<option value="">No se pudieron cargar los cursos</option>`;
  }
}
export const loadCursosSelect = () => loadCursosOptions("#new-est-curso");

// Crea de una vez los 17 cursos base (1°A–1°C … 5°A–5°C, 6°A–6°B) usando
// CURSOS_DISPONIBLES como fuente única de verdad. No pisa cursos que ya
// existan: usa merge:true y solo agrega los campos base si faltan.
export async function crearCursosBase() {
  const btn = $("#btn-crear-cursos-base");
  const status = $("#crear-cursos-base-status");
  btn.disabled = true;
  status.style.color = "var(--ink-soft)";
  status.textContent = "Creando cursos…";
  try {
    const existentesSnap = await getDocs(collection(db, "cursos"));
    const yaExisten = new Set(existentesSnap.docs.map(d => d.id));

    let creados = 0;
    for (const id of CURSOS_DISPONIBLES) {
      if (yaExisten.has(id)) continue;
      await setDoc(doc(db, "cursos", id), {
        nombre: id,
        materia: "",
        hora_inicio: "",
        hora_fin: ""
      }, { merge: true });
      creados++;
    }

    status.style.color = "var(--green-600)";
    status.textContent = creados
      ? `Listo: ${creados} curso(s) nuevo(s) creado(s). Ya tienes los ${CURSOS_DISPONIBLES.length} cursos base (1° a 6°) disponibles para importar estudiantes, notas y horarios.`
      : `Ya existían los ${CURSOS_DISPONIBLES.length} cursos base — no se creó ninguno nuevo.`;
    toast("Cursos base listos");
    loadCursosSelect();
    loadCursosOptions("#hor-curso", "Selecciona un curso");
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudieron crear los cursos. Revisa la consola.";
  } finally {
    btn.disabled = false;
  }
}

export async function agregarCurso() {
  const id = $("#new-curso-id").value.trim();
  const materia = $("#new-curso-materia").value;
  const horaInicio = $("#new-curso-hora-inicio").value;
  const horaFin = $("#new-curso-hora-fin").value;
  const status = $("#curso-status");

  if (!id) {
    status.style.color = "var(--red-500)";
    status.textContent = "Ponle un código al curso, ej. 4B.";
    return;
  }
  try {
    await setDoc(doc(db, "cursos", id), {
      nombre: id,
      materia: materia || "",
      hora_inicio: horaInicio || "",
      hora_fin: horaFin || ""
    }, { merge: true });
    status.style.color = "var(--green-600)";
    status.textContent = `Curso "${id}" guardado en Firestore.`;
    $("#new-curso-id").value = "";
    $("#new-curso-hora-inicio").value = "";
    $("#new-curso-hora-fin").value = "";
    toast("Curso guardado");
    loadCursosSelect();
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo guardar el curso. Revisa la consola.";
  }
}

export async function agregarEstudiante() {
  const cursoId = $("#new-est-curso").value;
  const nombre = $("#new-est-nombre").value.trim();
  const grupo = $("#new-est-grupo").value;
  const status = $("#estudiante-status");

  if (!cursoId || !nombre) {
    status.style.color = "var(--red-500)";
    status.textContent = "Elige un curso y escribe el nombre del estudiante.";
    return;
  }
  try {
    await addDoc(collection(db, "cursos", cursoId, "estudiantes"), { nombre, grupo });
    status.style.color = "var(--green-600)";
    status.textContent = `"${nombre}" agregado al curso ${cursoId}${grupo ? ` (${grupo})` : ""}.`;
    $("#new-est-nombre").value = "";
    $("#new-est-grupo").value = "";
    toast("Estudiante agregado");
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo agregar. Revisa la consola.";
  }
}

/* -------------------------------------------------------------------------
   DIAGNÓSTICO — escritura/lectura de prueba + fallback a Firebase Console
   ------------------------------------------------------------------------- */
export async function probarConexion() {
  const result = $("#diag-result");
  const countsBox = $("#diag-counts");
  result.style.color = "var(--ink-soft)";
  result.textContent = "Probando…";

  const started = performance.now();
  try {
    const testRef = doc(db, "_diagnostico", "ping");
    await setDoc(testRef, { probado: serverTimestamp(), por: state.currentUser?.uid || "anónimo" });
    const readBack = await getDoc(testRef);
    await deleteDoc(testRef);
    const ms = Math.round(performance.now() - started);

    if (readBack.exists()) {
      result.style.color = "var(--green-600)";
      result.textContent = `✓ Conectado a Firestore. Escritura y lectura OK (${ms} ms).`;
    } else {
      result.style.color = "var(--amber-500)";
      result.textContent = "Se pudo escribir pero no leer de vuelta. Revisa las reglas de lectura.";
    }

    countsBox.innerHTML = `<div class="empty-state">Contando documentos…</div>`;
    const [docentesSnap, cursosSnap] = await Promise.all([
      getDocs(collection(db, "docentes")),
      getDocs(collection(db, "cursos"))
    ]);
    countsBox.innerHTML = `
      <div class="roster-row"><div class="roster-name">Docentes registrados</div><strong>${docentesSnap.size}</strong></div>
      <div class="roster-row"><div class="roster-name">Cursos creados</div><strong>${cursosSnap.size}</strong></div>
    `;
  } catch (err) {
    console.error(err);
    result.style.color = "var(--red-500)";
    result.textContent = `✗ Falló la conexión: ${err.code || err.message}. Revisa firebaseConfig y las reglas de Firestore.`;
    countsBox.innerHTML = `<div class="empty-state">No se pudieron contar los documentos.</div>`;
  }
}


$("#diag-project").textContent = firebaseConfig.projectId;