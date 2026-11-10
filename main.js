/* =========================================================================
   PUNTO DE ENTRADA — eventos de navegación y arranque de la app.
   Importa todas las pantallas para registrar sus funciones y engancha
   los botones/formularios de la interfaz.
   ========================================================================= */
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, firebaseConfig, toAuthEmail } from "./firebase.js";
import { $, show, toast, preguntar, wirePasswordToggles } from "./utils.js";
import { state } from "./state.js";

import { loadTeacherHome, saveAttendance, saveLog, saveTarea, saveTodo, loadActividadReciente, initActividadUI, hayCambiosSinGuardar, descartarCambios, renderPendientes } from "./home.js";
import { registrarDocente, actualizarTipoRegistro } from "./registro-docente.js";
import {
  loadCursosSelect, loadCursosOptions, crearCursosBase,
  agregarCurso, agregarEstudiante, probarConexion
} from "./admin-cursos.js";
import { importCSV, exportCSV } from "./csv-asistencia.js";
import {
  actualizarPermisoNotasUI, loadNotasCursoSelect,
  refreshNotasMateriaYTrimestreFiltro, renderNotasTabla,
  importNotasCSV, exportNotasCSV, initGradebookUI
} from "./notas.js";
import { agregarComision } from "./comisiones.js";
import { abrirReportes, switchReporteTab, guardarReporte, loadReportesHistorial, cargarEstudiantesDeCurso, switchSeguimientoSubTab, recargarSeguimientoActivo, mostrarFiliacionReporte } from "./reportes.js";
import { initNotificacionesUI, actualizarBadgeNotificaciones } from "./notificaciones.js";
import { importFiliacionCSV, exportFiliacionCSV } from "./filiacion.js";
import { cargarAsesores, initAsesoresUI } from "./asesores.js";
import {
  loadHorarioAdminLista, importHorarioCSV, exportHorarioCSV,
  agregarHorario, loadHorarioCursoRail
} from "./horarios.js";

wirePasswordToggles();

// ---- Avisar antes de salir con cambios sin guardar ----
async function confirmarSalida() {
  if (!hayCambiosSinGuardar()) return true;
  const r = await preguntar({
    titulo: "Tienes cambios sin guardar",
    texto: "Si sales ahora, se perderá lo que escribiste o marcaste.",
    botones: [
      { id: "guardar", label: "Guardar y salir", tipo: "primario" },
      { id: "salir", label: "Salir sin guardar", tipo: "peligro" },
      { id: "seguir", label: "Seguir editando", tipo: "suave" }
    ]
  });
  if (r === "seguir" || r === "cancelar") return false;
  if (r === "guardar") {
    await saveTodo();
    if (hayCambiosSinGuardar()) return false; // no se pudo guardar: se queda aquí
  }
  descartarCambios();
  return true;
}

// ---- Aviso de conexión ----
function pintarConexion() {
  $("#offline-banner").classList.toggle("show", !navigator.onLine);
}
window.addEventListener("offline", pintarConexion);
window.addEventListener("online", async () => {
  pintarConexion();
  toast("Conexión recuperada. Enviando tus cambios…");
  try { await waitForPendingWrites(db); toast("Todo enviado ✓"); } catch (err) { console.warn(err); }
});
pintarConexion();
initActividadUI();
initGradebookUI();
initNotificacionesUI();
initAsesoresUI();

$("#btn-login").addEventListener("click", async () => {
  const usuario = $("#login-email").value.trim();
  const pass = $("#login-pass").value;
  $("#login-msg").textContent = "";
  $("#login-msg").style.color = "";
  if (!usuario || !pass) { $("#login-msg").textContent = "Ingresa usuario y contraseña."; return; }
  try {
    await signInWithEmailAndPassword(auth, toAuthEmail(usuario), pass);
  } catch (err) {
    $("#login-msg").textContent = "Usuario o contraseña incorrectos.";
  }
});

// Registro público = solicitud (siempre Docente). Solo un Admin logueado puede elegir el tipo.
function prepararRegistro(esAdminCreando) {
  $("#reg-tipo").value = "Docente";
  $("#reg-rol").value = "";
  actualizarTipoRegistro();
  $("#reg-aprobacion-hint").style.display = esAdminCreando ? "none" : "block";
  $("#btn-register-save").textContent = esAdminCreando ? "Guardar y registrar docente" : "Enviar solicitud";
  show("#screen-register");
}
$("#btn-goto-register").addEventListener("click", () => prepararRegistro(false));
$("#btn-back-register").addEventListener("click", () => show(state.currentUser ? "#screen-home" : "#screen-login"));
$("#btn-register-save").addEventListener("click", registrarDocente);

