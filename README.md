# Nexora - Free Bootstrap 5 & HTML SaaS Business Website Template

#### Preview

 - [Demo](https://themewagon.github.io/nexora/)

#### Download
 - [Download from ThemeWagon](https://themewagon.com/themes/nexora/)

## Getting Started

1. Clone Repository
```
git clone https://github.com/themewagon/nexora.git
```

## Author 
```
Design and code is completely written by Harshad Mahadik and development team. 
```

## License

 - Design and Code is Copyright &copy; <a href="https://github.com/HarshadMahadik" target="_blank">Harshad Mahadik</a>
 - Licensed cover under [MIT]
 - Distributed by <a href="https://themewagon.com" target="_blank">ThemeWagon</a>

## Ofertas de empleo en Cloudflare Workers

El sitio conserva sus páginas HTML estáticas. `worker.mjs` renderiza en el servidor las rutas `/empleos`, `/empleos/:slug`, `/sitemap.xml` y `/robots.txt`, consultando `public.canales_publicaciones`.

La clave privada `SUPABASE_SERVICE_ROLE_KEY` se usa únicamente en el Worker (nunca se envía al navegador). Esta opción omite RLS; limita el Worker a sus lecturas actuales y rota cualquier clave de servicio que se haya compartido:

```powershell
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

Para desarrollo local:

```powershell
pnpm install
pnpm start
```

Abre `http://127.0.0.1:8787/empleos`. El archivo local `.dev.vars` (excluido de Git) contiene `SUPABASE_URL`, `SITE_URL` y el campo `SUPABASE_SERVICE_ROLE_KEY`. Pega allí una clave nueva ya rotada; no la compartas por el chat ni la guardes en `wrangler.jsonc`.

Google Tag Manager (`GTM-WML4WJG8`) está instalado en todas las páginas estáticas y en las páginas generadas por el Worker (script en `<head>` y `<noscript>` tras `<body>`). En el detalle de cada vacante se envían a `dataLayer` los eventos `view_vacancy` y `vacancy_whatsapp_click` (botón "Crear mi hoja de vida"), junto con GA4. Si el contenedor GTM ya incluye GA4, quita el snippet directo de `gtag.js` para no contar páginas dos veces.

La portada muestra hasta 12 vacantes recientes y `/empleos` hasta 50 por página. El listado permite filtrar por cargo o palabra clave, ciudad y rango de fechas de publicación. El botón de WhatsApp, con un mensaje precargado para solicitar ayuda con la hoja de vida, aparece solo en el detalle individual de cada vacante.

Las vacantes se muestran máximo 15 días y solo si tienen imagen; si la imagen pública falla al cargar, `main.js` oculta la tarjeta o el detalle de inmediato. Un cron diario (08:00 hora de Colombia, `0 13 * * *` UTC) cruza la tabla con el almacenamiento de imágenes: elimina las vacantes antiguas, las que no tienen `imagen_url` y las cuya imagen devuelve 404/410. Cada eliminación se registra en los logs con su ID y motivo (`npx wrangler tail`). El cron solo actúa si `SUPABASE_SERVICE_ROLE_KEY` es una clave de servicio válida; sin ella omite la limpieza. Errores temporales de red o respuestas 5xx no eliminan vacantes.

`SUPABASE_URL` y `SITE_URL` de producción están en `wrangler.jsonc`. Las rutas de Cloudflare apuntan al dominio canónico `grupoavitar.com`; el despliegue requiere acceso a la zona correspondiente. Si se usa solo la clave pública anon, Supabase debe permitir la lectura mediante RLS.
