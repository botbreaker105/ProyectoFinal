/* -------------------------------------------------------------------------
   REGISTRO DE NUEVO DOCENTE
   ------------------------------------------------------------------------- */
import {
  doc, setDoc, updateDoc, serverTimestamp, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, db, secondaryAuth, secondaryDb, toAuthEmail } from "./firebase.js";
import { MATERIAS_DISPONIBLES, CURSOS_DISPONIBLES } from "./constants.js";
import { $, show, toast } from "./utils.js";
import { state } from "./state.js";
import { fillMateriaSelect } from "./admin-cursos.js";
import { mejorarSelect } from "./dropdown.js";

// Cargos de dirección que se aceptan en el cuadro "Rol" para pedir acceso de Admin.
const normTxt = (t) => String(t || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esRolDireccion = (t) => /^(director|directora|direccion)(\s|$)/.test(normTxt(t));

// Si el tipo es Admin: se quitan las materias y (en el registro público) aparece el cuadro "Rol".
export function actualizarTipoRegistro() {
  const admin = $("#reg-tipo").value === "Admin";
  $("#reg-materias-wrap").style.display = admin ? "none" : "block";
  $("#reg-rol-field").style.display = admin && !state.currentUser ? "block" : "none";
  if (admin) { state.materiasAsignadas = []; renderMateriasList(); resetCursoGrid(); }
}

function renderMateriaSelect() {
  const sel = $("#reg-materia");
  sel.innerHTML = `<option value="">Selecciona una materia</option>` +
    MATERIAS_DISPONIBLES.map(m => `<option value="${m}">${m}</option>`).join("");
}

function renderCursoGrid() {
  const grid = $("#reg-curso-grid");
  grid.innerHTML = CURSOS_DISPONIBLES.map(c => `
    <label class="curso-chip" data-curso="${c}">
      <input type="checkbox" value="${c}" />
      <span>${c}</span>
    </label>
  `).join("");
  grid.querySelectorAll(".curso-chip").forEach(chip => {
    const input = chip.querySelector("input");
    // El <label> ya reenvía el clic al checkbox: se frena eso y se alterna una sola vez
    // (antes se alternaba dos veces y el curso podía quedar sin marcar).
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      setTimeout(() => {
        input.checked = !input.checked;
        chip.classList.toggle("checked", input.checked);
      });
    });
  });
}

function resetCursoGrid() {
  document.querySelectorAll("#reg-curso-grid .curso-chip").forEach(chip => {
    chip.classList.remove("checked");
    chip.querySelector("input").checked = false;
  });
}

function renderMateriasList() {
  const box = $("#reg-materias-list");
  if (!state.materiasAsignadas.length) {
    box.innerHTML = `<div class="empty-state">Aún no hay materias asignadas.</div>`;
    return;
  }
  box.innerHTML = "";
  state.materiasAsignadas.forEach((m, idx) => {
    const row = document.createElement("div");
    row.className = "materia-entry";
    row.innerHTML = `
      <div>
        <div class="m-name">${m.materia}</div>
        <div class="m-cursos">${m.cursos.join(", ")}</div>
      </div>
      <button class="m-remove" type="button" data-idx="${idx}">Quitar</button>
    `;
    box.appendChild(row);
  });
  box.querySelectorAll(".m-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      state.materiasAsignadas.splice(Number(btn.dataset.idx), 1);
      renderMateriasList();
    });
  });
}

$("#btn-add-materia").addEventListener("click", () => {
  const materia = $("#reg-materia").value;
  const cursos = Array.from(document.querySelectorAll("#reg-curso-grid input:checked")).map(i => i.value);
  const hint = $("#reg-materia-hint");
  if (!materia || !cursos.length) {
    hint.textContent = "Selecciona una materia y al menos un curso, luego pulsa Agregar materia.";
    hint.style.color = "var(--red-500)";
    return;
  }
  state.materiasAsignadas.push({ materia, cursos });
  $("#reg-materia").value = "";
  resetCursoGrid();
  hint.textContent = "Materia agregada. Puedes asignar otra si el docente dicta varias.";
  hint.style.color = "var(--ink-soft)";
  renderMateriasList();
});