$("#btn-admin-register").addEventListener("click", () => prepararRegistro(true));
$("#btn-admin-import").addEventListener("click", () => {
  loadCursosSelect();
  loadCursosOptions("#hor-curso", "Selecciona un curso");
  cargarAsesores();
  show("#screen-import");
});
$("#btn-back-import").addEventListener("click", () => show(state.currentUser ? "#screen-home" : "#screen-login"));
$("#btn-import-csv").addEventListener("click", importCSV);
$("#btn-export-csv").addEventListener("click", exportCSV);
$("#btn-add-curso").addEventListener("click", agregarCurso);
$("#btn-crear-cursos-base").addEventListener("click", crearCursosBase);
$("#btn-add-estudiante").addEventListener("click", agregarEstudiante);
$("#btn-add-comision").addEventListener("click", agregarComision);
$("#btn-add-horario").addEventListener("click", agregarHorario);
$("#btn-import-horario-csv").addEventListener("click", importHorarioCSV);
$("#btn-export-horario-csv").addEventListener("click", exportHorarioCSV);
$("#hor-curso").addEventListener("change", loadHorarioAdminLista);
$("#btn-import-notas-csv").addEventListener("click", importNotasCSV);
$("#btn-export-notas-csv").addEventListener("click", exportNotasCSV);
$("#notas-curso").addEventListener("change", async () => {
  actualizarPermisoNotasUI();
  await refreshNotasMateriaYTrimestreFiltro();
  await renderNotasTabla();
});
$("#notas-materia-filtro").addEventListener("change", renderNotasTabla);
$("#notas-trimestre-filtro").addEventListener("change", renderNotasTabla);
$("#notas-grupo-filtro").addEventListener("change", renderNotasTabla);

$("#btn-admin-diag").addEventListener("click", () => show("#screen-diag"));
$("#btn-back-diag").addEventListener("click", () => show(state.currentUser ? "#screen-home" : "#screen-login"));
$("#btn-diag-test").addEventListener("click", probarConexion);
$("#btn-open-console").addEventListener("click", () => {
  window.open(`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/data`, "_blank");
});

$("#btn-logout").addEventListener("click", async () => { if (await confirmarSalida()) signOut(auth); });
$("#btn-back").addEventListener("click", async () => {
  if (!(await confirmarSalida())) return;
  show("#screen-home");
  renderPendientes().catch(() => {});
});
$("#btn-save-attendance").addEventListener("click", saveAttendance);
$("#btn-save-log").addEventListener("click", saveLog);
$("#btn-save-tarea").addEventListener("click", saveTarea);
$("#btn-save-all").addEventListener("click", saveTodo);

$("#tab-crear-reporte").addEventListener("click", () => switchReporteTab("crear"));
$("#tab-historial-reportes").addEventListener("click", () => switchReporteTab("historial"));
$("#tab-seguimiento").addEventListener("click", () => switchReporteTab("seguimiento"));
$("#btn-guardar-reporte").addEventListener("click", guardarReporte);
$("#rep-curso").addEventListener("input", (e) => cargarEstudiantesDeCurso(e.target.value));
$("#rep-estudiante").addEventListener("input", mostrarFiliacionReporte);
$("#rep-estudiante").addEventListener("change", mostrarFiliacionReporte);
$("#btn-import-filiacion-csv").addEventListener("click", importFiliacionCSV);
$("#btn-export-filiacion-csv").addEventListener("click", exportFiliacionCSV);
$("#rep-filtro-curso").addEventListener("change", (e) => { state.reportesFiltro.curso = e.target.value; loadReportesHistorial(); });
$("#rep-filtro-comision").addEventListener("change", (e) => { state.reportesFiltro.comision = e.target.value; loadReportesHistorial(); });
$("#seg-filtro-curso").addEventListener("change", recargarSeguimientoActivo);
$("#seg-filtro-materia").addEventListener("change", recargarSeguimientoActivo);
$("#seg-tab-bitacoras").addEventListener("click", () => switchSeguimientoSubTab("bitacoras"));
$("#seg-tab-tareas").addEventListener("click", () => switchSeguimientoSubTab("tareas"));
$("#seg-tab-asistencia").addEventListener("click", () => switchSeguimientoSubTab("asistencia"));

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (!(await confirmarSalida())) return;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.go === "home") { show("#screen-home"); if (state.currentUser) { loadActividadReciente(state.currentUser.uid); actualizarBadgeNotificaciones(); } }
    if (btn.dataset.go === "reportes") { show("#screen-reportes"); abrirReportes(); }
    if (btn.dataset.go === "horarios") { show("#screen-horarios"); loadHorarioCursoRail(); }
    if (btn.dataset.go === "notas") { show("#screen-notas"); loadNotasCursoSelect(); }
  });
});

