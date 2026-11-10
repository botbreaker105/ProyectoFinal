/* =========================================================================
   ESTADO — variables compartidas entre pantallas/módulos.
   Se usa un objeto único para que todos los módulos lean y escriban
   las mismas propiedades (los bindings de ES modules no permiten
   reasignar una variable importada directamente).
   ========================================================================= */
export const state = {
  currentUser: null,
  currentTeacherDoc: null,
  classesToday: [],
  activeClass: null,
  materiaActiva: "",        // materia con la que se guarda lo de la clase abierta (si el docente da varias en el curso)
  rosterState: {},          // { studentId: 'P' | 'T' | 'A' }
  materiasAsignadas: [],    // [{ materia, cursos: [...] }] — para el registro de un nuevo docente
  suppressAuthUI: false,    // evita el parpadeo de "Home" mientras se crea una cuenta nueva
  reportesFiltro: { curso: "", comision: "" },
  activeHorarioCurso: null, // curso actualmente mostrado en la pantalla de Horarios
  notasCache: [],           // últimas notas cargadas para el curso seleccionado en pantalla
};