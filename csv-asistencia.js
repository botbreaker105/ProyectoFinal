/* -------------------------------------------------------------------------
   IMPORTAR / EXPORTAR CURSOS Y ESTUDIANTES POR CSV
   Formato: columnas "curso" y "nombre" (encabezados sin distinguir mayúsculas).
   ------------------------------------------------------------------------- */
import {
  collection, addDoc, getDocs, doc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { $, toast, escapeCsv, downloadTextFile } from "./utils.js";
import { GRUPOS_DISPONIBLES } from "./constants.js";

// Acepta variantes cortas en el CSV ("Agro", "Sistemas") y las normaliza al
// nombre exacto del catálogo. Si no reconoce nada, deja el estudiante sin grupo.
function normalizarGrupo(valor) {
  const texto = String(valor ?? "").trim().toLowerCase();
  if (!texto) return "";
  const match = GRUPOS_DISPONIBLES.find(g => g.toLowerCase().startsWith(texto) || texto.startsWith(g.toLowerCase().slice(0, 4)));
  return match || "";
}

export function importCSV() {
  const fileInput = $("#import-csv-file");
  const status = $("#import-status");
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
      const porCurso = {};
      results.data.forEach(row => {
        const curso = (row.curso || row.Curso || row.CURSO || "").trim();
        const nombre = (row.nombre || row.Nombre || row.NOMBRE || row.nombre_estudiante || "").trim();
        const grupo = normalizarGrupo(row.grupo || row.Grupo || row.GRUPO || "");
        if (!curso || !nombre) return;
        (porCurso[curso] ||= []).push({ nombre, grupo });
      });

      const cursos = Object.keys(porCurso);
      if (!cursos.length) {
        status.style.color = "var(--red-500)";
        status.textContent = "No se encontraron filas válidas. Revisa que las columnas se llamen 'curso' y 'nombre'.";
        return;
      }

      status.textContent = "Importando…";
      let totalEstudiantes = 0;
      try {
        for (const curso of cursos) {
          await setDoc(doc(db, "cursos", curso), { nombre: curso }, { merge: true });
          for (const { nombre, grupo } of porCurso[curso]) {
            await addDoc(collection(db, "cursos", curso, "estudiantes"), { nombre, grupo });
            totalEstudiantes++;
          }
        }
        status.style.color = "var(--green-600)";
        status.textContent = `Listo: ${cursos.length} curso(s), ${totalEstudiantes} estudiante(s) importados.`;
        fileInput.value = "";
        toast("Importación completada");
      } catch (err) {
        console.error(err);
        status.style.color = "var(--red-500)";
        status.textContent = "Ocurrió un error durante la importación. Revisa la consola.";
      }
    },
    error: (err) => {
      console.error(err);
      status.style.color = "var(--red-500)";
      status.textContent = "No se pudo leer el archivo CSV.";
    }
  });
}

export async function exportCSV() {
  toast("Preparando exportación…");
  try {
    const rows = [["curso", "nombre", "grupo"]];
    const cursosSnap = await getDocs(collection(db, "cursos"));
    for (const cDoc of cursosSnap.docs) {
      const studentsSnap = await getDocs(collection(db, "cursos", cDoc.id, "estudiantes"));
      studentsSnap.forEach(sDoc => rows.push([cDoc.id, sDoc.data().nombre || "", sDoc.data().grupo || ""]));
    }
    const csv = rows.map(r => r.map(escapeCsv).join(",")).join("\n");
    downloadTextFile(csv, `estudiantes_${new Date().toISOString().slice(0, 10)}.csv`);
    toast("CSV descargado");
  } catch (err) {
    console.error(err);
    toast("No se pudo exportar. Revisa la consola.");
  }
}