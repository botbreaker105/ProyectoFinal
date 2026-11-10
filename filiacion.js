/* =========================================================================
   FILIACIÓN — datos de padre, madre y tutor de cada estudiante.
   Firestore: cursos/{cursoId}/estudiantes/{id}.filiacion =
     { padre:{nombre,telefono}, madre:{nombre,telefono}, tutor:{nombre,telefono,parentesco} }
   - Solo Admin la sube (CSV) y la edita: lo exigen las reglas de cursos/estudiantes.
   - Al crear un reporte, se muestra sola según el estudiante elegido:
     si hay tutor se muestra el tutor y se apagan padre y madre; si no hay
     tutor, se muestran padre y madre y se apaga el tutor.
   ========================================================================= */
import {
  collection, doc, getDocs, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, toast, escapeCsv, downloadTextFile } from "./utils.js";
import { state } from "./state.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
// Para comparar nombres: sin acentos, sin mayúsculas, sin espacios repetidos.
export const norm = (s) => String(s ?? "").trim().toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

const esAdmin = () => state.currentTeacherDoc?.tipo === "Admin";
const tiene = (p) => !!(p && (p.nombre || p.telefono));

// Decide quién cuenta como contacto: con tutor, solo el tutor; sin tutor, padre y madre.
export function resolverFiliacion(fil) {
  const padre = fil?.padre || {}, madre = fil?.madre || {}, tutor = fil?.tutor || {};
  const modo = tiene(tutor) ? "tutor" : (tiene(padre) || tiene(madre)) ? "padres" : "ninguno";
  return { modo, padre, madre, tutor };
}

// Tarjetas Padre / Madre / Tutor para el formulario de reportes (las que no aplican, en gris).
export function renderFiliacionHTML(fil) {
  const { modo, padre, madre, tutor } = resolverFiliacion(fil);
  if (modo === "ninguno") {
    return `<p class="hint-text" style="margin:0;">Este estudiante aún no tiene datos de padres ni tutor. Administración puede cargarlos desde «Datos masivos».</p>`;
  }
  const roles = [
    { rol: "Padre", p: padre, activo: modo === "padres" },
    { rol: "Madre", p: madre, activo: modo === "padres" },
    { rol: "Tutor", p: tutor, activo: modo === "tutor" }
  ];
  return `<div class="fil-grid">${roles.map(({ rol, p, activo }) => {
    const tel = String(p.telefono || "").trim();
    const href = tel.replace(/[^\d+]/g, "");
    return `
      <div class="fil-card${activo ? "" : " off"}">
        <div class="fil-rol">${rol}${rol === "Tutor" && p.parentesco ? " · " + esc(p.parentesco) : ""}</div>
        <div class="fil-nombre">${esc(p.nombre) || "—"}</div>
        <div class="fil-tel">${tel ? (activo && href ? `<a href="tel:${esc(href)}">${esc(tel)}</a>` : esc(tel)) : "Sin teléfono"}</div>
        ${activo ? "" : `<div class="fil-nota">No aplica (${modo === "tutor" ? "tiene tutor" : "sin tutor"})</div>`}
      </div>`;
  }).join("")}</div>`;
}

// Copia de los contactos vigentes, para guardarla dentro del reporte.
export function snapshotContactos(fil) {
  const { modo, padre, madre, tutor } = resolverFiliacion(fil);
  const lista = modo === "tutor" ? [["Tutor", tutor]] : modo === "padres" ? [["Padre", padre], ["Madre", madre]] : [];
  return lista.filter(([, p]) => tiene(p)).map(([rol, p]) => ({
    rol, nombre: p.nombre || "", telefono: p.telefono || "", ...(rol === "Tutor" && p.parentesco ? { parentesco: p.parentesco } : {})
  }));
}

/* ----------------------------- IMPORTAR (CSV) ----------------------------- */
const pick = (row, ...keys) => {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};

