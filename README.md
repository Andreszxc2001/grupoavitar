# Grupo Avitar — portal de empleos

Sitio estático Bootstrap 5.3.3 con dos Cloudflare Workers. El sitio es un portal informativo: las vacantes provienen de canales externos, se procesan con OCR/IA y se muestran como máximo 15 días.

## Arquitectura de dos Workers

| Worker | Archivo | Responsabilidad | Secretos |
| --- | --- | --- | --- |
| `grupoavitar-empleos` | `worker.mjs` (config `wrangler.jsonc`) | Home, `/empleos`, detalle, ciudades, sitemap y robots | Solo `SUPABASE_ANON_KEY` (JWT `anon` o clave `sb_publishable_...`). **Nunca** claves de servicio. |
| `grupoavitar-limpieza` | `cleanup/index.mjs` (config `cleanup/wrangler.jsonc`) | Cron diario `0 13 * * *` (08:00 Colombia) que retira vacantes vencidas, sin imagen o con imagen 404/410 | `SUPABASE_SERVICE_ROLE_KEY` (JWT `service_role`) o `SUPABASE_SECRET_KEY` (`sb_secret_...`). Se configura como secreto del Worker de limpieza. |

El Worker público responde 503 si detecta `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_SECRET_KEY` en su entorno; el mensaje es genérico y el log no incluye claves. La clave anon `sb_publishable_...` envía únicamente el header `apikey`; los JWT `anon` envían `apikey` y `Authorization: Bearer`.

Para publicar, el dueño configura los secretos con `wrangler secret put` **en el Worker de limpieza** y despliega ambos Workers por separado. No hay secretos en `wrangler.jsonc`, `_headers` ni archivos versionados.

## Consultas y caché

El Worker público hace una sola consulta a `canales_publicaciones` por minuto, con `limit=1000` y el corte de 15 días calculado sobre el minuto exacto. La respuesta se guarda en `caches.default` y la reutilizan home, listado, detalle y sitemap. Los filtros de búsqueda, ciudad y fecha se aplican en el Worker sobre esa respuesta; no se envían condiciones `or` a Supabase.

Si Supabase falla, el Worker usa la caché de los 10 minutos anteriores y registra una advertencia genérica. Agotado ese margen, responde 503 con un mensaje que no revela detalles internos.

## Limpieza segura

- `CLEANUP_DRY_RUN` está en `"true"` por defecto: el cron solo registra ID y motivo de lo que borraría. Para ejecutar borrados reales, el dueño debe cambiar esa variable de forma explícita y deliberada.
- `CLEANUP_MAX_DELETES=200` limita cada ejecución. Si hay más candidatos, se aborta sin borrar y se registra el error.
- "Sin imagen" significa únicamente `imagen_url` vacía o nula. Una URL de otro host se registra como advertencia y no se borra. Solo 404/410 de la imagen autorizan el borrado; timeouts y 5xx nunca.
- Las filas antiguas se paginan hasta agotarlas, con un tope de 50 páginas por ejecución como medida anti abuso.
- Cada borrado (o simulación) se registra con ID y motivo; se pueden consultar con `wrangler tail`.

## Cabeceras y CSP

Todas las respuestas HTML y de texto del Worker y los estáticos incluyen CSP, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin`. HSTS se configura en Cloudflare, no en código.

La CSP se deriva de `env.SUPABASE_URL` para `img-src`. En el Worker público, la constante `CSP_MODE` de `worker.mjs` está en `enforce`; si una integración legítima falla, cámbiala temporalmente a `report-only` (el header pasa a `Content-Security-Policy-Report-Only`), revisa los reportes y vuelve a `enforce`. El archivo `_headers` replica la CSP para activos estáticos con el host de Supabase de producción; actualízalo si cambia el proyecto de Supabase. `_headers` no está excluido en `.assetsignore`.

## Dependencias e iconos

Bootstrap CSS 5.3.3, Bootstrap JS 5.3.3 y Bootstrap Icons 1.11.3 se cargan desde jsDelivr con versión fija, `integrity` SHA-384 calculado sobre los archivos reales y `crossorigin="anonymous"`. Los hashes se generaron con `curl` y `sha384` sobre los archivos descargados. Bootstrap Icons es la única librería de iconos; se eliminó el kit de FontAwesome.

Equivalencias usadas:

| FontAwesome | Bootstrap Icons |
| --- | --- |
| `fa-x-twitter` | `bi-twitter-x` |
| `fa-linkedin-in` | `bi-linkedin` |
| `fa-facebook-f` | `bi-facebook` |
| `fa-instagram` | `bi-instagram` |
| `fa-whatsapp` | `bi-whatsapp` |
| `fa-arrow-right` / `fa-arrow-left` | `bi-arrow-right` / `bi-arrow-left` |
| `fa-briefcase` | `bi-briefcase` |
| `fa-magnifying-glass` | `bi-search` |
| `fa-bolt` | `bi-lightning-charge` |
| `fa-arrow-up-right-from-square` | `bi-box-arrow-up-right` |
| `fa-building` | `bi-building` |
| `fa-location-dot` | `bi-geo-alt` |
| `fa-money-bill-wave` | `bi-cash-coin` |
| `fa-file-contract` | `bi-file-earmark-text` |
| `fa-address-book` | `bi-person-vcard` |
| `fa-calendar-days` | `bi-calendar3` |
| `fa-bullhorn` | `bi-megaphone` |

CSS y JS locales se sirven con query string de versión (`?v=20261121`) para permitir `Cache-Control` largo en `/assets/*`. Los estilos del portal de empleos viven en `assets/css/jobs.css`; el Worker los enlaza en lugar de incrustar un bloque `<style>`.

## SEO de las páginas estáticas

Las 17 páginas tienen título único, descripción, Open Graph y canonical absoluto sin extensión (`https://grupoavitar.com/about`, no `/about.html`). Los enlaces internos también usan rutas limpias y el JS marca el enlace activo comparando la ruta sin extensión. Las dos imágenes de Unsplash se reemplazaron por `/assets/img/profile-img.jpg`, con `width`, `height`, `loading="lazy"` y `decoding="async"`.

`wrangler.jsonc` mantiene `workers_dev: false` para publicar solo por las rutas configuradas en `grupoavitar.com`.

## Desarrollo y pruebas

```powershell
pnpm install
pnpm start
node --test tests/worker.test.mjs
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --config cleanup/wrangler.jsonc
```

Abre `http://127.0.0.1:8787/empleos`. El archivo local `.dev.vars` (excluido de Git) contiene `SUPABASE_URL`, `SITE_URL` y `SUPABASE_ANON_KEY` para el Worker público. No pegues claves de servicio allí: la guardia de seguridad bloquearía el Worker.
