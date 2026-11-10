/* =========================================================================
   CONSTANTES — catálogos usados en varias pantallas
   ========================================================================= */

// Catálogo de materias y cursos disponibles para el formulario de registro
export const MATERIAS_DISPONIBLES = [
  "Matemática","Lengua Castellana","Lengua Originaria","Inglés","Ciencias Sociales",
  "Biología","Biogeografía","Física","Química","Psicología","Cosmovisiones y Filosofía",
  "Valores y espiritualidades","Educación Física","Artes Plásticas y Visuales","Música",
  "Técnica General","Computación","Sistemas Informáticos","Agroecología","Perfil de Proyecto"
];
export const CURSOS_DISPONIBLES = [
  "1A","1B","1C","2A","2B","2C","3A","3B","3C",
  "4A","4B","4C","5A","5B","5C","6A","6B"
];
// Grupos/menciones técnicas dentro de un mismo curso. El valor coincide con
// el nombre exacto de la materia correspondiente, para poder cruzar
// estudiante -> grupo -> materia sin tablas de traducción aparte.
export const GRUPOS_DISPONIBLES = ["Agroecología", "Sistemas Informáticos"];
// Comisiones por defecto — siempre disponibles aunque Firestore no tenga
// ninguna todavía. Un Admin puede agregar más desde el panel.
export const COMISIONES_DEFAULT = ["Comisión de Convivencia", "Comisión Disciplinaria"];
export const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];