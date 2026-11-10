/* -------------------------------------------------------------------------
   COMISIONES — catálogo en Firestore (con defaults integrados)
   ------------------------------------------------------------------------- */
import { collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { COMISIONES_DEFAULT } from "./constants.js";
import { $, toast } from "./utils.js";

// "Comisión Pedagógica" pasó a llamarse "Comisión de Convivencia". Los reportes
// viejos siguen guardados con el nombre anterior; esto los muestra y filtra
// con el nombre nuevo sin tocar la base de datos.
const COMISION_ALIAS = { "Comisión Pedagógica": "Comisión de Convivencia" };
export const comisionActual = (nombre) => COMISION_ALIAS[nombre] || nombre;

export async function getComisiones() {
  try {
    const snap = await getDocs(collection(db, "comisiones"));
    const desdeFirestore = snap.docs.map(d => comisionActual(d.data().nombre)).filter(Boolean);
    return [...new Set([...COMISIONES_DEFAULT, ...desdeFirestore])].sort();
  } catch (err) {
    console.error(err);
    return COMISIONES_DEFAULT;
  }
}

export async function agregarComision() {
  const input = $("#new-comision-nombre");
  const status = $("#comision-status");
  const nombre = input.value.trim();
  if (!nombre) {
    status.style.color = "var(--red-500)";
    status.textContent = "Escribe un nombre para la comisión.";
    return;
  }
  try {
    await addDoc(collection(db, "comisiones"), { nombre });
    status.style.color = "var(--green-600)";
    status.textContent = `Comisión "${nombre}" guardada.`;
    input.value = "";
    toast("Comisión guardada");
  } catch (err) {
    console.error(err);
    status.style.color = "var(--red-500)";
    status.textContent = "No se pudo guardar. Revisa la consola.";
  }
}

/* -------------------------------------------------------------------------
   REPORTES (Comisión de Convivencia / Disciplinaria)
   ------------------------------------------------------------------------- */
export function comisionBadgeClass(nombre) {
  return /disciplinari/i.test(nombre || "") ? "reporte-badge disciplinaria" : "reporte-badge";
}