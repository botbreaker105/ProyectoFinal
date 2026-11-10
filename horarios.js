/* -------------------------------------------------------------------------
   HORARIO — administración (Admin) y visor con resaltado por docente
   ------------------------------------------------------------------------- */
import {
  collection, getDocs, doc, setDoc, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { MATERIAS_DISPONIBLES, DIAS_SEMANA } from "./constants.js";
import { $, toast, escapeCsv, downloadTextFile } from "./utils.js";
import { state } from "./state.js";
import { loadCursosOptions } from "./admin-cursos.js";

function ordenarHora(a, b) {
  return (a.hora_inicio || "").localeCompare(b.hora_inicio || "");
}

export async function loadHorarioAdminLista() {
  const cursoId = $("#hor-curso").value;
  const box = $("#hor-lista");
  if (!cursoId) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="empty-state">Cargando horario…</div>`;
  try {
    const snap = await getDocs(collection(db, "cursos", cursoId, "horario"));
    if (snap.empty) {
      box.innerHTML = `<div class="empty-state">Este curso todavía no tiene horario cargado.</div>`;
      return;
    }
    const entradas = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) =>
      DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia) || ordenarHora(a, b)
    );
    box.innerHTML = "";
    entradas.forEach(e => {
      const row = document.createElement("div");
      row.className = "materia-entry";
      row.innerHTML = `
        <div>
          <div class="m-name">${e.dia} · ${e.hora_inicio}–${e.hora_fin}</div>
          <div class="m-cursos">${e.materia}</div>
        </div>
        <button class="m-remove" type="button" data-id="${e.id}">Quitar</button>
      `;
      box.appendChild(row);
    });
    box.querySelectorAll(".m-remove").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await deleteDoc(doc(db, "cursos", cursoId, "horario", btn.dataset.id));
          toast("Bloque eliminado del horario");
          loadHorarioAdminLista();
        } catch (err) {
          console.error(err);
          toast("No se pudo eliminar. Revisa la consola.");
        }
      });
    });
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="empty-state">No se pudo cargar el horario.</div>`;
  }
}

// Slug simple para comparar strings de forma tolerante a acentos/mayúsculas.
function slugifyHorario(text) {
  return String(text ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function importHorarioCSV() {
  const fileInput = $("#horario-csv-file");
  const status = $("#horario-import-status");
  const file = fileInput.files[0];
  if (!file) {
    status.style.color = "var(--sello-rojo)";
    status.textContent = "Selecciona un archivo CSV primero.";
    return;
  }
  status.style.color = "var(--ink-soft)";
  status.textContent = "Leyendo archivo…";

  // mapa tolerante a acentos/mayúsculas: "matematicas" -> "Matemática", etc.
  const materiaPorSlug = new Map(MATERIAS_DISPONIBLES.map(m => [slugifyHorario(m), m]));
  const diaPorSlug = new Map(DIAS_SEMANA.map(d => [slugifyHorario(d), d]));

  window.Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const filas = [];
      let omitidasMateria = 0, omitidasDia = 0, omitidasHora = 0;

      results.data.forEach(row => {
        const curso = (row.curso || row.Curso || row.CURSO || "").trim();
        const diaRaw = (row.dia || row.Dia || row.DIA || row["día"] || row["Día"] || "").trim();
        const horaInicio = (row.hora_inicio || row.Hora_inicio || row["Hora Inicio"] || "").trim();
        const horaFin = (row.hora_fin || row.Hora_fin || row["Hora Fin"] || "").trim();
        const materiaRaw = (row.materia || row.Materia || row.MATERIA || "").trim();
        if (!curso || !diaRaw || !horaInicio || !horaFin || !materiaRaw) return;

        const dia = diaPorSlug.get(slugifyHorario(diaRaw));
        if (!dia) { omitidasDia++; return; }
        const materia = materiaPorSlug.get(slugifyHorario(materiaRaw));
        if (!materia) { omitidasMateria++; return; }
        if (!/^\d{1,2}:\d{2}$/.test(horaInicio) || !/^\d{1,2}:\d{2}$/.test(horaFin) || horaFin <= horaInicio) {
          omitidasHora++; return;
        }
        filas.push({ curso, dia, hora_inicio: horaInicio, hora_fin: horaFin, materia });
      });

      if (!filas.length) {
        status.style.color = "var(--sello-rojo)";
        status.textContent = "No se encontraron filas válidas. Revisa columnas, días y nombres de materia.";
        return;
      }

      status.textContent = "Importando…";
      let total = 0;
      const cursosTocados = new Set();
      try {
        for (const f of filas) {
          await setDoc(doc(db, "cursos", f.curso), { nombre: f.curso }, { merge: true });
          const blockId = `${slugifyHorario(f.dia)}__${f.hora_inicio.replace(":", "")}__${slugifyHorario(f.materia)}`;
          await setDoc(doc(db, "cursos", f.curso, "horario", blockId), {
            dia: f.dia, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, materia: f.materia
          }, { merge: true });
          total++;
          cursosTocados.add(f.curso);
        }
        const omitidas = omitidasMateria + omitidasDia + omitidasHora;
        status.style.color = "var(--sello-verde)";
        status.textContent = `Listo: ${total} bloque(s) importados en ${cursosTocados.size} curso(s).` +
          (omitidas ? ` Se omitieron ${omitidas} fila(s) (materia sin coincidencia: ${omitidasMateria}, día inválido: ${omitidasDia}, horas inválidas: ${omitidasHora}).` : "");
        fileInput.value = "";
        toast("Horario importado");
        loadCursosOptions("#hor-curso", "Selecciona un curso");
        loadHorarioAdminLista();
      } catch (err) {
        console.error(err);
        status.style.color = "var(--sello-rojo)";
        status.textContent = "Ocurrió un error durante la importación. Revisa la consola.";
      }
    },
    error: (err) => {
      console.error(err);
      status.style.color = "var(--sello-rojo)";
      status.textContent = "No se pudo leer el archivo CSV.";
    }
  });
}

