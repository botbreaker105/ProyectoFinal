# EduGest

**Plataforma Digital Automatizada de Registro y Organización Educativa**

_Menos papeles. Más enseñanza._

EduGest es una aplicación web (instalable en el celular como PWA) para que los docentes registren asistencia, bitácora de clase, tareas, notas y reportes de convivencia desde el teléfono, y para que la dirección pueda supervisar, aprobar cuentas y enviar avisos. Nació como trabajo final del Técnico Medio en Sistemas Informáticos de la **Unidad Educativa Sagrado Corazón “4” E.P.D.B** (San Juan, Santa Cruz, Bolivia, 2026).

> Capturas de pantalla: agrégalas en `assets/capturas/` y enlázalas aquí.
> `![Inicio](assets/capturas/inicio.png)`

---

## ¿Por qué lo hicimos?

En la observación y la encuesta que hicimos en la unidad educativa vimos que el trabajo administrativo diario se hace casi todo a mano: cuadernos, formularios impresos y archivos dispersos.

| Hallazgo                                                                    | Resultado             |
| --------------------------------------------------------------------------- | --------------------- |
| Docentes con dificultades para organizar asistencia, actividades y horarios | **80 %**              |
| Docentes que sienten que estos trámites les quitan más tiempo del necesario | **75 %**              |
| Tiempo que recupera un docente si ahorra 10 min al día (200 días de clases) | **≈ 33 horas al año** |

_Encuesta a 30 docentes._ Además observamos que muchos docentes dedican parte del inicio de clase a llenar formularios, que los datos viven en formatos distintos y que los papeles se deterioran o se pierden.

**Objetivo general:** desarrollar e implementar una plataforma digital que optimice el registro diario de actividades académicas, la gestión de horarios y el control de listas de estudiantes y docentes, mejorando la organización y la eficiencia de la institución.

**Objetivos específicos:** analizar los procesos actuales de registro, diseñar la estructura de la plataforma, desarrollar los módulos de acceso, horarios y registros, implementarla en la unidad educativa y evaluar su funcionamiento.

---

## ¿Qué hace?

**Para docentes**

- **Asistencia con un toque:** “Todos presentes” y se corrigen solo las excepciones (presente, falta, atraso, licencia). Se puede corregir la asistencia ya tomada ese día.
- **Bitácora de clase, tareas y evaluaciones**, y **notas por curso y trimestre** (también por importación CSV).
- **Reportes** de convivencia y disciplina, con los datos de la familia del estudiante a la vista.
- **Horarios** por curso, con las clases del docente resaltadas.
- **Avisos, reuniones y citaciones** con botón “Entendido”, y una tarjeta de **pendientes del día** (por ejemplo, asistencia sin tomar).
- **Funciona sin conexión:** lo que se guarda sin internet queda en el teléfono y se envía solo al volver la señal.

**Para la dirección (Admin)**

- **Aprobación de cuentas:** cada solicitud de registro se acepta o rechaza, y se pueden quitar cursos antes de aceptar.
- **Actividad de docentes** en tiempo real: quién hizo un reporte o subió un registro, con el detalle al tocarlo.
- **Envío de notificaciones** a todos los docentes o a uno en privado, con seguimiento de quién la leyó y quién confirmó.
- Carga masiva por CSV de cursos, estudiantes, horarios y datos de filiación.

---

## ¿Cómo lo hicimos?

### Tecnologías

