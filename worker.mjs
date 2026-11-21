const PAGE_SIZE = 50;
const QUERY_BATCH_SIZE = 100;
const MAX_QUERY_ROWS = 1000;
const FEATURED_LIMIT = 12;
const PUBLICATION_DAYS = 20;
const EMPLOYMENT_PLACEHOLDER_IMAGE = "/assets/img/empleo-placeholder.svg";
const NOT_AVAILABLE = "No disponible";
const VACANCY_JSON_KEYS = [
  "cargo",
  "titulo",
  "empresa",
  "contacto",
  "requisitos",
  "descripcion",
  "tipo_contrato",
];
const EMPLOYMENT_TYPE_MAP = {
  "tiempo completo": "FULL_TIME",
  indefinido: "FULL_TIME",
  "contrato indefinido": "FULL_TIME",
  "contrato temporal": "TEMPORARY",
  temporal: "TEMPORARY",
  "medio tiempo": "PART_TIME",
  "part time": "PART_TIME",
  pasantia: "INTERN",
  practicas: "INTERN",
};
const WHATSAPP_PHONE = "573019441676";
const FEATURED_JOBS_MARKER = "<!-- FEATURED_JOBS -->";
const HOME_SEO_MARKER = "<!-- HOME_SEO -->";
const PUBLICATION_FIELDS = [
  "id",
  "canal_nombre",
  "canal_url",
  "fecha_publicacion",
  "tipo",
  "imagen_url",
  "texto_ocr",
  "texto_ia",
  "metadata",
].join(",");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnavailable(value) {
  return !text(value) || normalize(value) === normalize(NOT_AVAILABLE);
}

function displayValue(value, fallback = NOT_AVAILABLE) {
  if (Array.isArray(value)) {
    const items = value.map((item) => displayValue(item, "")).filter(Boolean);
    return items.length ? items.join(", ") : fallback;
  }
  if (isPlainObject(value)) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const valueText = text(value);
  return isUnavailable(valueText) ? fallback : valueText.slice(0, 2000);
}

