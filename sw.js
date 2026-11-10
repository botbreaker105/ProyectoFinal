/* =========================================================================
   SERVICE WORKER — habilita "Instalar app" / "Agregar a pantalla de inicio"
   y un mínimo de uso sin conexión para la app shell (HTML/CSS/JS/íconos).

   IMPORTANTE: sube este archivo de nuevo cada vez que cambien nombres de
   archivo del proyecto (agregar/quitar un .js), y sube esto CON el resto
   de los archivos actualizados en el mismo despliegue — este service
   worker NUNCA cachea Firebase/Firestore ni fuentes externas, así que los
   datos siempre son en vivo; solo el "cascarón" de la app se guarda.

   Si alguna vez ves que los cambios no se reflejan para los docentes,
   sube el número de CACHE_VERSION — eso fuerza a borrar la caché vieja.
   ========================================================================= */
const CACHE_VERSION = "edugest-v4";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./main.js",
  "./home.js",
  "./reportes.js",
  "./notas.js",
  "./horarios.js",
  "./admin-cursos.js",
  "./csv-asistencia.js",
  "./filiacion.js",
  "./comisiones.js",
  "./notificaciones.js",
  "./dropdown.js",
  "./actividad.js",
  "./registro-docente.js",
  "./firebase.js",
  "./state.js",
  "./utils.js",
  "./constants.js",
  "./assets/escudo.png",
  "./assets/icon-96.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/favicon-32.png",
  "./assets/favicon-16.png",
  "./assets/favicon.ico",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.warn("Precache falló (no es grave):", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Red primero (para que las actualizaciones se vean apenas hay internet);
// si falla por estar sin conexión, se sirve lo último guardado en caché.
// Todo lo que no sea del mismo origen (Firebase, Google Fonts, gstatic)
// se deja pasar directo a la red, sin interceptar ni cachear.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copia = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copia));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});