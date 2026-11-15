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

El sitio conserva sus páginas HTML estáticas. `worker.mjs` renderiza en el servidor las rutas `/empleos`, `/empleos/:slug`, `/sitemap.xml` y `/robots.txt`, consultando en modo de solo lectura `public.canales_publicaciones`.

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

La portada muestra hasta 12 vacantes recientes y `/empleos` hasta 50 por página. El listado permite filtrar por cargo o palabra clave, ciudad y rango de fechas de publicación. El botón de WhatsApp, con un mensaje precargado para solicitar ayuda con la hoja de vida, aparece solo en el detalle individual de cada vacante.

`SUPABASE_URL` y `SITE_URL` de producción están en `wrangler.jsonc`. Las rutas de Cloudflare apuntan al dominio canónico `grupoavitar.com`; el despliegue requiere acceso a la zona correspondiente. Si se usa solo la clave pública anon, Supabase debe permitir la lectura mediante RLS.