function parseJsonObject(value) {
  const raw = text(value);
  if (!raw) return null;
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const braced = raw.match(/\{[\s\S]*\}/);
  if (braced?.[0]) candidates.push(braced[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function hasVacancyKeys(value) {
  return isPlainObject(value) && VACANCY_JSON_KEYS.some((key) => key in value);
}

function vacancyJsonFromSources(...sources) {
  for (const source of sources) {
    if (isPlainObject(source)) {
      const nested = [source.vacancy, source.vacante, source.json, source.datos];
      for (const candidate of [source, ...nested]) {
        if (hasVacancyKeys(candidate)) return candidate;
      }
      continue;
    }
    const parsed = parseJsonObject(source);
    if (hasVacancyKeys(parsed)) return parsed;
  }
  return null;
}

function jsonList(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
    ? value.split(/\r?\n|,/)
    : [];
  const cleaned = items.map((item) => displayValue(item, "")).filter(Boolean);
  return cleaned.length ? cleaned : [NOT_AVAILABLE];
}

function contactHref(contact) {
  if (!isPlainObject(contact)) return "";
  const link = displayValue(contact.link, "");
  if (link) {
    const safeLink = safeExternalUrl(link);
    if (safeLink) return safeLink;
  }
  const email = displayValue(contact.correo, "");
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `mailto:${email}`;
  const phone = displayValue(contact.telefono, "");
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 7) return `tel:${digits}`;
  }
  return "";
}

function contactLabel(contact) {
  if (!isPlainObject(contact)) return NOT_AVAILABLE;
  const phone = displayValue(contact.telefono, "");
  if (phone) return phone;
  const email = displayValue(contact.correo, "");
  if (email) return email;
  const link = displayValue(contact.link, "");
  if (link && safeExternalUrl(link)) return "Enlace de contacto";
  return NOT_AVAILABLE;
}

function normalize(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function escapeXml(value) {
  return escapeHtml(value);
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "");
}

function resolveImageUrl(imageUrl, supabaseUrl) {
  const value = text(imageUrl);
  if (!value) return "";
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https:\/\//i.test(value)) {
    return "";
  }
  try {
    const base = new URL(supabaseUrl);
    if (/^https?:\/\//i.test(value)) {
      const parsed = new URL(value);
      return parsed.protocol === "https:" ? parsed.href : "";
    }
    if (value.startsWith("/")) {
      const parsed = new URL(value, base);
      return parsed.protocol === "https:" ? parsed.href : "";
    }
    const objectPath = value.replace(/^imagenes_posts\//, "");
    return new URL(
      `/storage/v1/object/public/imagenes_posts/${objectPath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      base,
    ).href;
  } catch {
    return "";
  }
}

function vacancyWhatsAppUrl(vacancy) {
  const message = `Hola, vi la vacante "${vacancy.title}" en Grupo Avitar y quiero ayuda para crear una hoja de vida enfocada en esta oportunidad.`;
  return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}

function safeExternalUrl(value) {
  const url = text(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function isVacancy(publication) {
  return Boolean(
    vacancyJsonFromSources(publication.texto_ia, publication.texto_ocr, publication.metadata),
  );
}

function publicationToVacancy(publication, supabaseUrl) {
  const structured = vacancyJsonFromSources(
    publication.texto_ia,
    publication.texto_ocr,
    publication.metadata,
  );
  if (!structured) return null;

  const date = new Date(publication.fecha_publicacion);
  const id = text(publication.id);
  if (!id || Number.isNaN(date.getTime())) return null;

  const title = displayValue(
    structured.titulo,
    displayValue(structured.cargo, NOT_AVAILABLE),
  );
  const company = displayValue(structured.empresa);
  const location = displayValue(structured.ubicacion);
  const slugBase = isUnavailable(title)
    ? isUnavailable(company)
      ? "oferta-laboral"
      : company
    : `${title} ${location}`;
  const contact = isPlainObject(structured.contacto) ? structured.contacto : {};
  const description = displayValue(structured.descripcion);

  return {
    id,
    slug: `${slugify(slugBase) || "oferta-laboral"}-${id.slice(0, 8)}`,
    title,
    company,
    location,
    salary: displayValue(structured.salario),
    contractType: displayValue(structured.tipo_contrato),
    description,
    requirements: jsonList(structured.requisitos),
    contactLink: displayValue(contact.link),
    contactEmail: displayValue(contact.correo),
    contactPhone: displayValue(contact.telefono),
    contactUrl: contactHref(contact),
    contactLabel: contactLabel(contact),
    aiText: description,
    publishedAt: date.toISOString(),
    imageUrl: resolveImageUrl(publication.imagen_url, supabaseUrl),
    channelName: text(publication.canal_nombre),
    channelUrl: safeExternalUrl(publication.canal_url),
    duplicateKey: normalize(JSON.stringify(structured))
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim(),
  };
}

function activeVacancies(publications, supabaseUrl, now = new Date()) {
  const expiryBoundary = now.getTime() - PUBLICATION_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set();
  const vacancies = [];
  const recentFirst = [...publications].sort(
    (left, right) =>
      Date.parse(right.fecha_publicacion) - Date.parse(left.fecha_publicacion),
  );
  for (const publication of recentFirst) {
    const publishedAt = new Date(publication.fecha_publicacion).getTime();
    if (
      !Number.isFinite(publishedAt) ||
      publishedAt > now.getTime() ||
      publishedAt <= expiryBoundary ||
      !isVacancy(publication)
    ) {
      continue;
    }
    const vacancy = publicationToVacancy(publication, supabaseUrl);
    if (!vacancy || seen.has(vacancy.duplicateKey)) continue;
    seen.add(vacancy.duplicateKey);
    vacancies.push(vacancy);
  }
  return vacancies;
}

function queryWords(value) {
  return normalize(value)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((word) => word.slice(0, 4));
}

function dateFilterIso(value, endOfDay = false) {
  return `${value}T${endOfDay ? "04:59:59.999" : "05:00:00.000"}Z`;
}

function publicationQueryUrl(env, now, options = {}) {
  const {
    searchTerm = "",
    cityTerm = "",
    startDate = "",
    endDate = "",
    limit = QUERY_BATCH_SIZE,
    offset = 0,
  } = options;
  const cutoff = new Date(
    now.getTime() - PUBLICATION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const url = new URL("/rest/v1/canales_publicaciones", env.SUPABASE_URL);
  url.searchParams.set("select", PUBLICATION_FIELDS);
  url.searchParams.set("fecha_publicacion", `gte.${cutoff}`);
  url.searchParams.set("order", "fecha_publicacion.desc");
  url.searchParams.set("limit", String(limit));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  if (startDate) {
    url.searchParams.append("fecha_publicacion", `gte.${dateFilterIso(startDate)}`);
  }
  if (endDate) {
    url.searchParams.append("fecha_publicacion", `lte.${dateFilterIso(endDate, true)}`);
  }
  const contentFields = [
    "texto_ocr",
    "canal_nombre",
    "texto_ia->>titulo",
    "texto_ia->>cargo",
    "texto_ia->>empresa",
    "texto_ia->>salario",
    "texto_ia->>ubicacion",
    "texto_ia->>descripcion",
    "texto_ia->>tipo_contrato",
    "texto_ia->>requisitos",
    "texto_ia->contacto->>link",
    "texto_ia->contacto->>correo",
    "texto_ia->contacto->>telefono",
  ];
  for (const word of queryWords(searchTerm)) {
    const pattern = `*${word}*`;
    url.searchParams.append(
      "or",
      `(${contentFields.map((field) => `${field}.ilike.${pattern}`).join(",")})`,
    );
  }
  const cityFields = [
    "metadata->>ciudad",
    "metadata->>city",
    "metadata->>ubicacion",
    "metadata->>location",
    "texto_ia->>ubicacion",
    "texto_ocr",
  ];
  for (const word of queryWords(cityTerm)) {
    const pattern = `*${word}*`;
    url.searchParams.append(
      "or",
      `(${cityFields.map((field) => `${field}.ilike.${pattern}`).join(",")})`,
    );
  }
  return url;
}

async function fetchPublicationRows(env, now, options, url = publicationQueryUrl(env, now, options)) {
  const apiKey = supabaseReadKey(env);
  if (!apiKey) throw new Error("No hay una clave válida de solo lectura configurada.");
  const response = await fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (response.status === 416) return [];
  if (!response.ok) {
    console.error("Supabase publication read failed", response.status);
    throw new Error("No fue posible consultar las publicaciones.");
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Respuesta inválida de Supabase.");
  return rows;
}

async function getPublicationRows(env, now, options = {}) {
  const url = publicationQueryUrl(env, now, options);
  const minute = Math.floor(now.getTime() / 60000);
  const accessMode = env.SUPABASE_SERVICE_ROLE_KEY ? "service-role" : "anon";
  const cacheKey = new Request(
    `${env.SITE_URL}/__cache/publicaciones-laborales/${accessMode}/${minute}${url.pathname}${url.search}`,
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const rows = await fetchPublicationRows(env, now, options, url);
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(rows), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    }),
  );
  return rows;
}

async function getVacancies(env, now, options = {}, maxVacancies = PAGE_SIZE) {
  const rows = [];
  let vacancies = [];
  let offset = 0;
  while (offset < MAX_QUERY_ROWS && vacancies.length < maxVacancies) {
    const limit = Math.min(QUERY_BATCH_SIZE, MAX_QUERY_ROWS - offset);
    const page = await getPublicationRows(env, now, { ...options, limit, offset });
    rows.push(...page);
    vacancies = activeVacancies(rows, env.SUPABASE_URL, now);
    if (page.length < limit) break;
    offset += limit;
  }
  return vacancies.slice(0, maxVacancies);
}

function responseHeaders(contentType, extra = {}) {
  return {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...extra,
  };
}

function htmlResponse(request, html, status = 200, extraHeaders = {}) {
  return new Response(request.method === "HEAD" ? null : html, {
    status,
    headers: responseHeaders("text/html; charset=utf-8", {
      "Cache-Control": "public, max-age=60, s-maxage=60",
      ...extraHeaders,
    }),
  });
}

function layout({ title, description, canonical, image, body, robots = "index,follow", structuredData = "", analyticsData = null }) {
  const socialImage = image || "";
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  ${structuredData}
  <link rel="apple-touch-icon" sizes="57x57" href="/assets/favicon/apple-icon-57x57.png">
  <link rel="apple-touch-icon" sizes="60x60" href="/assets/favicon/apple-icon-60x60.png">
  <link rel="apple-touch-icon" sizes="72x72" href="/assets/favicon/apple-icon-72x72.png">
  <link rel="apple-touch-icon" sizes="76x76" href="/assets/favicon/apple-icon-76x76.png">
  <link rel="apple-touch-icon" sizes="114x114" href="/assets/favicon/apple-icon-114x114.png">
  <link rel="apple-touch-icon" sizes="120x120" href="/assets/favicon/apple-icon-120x120.png">
  <link rel="apple-touch-icon" sizes="144x144" href="/assets/favicon/apple-icon-144x144.png">
  <link rel="apple-touch-icon" sizes="152x152" href="/assets/favicon/apple-icon-152x152.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/favicon/apple-icon-180x180.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon/android-icon-192x192.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon/favicon-96x96.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon/favicon-16x16.png">
  <link rel="shortcut icon" href="/assets/favicon/favicon.ico">
  <meta name="msapplication-TileColor" content="#004AAD">
  <meta name="theme-color" content="#004AAD">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-29YCBD5TL9"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-29YCBD5TL9');
  </script>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Grupo Avitar">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  ${socialImage ? `<meta property="og:image" content="${escapeHtml(socialImage)}">` : ""}
  <meta name="twitter:card" content="${socialImage ? "summary_large_image" : "summary"}">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  ${socialImage ? `<meta name="twitter:image" content="${escapeHtml(socialImage)}">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="/assets/css/custom.css" rel="stylesheet">
  <style>
    .jobs-page { min-height: 65vh; }
    .jobs-hero { position: relative; overflow: hidden; padding: 8.5rem 0 4.5rem; background: linear-gradient(125deg, #081a40 0%, #0a1f4d 55%, #145bc2 100%); color: #fff; }
    .jobs-hero::before, .jobs-hero::after { position: absolute; content: ""; border-radius: 50%; pointer-events: none; }
    .jobs-hero::before { width: 420px; height: 420px; right: -120px; top: -240px; background: rgba(91, 157, 255, .22); }
    .jobs-hero::after { width: 280px; height: 280px; right: 24%; bottom: -240px; background: rgba(91, 157, 255, .12); }
    .jobs-hero .container { position: relative; z-index: 1; }
    .jobs-kicker { display: inline-flex; align-items: center; gap: .55rem; margin-bottom: 1.1rem; color: #dce9ff; font-size: .78rem; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
    .jobs-kicker::before { width: 8px; height: 8px; border-radius: 50%; background: #64d9a1; content: ""; }
    .jobs-hero h1 { max-width: 700px; margin: 0 0 1rem; color: #fff; font-size: clamp(1.9rem, 3.2vw, 2.5rem); line-height: 1.2; }
    .jobs-hero-copy > p { max-width: 610px; margin-bottom: 1.7rem; color: rgba(255,255,255,.8); font-size: 1.08rem; }
    .jobs-hero-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.5rem; }
    .jobs-hero-count { display: flex; align-items: center; gap: .7rem; }
    .jobs-hero-count strong { color: #fff; font-family: var(--n-font-display); font-size: 1.8rem; line-height: 1; }
    .jobs-hero-count span, .jobs-validity { color: rgba(255,255,255,.8); font-size: .92rem; }
    .jobs-validity { padding-left: 1.3rem; border-left: 1px solid rgba(255,255,255,.28); }
    .jobs-hero-art { display: flex; justify-content: center; padding: 1rem; }
    .jobs-hero-card { width: min(100%, 350px); padding: 1.6rem; border: 1px solid rgba(255,255,255,.65); border-radius: 22px; background: rgba(255,255,255,.96); box-shadow: 0 24px 60px rgba(0,0,0,.2); transform: rotate(2deg); }
    .jobs-art-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.4rem; color: var(--n-slate); font-size: .8rem; font-weight: 600; }
    .jobs-art-status { padding: .35rem .65rem; border-radius: 99px; background: #e7f9f0; color: #12804f; }
    .jobs-art-icon { display: grid; width: 52px; height: 52px; margin-bottom: 1rem; place-items: center; border-radius: 15px; background: #e9f0fb; color: var(--n-primary); font-size: 1.25rem; font-weight: 800; }
    .jobs-hero-card h2 { margin-bottom: .6rem; font-size: 1.3rem; }
    .jobs-hero-card p { margin: 0; color: var(--n-slate); font-size: .92rem; }
    .jobs-content { padding: clamp(2.5rem, 5vw, 4.5rem) 0; }
    .jobs-section-head { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.75rem; }
    .jobs-section-head .eyebrow { margin-bottom: .7rem; }
    .jobs-section-head h2 { margin-bottom: .35rem; font-size: clamp(1.4rem, 2vw, 1.9rem); }
    .jobs-section-head p { margin: 0; }
    .jobs-result-count { flex: 0 0 auto; padding: .65rem 1rem; border: 1px solid var(--n-border); border-radius: 99px; background: #fff; color: var(--n-navy); font-size: .9rem; font-weight: 700; }
    .jobs-search { display: grid; grid-template-columns: minmax(220px, 1.8fr) minmax(150px, 1fr) repeat(2, minmax(145px, .8fr)) auto; gap: .85rem; align-items: end; margin-bottom: 1.75rem; padding: 1.2rem; border: 1px solid var(--n-border); border-radius: 16px; background: #fff; box-shadow: var(--n-shadow-sm); }
    .jobs-search-field label { display: block; margin-bottom: .4rem; color: var(--n-navy); font-size: .82rem; font-weight: 700; }
    .jobs-search .form-control { min-height: 46px; border-color: var(--n-border); border-radius: 10px; }
    .jobs-search-actions { display: flex; gap: .5rem; }
    .jobs-search-actions .btn { min-height: 46px; white-space: nowrap; }
    .jobs-nav { background: rgba(255,255,255,.96); box-shadow: var(--n-shadow-sm); }
    .jobs-card { display: flex; height: 100%; flex-direction: column; overflow: hidden; padding: 0; border: 1px solid var(--n-border); border-radius: 18px; background: #fff; box-shadow: var(--n-shadow-sm); transition: transform .2s ease, box-shadow .2s ease; }
    .jobs-card:hover { transform: translateY(-4px); box-shadow: var(--n-shadow-md); }
    .jobs-card-media { display: grid; aspect-ratio: 16 / 9; overflow: hidden; place-items: center; border-bottom: 1px solid var(--n-border); background: #f3f6fb; }
    .jobs-card img { width: 100%; height: 100%; object-fit: contain; }
    .jobs-card-body { display: flex; height: 100%; flex-direction: column; padding: 1.4rem; }
    .jobs-card-label { align-self: flex-start; margin-bottom: .75rem; padding: .35rem .7rem; border-radius: 99px; background: #e9f0fb; color: var(--n-primary); font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .jobs-card-title { margin-bottom: .9rem; color: var(--n-navy); font-size: 1.15rem; line-height: 1.4; }
    .jobs-card-facts { display: flex; flex-wrap: wrap; gap: .5rem 1rem; margin: 0 0 1rem; padding: 0; color: var(--n-slate); font-size: .84rem; list-style: none; }
    .jobs-card-salary { margin: 0 0 .85rem; color: var(--n-navy); font-weight: 700; }
    .jobs-card-description { display: -webkit-box; overflow: hidden; margin: 0 0 1.3rem; color: var(--n-slate); font-size: .92rem; line-height: 1.65; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
    .jobs-card-action { display: flex; justify-content: center; align-items: center; gap: .55rem; margin-top: auto; padding: .75rem 1rem; border: 0; border-radius: 10px; background: var(--n-primary); color: #fff; font-weight: 700; text-decoration: none; }
    .jobs-card-action:hover { background: var(--n-primary-dark); color: #fff; }
    .jobs-whatsapp-button { border-color: #1f9d55; background: #1f9d55; color: #fff; font-weight: 700; }
    .jobs-whatsapp-button:hover { border-color: #187c42; background: #187c42; color: #fff; }
    .jobs-detail-cta-copy { margin: 0; color: var(--n-slate); font-size: .88rem; line-height: 1.55; }
    .jobs-detail-page { background: #f7f9fc; }
    .jobs-detail-container { padding-top: 2rem; padding-bottom: 4rem; }
    .jobs-detail-breadcrumb { margin-bottom: 1.5rem; color: var(--n-slate); font-size: .9rem; }
    .jobs-detail-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, .72fr); gap: 1.5rem; align-items: start; }
    .jobs-detail-main, .jobs-detail-summary, .jobs-detail-note { border: 1px solid var(--n-border); border-radius: 20px; background: #fff; box-shadow: var(--n-shadow-sm); }
    .jobs-detail-header { padding: 2rem 2rem 1.25rem; }
    .jobs-detail-status { display: inline-flex; margin-bottom: 1rem; padding: .4rem .8rem; border-radius: 99px; background: #e7f9f0; color: #12804f; font-size: .76rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .jobs-detail-title { margin: 0 0 .8rem; color: var(--n-navy); font-size: clamp(1.6rem, 2.4vw, 2.1rem); line-height: 1.2; overflow-wrap: anywhere; }
    .jobs-detail-subtitle { margin: 0; color: var(--n-slate); }
    .jobs-detail-visual { padding: 0 2rem; }
    .jobs-detail-image { display: block; width: 100%; max-height: 600px; min-height: 250px; object-fit: contain; background: #f3f6fb; border: 1px solid var(--n-border); border-radius: 16px; }
    .jobs-detail-description { padding: 1.5rem 2rem 2rem; }
    .jobs-detail-description h2, .jobs-detail-summary h2 { margin-bottom: 1.1rem; color: var(--n-navy); font-size: 1.1rem; }
    .jobs-detail-copy { color: #39465d; font-size: 1rem; line-height: 1.8; white-space: pre-line; overflow-wrap: anywhere; }
    .jobs-detail-sidebar { display: grid; gap: 1rem; }
    .jobs-detail-summary { padding: 1.5rem; }
    .jobs-detail-facts { display: grid; gap: .8rem; margin: 0; }
    .jobs-detail-fact { padding-bottom: .8rem; border-bottom: 1px solid var(--n-border); }
    .jobs-detail-fact dt { margin-bottom: .2rem; color: var(--n-slate); font-size: .78rem; font-weight: 600; }
    .jobs-detail-fact dt i { margin-right: .3rem; color: var(--n-primary); }
    .jobs-detail-fact dd { margin: 0; color: var(--n-navy); font-weight: 700; overflow-wrap: anywhere; }
    .jobs-detail-source { display: grid; gap: .7rem; margin-top: 1.2rem; }
    .jobs-detail-source .btn { width: 100%; }
    .jobs-detail-note { padding: 1.2rem 1.4rem; background: var(--n-gradient-soft); }
    .jobs-detail-note strong { display: block; margin-bottom: .35rem; color: var(--n-navy); }
    .jobs-detail-note p { margin: 0; color: var(--n-slate); font-size: .9rem; }
    .jobs-pagination a[aria-current="page"] { color: #fff; background: var(--n-primary); }
    .jobs-pagination { flex-wrap: wrap; justify-content: flex-start !important; }
    @media (max-width: 991.98px) { .jobs-hero { padding-top: 2rem; } .jobs-search { grid-template-columns: repeat(2, minmax(0, 1fr)); } .jobs-detail-grid { grid-template-columns: 1fr; } .jobs-hero h1, .jobs-detail-title { font-size: 1.8rem; } .jobs-section-head h2 { font-size: 1.45rem; } .jobs-hero-count strong { font-size: 1.6rem; } }
    @media (max-width: 767.98px) { .jobs-hero { padding: 2rem 0 3rem; text-align: left; } .jobs-hero h1, .jobs-detail-title { font-size: 1.5rem; line-height: 1.25; } .jobs-hero-art { padding: 0; } .jobs-section-head { align-items: start; flex-direction: column; text-align: left; } .jobs-section-head h2 { font-size: 1.25rem; } .jobs-validity { padding-left: 0; border-left: 0; } .jobs-detail-container { padding-top: 1.5rem; padding-bottom: 2.5rem; } .jobs-detail-header { padding: 1rem 1rem .75rem; } .jobs-detail-visual { padding: 0 1rem; } .jobs-detail-description { padding: 1rem; } .jobs-detail-summary { padding: 1rem; } .jobs-detail-copy { font-size: .875rem; line-height: 1.65; } .jobs-detail-image { min-height: 180px; } .jobs-card-body { padding: 1rem; } .jobs-card-title { font-size: .95rem; } }
    @media (max-width: 575.98px) { .jobs-search { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-nexora fixed-top jobs-nav">
    <div class="container">
      <a class="navbar-brand navbar-brand-custom d-flex align-items-center" href="/">
        <img src="/assets/img/logo.png" alt="Grupo Avitar" style="height:44px;width:auto;">
      </a>
      <button class="navbar-toggler navbar-toggler-custom" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav" aria-controls="mainNav" aria-expanded="false" aria-label="Alternar navegación">
        <span class="bar"></span><span class="bar"></span><span class="bar"></span>
      </button>
      <div class="collapse navbar-collapse" id="mainNav">
        <ul class="navbar-nav ms-auto align-items-lg-center gap-1 mt-3 mt-lg-0">
          <li class="nav-item"><a class="nav-link nav2" href="/">Inicio</a></li>
          <li class="nav-item"><a class="nav-link nav2" href="/about.html">Nosotros</a></li>
          <li class="nav-item"><a class="nav-link nav2" href="/services.html">Servicios</a></li>
          <li class="nav-item"><a class="nav-link nav2 active" href="/empleos" aria-current="page">Empleos</a></li>
          <li class="nav-item"><a class="nav-link nav2" href="/contact.html">Contacto</a></li>
          <li class="nav-item ms-lg-2 mt-2 mt-lg-0">
            <a href="/contact.html" class="btn btn-primary btn-sm-custom w-100">Solicitar servicio</a>
          </li>
        </ul>
      </div>
    </div>
  </nav>
  ${body}
  <footer class="footer-nexora">
    <div class="container">
      <div class="row gy-4">
        <div class="col-lg-4 col-md-6">
          <a class="d-inline-block mb-3" href="/"><img src="/assets/img/logo1.png" alt="Grupo Avitar" style="height:48px;width:auto;"></a>
          <p class="text-white-50 mb-4" style="max-width:320px;">Servicio especializado en la elaboración, organización y optimización de documentos laborales y profesionales.</p>
          <div class="d-flex gap-2">
            <a href="#" class="social-icon" aria-label="X"><i class="fa-brands fa-x-twitter"></i></a>
            <a href="#" class="social-icon" aria-label="LinkedIn"><i class="fa-brands fa-linkedin-in"></i></a>
            <a href="#" class="social-icon" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a>
            <a href="#" class="social-icon" aria-label="Instagram"><i class="fa-brands fa-instagram"></i></a>
          </div>
        </div>
        <div class="col-lg-2 col-md-6 col-6">
          <h6>Empresa</h6>
          <a href="/about.html">Sobre nosotros</a>
          <a href="/services.html">Servicios</a>
          <a href="/empleos">Ofertas de empleo</a>
          <a href="/contact.html">Contacto</a>
        </div>
        <div class="col-lg-2 col-md-6 col-6">
          <h6>Servicios</h6>
          <a href="/servicio-ats.html">Hojas de Vida ATS</a>
          <a href="/servicio-hdv.html">Hojas de Vida Profesionales</a>
          <a href="/servicio-ctr.html">Cartas de Renuncia</a>
          <a href="/services.html#optimizacion">Optimización de Perfiles</a>
          <a href="/servicio-ctp.html">Catálogos e Infoproductos</a>
        </div>
        <div class="col-lg-4 col-md-6">
          <h6>Contáctanos</h6>
          <p class="text-white-50 mb-3">Escríbenos y cuéntanos qué necesitas. Nuestro equipo te orientará sobre el servicio que puede ayudarte.</p>
          <a href="https://wa.me/573019441676" target="_blank" rel="noopener" class="btn btn-primary"><i class="fa-brands fa-whatsapp me-1"></i> Escribir por WhatsApp</a>
        </div>
      </div>
      <div class="footer-bottom d-flex flex-column flex-md-row justify-content-between align-items-center gap-2 text-center text-md-start">
        <p class="mb-0">&copy; ${new Date().getFullYear()} Grupo Avitar. Todos los derechos reservados.</p>
        <div class="d-flex flex-wrap gap-4">
          <a href="/privacidad.html" class="mb-0">Política de Privacidad</a>
          <a href="/terminos.html" class="mb-0">Términos y Condiciones</a>
          <a href="/cookies.html" class="mb-0">Política de Cookies</a>
        </div>
      </div>
    </div>
  </footer>
  <script src="https://kit.fontawesome.com/3140323153.js" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="/assets/js/main.js"></script>
  ${analyticsData ? `<script>
    (function () {
      if (typeof gtag !== "function") return;
      var vacancy = ${serializeForScript(analyticsData)};
      gtag("event", "view_vacancy", vacancy);
      var cta = document.getElementById("vacancy-whatsapp-cta");
      if (cta) {
        cta.addEventListener("click", function () {
          gtag("event", "vacancy_whatsapp_click", vacancy);
        });
      }
    })();
  </script>` : ""}
</body>
</html>`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

function dateKeyInBogota(value) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const date = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${date.year}-${date.month}-${date.day}`;
}

function isValidDateFilter(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function jsonLd(schema) {
  return `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`;
}

function homeSeoJsonLd(siteUrl) {
  return jsonLd({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: "Grupo Avitar",
        url: siteUrl,
        logo: `${siteUrl}/assets/img/logo.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: "Grupo Avitar",
        inLanguage: "es",
        publisher: { "@id": `${siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${siteUrl}/empleos?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "WebPage",
        "@id": `${siteUrl}/#webpage`,
        url: siteUrl,
        name: "Grupo Avitar — Documentación Laboral y Profesional",
        isPartOf: { "@id": `${siteUrl}/#website` },
        about: { "@id": `${siteUrl}/#organization` },
        inLanguage: "es",
      },
    ],
  });
}

function itemListJsonLd(vacancies, siteUrl) {
  if (!vacancies.length) return "";
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: vacancies.map((vacancy, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: vacancy.title,
      url: `${siteUrl}/empleos/${vacancy.slug}`,
    })),
  });
}

function jobPostingJsonLd(vacancy, siteUrl) {
  if (
    isUnavailable(vacancy.title) ||
    isUnavailable(vacancy.description) ||
    isUnavailable(vacancy.company) ||
    isUnavailable(vacancy.location)
  ) {
    return "";
  }
  const description = [
    vacancy.description,
    isUnavailable(vacancy.requirements?.join(""))
      ? ""
      : `Requisitos: ${vacancy.requirements.join(", ")}`,
  ].filter(Boolean).join("<br><br>");
  const schema = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: vacancy.title,
    description,
    datePosted: vacancy.publishedAt,
    hiringOrganization: {
      "@type": "Organization",
      name: vacancy.company,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: vacancy.location,
      },
    },
    url: `${siteUrl}/empleos/${vacancy.slug}`,
  };
  const employmentType = EMPLOYMENT_TYPE_MAP[normalize(vacancy.contractType || "")];
  if (employmentType) schema.employmentType = employmentType;
  return jsonLd(schema);
}

function listingCard(vacancy, siteUrl) {
  const image = vacancy.imageUrl
    ? `<img src="${escapeHtml(vacancy.imageUrl)}" alt="${escapeHtml(vacancy.title)}" loading="lazy" decoding="async">`
    : `<img src="${EMPLOYMENT_PLACEHOLDER_IMAGE}" alt="Imagen ilustrativa de una oportunidad laboral" loading="lazy" decoding="async">`;
  const aiText = displayValue(vacancy.aiText, "");
  const description = aiText
    ? `<p class="jobs-card-description">${escapeHtml(aiText.slice(0, 320))}${aiText.length > 320 ? "…" : ""}</p>`
    : "";
  const requirements = vacancy.requirements?.length
    ? `<p class="jobs-card-description"><strong>Requisitos:</strong> ${escapeHtml(vacancy.requirements.join(", ").slice(0, 220))}</p>`
    : "";
  const facts = [
    `<li><strong>Empresa:</strong> ${escapeHtml(displayValue(vacancy.company))}</li>`,
    `<li><strong>Ubicación:</strong> ${escapeHtml(displayValue(vacancy.location))}</li>`,
    `<li><strong>Contrato:</strong> ${escapeHtml(displayValue(vacancy.contractType))}</li>`,
    `<li><strong>Contacto:</strong> ${escapeHtml(displayValue(vacancy.contactLabel))}</li>`,
    `<li><time datetime="${escapeHtml(vacancy.publishedAt)}">${escapeHtml(formatDate(vacancy.publishedAt))}</time></li>`,
  ].join("");
  return `<article class="col-md-6 col-xl-4">
    <div class="jobs-card">
      <div class="jobs-card-media">${image}</div>
      <div class="jobs-card-body">
        <span class="jobs-card-label">Vacante</span>
        <h3 class="jobs-card-title">${escapeHtml(vacancy.title)}</h3>
        <ul class="jobs-card-facts">${facts}</ul>
        <p class="jobs-card-salary">Salario: ${escapeHtml(displayValue(vacancy.salary))}</p>
        ${description}
        ${requirements}
        <a class="jobs-card-action btn btn-primary" href="${escapeHtml(`${siteUrl}/empleos/${vacancy.slug}`)}"><span>Ver detalle</span><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      </div>
    </div>
  </article>`;
}

function renderFeaturedJobs(vacancies, env) {
  const siteUrl = env.SITE_URL.replace(/\/+$/, "");
  const featured = vacancies.slice(0, FEATURED_LIMIT);
  const total = vacancies.length;
  const content = featured.length
    ? `<div class="row g-4">${featured.map((vacancy) => listingCard(vacancy, siteUrl)).join("")}</div>`
    : '<p class="card-premium">No hay vacantes vigentes para mostrar en este momento.</p>';
  return `<section class="section bg-soft home-jobs-section" aria-labelledby="home-jobs-title">
    ${itemListJsonLd(featured, siteUrl)}
    <div class="container">
      <div class="section-header">
        <span class="eyebrow">Oportunidades recientes</span>
        <h2 class="section-title" id="home-jobs-title">Vacantes disponibles</h2>
        <p class="section-subtitle">Explora empleos publicados recientemente y encuentra una oportunidad para ti.</p>
      </div>
      <div class="home-jobs-toolbar">
        <div class="home-jobs-search-copy">
          <span class="home-jobs-search-icon"><i class="fa-solid fa-briefcase" aria-hidden="true"></i></span>
          <div>
            <h3>Encuentra tu próxima oportunidad</h3>
            <p>Busca entre las vacantes activas por cargo, empresa o palabra clave.</p>
          </div>
        </div>
        <form class="home-jobs-search" action="/empleos" method="get" role="search">
          <div class="home-jobs-search-field">
            <label class="visually-hidden" for="home-jobs-search-input">Buscar vacantes por palabra clave</label>
            <i class="fa-solid fa-magnifying-glass home-jobs-search-field-icon" aria-hidden="true"></i>
            <input id="home-jobs-search-input" class="form-control" type="search" name="q" placeholder="Ej. auxiliar, ventas, Bogotá..." maxlength="100">
          </div>
          <button class="btn btn-primary" type="submit">Buscar <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        </form>
        <span class="home-jobs-count"><strong>${total}</strong> ${total === 1 ? "vacante disponible" : "vacantes disponibles"}<small class="d-block fw-normal">Publicadas y vigentes</small></span>
      </div>
      <div class="home-jobs-results-head">
        <h3>Vacantes destacadas</h3>
        <span><i class="fa-solid fa-bolt" aria-hidden="true"></i> Actualizadas constantemente</span>
      </div>
      ${content}
      <div class="mt-5 text-center">
        <a class="btn btn-primary btn-lg" href="/empleos">Ver todas las vacantes <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
      </div>
    </div>
  </section>`;
}

function parseListingFilters(url) {
  const rawPage = url.searchParams.get("page") || "1";
  if (!/^[1-9]\d*$/.test(rawPage)) return null;
  const searchTerm = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const cityTerm = (url.searchParams.get("ciudad") || "").trim().slice(0, 80);
  const startDate = (url.searchParams.get("desde") || "").trim();
  const endDate = (url.searchParams.get("hasta") || "").trim();
  if (
    !isValidDateFilter(startDate) ||
    !isValidDateFilter(endDate) ||
    (startDate && endDate && startDate > endDate)
  ) {
    return null;
  }
  const filtersApplied = Boolean(searchTerm || cityTerm || startDate || endDate);
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || (!filtersApplied && page > 1)) return null;
  return { searchTerm, cityTerm, startDate, endDate, filtersApplied, page };
}

function renderListing(request, env, vacancies, filters) {
  const { searchTerm, cityTerm, startDate, endDate, filtersApplied, page } = filters;
  const searchWords = normalize(searchTerm).split(/\s+/).filter(Boolean);
  const normalizedCity = normalize(cityTerm);
  const filteredVacancies = vacancies.filter((vacancy) => {
    const searchableText = normalize([
      vacancy.title,
      vacancy.company,
      vacancy.location,
      vacancy.salary,
      vacancy.contractType,
      vacancy.requirements?.join(" "),
      vacancy.contactEmail,
      vacancy.contactPhone,
      vacancy.aiText,
      vacancy.channelName,
    ].filter((value) => !isUnavailable(value)).join(" "));
    const citySearchText = normalize(`${vacancy.location} ${vacancy.aiText}`);
    const publishedDate = dateKeyInBogota(vacancy.publishedAt);
    return (
      searchWords.every((word) => searchableText.includes(word)) &&
      (!normalizedCity || citySearchText.includes(normalizedCity)) &&
      (!startDate || publishedDate >= startDate) &&
      (!endDate || publishedDate <= endDate)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filteredVacancies.length / PAGE_SIZE));
  if (page > totalPages) {
    return htmlResponse(request, "<!doctype html><title>Página no encontrada</title>", 404);
  }

  const siteUrl = env.SITE_URL.replace(/\/+$/, "");
  const canonical = `${siteUrl}/empleos${filtersApplied && page > 1 ? `?page=${page}` : ""}`;
  const pageItems = filteredVacancies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cards = pageItems.map((vacancy) => listingCard(vacancy, siteUrl)).join("");
  const pagination = totalPages > 1
    ? `<nav class="jobs-pagination d-flex justify-content-center gap-2 mt-5" aria-label="Paginación">${Array.from({ length: totalPages }, (_, index) => {
        const pageNumber = index + 1;
        const query = new URLSearchParams();
        if (searchTerm) query.set("q", searchTerm);
        if (cityTerm) query.set("ciudad", cityTerm);
        if (startDate) query.set("desde", startDate);
        if (endDate) query.set("hasta", endDate);
        if (pageNumber > 1) query.set("page", String(pageNumber));
        const queryString = query.toString();
        const href = queryString ? `/empleos?${queryString}` : "/empleos";
        return `<a class="btn btn-light-custom ${pageNumber === page ? "active" : ""}" href="${escapeHtml(href)}"${pageNumber === page ? ' aria-current="page"' : ""}>${pageNumber}</a>`;
      }).join("")}</nav>`
    : "";
  const description =
    filtersApplied
      ? `Resultados de búsqueda${searchTerm ? ` para ${searchTerm}` : ""}${cityTerm ? ` en ${cityTerm}` : ""} en las ofertas laborales vigentes de Grupo Avitar.`
      : pageItems[0]?.title
      ? `Ofertas laborales vigentes en Grupo Avitar. Consulta vacantes como ${pageItems[0].title}${pageItems[0].location ? ` en ${pageItems[0].location}` : ""}.`
      : "Consulta las ofertas laborales vigentes publicadas en los canales de Grupo Avitar.";
  const emptyMessage = filtersApplied
    ? "No encontramos vacantes con esos filtros. <a href=\"/empleos\">Ver todas las vacantes</a>."
    : "No hay ofertas laborales vigentes por el momento. Vuelve pronto para consultar nuevas publicaciones.";
  const cityOptions = [...new Set(vacancies.map((vacancy) => vacancy.location).filter((value) => !isUnavailable(value)))]
    .sort((left, right) => left.localeCompare(right, "es"))
    .map((city) => `<option value="${escapeHtml(city)}"></option>`)
    .join("");
  const body = `<main class="jobs-page">
    <header class="jobs-hero">
      <div class="container">
        <div class="row align-items-center g-5">
          <div class="col-lg-7 jobs-hero-copy">
            <span class="jobs-kicker">Empleo · Grupo Avitar</span>
            <h1>Encuentra una oportunidad para dar el siguiente paso</h1>
            <p>Vacantes compartidas por los canales de origen, con información publicada recientemente.</p>
            <div class="jobs-hero-stats">
              <div class="jobs-hero-count"><strong>${filteredVacancies.length}</strong><span>${filtersApplied ? "resultados encontrados" : filteredVacancies.length === 1 ? "vacante activa" : "vacantes activas"}</span></div>
              <span class="jobs-validity">Cada publicación se mantiene durante 20 días</span>
            </div>
          </div>
          <div class="col-lg-5">
            <div class="jobs-hero-art" aria-hidden="true">
              <div class="jobs-hero-card">
                <div class="jobs-art-top"><span>Grupo Avitar</span><span class="jobs-art-status">Actualizadas</span></div>
                <span class="jobs-art-icon"><i class="fa-solid fa-briefcase" aria-hidden="true"></i></span>
                <h2>Oportunidades laborales</h2>
                <p>Consulta los detalles y la publicación de origen de cada vacante.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
    <section class="jobs-content">
    <div class="container">
      <header class="jobs-section-head">
        <div>
          <span class="eyebrow">Oportunidades vigentes</span>
          <h2>Vacantes disponibles</h2>
          <p>Solo ofertas laborales identificadas y aún vigentes.</p>
        </div>
        <span class="jobs-result-count">${filteredVacancies.length} ${filteredVacancies.length === 1 ? "resultado" : "resultados"}<small class="d-block fw-normal">${filtersApplied ? "Mostrando todas las coincidencias" : `Mostrando ${pageItems.length} en esta página`}</small></span>
      </header>
      <form class="jobs-search" action="/empleos" method="get" role="search">
        <div class="jobs-search-field">
          <label for="jobs-search-input">Vacante o palabra clave</label>
          <input id="jobs-search-input" class="form-control" type="search" name="q" value="${escapeHtml(searchTerm)}" placeholder="Ej. auxiliar, ventas..." maxlength="100">
        </div>
        <div class="jobs-search-field">
          <label for="jobs-city-input">Ciudad</label>
          <input id="jobs-city-input" class="form-control" type="search" name="ciudad" value="${escapeHtml(cityTerm)}" list="jobs-city-options" placeholder="Todas las ciudades" maxlength="80">
          <datalist id="jobs-city-options">${cityOptions}</datalist>
        </div>
        <div class="jobs-search-field">
          <label for="jobs-start-date">Publicada desde</label>
          <input id="jobs-start-date" class="form-control" type="date" name="desde" value="${escapeHtml(startDate)}">
        </div>
        <div class="jobs-search-field">
          <label for="jobs-end-date">Publicada hasta</label>
          <input id="jobs-end-date" class="form-control" type="date" name="hasta" value="${escapeHtml(endDate)}">
        </div>
        <div class="jobs-search-actions">
          <button class="btn btn-primary" type="submit">Filtrar</button>
          ${filtersApplied ? '<a class="btn btn-light-custom d-flex align-items-center" href="/empleos">Limpiar</a>' : ""}
        </div>
      </form>
      ${pageItems.length
        ? `<div class="row g-4">${cards}</div>${pagination}`
        : `<p class="card-premium">${emptyMessage}</p>`}
    </div>
    </section>
  </main>`;
  return htmlResponse(
    request,
    layout({
      title: `${searchTerm ? `Resultados para ${searchTerm}` : cityTerm ? `Empleos en ${cityTerm}` : "Empleos en Colombia"}${page > 1 ? ` — página ${page}` : ""} | Grupo Avitar`,
      description,
      canonical,
      body,
      robots: filtersApplied ? "noindex,follow" : "index,follow",
      structuredData: filtersApplied ? "" : itemListJsonLd(pageItems, siteUrl),
    }),
  );
}

function renderDetail(request, env, vacancies, slug) {
  const vacancy = vacancies.find((item) => item.slug === slug);
  if (!vacancy) {
    return htmlResponse(
      request,
      "<!doctype html><html lang=\"es\"><head><meta name=\"robots\" content=\"noindex,follow\"><title>Oferta no disponible | Grupo Avitar</title></head><body><main><h1>Esta oferta ya no está disponible</h1><a href=\"/empleos\">Ver ofertas vigentes</a></main></body></html>",
      404,
      { "Cache-Control": "no-store" },
    );
  }

  const siteUrl = env.SITE_URL.replace(/\/+$/, "");
  const canonical = `${siteUrl}/empleos/${vacancy.slug}`;
  const image = vacancy.imageUrl
    ? `<img class="jobs-detail-image" src="${escapeHtml(vacancy.imageUrl)}" alt="${escapeHtml(vacancy.title)}" decoding="async" fetchpriority="high">`
    : `<img class="jobs-detail-image" src="${EMPLOYMENT_PLACEHOLDER_IMAGE}" alt="Imagen ilustrativa de una oportunidad laboral" decoding="async">`;
  const company = displayValue(vacancy.company);
  const location = displayValue(vacancy.location);
  const salary = displayValue(vacancy.salary);
  const contractType = displayValue(vacancy.contractType);
  const contactLabel = displayValue(vacancy.contactLabel);
  const contactValue = vacancy.contactUrl && !isUnavailable(contactLabel)
    ? `<a href="${escapeHtml(vacancy.contactUrl)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(contactLabel)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>`
    : escapeHtml(contactLabel);
  const details = [
    `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-building" aria-hidden="true"></i> Empresa</dt><dd>${escapeHtml(company)}</dd></div>`,
    `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Ubicación</dt><dd>${escapeHtml(location)}</dd></div>`,
    `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-money-bill-wave" aria-hidden="true"></i> Salario</dt><dd>${escapeHtml(salary)}</dd></div>`,
    `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-file-contract" aria-hidden="true"></i> Tipo de contrato</dt><dd>${escapeHtml(contractType)}</dd></div>`,
    `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-address-book" aria-hidden="true"></i> Contacto</dt><dd>${contactValue}</dd></div>`,
    `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-calendar-days" aria-hidden="true"></i> Fecha de publicación</dt><dd><time datetime="${escapeHtml(vacancy.publishedAt)}">${escapeHtml(formatDate(vacancy.publishedAt))}</time></dd></div>`,
    vacancy.channelName
      ? `<div class="jobs-detail-fact"><dt><i class="fa-solid fa-bullhorn" aria-hidden="true"></i> Canal de origen</dt><dd>${escapeHtml(vacancy.channelName)}</dd></div>`
      : "",
  ].filter(Boolean).join("");
  const originalChannel = vacancy.channelUrl
    ? `<a class="btn btn-light-custom" href="${escapeHtml(vacancy.channelUrl)}" rel="nofollow noopener noreferrer" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Consultar canal original</a>`
    : "";
  const whatsappUrl = escapeHtml(vacancyWhatsAppUrl(vacancy));
  const subtitle = [
    !isUnavailable(company) ? company : "",
    !isUnavailable(location) ? `Empleo en ${escapeHtml(location)}` : "",
    escapeHtml(formatDate(vacancy.publishedAt)),
  ].filter(Boolean).join(" · ");
  const description = displayValue(vacancy.description, displayValue(vacancy.aiText));
  const requirements = vacancy.requirements?.length
    ? vacancy.requirements.map((requirement) => `• ${requirement}`).join("\n")
    : NOT_AVAILABLE;
  const body = `<main class="jobs-detail-page">
    <div class="container jobs-detail-container">
      <nav aria-label="Ruta de navegación" class="jobs-detail-breadcrumb">
        <a href="/">Inicio</a> <span aria-hidden="true">/</span> <a href="/empleos">Empleos</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(vacancy.title)}</span>
      </nav>
      <div class="jobs-detail-grid">
        <article class="jobs-detail-main" itemscope itemtype="https://schema.org/Article">
          <header class="jobs-detail-header">
            <span class="jobs-detail-status">Publicación reciente</span>
            <h1 class="jobs-detail-title" itemprop="headline">${escapeHtml(vacancy.title)}</h1>
            <p class="jobs-detail-subtitle">${subtitle}</p>
          </header>
          <figure class="jobs-detail-visual">${image}</figure>
          <section class="jobs-detail-description">
            <h2>Descripción de la vacante</h2>
            <p class="jobs-detail-copy" itemprop="description">${escapeHtml(description)}</p>
            <h2>Requisitos</h2>
            <p class="jobs-detail-copy">${escapeHtml(requirements)}</p>
          </section>
        </article>
        <aside class="jobs-detail-sidebar" aria-label="Información de la vacante">
          <section class="jobs-detail-summary">
            <h2>Información clave</h2>
            <dl class="jobs-detail-facts">${details}</dl>
            <div class="jobs-detail-source">
              <p class="jobs-detail-cta-copy">¿Quieres postularte con una hoja de vida clara y enfocada en este cargo? Escríbenos y te ayudamos.</p>
              <a id="vacancy-whatsapp-cta" class="btn jobs-whatsapp-button" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(`Solicitar hoja de vida para ${vacancy.title} por WhatsApp`)}"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Crear mi hoja de vida</a>
              ${originalChannel}
              <a class="btn btn-primary" href="/empleos"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Ver todas las vacantes</a>
            </div>
          </section>
          <section class="jobs-detail-note">
            <strong>Información importante</strong>
            <p>Este portal es informativo. La oferta puede haber cerrado o cambiado; confirma su disponibilidad directamente con el empleador o en el canal original antes de postularte. La publicación puede permanecer aquí hasta 20 días desde su fecha de origen.</p>
            <a href="/terminos">Leer Términos y Condiciones</a>
          </section>
        </aside>
      </div>
    </div>
  </main>`;
  return htmlResponse(
    request,
    layout({
      title: `${vacancy.title} | Empleo | Grupo Avitar`,
      description: (isUnavailable(description) ? vacancy.title : description).slice(0, 155),
      canonical,
      image: vacancy.imageUrl,
      body,
      structuredData: jobPostingJsonLd(vacancy, siteUrl),
      analyticsData: {
        vacancy_title: vacancy.title,
        vacancy_slug: vacancy.slug,
        vacancy_company: displayValue(vacancy.company, ""),
        vacancy_location: displayValue(vacancy.location, ""),
      },
    }),
  );
}

const STATIC_PAGE_PATHS = [
  "/about",
  "/contact",
  "/cookies",
  "/privacidad",
  "/services",
  "/terminos",
  "/servicio-ajt",
  "/servicio-ats",
  "/servicio-cdr",
  "/servicio-ctp",
  "/servicio-ctr",
  "/servicio-drp",
  "/servicio-ebk",
  "/servicio-hdv",
  "/servicio-hfp",
  "/servicio-hvm",
];

function renderSitemap(env, vacancies, head = false) {
  const siteUrl = env.SITE_URL.replace(/\/+$/, "");
  const urls = [
    `${siteUrl}/`,
    ...STATIC_PAGE_PATHS.map((path) => `${siteUrl}${path}`),
    `${siteUrl}/empleos`,
    ...vacancies.map((vacancy) => `${siteUrl}/empleos/${vacancy.slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((url) => `<url><loc>${escapeXml(url)}</loc></url>`)
    .join("")}</urlset>`;
  return new Response(head ? null : body, {
    headers: responseHeaders("application/xml; charset=utf-8", {
      "Cache-Control": "public, max-age=60, s-maxage=60",
    }),
  });
}

function renderRobots(env, head = false) {
  const siteUrl = env.SITE_URL.replace(/\/+$/, "");
  return new Response(
    head ? null : `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`,
    {
      headers: responseHeaders("text/plain; charset=utf-8", {
        "Cache-Control": "public, max-age=3600",
      }),
    },
  );
}

function validSiteUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
}

function isPublicSupabaseKey(key) {
  if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) return true;
  return supabaseJwtRole(key) === "anon";
}

function isServiceRoleKey(key) {
  return supabaseJwtRole(key) === "service_role";
}

function supabaseJwtRole(key) {
  if (typeof key !== "string") return "";
  const payload = key.split(".")[1];
  if (!payload) return "";
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return JSON.parse(decoded).role || "";
  } catch {
    return "";
  }
}

function supabaseReadKey(env) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    return isServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY)
      ? env.SUPABASE_SERVICE_ROLE_KEY
      : "";
  }
  return isPublicSupabaseKey(env.SUPABASE_ANON_KEY)
    ? env.SUPABASE_ANON_KEY
    : "";
}

function validEnvironment(env) {
  if (!env.SUPABASE_URL || !supabaseReadKey(env) || !env.SITE_URL) return false;
  try {
    return (
      new URL(env.SUPABASE_URL).protocol === "https:" &&
      validSiteUrl(env.SITE_URL)
    );
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isHomeRoute = url.pathname === "/" || url.pathname === "/index.html";
    const isDynamicRoute =
      isHomeRoute ||
      url.pathname === "/empleos" ||
      url.pathname.startsWith("/empleos/") ||
      url.pathname === "/sitemap.xml" ||
      url.pathname === "/robots.txt";
    if (!isDynamicRoute) {
      return env.ASSETS.fetch(request);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Método no permitido", {
        status: 405,
        headers: responseHeaders("text/plain; charset=utf-8", { Allow: "GET, HEAD" }),
      });
    }
    if (isHomeRoute && request.method === "HEAD") return env.ASSETS.fetch(request);
    if (url.pathname === "/robots.txt") {
      if (!validSiteUrl(env.SITE_URL)) {
        return new Response("Configuración del sitio incompleta.", {
          status: 503,
          headers: responseHeaders("text/plain; charset=utf-8", {
            "Cache-Control": "no-store",
          }),
        });
      }
      return renderRobots(env, request.method === "HEAD");
    }
    if (!validEnvironment(env)) {
      return new Response("Configuración del Worker incompleta.", {
        status: 503,
        headers: responseHeaders("text/plain; charset=utf-8", {
          "Cache-Control": "no-store",
        }),
      });
    }
    try {
      const now = new Date();
      const filters = url.pathname === "/empleos" ? parseListingFilters(url) : null;
      if (url.pathname === "/empleos" && !filters) {
        return htmlResponse(request, "<!doctype html><title>Solicitud inválida</title>", 400);
      }

      let vacancies = [];
      if (isHomeRoute) {
        vacancies = await getVacancies(env, now, {}, MAX_QUERY_ROWS);
      } else if (url.pathname === "/sitemap.xml") {
        vacancies = await getVacancies(env, now, {}, MAX_QUERY_ROWS);
      } else if (filters) {
        vacancies = await getVacancies(
          env,
          now,
          filters,
          filters.filtersApplied ? filters.page * PAGE_SIZE + 1 : PAGE_SIZE,
        );
      } else {
        const slug = url.pathname.slice("/empleos/".length);
        const idPrefix = slug.match(/-([0-9a-f]{8})$/i)?.[1];
        if (!slug || slug.includes("/") || !idPrefix) {
          return htmlResponse(request, "<!doctype html><title>Oferta no encontrada</title>", 404, {
            "Cache-Control": "no-store",
          });
        }
        vacancies = await getVacancies(env, now, {}, MAX_QUERY_ROWS);
      }

      if (isHomeRoute) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (!assetResponse.ok) return assetResponse;
        const homeHtml = await assetResponse.text();
        if (
          homeHtml.split(FEATURED_JOBS_MARKER).length !== 2 ||
          homeHtml.split(HOME_SEO_MARKER).length !== 2
        ) {
          throw new Error("No se encontraron los espacios de empleos o SEO en index.html.");
        }
        const headers = new Headers(assetResponse.headers);
        headers.delete("Content-Length");
        headers.delete("Content-Encoding");
        headers.delete("ETag");
        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
        const siteUrl = env.SITE_URL.replace(/\/+$/, "");
        return new Response(
          homeHtml
            .replace(HOME_SEO_MARKER, homeSeoJsonLd(siteUrl))
            .replace(FEATURED_JOBS_MARKER, renderFeaturedJobs(vacancies, env)),
          { status: assetResponse.status, headers },
        );
      }
      if (url.pathname === "/sitemap.xml") {
        return renderSitemap(env, vacancies, request.method === "HEAD");
      }
      if (filters) return renderListing(request, env, vacancies, filters);
      const slug = url.pathname.slice("/empleos/".length);
      return renderDetail(request, env, vacancies, slug);
    } catch (error) {
      console.error("Employment page generation failed", error);
      return new Response("No fue posible cargar las ofertas en este momento.", {
        status: 503,
        headers: responseHeaders("text/plain; charset=utf-8", {
          "Cache-Control": "no-store",
        }),
      });
    }
  },
};

export {
  activeVacancies,
  displayValue,
  isPublicSupabaseKey,
  isServiceRoleKey,
  isVacancy,
  parseJsonObject,
  resolveImageUrl,
  slugify,
  vacancyJsonFromSources,
};