// PRIMERA CUENTA DE DIRECCIÓN: si todavía no existe config/primerAdmin, quien se registra
// pidiendo ser Director/a queda como Admin ACTIVO de inmediato, y ese documento marca que ya
// hay un primer Admin (las reglas de Firestore solo lo permiten una vez; ver el aviso al
// final de este archivo). Si ya existe, o si las reglas lo rechazan, la solicitud queda
// pendiente como siempre y la aprueba un Admin desde Notificaciones.
async function intentarPrimerAdmin(uid, nombre, usuario, rol) {
  try {
    const marca = await getDoc(doc(db, "config", "primerAdmin"));
    if (marca.exists()) return false;
    const batch = writeBatch(db);
    batch.set(doc(db, "docentes", uid), {
      nombre, usuario, tipo: "Admin", estado: "activo", aprobado: true, rol,
      materia: "", materias: [], cursos: [], creado: serverTimestamp()
    });
    batch.set(doc(db, "config", "primerAdmin"), { uid, nombre, creado: serverTimestamp() });
    await batch.commit();
    return true;
  } catch (err) {
    console.warn("No se pudo crear el primer Admin (queda como solicitud):", err);
    return false;
  }
}

export async function registrarDocente() {
  const nombre = $("#reg-nombre").value.trim();
  const usuario = $("#reg-usuario").value.trim();
  const pass = $("#reg-pass").value;
  const msg = $("#reg-msg");
  msg.style.color = "var(--red-500)";
  msg.textContent = "";

  // Si ya hay alguien logueado (un Admin registrando a un docente), la cuenta
  // se crea con la app secundaria para no pisar esa sesión, y queda ACTIVA de
  // inmediato. Si no hay nadie logueado (registro público), es una SOLICITUD:
  // siempre tipo "Docente", estado "pendiente", hasta que administración acepte.
  const usingSecondary = !!state.currentUser;
  const authForCreation = usingSecondary ? secondaryAuth : auth;
  const dbForCreation = usingSecondary ? secondaryDb : db;
  const tipo = usingSecondary ? $("#reg-tipo").value : "Docente";
  const pideAdmin = $("#reg-tipo").value === "Admin";
  const rolTexto = $("#reg-rol").value.trim();

  if (!nombre || !usuario || !pass) {
    msg.textContent = "Completa nombre, usuario y contraseña.";
    return;
  }
  if (pass.length < 6) {
    msg.textContent = "La contraseña debe tener al menos 6 caracteres.";
    return;
  }
  if (!usingSecondary && pideAdmin && !esRolDireccion(rolTexto)) {
    msg.textContent = "Escribe tu rol de dirección en el cuadro «Rol» (por ejemplo: Director/a).";
    return;
  }
  if (!usingSecondary && !pideAdmin && !state.materiasAsignadas.length) {
    msg.textContent = "Agrega al menos una materia con sus cursos (botón «+ Agregar materia con cursos»).";
    return;
  }

  if (!usingSecondary) state.suppressAuthUI = true;
  let cred = null;
  let perfilCreado = false;
  try {
    cred = await createUserWithEmailAndPassword(authForCreation, toAuthEmail(usuario), pass);
    const materias = pideAdmin ? [] : state.materiasAsignadas;
    const cursosPlanos = [...new Set(materias.flatMap(m => m.cursos))];

    let esPrimerAdmin = false;
    if (!usingSecondary && pideAdmin) esPrimerAdmin = await intentarPrimerAdmin(cred.user.uid, nombre, usuario, rolTexto);

    // Lo que el docente ELIGE queda como "solicitado". Los cursos/materias reales
    // (los que dan acceso, según las reglas de Firestore) los activa administración.
    if (!esPrimerAdmin) await setDoc(doc(dbForCreation, "docentes", cred.user.uid), {
      nombre,
      usuario,
      tipo: "Docente",
      estado: "pendiente",
      aprobado: false, // true = la cuenta puede entrar (lo pone administración, o tú en la consola)
      materia: "",
      materias: [],
      cursos: [],
      materiasSolicitadas: materias,
      cursosSolicitados: cursosPlanos,
      // Quien pide ser Admin queda PENDIENTE como Docente; solo un Admin puede aprobarlo.
      ...(pideAdmin && !usingSecondary ? { rolSolicitado: "Admin", rol: rolTexto } : {}),
      creado: serverTimestamp()
    });
    perfilCreado = true;

    if (usingSecondary) {
      // Admin: se activa ya mismo con el tipo y las materias elegidas.
      await updateDoc(doc(db, "docentes", cred.user.uid), {
        tipo,
        estado: "activo",
        aprobado: true,
        materia: materias[0]?.materia || "",
        materias,
        cursos: cursosPlanos
      });
    }

    await signOut(authForCreation);

    $("#reg-nombre").value = "";
    $("#reg-usuario").value = "";
    $("#reg-pass").value = "";
    $("#reg-rol").value = "";
    $("#reg-tipo").value = "Docente";
    state.materiasAsignadas = [];
    renderMateriasList();
    actualizarTipoRegistro();

    if (usingSecondary) {
      toast(`Docente "${nombre}" registrado`);
      show("#screen-home");
    } else {
      toast(esPrimerAdmin ? "Cuenta de administración creada" : "Solicitud enviada");
      $("#login-email").value = usuario;
      state.suppressAuthUI = false;
      show("#screen-login");
      const lm = $("#login-msg");
      lm.style.color = "#BFEBD7";
      lm.textContent = esPrimerAdmin
        ? "Cuenta de administración creada. Ya puedes ingresar."
        : "Solicitud enviada. Cuando administración la apruebe, podrás ingresar.";
    }
  } catch (err) {
    console.error(err);
    // Si la cuenta se creó pero el perfil no pudo guardarse, se borra la cuenta
    // para que el usuario pueda volver a intentarlo con el mismo nombre.
    if (cred?.user && !perfilCreado) { try { await cred.user.delete(); } catch (e) { console.error(e); } }
    if (!usingSecondary) { state.suppressAuthUI = false; try { await signOut(authForCreation); } catch (e) {} }
    if (err.code === "auth/email-already-in-use") {
      msg.textContent = "Ese nombre de usuario ya está registrado.";
    } else if (err.code === "auth/weak-password") {
      msg.textContent = "La contraseña es muy débil.";
    } else if (err.code === "permission-denied") {
      msg.textContent = "No se pudo enviar: Firestore rechazó el registro. Avisa a administración.";
    } else {
      msg.textContent = "No se pudo registrar. Intenta de nuevo.";
    }
  }
}

