/* =========================================================================
   ACTIVIDAD DE DOCENTES — feed para administración.
   Cada vez que un docente guarda un reporte o sube un registro de clase se
   crea un documento en `actividad/{id}`:
     { tipo: "reporte" | "registro", docenteId, docenteNombre, creado,
       leidoPor: [uid de admin,...], ...datos del evento }
   Es un solo documento por evento (no uno por admin); cada admin marca el
   suyo como leído con leidoPor.
   ========================================================================= */
import {
  collection, addDoc, query, orderBy, limit, getDocs, doc, updateDoc,
  arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";
import { state } from "./state.js";

// Nunca rompe el flujo de quien guarda: si falla, solo avisa en consola.
export async function registrarActividad(datos) {
  try {
    const uid = state.currentUser?.uid;
    if (!uid) return false;
    const soyAdmin = state.currentTeacherDoc?.tipo === "Admin";
    await addDoc(collection(db, "actividad"), {
      ...datos,
      docenteId: uid,
      docenteNombre: state.currentTeacherDoc?.nombre || "",
      leidoPor: soyAdmin ? [uid] : [], // lo que hace un admin no le suma un aviso a sí mismo
      creado: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("No se pudo registrar la actividad (¿reglas de Firestore?):", err);
    return false;
  }
}

export async function leerActividad(n = 40) {
  const snap = await getDocs(query(collection(db, "actividad"), orderBy("creado", "desc"), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const noLeida = (e, uid) => !(e.leidoPor || []).includes(uid);

export function marcarActividadLeida(id, uid) {
  return updateDoc(doc(db, "actividad", id), { leidoPor: arrayUnion(uid) }).catch(err => console.warn(err));
}