- **HTML, CSS y JavaScript** (módulos ES, sin framework ni paso de compilación).
- **Firebase Authentication** (usuario y contraseña) y **Cloud Firestore** (base de datos en la nube con sincronización en tiempo real).
- **PWA:** `manifest.json` + service worker (`sw.js`) para instalar la app y abrirla sin conexión.
- Firestore con **caché local persistente** para el trabajo sin internet.
- [PapaParse](https://www.papaparse.com/) para leer los CSV.

### Una decisión importante: de MySQL a Firebase

Empezamos usando **MySQL**, pero para probar el sistema había que hacer muchas configuraciones previas, el entorno generaba muchos archivos que no entendíamos tan bien como nuestro código en JavaScript y HTML, y el equipo dominaba la base de datos de forma desigual. Como Yuuta ya tenía experiencia con **Firebase y Firestore**, migramos. Eso redujo la complejidad, aceleró las pruebas y no cambió los objetivos del proyecto.

### Estructura del proyecto

```
index.html            Pantallas de la app
style.css             Estilos
main.js               Punto de entrada: navegación, sesión, conexión
firebase.js           Configuración de Firebase
state.js / utils.js / constants.js
home.js               Inicio, asistencia, bitácora, tareas, pendientes
reportes.js           Reportes y seguimiento
notas.js              Notas por curso y trimestre
horarios.js           Horarios (admin y vista por docente)
notificaciones.js     Campana, solicitudes, avisos y envíos
actividad.js          Actividad de docentes para administración
registro-docente.js   Registro y solicitudes de cuenta
admin-cursos.js, csv-asistencia.js, filiacion.js, comisiones.js
dropdown.js           Listas desplegables con el estilo del sitio
sw.js, manifest.json  PWA
firestore.rules       Reglas de seguridad de Firestore
```

### Datos (Firestore)

`docentes`, `cursos` (con `estudiantes` y `horario`), `asistencia`, `bitacora`, `tareas`, `notas`, `reportes`, `comisiones`, `notificaciones` y `actividad`.

### Roles y seguridad

- Dos tipos de cuenta: **Docente** y **Admin**.
- El registro público **siempre** crea una cuenta _pendiente_ (`aprobado: false`); nadie puede registrarse como Admin por su cuenta.
- Una cuenta entra solo si `aprobado` es `true`. Los docentes solo acceden a los cursos que administración les asignó.
- Todo el control de acceso está en [`firestore.rules`](firestore.rules). La `apiKey` del `firebaseConfig` **no es un secreto** en una app web; la protección real son estas reglas.

---

## Instalación y uso local

1. **Crea un proyecto en Firebase** y activa _Authentication_ (correo/contraseña) y _Firestore_.
2. Copia la configuración de tu app web en `firebase.js` (`firebaseConfig`).
3. Publica las reglas de `firestore.rules` en Firestore → Reglas.
4. Sirve la carpeta con cualquier servidor estático (los módulos ES no funcionan abriendo el archivo directamente):
   ```bash
   python -m http.server 8000
   # abre http://localhost:8000
   ```
5. **Primera cuenta de dirección:** regístrate eligiendo _Admin_ y escribiendo tu cargo (por ejemplo “Directora”) en _Rol_. Luego, en Firestore → `docentes` → tu documento, cambia `aprobado` a `true`. Al volver a entrar serás Admin.
6. Desde el panel de administración crea los cursos base, importa estudiantes y horarios, y aprueba a los docentes.

Se puede publicar en cualquier hosting estático (por ejemplo GitHub Pages o Firebase Hosting).

### Buenas prácticas

- **No subas datos reales de estudiantes** (CSV con nombres, teléfonos o filiación). Están excluidos en `.gitignore`.
- Restringe la llave de API de Firebase a tu dominio en Google Cloud Console → Credenciales.

## Pruebas

Se hicieron pruebas de campo con docentes de la unidad educativa y con nuestro tutor, y un taller de capacitación para mostrar el uso de la app.

## Próximos pasos

- Notificaciones automáticas a **padres de familia** cuando un estudiante falta.
- Notificaciones _push_ en el celular con la app cerrada.
- Videotutoriales cortos dentro de la plataforma para capacitar a docentes nuevos.
- Prueba piloto con la dirección y secretaría, y evaluación continua del sistema.

---

## Equipo

- **Yuuta Shoji** — desarrollo
- **Gianna Lizbeth Cuellar Montenegro** — desarrollo
- **Lic. Robert Snaeder Cahuaya Ulo** — docente guía

Agradecemos a nuestros profesores, a los docentes que probaron la plataforma y a nuestras familias.

## Licencia

_Define aquí la licencia (por ejemplo MIT) o indica que el código es de uso educativo._