renderMateriaSelect();
renderCursoGrid();
renderMateriasList();
fillMateriaSelect($("#new-curso-materia"));
fillMateriaSelect($("#hor-materia"));
mejorarSelect($("#reg-tipo"));
mejorarSelect($("#reg-materia"));
$("#reg-tipo").addEventListener("change", actualizarTipoRegistro);

/* -------------------------------------------------------------------------
   REGLAS DE FIRESTORE necesarias para la primera cuenta de dirección (fusiónalas
   con las tuyas; sin ellas todo sigue funcionando: la solicitud queda pendiente):

   match /config/primerAdmin {
     allow read: if request.auth != null;
     allow create: if request.auth != null
       && request.resource.data.uid == request.auth.uid
       && getAfter(/databases/$(database)/documents/docentes/$(request.auth.uid)).data.tipo == "Admin";
     allow update, delete: if false;
   }
   // y en docentes/{uid}, además de lo que ya permites al registrarse como Docente pendiente:
   allow create: if request.auth.uid == uid
     && request.resource.data.tipo == "Admin" && request.resource.data.estado == "activo"
     && !exists(/databases/$(database)/documents/config/primerAdmin)
     && getAfter(/databases/$(database)/documents/config/primerAdmin).data.uid == uid;
   ------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   APROBACIÓN POR BOOLEANO (docentes/{uid}.aprobado) — regla opcional para que, al poner
   aprobado = true a mano en la consola, la cuenta reciba sola los cursos que pidió:

   allow update: if request.auth.uid == uid
     && resource.data.aprobado == true
     && request.resource.data.tipo == resource.data.tipo
     && request.resource.data.cursos == resource.data.cursosSolicitados
     && request.resource.data.materias == resource.data.materiasSolicitadas
     && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["materias", "cursos", "materia", "estado"]);

   Además, el acceso a datos por curso ya depende de docentes/{uid}.cursos, así que sin esa regla
   la cuenta entra a la app pero no verá cursos hasta que un Admin la acepte desde Notificaciones.
   ------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   PRIMERA CUENTA DE DIRECCIÓN POR BOOLEANO: quien se registró pidiendo ser Director/a queda con
   rolSolicitado = "Admin". Cuando tú pones aprobado = true en su documento, la app la convierte
   en Admin sola. Esta regla lo permite SOLO en ese caso (se suma a la de arriba, en docentes/{uid}):

   allow update: if request.auth.uid == uid
     && resource.data.aprobado == true
     && resource.data.rolSolicitado == "Admin"
     && request.resource.data.tipo == "Admin"
     && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["tipo", "estado", "materia", "materias", "cursos"]);

   Con esto ya no hace falta la regla de config/primerAdmin (que dejaba una ventana abierta
   hasta que se registraba la directora): si no la publicas, el registro queda pendiente y listo.
   Importante: nadie debe poder editar su propio campo "aprobado" ni "tipo" salvo con las reglas de arriba.
   ------------------------------------------------------------------------- */