// Solo las cuentas con estado "activo" (o sin estado: cuentas anteriores) entran a la app.
// Pendiente / rechazado / inactivo ven una pantalla de espera.
const MENSAJES_CUENTA = {
  pendiente: ["Solicitud en revisión", "Administración está revisando tu solicitud. Cuando la acepte podrás entrar y usar la app."],
  rechazado: ["Solicitud no aprobada", "Administración no aprobó esta solicitud. Habla con administración si crees que es un error."],
  inactivo: ["Cuenta desactivada", "Tu cuenta está desactivada. Habla con administración para reactivarla."],
  sinperfil: ["Cuenta sin perfil", "Tu cuenta no tiene un perfil de docente. Habla con administración."]
};

// Si la cuenta se aprobó "a mano" (poniendo aprobado = true en Firestore) y todavía no tiene
// cursos, se le asignan los que pidió al registrarse. Las reglas de Firestore solo deben
// permitir copiar exactamente lo solicitado (ver nota en registro-docente.js).
async function completarAsignacionSolicitada(user, perfil) {
  if (!perfil || perfil.aprobado !== true) return;
  // Pidió ser Admin (escribió "Director/a" al registrarse) y alguien puso aprobado = true:
  // se convierte en Admin. Así la primera cuenta de dirección se aprueba con un solo campo.
  if (perfil.rolSolicitado === "Admin" && perfil.tipo !== "Admin") {
    try {
      await updateDoc(doc(db, "docentes", user.uid), { tipo: "Admin", estado: "activo", materia: "", materias: [], cursos: [] });
    } catch (err) {
      console.warn("No se pudo activar el rol de Admin (¿reglas de Firestore?):", err);
    }
    return;
  }
  if (perfil.tipo === "Admin") return;
  if ((perfil.cursos || []).length || !(perfil.cursosSolicitados || []).length) return;
  try {
    const materias = perfil.materiasSolicitadas || [];
    await updateDoc(doc(db, "docentes", user.uid), {
      estado: "activo",
      materias,
      cursos: perfil.cursosSolicitados,
      materia: materias[0]?.materia || ""
    });
  } catch (err) {
    console.warn("No se pudieron asignar los cursos solicitados (¿reglas de Firestore?):", err);
  }
}

async function cuentaActiva(user) {
  let perfil = null;
  try {
    const snap = await getDoc(doc(db, "docentes", user.uid));
    perfil = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.error(err);
    return true; // sin poder verificar, se deja pasar: las reglas de Firestore igual protegen los datos
  }
  // `aprobado` (true/false) manda cuando existe: true = puede entrar. Las cuentas anteriores,
  // que no tienen ese campo, se siguen rigiendo por `estado`.
  const estadoBase = perfil ? (perfil.estado || "activo") : "sinperfil";
  let estado = estadoBase;
  if (perfil && typeof perfil.aprobado === "boolean") {
    estado = perfil.aprobado ? "activo" : (["rechazado", "inactivo"].includes(estadoBase) ? estadoBase : "pendiente");
  }
  if (estado === "activo") {
    await completarAsignacionSolicitada(user, perfil);
    return true;
  }

  const [titulo, texto] = MENSAJES_CUENTA[estado] || MENSAJES_CUENTA.pendiente;
  $("#pend-titulo").textContent = titulo;
  $("#pend-texto").textContent = texto;
  const pedido = perfil?.rolSolicitado === "Admin"
    ? `acceso de administración (${perfil.rol || "dirección"})`
    : (perfil?.materiasSolicitadas || []).map(m => `${m.materia} (${(m.cursos || []).join(", ")})`).join(" · ");
  $("#pend-detalle").textContent = estado === "pendiente" && pedido ? `Pediste: ${pedido}` : "";
  $("#bottom-nav").style.display = "none";
  show("#screen-pendiente");
  return false;
}

async function entrarSiActiva(user) {
  if (!(await cuentaActiva(user))) return;
  $("#bottom-nav").style.display = "flex";
  show("#screen-home");
  await loadTeacherHome(user.uid);
  actualizarBadgeNotificaciones();
}

$("#btn-pend-refrescar").addEventListener("click", () => { if (state.currentUser) entrarSiActiva(state.currentUser); });
$("#btn-pend-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (state.suppressAuthUI) { state.currentUser = user; return; }
  state.currentUser = user;
  if (user) {
    await entrarSiActiva(user);
  } else {
    $("#bottom-nav").style.display = "none";
    show("#screen-login");
  }
});