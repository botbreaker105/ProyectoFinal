# EduGest

**Plataforma Digital Automatizada de Registro y Organización Educativa**

_Menos papeles. Más enseñanza._

EduGest es una aplicación web (instalable en el celular como PWA) para que los docentes registren asistencia, bitácora de clase, tareas, notas y reportes de convivencia desde el teléfono, para que cada curso tenga un **asesor o asesora** que reciba los reportes y pida informes a los docentes, y para que la dirección pueda supervisar, aprobar cuentas y enviar avisos. Nació como trabajo final del Técnico Medio en Sistemas Informáticos de la **Unidad Educativa Sagrado Corazón “4” E.P.D.B** (San Juan, Santa Cruz, Bolivia, 2026).

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
- **Selector de materia:** cuando un docente da **varias materias en un mismo curso**, la pantalla de clase muestra un selector rápido (“Trabajando en: Física · Química”) con el color de cada materia. La app propone la materia según el horario del curso (el bloque de ese momento o el más cercano) o la última que se usó, explica por qué la eligió y permite cambiarla con un toque. Lo que se guarda (bitácora, tareas, avisos a administración) queda en la materia elegida.
- **Reportes** de convivencia y disciplina, con los datos de la familia del estudiante a la vista.
- **Horarios** por curso, con las clases del docente resaltadas.
- **Avisos, reuniones y citaciones** con botón “Entendido”, y una tarjeta de **pendientes del día** (por ejemplo, asistencia sin tomar o un informe que pidió el asesor).
- **Informe rápido para el asesor:** cuando el asesor de un curso pide un informe, el docente lo ve en sus pendientes, y por cada estudiante anota las **faltas** y las **tareas no presentadas o notas bajas**. Solo llena a quienes tienen novedades; puede corregir su respuesta mientras el pedido siga abierto.
- **Funciona sin conexión:** lo que se guarda sin internet queda en el teléfono y se envía solo al volver la señal.

**Para el asesor o asesora de curso**

La dirección designa a un docente como asesor de un curso (el docente ya debe tener ese curso asignado). Un curso tiene un asesor; un docente puede asesorar varios cursos. Quien es asesor ve una ★ junto a su curso y “Asesor/a de 4A” en el inicio.

- **Recibe los reportes** de los estudiantes de su curso: le llega un aviso y los ve en _Reportes → Historial_, con el nombre de quien reportó. Solo aplica a reportes creados después de asignarle el curso.
- **Pide informes** a todos los docentes que pasan por su curso desde _Reportes → Asesoría_: elige el curso, escribe qué necesita (opcional) y una fecha límite (opcional). Cada docente recibe un aviso y lo ve en sus pendientes.
- **Ve los informes por materia y docente:** cuántos respondieron, quién falta y, al abrir cada tarjeta, la lista de estudiantes con novedades.
- **Descarga un CSV para imprimir**, con una fila por cada estudiante del curso: N°, estudiante, faltas (total), faltas por materia, tareas no presentadas / notas bajas (por materia) y una columna en blanco para la **firma de los padres o tutor**.
- Puede **cerrar o reabrir** un pedido.

**Para la dirección (Admin)**

- **Aprobación de cuentas:** cada solicitud de registro se acepta o rechaza, y se pueden quitar cursos antes de aceptar.
- **Asignación de asesores** por curso (en el panel de datos masivos), con la lista de asesores actuales.
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
home.js               Inicio, asistencia, bitácora, tareas, pendientes, selector de materia
reportes.js           Reportes (con envío al asesor) y seguimiento
asesores.js           Asignación de asesor a cada curso (Admin)
informes.js           Informes del asesor: pedido, formulario del docente, consolidado y CSV
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

`docentes`, `cursos` (con `estudiantes` y `horario`; el asesor se guarda en el propio curso como `asesorId` y `asesorNombre`), `asistencia`, `bitacora`, `tareas`, `notas`, `reportes` (con `cursoId`, `asesorId` y `asesorNombre` cuando el curso tiene asesor), `comisiones`, `notificaciones`, `actividad` e `informes_solicitud` (con la subcolección `respuestas`, un documento por docente).

### Roles y seguridad

- Dos tipos de cuenta: **Docente** y **Admin**. El **asesor** no es un tipo de cuenta: es una asignación sobre un curso que hace la dirección.
- El registro público **siempre** crea una cuenta _pendiente_ (`aprobado: false`); nadie puede registrarse como Admin por su cuenta.
- Una cuenta entra solo si `aprobado` es `true`. Los docentes solo acceden a los cursos que administración les asignó.
- El asesor lee los reportes de su curso; solo él puede crear y cerrar pedidos de informe de ese curso; cada docente escribe únicamente su propia respuesta, y solo mientras el pedido está abierto.
- Los avisos automáticos de asesoría (`reporte_asesor` e `informe`) los puede crear cualquier cuenta activa, con campos fijos y siempre como no leídos; el resto de los avisos solo los envía Admin.
- Todo el control de acceso está en [`firestore.rules`](firestore.rules). La `apiKey` del `firebaseConfig` **no es un secreto** en una app web; la protección real son estas reglas.
- Las reglas permiten que cualquier cuenta activa vea los perfiles de los docentes (para que el asesor encuentre a quién avisar). Si prefieres no abrirlos, cambia `allow read` en `docentes` a `esDueno(docenteId) || esAdmin()`; el pedido de informe seguirá funcionando, pero sin avisos individuales en la campana.

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
6. Desde el panel de administración crea los cursos base, importa estudiantes y horarios, aprueba a los docentes y **asigna un asesor a cada curso**.