export function importFiliacionCSV() {
  const status = $("#filiacion-import-status");
  const input = $("#filiacion-csv-file");
  const rojo = (t) => { status.style.color = "var(--red-500)"; status.textContent = t; };
  if (!esAdmin()) return rojo("Solo administración puede cargar filiación.");
  const file = input.files[0];
  if (!file) return rojo("Elige un archivo CSV primero.");
  status.style.color = "var(--ink-soft)";
  status.textContent = "Leyendo archivo…";

  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => norm(h).replace(/ /g, "_"),
    complete: async (res) => {
      const filas = res.data.map(r => ({
        curso: pick(r, "curso"),
        nombre: pick(r, "nombre", "estudiante"),
        fil: {
          padre: { nombre: pick(r, "padre", "padre_nombre", "nombre_padre"), telefono: pick(r, "padre_telefono", "telefono_padre", "padre_celular", "celular_padre", "padre_tel") },
          madre: { nombre: pick(r, "madre", "madre_nombre", "nombre_madre"), telefono: pick(r, "madre_telefono", "telefono_madre", "madre_celular", "celular_madre", "madre_tel") },
          tutor: {
            nombre: pick(r, "tutor", "tutor_nombre", "nombre_tutor", "apoderado"),
            telefono: pick(r, "tutor_telefono", "telefono_tutor", "tutor_celular", "celular_tutor", "tutor_tel"),
            parentesco: pick(r, "tutor_parentesco", "parentesco")
          }
        }
      })).filter(f => f.curso && f.nombre);
      if (!filas.length) return rojo("No se encontraron filas válidas. Revisa que haya columnas 'curso' y 'nombre'.");

      status.textContent = "Importando…";
      try {
        const cursosSnap = await getDocs(collection(db, "cursos"));
        const cursoPorClave = new Map();
        cursosSnap.docs.forEach(d => { cursoPorClave.set(norm(d.id), d.id); cursoPorClave.set(norm(d.data().nombre || ""), d.id); });
        const estudiantesDe = {}; // cursoId -> Map(nombre normalizado -> id)
        let ok = 0;
        const sinCurso = new Set(), sinEstudiante = [];
        for (const f of filas) {
          const cursoId = cursoPorClave.get(norm(f.curso));
          if (!cursoId) { sinCurso.add(f.curso); continue; }
          if (!estudiantesDe[cursoId]) {
            const snap = await getDocs(collection(db, "cursos", cursoId, "estudiantes"));
            estudiantesDe[cursoId] = new Map(snap.docs.map(d => [norm(d.data().nombre), d.id]));
          }
          const estId = estudiantesDe[cursoId].get(norm(f.nombre));
          if (!estId) { sinEstudiante.push(`${f.nombre} (${f.curso})`); continue; }
          await updateDoc(doc(db, "cursos", cursoId, "estudiantes", estId), { filiacion: f.fil });
          ok++;
        }
        const avisos = [];
        if (sinCurso.size) avisos.push(`Cursos no encontrados: ${[...sinCurso].join(", ")}.`);
        if (sinEstudiante.length) avisos.push(`${sinEstudiante.length} estudiante(s) no encontrados (primero impórtalos en «Importar desde CSV»): ${sinEstudiante.slice(0, 6).join("; ")}${sinEstudiante.length > 6 ? "…" : ""}.`);
        status.style.color = ok ? "var(--green-600)" : "var(--red-500)";
        status.textContent = `Listo: ${ok} estudiante(s) actualizados. ${avisos.join(" ")}`.trim();
        if (ok) { input.value = ""; toast("Filiación importada"); }
      } catch (err) {
        console.error(err);
        rojo("Ocurrió un error durante la importación. Revisa la consola.");
      }
    },
    error: (err) => { console.error(err); rojo("No se pudo leer el archivo CSV."); }
  });
}

/* ----------------------------- EXPORTAR (CSV) ----------------------------- */
// También sirve de plantilla: baja a todos los estudiantes con lo que ya tienen cargado.
export async function exportFiliacionCSV() {
  const status = $("#filiacion-export-status");
  status.style.color = "var(--ink-soft)";
  status.textContent = "Preparando exportación…";
  try {
    const rows = [["curso", "nombre", "padre", "padre_telefono", "madre", "madre_telefono", "tutor", "tutor_telefono", "tutor_parentesco"]];
    const cursosSnap = await getDocs(collection(db, "cursos"));
    for (const c of cursosSnap.docs) {
      const snap = await getDocs(collection(db, "cursos", c.id, "estudiantes"));
      snap.docs
        .map(d => d.data())
        .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"))
        .forEach(e => {
          const f = e.filiacion || {};
          rows.push([c.id, e.nombre || "", f.padre?.nombre || "", f.padre?.telefono || "", f.madre?.nombre || "", f.madre?.telefono || "", f.tutor?.nombre || "", f.tutor?.telefono || "", f.tutor?.parentesco || ""]);
        });
    }
    if (rows.length === 1) { status.style.color = "var(--amber-500)"; status.textContent = "No hay estudiantes cargados todavía."; return; }
    downloadTextFile(rows.map(r => r.map(escapeCsv).join(",")).join("\n"), `filiacion_${new Date().toISOString().slice(0, 10)}.csv`);
    status.style.color = "var(--green-600)";
    status.textContent = `Listo: ${rows.length - 1} estudiante(s) exportados.`;
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo exportar. Revisa la consola.";
  }
}