export async function exportHorarioCSV() {
  const status = $("#horario-export-status");
  status.style.color = "var(--ink-soft)";
  status.textContent = "Preparando exportación…";
  try {
    const rows = [["curso", "dia", "hora_inicio", "hora_fin", "materia"]];
    const cursosSnap = await getDocs(collection(db, "cursos"));
    for (const cDoc of cursosSnap.docs) {
      const snap = await getDocs(collection(db, "cursos", cDoc.id, "horario"));
      snap.forEach(d => {
        const h = d.data();
        rows.push([cDoc.id, h.dia || "", h.hora_inicio || "", h.hora_fin || "", h.materia || ""]);
      });
    }
    if (rows.length === 1) {
      status.style.color = "var(--sello-ocre)";
      status.textContent = "Todavía no hay ningún horario cargado.";
      return;
    }
    const csv = rows.map(r => r.map(escapeCsv).join(",")).join("\n");
    downloadTextFile(csv, `horario_${new Date().toISOString().slice(0, 10)}.csv`);
    status.style.color = "var(--sello-verde)";
    status.textContent = `Listo: ${rows.length - 1} bloque(s) exportados.`;
    toast("CSV de horario descargado");
  } catch (err) {
    console.error(err);
    status.style.color = "var(--sello-rojo)";
    status.textContent = "No se pudo exportar. Revisa la consola.";
  }
}

export async function agregarHorario() {
  const cursoId = $("#hor-curso").value;
  const dia = $("#hor-dia").value;
  const horaInicio = $("#hor-hora-inicio").value;
  const horaFin = $("#hor-hora-fin").value;
  const materia = $("#hor-materia").value;
  const status = $("#horario-status");

  if (!cursoId || !dia || !horaInicio || !horaFin || !materia) {
    status.style.color = "var(--red-500)";
    status.textContent = "Completa curso, día, horas y materia.";
    return;
  }
  if (horaFin <= horaInicio) {
    status.style.color = "var(--red-500)";
    status.textContent = "La hora fin debe ser posterior a la hora inicio.";
    return;
  }
  try {
    await addDoc(collection(db, "cursos", cursoId, "horario"), { dia, hora_inicio: horaInicio, hora_fin: horaFin, materia });
    status.style.color = "var(--green-600)";
    status.textContent = "Bloque agregado al horario.";
    toast("Horario actualizado");
    $("#hor-hora-inicio").value = "";
    $("#hor-hora-fin").value = "";
    loadHorarioAdminLista();
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo guardar. Revisa la consola.";
  }
}