Se puede publicar en cualquier hosting estático (por ejemplo GitHub Pages o Firebase Hosting).

### Usarlo en otra institución

EduGest está configurado para la Unidad Educativa Sagrado Corazón “4” y para el proyecto de Firebase de este trabajo. Quien lo quiera usar en otro colegio debe cambiar, como mínimo:

1. **Firebase:** crear su propio proyecto y reemplazar `firebaseConfig` en `firebase.js`. Nunca debe conectarse al proyecto original (lo prohíbe la [licencia](LICENSE)). También puede cambiar `AUTH_DOMAIN`, el dominio interno que arma los correos de acceso.
2. **Identidad:** reemplazar el escudo (`assets/escudo.png` y su texto alternativo en `index.html`), los íconos de `assets/`, y el nombre, descripción y colores de `manifest.json`.
3. **Datos del colegio:** adaptar `constants.js` (materias, cursos, grupos o menciones técnicas y comisiones) a su realidad.
4. **Service worker:** cambiar el nombre de `CACHE_VERSION` en `sw.js`.
5. **Reglas:** publicar `firestore.rules` en su propio Firestore y crear su primera cuenta de dirección como se explica arriba.

> Si publicas el repositorio, tu `firebaseConfig` queda visible. No es un secreto, pero restringe la llave de API a tu dominio y considera activar _App Check_, para que nadie use tu proyecto para crear cuentas de prueba o gastar tu cuota.

### Al actualizar la app

- Sube **todos** los archivos modificados en el mismo despliegue. Si `index.html` y los `.js` quedan de versiones distintas, la app puede cargar a medias (por ejemplo, el botón de ingresar no responde).
- Cada vez que cambien archivos, sube el número de `CACHE_VERSION` en `sw.js` para que los teléfonos descarten la copia vieja. Si algo no se actualiza en un celular, cierra la app o borra los datos del sitio.
- Si algo falla al cargar, la app muestra un cartel rojo al pie con el mensaje de error; sirve para diagnosticar desde el celular.

### Buenas prácticas

- **No subas datos reales de estudiantes** (CSV con nombres, teléfonos o filiación). Están excluidos en `.gitignore`.
- Restringe la llave de API de Firebase a tu dominio en Google Cloud Console → Credenciales.

## Pruebas

Se hicieron pruebas de campo con docentes de la unidad educativa y con nuestro tutor, y un taller de capacitación para mostrar el uso de la app.

## Limitaciones conocidas

- La asistencia se guarda por curso, día y docente, sin la materia: si un docente da dos materias en el mismo curso el mismo día, la segunda toma de asistencia reemplazaría a la primera.
- Un pedido de informe sigue apareciendo en los pendientes del docente aunque ya lo haya respondido, mientras el asesor no lo cierre.
- El formulario de informe no precarga las faltas ni las notas bajas que ya están en el sistema; el docente las escribe.
- El CSV de informes no incluye un encabezado con el nombre del curso (va en el nombre del archivo). Al abrirlo en Excel, impórtalo como UTF-8 si las tildes se ven mal.
- Los reportes creados antes de asignar un asesor al curso no le llegan a ese asesor.

## Próximos pasos

- Notificaciones automáticas a **padres de familia** cuando un estudiante falta.
- Notificaciones _push_ en el celular con la app cerrada.
- Videotutoriales cortos dentro de la plataforma para capacitar a docentes nuevos.
- Precargar en el informe del asesor las faltas y notas bajas ya registradas, y marcar como respondido lo que el docente ya envió.
- Prueba piloto con la dirección y secretaría, y evaluación continua del sistema.

---

## Equipo

- **Yuuta Shoji** — desarrollo
- **Gianna Lizbeth Cuellar Montenegro** — desarrollo
- **Lic. Robert Snaeder Cahuaya Ulo** — docente guía

Agradecemos a nuestros profesores, a los docentes que probaron la plataforma y a nuestras familias.

## Licencia

**Licencia de uso no comercial.** EduGest se desarrolló como trabajo final de defensa de grado y se puede usar, copiar y modificar libremente **sin fines de lucro**, manteniendo los créditos del autor. El código y su autoría pertenecen a su titular, y cualquier uso comercial requiere autorización escrita. La licencia cubre el código, no el nombre ni el escudo de la unidad educativa ni el proyecto de Firebase original. Ver el archivo [`LICENSE`](LICENSE).

© 2026 Yuuta Shoji.
