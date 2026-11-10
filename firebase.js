/* =========================================================================
   FIREBASE — inicialización y configuración del proyecto
   Sustituye firebaseConfig por el de tu proyecto y ajusta los nombres
   de colección si tu Firestore ya usa otros nombres.
   ========================================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- 1. CONFIGURA TU PROYECTO FIREBASE AQUÍ ----
export const firebaseConfig = {
  apiKey: "AIzaSyCAotInriWcSLcBztfPWrXKAk6KK674MW0",
  authDomain: "edugest-36fd2.firebaseapp.com",
  projectId: "edugest-36fd2",
  storageBucket: "edugest-36fd2.firebasestorage.app",
  messagingSenderId: "681005309640",
  appId: "1:681005309640:web:4449465f36c1e2a87dcffd",
  measurementId: "G-VY84K4ERD6"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Modo sin conexión: Firestore guarda una copia en el teléfono. Lo que se escribe sin internet
// queda en cola y se envía solo cuando vuelve la señal; lo ya visto se puede seguir leyendo.
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (err) {
    console.warn("Sin modo offline (se usa Firestore normal):", err);
    return getFirestore(app);
  }
})();

// App secundaria: crea cuentas nuevas sin pisar la sesión de quien está
// logueado (si un Admin registra a un docente, el Admin no pierde su sesión).
export const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);
export const secondaryDb = getFirestore(secondaryApp);

// Firebase Auth necesita un correo. El sistema usa "usuario" como login,
// así que aquí se arma internamente un correo interno para cada usuario.
export const AUTH_DOMAIN = "edugest.local";
export const toAuthEmail = (usuario) => `${usuario.trim().toLowerCase().replace(/\s+/g, "")}@${AUTH_DOMAIN}`;

/* -------------------------------------------------------------------------
   FIRESTORE — estructura de datos esperada
   docentes/{uid}                { nombre, materia, cursos: [cursoId,...] }
   cursos/{cursoId}               { nombre, hora_inicio, hora_fin, materia }
   cursos/{cursoId}/estudiantes/{studentId}  { nombre }
   asistencia/{cursoId_fecha}     { cursoId, fecha, docenteId, registros: {studentId: 'P'|'T'|'A'} }
   bitacora/{autoId}              { cursoId, docenteId, fecha, tipo, texto, creado }
   notas/{cursoId}/registros/{materiaSlug__trimestreSlug__estudianteSlug}
                                   { curso, materia, trimestre, estudiante, nota, actualizado }
                                   — las notas de un curso se acumulan aquí sin
                                   importar de qué materia vengan; el id
                                   determinístico evita duplicar filas al
                                   reimportar el mismo estudiante+materia+trimestre.
                                   Solo puede escribir aquí un docente con ese
                                   curso asignado (docentes/{uid}.cursos); Admin
                                   es de solo lectura (ver firestore.rules).
   ------------------------------------------------------------------------- */