// ¿Esta materia, en este curso, es una de las que dicta el docente logueado?
function esMiHora(cursoId, materia) {
  const materias = state.currentTeacherDoc?.materias || [];
  return materias.some(m => m.materia === materia && (m.cursos || []).includes(cursoId));
}

export async function loadHorarioCursoRail() {
  const rail = $("#horario-curso-rail");
  rail.innerHTML = `<div class="empty-state" style="padding:20px 8px;">Cargando cursos…</div>`;
  try {
    const snap = await getDocs(collection(db, "cursos"));
    if (snap.empty) {
      rail.innerHTML = `<div class="empty-state" style="padding:20px 8px;">Todavía no hay cursos creados.</div>`;
      return;
    }
    const cursos = snap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || d.id })).sort((a, b) => a.id.localeCompare(b.id));
    rail.innerHTML = "";
    cursos.forEach((c, idx) => {
      const pill = document.createElement("button");
      pill.className = "rail-pill" + (idx === 0 ? " now" : "");
      pill.dataset.curso = c.id;
      pill.innerHTML = `<div class="curso">${c.nombre}</div><div class="hora">Ver horario</div>`;
      pill.addEventListener("click", () => seleccionarHorarioCurso(c.id, c.nombre));
      rail.appendChild(pill);
    });
    seleccionarHorarioCurso(cursos[0].id, cursos[0].nombre);
  } catch (err) {
    console.error(err);
    rail.innerHTML = `<div class="empty-state" style="padding:20px 8px;">No se pudieron cargar los cursos.</div>`;
  }
}

export async function seleccionarHorarioCurso(cursoId, cursoNombre) {
  state.activeHorarioCurso = cursoId;
  $("#horario-curso-titulo").textContent = cursoNombre;
  document.querySelectorAll("#horario-curso-rail .rail-pill").forEach(p => {
    p.classList.toggle("now", p.dataset.curso === cursoId);
  });

  const tabla = $("#horario-tabla");
  tabla.innerHTML = `<tbody><tr><td class="loading">Cargando horario…</td></tr></tbody>`;

  try {
    const snap = await getDocs(collection(db, "cursos", cursoId, "horario"));
    if (snap.empty) {
      tabla.innerHTML = `<tbody><tr><td class="empty">Este curso todavía no tiene horario cargado.</td></tr></tbody>`;
      return;
    }
    const entradas = snap.docs.map(d => d.data());
    const horas = [...new Set(entradas.map(e => `${e.hora_inicio}|${e.hora_fin}`))]
      .sort((a, b) => a.localeCompare(b))
      .map(h => h.split("|"));

    const porDiaHora = {};
    entradas.forEach(e => { porDiaHora[`${e.dia}|${e.hora_inicio}`] = e.materia; });

    let html = "<thead><tr><th>Hora</th>" + DIAS_SEMANA.map(d => `<th>${d}</th>`).join("") + "</tr></thead><tbody>";
    horas.forEach(([hi, hf]) => {
      html += `<tr><td>${hi}–${hf}</td>`;
      DIAS_SEMANA.forEach(dia => {
        const materia = porDiaHora[`${dia}|${hi}`];
        if (!materia) {
          html += `<td class="empty-cell">—</td>`;
        } else {
          const mine = esMiHora(cursoId, materia);
          html += `<td class="materia-cell${mine ? " mine" : ""}">${materia}</td>`;
        }
      });
      html += "</tr>";
    });
    html += "</tbody>";
    tabla.innerHTML = html;
  } catch (err) {
    console.error(err);
    tabla.innerHTML = `<tbody><tr><td class="empty">No se pudo cargar el horario.</td></tr></tbody>`;
  }
}
