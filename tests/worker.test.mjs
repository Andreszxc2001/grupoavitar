import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import worker from "../worker.mjs";
import {
  activeVacancies,
  getActiveVacancies,
  isPublicSupabaseKey,
  isServiceRoleKey,
  isVacancy,
  parseJsonObject,
  resolveImageUrl,
  runCleanup,
  vacancyJsonFromSources,
} from "../worker.mjs";

const SUPABASE_URL = "https://example.supabase.co";
const NOW = new Date("2026-11-15T12:00:00.000Z");
const ANON_KEY = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
const SERVICE_KEY = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;

function publication(overrides = {}) {
  return {
    id: "12345678-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-11-14T12:00:00.000Z",
    tipo: "json",
    texto_ocr: "OCR_ONLY_TEXT_DO_NOT_RENDER",
    texto_ia: {
      cargo: "Panadero artesanal",
      titulo: "Panadero artesanal",
      empresa: "Vaz Perfumes",
      salario: "$1.500.000",
      contacto: {
        link: "No disponible",
        correo: "No disponible",
        telefono: "No disponible",
      },
      ubicacion: "Santa Marta",
      requisitos: ["Experiencia previa"],
      descripcion: "Panadero artesanal con experiencia en Santa Marta.",
      tipo_contrato: "Tiempo completo",
    },
    imagen_url: "post/foto.jpg",
    canal_nombre: "Empleos",
    canal_url: "https://example.com/canal",
    metadata: {},
    ...overrides,
  };
}

const VAZ_PERFUMES_JSON = `{
  "cargo": "No disponible",
  "titulo": "No disponible",
  "empresa": "Vaz Perfumes",
  "salario": "No disponible",
  "contacto": {
    "link": "No disponible",
    "correo": "No disponible",
    "telefono": "No disponible"
  },
  "ubicacion": "No disponible",
  "requisitos": [
    "No disponible"
  ],
  "descripcion": "Solicita nuestro catálogo de marcas de belleza, perfumes y productos originales como agua de perfume, cremas hidratantes y fragancias como Vanila, Victorias Secret y otras marcas de calidad. Enfocados en belleza, aroma y calidad que se siente.",
  "tipo_contrato": "No disponible"
}`;

function jsonPublication(overrides = {}) {
  return publication({
    id: "11111111-1234-1234-1234-123456789abc",
    tipo: "json",
    texto_ocr: "",
    texto_ia: VAZ_PERFUMES_JSON,
    imagen_url: "post/catalogo.jpg",
    canal_nombre: "Catálogos",
    ...overrides,
  });
}

function completeJsonPublication() {
  return jsonPublication({
    id: "22222222-1234-1234-1234-123456789abc",
    texto_ia: JSON.stringify({
      cargo: "Asesor de ventas",
      titulo: "Asesor de ventas",
      empresa: "Vaz Perfumes",
      salario: "$1.200.000",
      contacto: {
        link: "https://wa.me/573019441676",
        correo: "empleos@example.com",
        telefono: "300 944 1676",
      },
      ubicacion: "Cali",
      requisitos: ["Experiencia en ventas", "Disponibilidad inmediata"],
      descripcion: "Atención a clientes y venta de perfumes y productos de belleza.",
      tipo_contrato: "Tiempo completo",
    }),
  });
}

test("only publishes posts that include vacancy JSON", () => {
  assert.equal(isVacancy(publication()), true);
  assert.equal(isVacancy(jsonPublication()), true);
  assert.equal(
    isVacancy(
      publication({
        texto_ocr: "",
        texto_ia: "**Buscamos Auxiliar Operativo en Cartagena**\nRequisitos: experiencia previa.",
      }),
    ),
    false,
  );
  assert.equal(
    isVacancy(publication({ texto_ia: null, texto_ocr: "Busco empleo como panadero." })),
    false,
  );
  assert.equal(
    isVacancy(publication({ texto_ia: "", texto_ocr: "Promoción de panadería artesanal." })),
    false,
  );
  assert.deepEqual(
    activeVacancies(
      [publication({ texto_ia: "Vacante: Panadero artesanal", texto_ocr: "" })],
      SUPABASE_URL,
      NOW,
    ),
    [],
  );
});

test("reads vacancy fields from JSON data", () => {
  const [vacancy] = activeVacancies([publication()], SUPABASE_URL, NOW);
  assert.equal(vacancy.title, "Panadero artesanal");
  assert.equal(vacancy.company, "Vaz Perfumes");
  assert.equal(vacancy.location, "Santa Marta");
  assert.equal(vacancy.salary, "$1.500.000");
});

test("acepta imágenes solo del bucket propio de Supabase", () => {
  const bucket = "https://example.supabase.co/storage/v1/object/public/imagenes_posts/";
  assert.equal(
    resolveImageUrl("post/foto original.jpg", SUPABASE_URL),
    `${bucket}post/foto%20original.jpg`,
  );
  assert.equal(resolveImageUrl("imagenes_posts/post/foto.jpg", SUPABASE_URL), `${bucket}post/foto.jpg`);
  assert.equal(resolveImageUrl(`${bucket}post/foto.jpg`, SUPABASE_URL), `${bucket}post/foto.jpg`);
  assert.equal(resolveImageUrl("/storage/v1/object/public/imagenes_posts/post/foto.jpg", SUPABASE_URL), `${bucket}post/foto.jpg`);
  for (const invalid of [
    "https://cdn.example.com/original.jpg",
    "http://example.supabase.co/storage/v1/object/public/imagenes_posts/post/foto.jpg",
    "https://example.supabase.co/storage/v1/object/public/otros/post/foto.jpg",
    "https://example.supabase.co.evil.com/storage/v1/object/public/imagenes_posts/post/foto.jpg",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "post/../secreto.jpg",
    "post/%2e%2e/secreto.jpg",
    "/storage/v1/object/public/imagenes_posts/../secreto.jpg",
  ]) {
    assert.equal(resolveImageUrl(invalid, SUPABASE_URL), "", invalid);
  }
});

test("cabeceras de seguridad presentes en HTML, XML y texto", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = globalThis.caches;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {} },
  };
  globalThis.fetch = async () => new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" },
  });
  const env = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    SITE_URL: "https://grupoavitar.com",
  };
  try {
    for (const path of ["/empleos", "/sitemap.xml", "/robots.txt"]) {
      const response = await worker.fetch(new Request(`https://grupoavitar.com${path}`), env);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-security-policy"), /img-src 'self' data: https:\/\/example\.supabase\.co/, path);
      assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/, path);
      assert.equal(response.headers.get("x-frame-options"), "DENY", path);
      assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=(), usb=()", path);
      assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin", path);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
      assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin", path);
      assert.equal(response.headers.get("strict-transport-security"), null, path);
    }
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCache;
  }
});

test("reads vacancy data from JSON posts and fills missing values with No disponible", () => {
  const post = jsonPublication();
  assert.equal(isVacancy(post), true);
  assert.deepEqual(parseJsonObject(post.texto_ia)?.empresa, "Vaz Perfumes");
  assert.equal(vacancyJsonFromSources(post.texto_ia)?.salario, "No disponible");

  const [vacancy] = activeVacancies([post], SUPABASE_URL, NOW);
  assert.equal(vacancy.slug, "vaz-perfumes-11111111");
  assert.equal(vacancy.title, "No disponible");
  assert.equal(vacancy.company, "Vaz Perfumes");
  assert.equal(vacancy.location, "No disponible");
  assert.equal(vacancy.salary, "No disponible");
  assert.equal(vacancy.contractType, "No disponible");
  assert.deepEqual(vacancy.requirements, ["No disponible"]);
  assert.equal(vacancy.contactLabel, "No disponible");
  assert.equal(vacancy.contactUrl, "");
  assert.match(vacancy.description, /catálogo de marcas de belleza/);

  const [complete] = activeVacancies([completeJsonPublication()], SUPABASE_URL, NOW);
  assert.equal(complete.slug, "asesor-de-ventas-cali-22222222");
  assert.equal(complete.salary, "$1.200.000");
  assert.equal(complete.contractType, "Tiempo completo");
  assert.deepEqual(complete.requirements, ["Experiencia en ventas", "Disponibilidad inmediata"]);
  assert.equal(complete.contactEmail, "empleos@example.com");
  assert.equal(complete.contactPhone, "300 944 1676");
  assert.match(complete.contactUrl, /^https:\/\/wa\.me\//);
});

test("slug omite No disponible y el detalle usa 301, 410 y 404", async () => {
  const base = publication();
  const sinUbicacion = publication({
    id: "abcdef12-1234-1234-1234-123456789abc",
    texto_ia: { ...base.texto_ia, ubicacion: "No disponible" },
  });
  const [vacancy] = activeVacancies([sinUbicacion], SUPABASE_URL, NOW);
  assert.equal(vacancy.slug, "panadero-artesanal-abcdef12");
  assert.doesNotMatch(vacancy.slug, /no-disponible/);

  const previousFetch = globalThis.fetch;
  const previousCache = globalThis.caches;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {} },
  };
  globalThis.fetch = async () => new Response(JSON.stringify([sinUbicacion]), {
    headers: { "Content-Type": "application/json" },
  });
  const env = {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    SITE_URL: "https://grupoavitar.com",
  };
  try {
    const anterior = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/panadero-artesanal-no-disponible-abcdef12"),
      env,
    );
    assert.equal(anterior.status, 301);
    assert.equal(anterior.headers.get("location"), "/empleos/panadero-artesanal-abcdef12");

    const canonico = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/panadero-artesanal-abcdef12"),
      env,
    );
    assert.equal(canonico.status, 200);

    const vencida = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/vacante-antigua-99999999"),
      env,
    );
    const vencidaHtml = await vencida.text();
    assert.equal(vencida.status, 410);
    assert.match(vencidaHtml, /^<!doctype html>\s*<html lang="es">/);
    assert.match(vencidaHtml, /<meta name="robots" content="noindex,follow">/);
    assert.match(vencidaHtml, /<a href="\/empleos">Ver ofertas vigentes<\/a>/);
    assert.match(vencida.headers.get("cache-control"), /^public, max-age=\d+$/);

    const invalida = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/vacante-sin-sufijo"),
      env,
    );
    const invalidaHtml = await invalida.text();
    assert.equal(invalida.status, 404);
    assert.match(invalidaHtml, /^<!doctype html>\s*<html lang="es">/);
    assert.match(invalidaHtml, /<meta name="robots" content="noindex,follow">/);
    assert.match(invalidaHtml, /<a href="\/empleos">Ver ofertas vigentes<\/a>/);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCache;
  }
});

test("includes only current publications and deduplicates identical source text", () => {
  const active = publication();
  const duplicate = publication({
    id: "87654321-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-11-14T13:00:00.000Z",
  });
  const expired = publication({
    id: "aaaaaaaa-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-10-26T11:59:59.999Z",
  });
  const future = publication({
    id: "bbbbbbbb-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-11-16T12:00:00.000Z",
  });
  const jobs = activeVacancies([active, duplicate, expired, future], SUPABASE_URL, NOW);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, duplicate.id);
  assert.equal(jobs[0].location, "Santa Marta");
  assert.equal(jobs[0].salary, "$1.500.000");
});

test("keeps vacancies up to 15 days old and hides older ones", () => {
  const within = publication({
    id: "dddddddd-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-10-31T12:00:01.000Z",
  });
  const older = publication({
    id: "eeeeeeee-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-10-31T11:59:59.999Z",
  });
  const jobs = activeVacancies([within, older], SUPABASE_URL, NOW);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, within.id);
});

test("hides vacancies without a valid image", () => {
  const jobs = activeVacancies([
    publication({ id: "ffffffff-1234-1234-1234-123456789abc", imagen_url: "" }),
    publication({
      id: "11111111-2222-3333-4444-555555555555",
      imagen_url: "javascript:alert(1)",
    }),
  ], SUPABASE_URL, NOW);
  assert.deepEqual(jobs, []);
});

test("refuses a Supabase service-role key and accepts public keys", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.equal(isPublicSupabaseKey(`header.${encode({ role: "service_role" })}.signature`), false);
  assert.equal(isPublicSupabaseKey(`header.${encode({ role: "anon" })}.signature`), true);
  assert.equal(isPublicSupabaseKey("sb_publishable_example"), true);
  assert.equal(isServiceRoleKey(`header.${encode({ role: "service_role" })}.signature`), true);
  assert.equal(isServiceRoleKey("sb_secret_example"), true);
  assert.equal(isServiceRoleKey(undefined), false);
});

test("rechaza claves de servicio en el Worker público", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("no debería consultar Supabase");
  };
  const logs = [];
  const previousError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    for (const [name, value] of Object.entries({
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_SECRET_KEY: "sb_secret_example",
    })) {
      const response = await worker.fetch(new Request("https://grupoavitar.com/empleos"), {
        SUPABASE_URL,
        SUPABASE_ANON_KEY: ANON_KEY,
        SITE_URL: "https://grupoavitar.com",
        [name]: value,
      });
      assert.equal(response.status, 503);
      assert.match(await response.text(), /No fue posible cargar las ofertas/);
      assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    }
    assert.equal(fetchCalls, 0);
    assert.ok(logs.some((line) => line.includes("Configuración insegura: el Worker público no debe tener claves de servicio")));
    assert.equal(logs.some((line) => line.includes(SERVICE_KEY) || line.includes("sb_secret_example")), false);
  } finally {
    console.error = previousError;
    globalThis.fetch = previousFetch;
  }
});

test("envía solo apikey con claves sb_publishable", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = globalThis.caches;
  globalThis.caches = {
    default: {
      match: async () => undefined,
      put: async () => {},
    },
  };
  let headers = {};
  globalThis.fetch = async (_url, options) => {
    headers = options.headers;
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://grupoavitar.com/empleos"), {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: "sb_publishable_example",
      SITE_URL: "https://grupoavitar.com",
    });
    assert.equal(response.status, 200);
    assert.equal(headers.apikey, "sb_publishable_example");
    assert.equal(headers.Authorization, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCache;
  }
});

test("renders listings and job detail as server HTML with canonical metadata", async () => {
  const previousCache = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const cache = new Map();
  globalThis.caches = {
    default: {
      match: async (request) => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone()),
    },
  };
  let supabaseReads = 0;
  let forwardedKey = "";
  globalThis.fetch = async (_url, options) => {
    supabaseReads += 1;
    forwardedKey = options.headers.apikey;
    return new Response(JSON.stringify([
      publication(),
      publication({
        id: "aaaaaaaa-1234-1234-1234-123456789abc",
        fecha_publicacion: "2026-11-13T12:00:00.000Z",
        imagen_url: "post/auxiliar.jpg",
        texto_ocr: "OCR_ONLY_TEXT_DO_NOT_RENDER",
        texto_ia: {
          cargo: "Auxiliar de bodega",
          titulo: "Auxiliar de bodega",
          empresa: "Vaz Perfumes",
          salario: "No disponible",
          contacto: {
            link: "No disponible",
            correo: "No disponible",
            telefono: "No disponible",
          },
          ubicacion: "Cartagena",
          requisitos: ["Disponibilidad inmediata"],
          descripcion: "Apoyo en inventario.",
          tipo_contrato: "No disponible",
        },
        metadata: {},
      }),
      publication({
        id: "cccccccc-1234-1234-1234-123456789abc",
        fecha_publicacion: "2026-11-12T12:00:00.000Z",
        imagen_url: "",
        texto_ocr: "",
        texto_ia: {
          cargo: "Sin imagen",
          titulo: "Sin imagen",
          empresa: "Vaz Perfumes",
          salario: "No disponible",
          contacto: {},
          ubicacion: "Bogota",
          requisitos: [],
          descripcion: "Vacante sin imagen.",
          tipo_contrato: "No disponible",
        },
        metadata: {},
      }),
    ]), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SITE_URL: "https://grupoavitar.com",
    };
    const listing = await worker.fetch(
      new Request("https://grupoavitar.com/empleos"),
      env,
    );
    const listingHtml = await listing.text();
    assert.equal(listing.status, 200);
    assert.match(listingHtml, /<h1>Encuentra una oportunidad/);
    assert.match(listingHtml, /href="\/about">Nosotros/);
    assert.match(listingHtml, /href="\/services">Servicios/);
    assert.match(listingHtml, /href="\/empleos" aria-current="page">Empleos/);
    assert.match(listingHtml, /href="\/contact">Contacto/);
    assert.match(listingHtml, /id="mainNav"/);
    assert.match(listingHtml, /\/assets\/js\/main\.js/);
    assert.match(listingHtml, /<footer class="footer-nexora">/);
    assert.match(listingHtml, /logo1\.png/);
    assert.match(listingHtml, /href="\/privacidad"/);
    assert.match(listingHtml, /Escribir por WhatsApp/);
    assert.match(listingHtml, /href="\/assets\/favicon\/favicon-32x32\.png"/);
    assert.match(listingHtml, /href="\/assets\/favicon\/favicon\.ico"/);
    assert.match(listingHtml, /googletagmanager\.com\/gtag\/js\?id=G-29YCBD5TL9/);
    assert.match(listingHtml, /gtag\('config', 'G-29YCBD5TL9'\)/);
    assert.match(listingHtml, /GTM-WML4WJG8/);
    assert.match(listingHtml, /googletagmanager\.com\/ns\.html\?id=GTM-WML4WJG8/);
    assert.doesNotMatch(listingHtml, /vacancy_whatsapp_click|view_vacancy/);
    assert.doesNotMatch(listingHtml, /Se busca panadero artesanal|OCR_ONLY_TEXT_DO_NOT_RENDER/);
    assert.match(listingHtml, /<link rel="canonical" href="https:\/\/grupoavitar\.com\/empleos">/);
    assert.match(listingHtml, /panadero-artesanal-santa-marta-12345678/);
    assert.match(listingHtml, /src="https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/imagenes_posts\/post\/foto\.jpg"/);
    assert.doesNotMatch(listingHtml, /empleo-placeholder\.svg/);
    assert.doesNotMatch(listingHtml, /kit\.fontawesome\.com/);
    assert.match(listingHtml, /integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW\+ALEwIH"/);
    assert.match(listingHtml, /integrity="sha384-XGjxtQfXaH2tnPFa9x\+ruJTuLE3Aa6LhHSWRr1XeTyhezb4abCG4ccI5AkVDxqC\+"/);
    assert.match(listingHtml, /<!-- TODO: URL redes -->/);
    assert.doesNotMatch(listingHtml, /href="#" class="social-icon"/);
    assert.match(listingHtml, /Ver detalle/);
    assert.match(listingHtml, /bi bi-arrow-right/);
    assert.doesNotMatch(listingHtml, /wa\.me\/573019441676\?text=/);

    const filteredListing = await worker.fetch(
      new Request(
        "https://grupoavitar.com/empleos?q=auxiliar&ciudad=cartagena&desde=2026-11-13&hasta=2026-11-13",
      ),
      env,
    );
    const filteredHtml = await filteredListing.text();
    assert.equal(filteredListing.status, 200);
    assert.match(filteredHtml, /<meta name="robots" content="noindex,follow">/);
    assert.match(filteredHtml, /value="auxiliar"/);
    assert.match(filteredHtml, /value="cartagena"/);
    assert.match(filteredHtml, /value="2026-11-13"/);
    assert.match(filteredHtml, /Auxiliar de bodega/);
    assert.doesNotMatch(filteredHtml, /Panadero artesanal/);

    const invalidDateFilter = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?desde=2026-02-31"),
      env,
    );
    assert.equal(invalidDateFilter.status, 400);

    const detail = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/panadero-artesanal-santa-marta-12345678"),
      env,
    );
    const detailHtml = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(detailHtml, /googletagmanager\.com\/gtag\/js\?id=G-29YCBD5TL9/);
    assert.match(detailHtml, /gtag\('config', 'G-29YCBD5TL9'\)/);
    assert.match(detailHtml, /GTM-WML4WJG8/);
    assert.match(detailHtml, /pushToDataLayer\("vacancy_whatsapp_click"\)/);
    assert.match(detailHtml, /id="vacancy-whatsapp-cta"/);
    assert.match(detailHtml, /id="vacancy-image-unavailable" class="jobs-detail-unavailable" hidden/);
    assert.match(detailHtml, /gtag\("event", "view_vacancy", vacancy\)/);
    assert.match(detailHtml, /gtag\("event", "vacancy_whatsapp_click", vacancy\)/);
    assert.match(detailHtml, /"vacancy_title":"Panadero artesanal"/);
    assert.match(detailHtml, /"vacancy_slug":"panadero-artesanal-santa-marta-12345678"/);
    assert.match(detailHtml, /"vacancy_company":"Vaz Perfumes"/);
    assert.match(detailHtml, /"vacancy_location":"Santa Marta"/);
    assert.match(detailHtml, /<h1 class="jobs-detail-title" itemprop="headline">Panadero artesanal<\/h1>/);
    assert.match(detailHtml, /Publicación reciente/);
    assert.match(detailHtml, /Este portal es informativo/);
    assert.match(detailHtml, /href="\/terminos">Leer Términos y Condiciones<\/a>/);
    assert.match(detailHtml, /jobs-detail-grid/);
    assert.match(detailHtml, /Información clave/);
    assert.match(detailHtml, /wa\.me\/573019441676\?text=/);
    assert.match(detailHtml, /Crear mi hoja de vida/);
    assert.match(detailHtml, /bi bi-whatsapp/);
    assert.match(detailHtml, /Panadero%20artesanal/);
    assert.match(detailHtml, /property="og:image"/);
    assert.doesNotMatch(detailHtml, /Se busca panadero artesanal|OCR_ONLY_TEXT_DO_NOT_RENDER|\*\*/);

    const noImageDetail = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/sin-imagen-bogota-cccccccc"),
      env,
    );
    const noImageDetailHtml = await noImageDetail.text();
    assert.equal(noImageDetail.status, 410);
    assert.match(noImageDetailHtml, /Esta oferta ya no está disponible/);
    assert.match(noImageDetailHtml, /<meta name="robots" content="noindex,follow">/);
    assert.doesNotMatch(noImageDetailHtml, /empleo-placeholder\.svg/);
    assert.match(detailHtml, /Descripción/);

    const sitemap = await worker.fetch(
      new Request("https://grupoavitar.com/sitemap.xml"),
      env,
    );
    const sitemapXml = await sitemap.text();
    assert.equal(sitemap.status, 200);
    for (const path of [
      "/",
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
      "/empleos",
      "/empleos/panadero-artesanal-santa-marta-12345678",
      "/empleos/auxiliar-de-bodega-cartagena-aaaaaaaa",
    ]) {
      assert.ok(sitemapXml.includes(`<loc>https://grupoavitar.com${path}</loc>`), path);
    }

    assert.equal(supabaseReads, 1);
    assert.equal(forwardedKey, ANON_KEY);
    assert.equal(detailHtml.includes(SERVICE_KEY), false);
    assert.equal(noImageDetailHtml.includes(SERVICE_KEY), false);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

test("limits the listing to 50 recent jobs, filters searches on the server, and features 12 jobs", async () => {
  const previousCache = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const cache = new Map();
  globalThis.caches = {
    default: {
      match: async (request) => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone()),
    },
  };
  const posts = Array.from({ length: 51 }, (_, index) => {
    const number = index + 1;
    return publication({
      id: `${String(number).padStart(8, "0")}-1234-1234-1234-123456789abc`,
      texto_ocr: "OCR_ONLY_TEXT_DO_NOT_RENDER",
      texto_ia: {
        cargo: `Auxiliar ${number}`,
        titulo: `Auxiliar ${number}`,
        empresa: "Vaz Perfumes",
        salario: "No disponible",
        contacto: {
          link: "No disponible",
          correo: "No disponible",
          telefono: "No disponible",
        },
        ubicacion: "Cali",
        requisitos: ["Disponibilidad inmediata"],
        descripcion: `Auxiliar ${number} con disponibilidad inmediata.`,
        tipo_contrato: "No disponible",
      },
      imagen_url: "post/auxiliar.jpg",
      metadata: {},
    });
  });
  let supabaseReads = 0;
  const requestedLimits = [];
  const supabaseOrFilters = [];
  globalThis.fetch = async (requestUrl) => {
    supabaseReads += 1;
    const query = new URL(requestUrl);
    const limit = Number(query.searchParams.get("limit"));
    const offset = Number(query.searchParams.get("offset") || 0);
    requestedLimits.push({ limit, offset });
    supabaseOrFilters.push(...query.searchParams.getAll("or"));
    return new Response(JSON.stringify(posts.slice(offset, offset + limit)), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SITE_URL: "https://grupoavitar.com",
      ASSETS: {
        fetch: async () => new Response(
          "<!doctype html><html><head><!-- HOME_SEO --></head><body><!-- FEATURED_JOBS --></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
      },
    };
    const listing = await worker.fetch(new Request("https://grupoavitar.com/empleos"), env);
    const listingHtml = await listing.text();
    assert.equal(listing.status, 200);
    assert.equal((listingHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 50);
    assert.match(listingHtml, /Mostrando 50 en esta página/);
    assert.deepEqual(requestedLimits[0], { limit: 1000, offset: 0 });
    assert.deepEqual(supabaseOrFilters, []);

    const secondPage = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?page=2"),
      env,
    );
    assert.equal(secondPage.status, 400);

    const searchOne = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?q=Auxiliar%2051"),
      env,
    );
    const searchOneHtml = await searchOne.text();
    assert.equal((searchOneHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 1);
    assert.match(searchOneHtml, /Auxiliar 51/);

    const searchFirstPage = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?q=Auxiliar"),
      env,
    );
    const searchFirstPageHtml = await searchFirstPage.text();
    assert.equal(
      (searchFirstPageHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length,
      50,
    );
    assert.match(searchFirstPageHtml, /aria-label="Paginación"/);

    const searchSecondPage = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?q=Auxiliar&page=2"),
      env,
    );
    const searchSecondPageHtml = await searchSecondPage.text();
    assert.equal(searchSecondPage.status, 200);
    assert.equal(
      (searchSecondPageHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length,
      1,
    );

    const homepage = await worker.fetch(new Request("https://grupoavitar.com/"), env);
    const homepageHtml = await homepage.text();
    assert.equal(homepage.status, 200);
    assert.equal((homepageHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 12);
    assert.match(homepageHtml, /Auxiliar 12/);
    assert.doesNotMatch(homepageHtml, /Auxiliar 13/);
    assert.match(homepageHtml, /<form class="home-jobs-search" action="\/empleos" method="get" role="search">/);
    assert.match(homepageHtml, /<strong>51<\/strong> vacantes disponibles/);
    assert.match(homepageHtml, /"@type":"WebSite"/);
    assert.match(homepageHtml, /"@type":"SearchAction"/);
    assert.match(homepageHtml, /empleos\?q=\{search_term_string\}/);
    assert.doesNotMatch(homepageHtml, /FEATURED_JOBS|HOME_SEO/);
    assert.equal(supabaseReads, 1);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

test("serves robots.txt without querying Supabase", async () => {
  const response = await worker.fetch(
    new Request("https://grupoavitar.com/robots.txt"),
    { SITE_URL: "https://grupoavitar.com" },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Sitemap: https:\/\/grupoavitar\.com\/sitemap\.xml/);
});

test("la caché pública usa claves anónimas y rechaza claves de servicio", async () => {
  const previousCache = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const cache = new Map();
  globalThis.caches = {
    default: {
      match: async (request) => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone()),
    },
  };
  let supabaseReads = 0;
  globalThis.fetch = async () => {
    supabaseReads += 1;
    return new Response(JSON.stringify([publication()]), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SITE_URL: "https://grupoavitar.com",
    };
    await worker.fetch(new Request("https://grupoavitar.com/empleos"), env);
    const secondPage = await worker.fetch(new Request("https://grupoavitar.com/empleos"), env);
    assert.match(await secondPage.text(), /class="col-md-6 col-xl-4"/);
    const blocked = await worker.fetch(new Request("https://grupoavitar.com/empleos"), {
      ...env,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    });
    assert.equal(blocked.status, 503);
    assert.equal(supabaseReads, 1);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

test("getActiveVacancies consulta una sola vez por minuto sin filtros de Supabase", async () => {
  const previousCache = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const cache = new Map();
  const requestedUrls = [];
  globalThis.caches = {
    default: {
      match: async (request) => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone()),
    },
  };
  globalThis.fetch = async (url) => {
    requestedUrls.push(new URL(String(url)));
    return new Response(JSON.stringify([publication()]), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const env = { SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY, SITE_URL: "https://grupoavitar.com" };
  try {
    const first = await getActiveVacancies(env, new Date("2026-11-15T12:00:10.000Z"));
    const second = await getActiveVacancies(env, new Date("2026-11-15T12:00:59.000Z"));
    assert.deepEqual(second, first);
    assert.equal(requestedUrls.length, 1);
    assert.equal(requestedUrls[0].searchParams.get("limit"), "1000");
    assert.equal(requestedUrls[0].searchParams.getAll("or").length, 0);
    assert.equal(requestedUrls[0].searchParams.getAll("offset").length, 0);
    assert.ok(cache.size > 0);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

test("getActiveVacancies usa caché anterior hasta 10 minutos y luego falla", async () => {
  const previousCache = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  const cache = new Map();
  globalThis.caches = {
    default: {
      match: async (request) => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone()),
    },
  };
  globalThis.fetch = async () => new Response(JSON.stringify([publication()]), {
    headers: { "Content-Type": "application/json" },
  });
  const env = { SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY, SITE_URL: "https://grupoavitar.com" };
  try {
    await getActiveVacancies(env, new Date("2026-11-15T12:00:00.000Z"));
    globalThis.fetch = async () => {
      throw new Error("Supabase no disponible");
    };
    const fallback = await getActiveVacancies(env, new Date("2026-11-15T12:09:00.000Z"));
    assert.equal(fallback.length, 1);
    assert.ok(warnings.some((line) => line.includes("caché anterior")));
    await assert.rejects(
      getActiveVacancies(env, new Date("2026-11-15T12:11:00.000Z")),
      /Supabase no disponible/,
    );
  } finally {
    console.warn = previousWarn;
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

test("renders JSON vacancy data in the home, listing and detail server HTML", async () => {
  const previousCache = globalThis.caches;
  const previousFetch = globalThis.fetch;
  const cache = new Map();
  globalThis.caches = {
    default: {
      match: async (request) => cache.get(request.url)?.clone(),
      put: async (request, response) => cache.set(request.url, response.clone()),
    },
  };
  const textFilteredQueries = [];
  globalThis.fetch = async (requestUrl) => {
    const query = new URL(String(requestUrl));
    if (query.searchParams.has("or")) textFilteredQueries.push(query.search);
    return new Response(
      JSON.stringify([jsonPublication(), completeJsonPublication()]),
      { headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const env = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SITE_URL: "https://grupoavitar.com",
      ASSETS: {
        fetch: async () => new Response(
          "<!doctype html><html><head><!-- HOME_SEO --></head><body><!-- FEATURED_JOBS --></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
      },
    };

    const listing = await worker.fetch(new Request("https://grupoavitar.com/empleos"), env);
    const listingHtml = await listing.text();
    assert.equal(listing.status, 200);
    assert.equal((listingHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 2);
    assert.match(listingHtml, /Empresa:<\/strong> Vaz Perfumes/);
    assert.match(listingHtml, /Ubicación:<\/strong> No disponible/);
    assert.match(listingHtml, /Contrato:<\/strong> No disponible/);
    assert.match(listingHtml, /Contacto:<\/strong> No disponible/);
    assert.match(listingHtml, /Salario: No disponible/);
    assert.match(listingHtml, /Salario: \$1\.200\.000/);
    assert.match(listingHtml, /Requisitos:<\/strong> No disponible/);
    assert.match(listingHtml, /Requisitos:<\/strong> Experiencia en ventas/);
    assert.match(listingHtml, /"@type":"ItemList"/);
    assert.match(listingHtml, /<meta name="robots" content="index,follow">/);

    const detail = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/vaz-perfumes-11111111"),
      env,
    );
    const detailHtml = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(detailHtml, /<h1 class="jobs-detail-title" itemprop="headline">No disponible<\/h1>/);
    assert.match(detailHtml, /Empresa<\/dt><dd>Vaz Perfumes/);
    assert.match(detailHtml, /Ubicación<\/dt><dd>No disponible/);
    assert.match(detailHtml, /Salario<\/dt><dd>No disponible/);
    assert.match(detailHtml, /Tipo de contrato<\/dt><dd>No disponible/);
    assert.match(detailHtml, /Contacto<\/dt><dd>No disponible/);
    assert.match(detailHtml, /Requisitos<\/h2>\s*<p class="jobs-detail-copy">• No disponible/);
    assert.match(detailHtml, /catálogo de marcas de belleza/);
    assert.doesNotMatch(detailHtml, /"@type":"JobPosting"/);

    const completeDetail = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/asesor-de-ventas-cali-22222222"),
      env,
    );
    const completeHtml = await completeDetail.text();
    assert.equal(completeDetail.status, 200);
    assert.match(completeHtml, /Salario<\/dt><dd>\$1\.200\.000/);
    assert.match(completeHtml, /Tipo de contrato<\/dt><dd>Tiempo completo/);
    assert.match(completeHtml, /300 944 1676/);
    assert.match(completeHtml, /href="https:\/\/wa\.me\/573019441676"/);
    assert.match(completeHtml, /"@type":"JobPosting"/);
    assert.match(completeHtml, /"employmentType":"FULL_TIME"/);

    const home = await worker.fetch(new Request("https://grupoavitar.com/"), env);
    const homeHtml = await home.text();
    assert.equal(home.status, 200);
    assert.equal((homeHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 2);
    assert.match(homeHtml, /Vaz Perfumes/);
    assert.match(homeHtml, /Salario: No disponible/);
    assert.match(homeHtml, /"@type":"ItemList"/);
    assert.match(homeHtml, /<form class="home-jobs-search" action="\/empleos" method="get" role="search">/);
    assert.match(homeHtml, /<strong>2<\/strong> vacantes disponibles/);
    assert.match(homeHtml, /"@type":"WebSite"/);
    assert.match(homeHtml, /"@type":"SearchAction"/);
    assert.doesNotMatch(homeHtml, /FEATURED_JOBS|HOME_SEO/);
    assert.deepEqual(textFilteredQueries, []);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

function mockCleanupFetch({ oldRows = [], recentRows = [], imageStatus = () => 200 } = {}) {
  const deletedBatches = [];
  const readOffsets = [];
  const fetchMock = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/storage/")) {
      const status = imageStatus(url.pathname);
      if (status === "timeout") throw new Error("timeout simulado");
      return new Response(null, { status });
    }
    if (options.method === "DELETE") {
      deletedBatches.push(url.searchParams.get("id"));
      return new Response(null, { status: 204 });
    }
    const older = url.searchParams.get("fecha_publicacion")?.startsWith("lte.");
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 1000);
    readOffsets.push({ older, offset });
    const rows = older ? oldRows : recentRows;
    return new Response(JSON.stringify(rows.slice(offset, offset + limit)), {
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchMock, deletedBatches, readOffsets };
}

function cleanupFixtures() {
  return {
    oldRow: publication({
      id: "aaaaaaaa-1111-1111-1111-111111111111",
      fecha_publicacion: "2026-10-30T12:00:00.000Z",
    }),
    noImageRow: publication({ id: "bbbbbbbb-1111-1111-1111-111111111111", imagen_url: "" }),
    missingImageRow: publication({ id: "cccccccc-1111-1111-1111-111111111111", imagen_url: "post/missing.jpg" }),
    validRow: publication({ id: "dddddddd-1111-1111-1111-111111111111", imagen_url: "post/ok.jpg" }),
    notVacancyRow: publication({
      id: "eeeeeeee-1111-1111-1111-111111111111",
      texto_ia: null,
      texto_ocr: "",
      metadata: {},
    }),
  };
}

test("limpieza en modo prueba registra TODO sin borrar", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  const { oldRow, noImageRow, missingImageRow, validRow, notVacancyRow } = cleanupFixtures();
  const { fetchMock, deletedBatches } = mockCleanupFetch({
    oldRows: [oldRow, notVacancyRow],
    recentRows: [noImageRow, missingImageRow, validRow, notVacancyRow],
    imageStatus: (path) => (path.includes("/ok.jpg") ? 200 : 404),
  });
  globalThis.fetch = fetchMock;
  try {
    const result = await runCleanup({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SITE_URL: "https://grupoavitar.com",
      CLEANUP_DRY_RUN: "true",
    }, NOW);
    assert.equal(result.skipped, false);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.deleted, []);
    assert.deepEqual(result.wouldDelete, [oldRow.id, noImageRow.id, missingImageRow.id]);
    assert.equal(deletedBatches.length, 0);
    for (const id of [oldRow.id, noImageRow.id, missingImageRow.id]) {
      assert.ok(logs.some((line) => line.includes(id) && line.includes("Eliminaría")), id);
    }
  } finally {
    console.log = previousLog;
    globalThis.fetch = previousFetch;
  }
});

test("limpieza real acepta sb_secret y borra con cabeceras de servicio", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  console.log = () => {};
  const { oldRow, noImageRow, missingImageRow, validRow } = cleanupFixtures();
  const { fetchMock, deletedBatches } = mockCleanupFetch({
    oldRows: [oldRow],
    recentRows: [noImageRow, missingImageRow, validRow],
    imageStatus: (path) => (path.includes("/ok.jpg") ? 200 : 404),
  });
  const writeHeaders = [];
  globalThis.fetch = async (input, options = {}) => {
    if (options.method === "DELETE") writeHeaders.push(options.headers);
    return fetchMock(input, options);
  };
  try {
    const result = await runCleanup({
      SUPABASE_URL,
      SUPABASE_SECRET_KEY: "sb_secret_example",
      SITE_URL: "https://grupoavitar.com",
      CLEANUP_DRY_RUN: "false",
    }, NOW);
    assert.equal(result.dryRun, false);
    assert.deepEqual(result.deleted, [oldRow.id, noImageRow.id, missingImageRow.id]);
    assert.equal(deletedBatches.length, 1);
    assert.match(deletedBatches[0], new RegExp(oldRow.id));
    assert.doesNotMatch(deletedBatches[0], new RegExp(validRow.id));
    assert.equal(writeHeaders[0].apikey, "sb_secret_example");
    assert.equal(writeHeaders[0].Authorization, "Bearer sb_secret_example");
  } finally {
    console.log = previousLog;
    globalThis.fetch = previousFetch;
  }
});

test("limpieza aborta si los candidatos superan CLEANUP_MAX_DELETES", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const previousLog = console.log;
  console.error = () => {};
  console.log = () => {};
  const { oldRow, noImageRow, validRow } = cleanupFixtures();
  const secondOld = publication({
    id: "99999999-1111-1111-1111-111111111111",
    fecha_publicacion: "2026-10-29T12:00:00.000Z",
  });
  const { fetchMock, deletedBatches } = mockCleanupFetch({
    oldRows: [oldRow, secondOld],
    recentRows: [noImageRow, validRow],
    imageStatus: () => 200,
  });
  globalThis.fetch = fetchMock;
  try {
    const result = await runCleanup({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SITE_URL: "https://grupoavitar.com",
      CLEANUP_DRY_RUN: "false",
      CLEANUP_MAX_DELETES: "2",
    }, NOW);
    assert.equal(result.aborted, true);
    assert.equal(result.deleted.length, 0);
    assert.equal(result.wouldDelete.length, 3);
    assert.equal(deletedBatches.length, 0);
  } finally {
    console.error = previousError;
    console.log = previousLog;
    globalThis.fetch = previousFetch;
  }
});

test("limpieza no borra por host no permitido, timeout ni 5xx", async () => {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const previousLog = console.log;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  console.log = () => {};
  const { noImageRow, validRow } = cleanupFixtures();
  const foreignHost = publication({
    id: "12121212-1111-1111-1111-111111111111",
    imagen_url: "https://cdn.example.com/foto.jpg",
  });
  const timeoutRow = publication({
    id: "13131313-1111-1111-1111-111111111111",
    imagen_url: "post/timeout.jpg",
  });
  const serverErrorRow = publication({
    id: "14141414-1111-1111-1111-111111111111",
    imagen_url: "post/server-error.jpg",
  });
  const notFoundRow = publication({
    id: "15151515-1111-1111-1111-111111111111",
    imagen_url: "post/not-found.jpg",
  });
  const { fetchMock, deletedBatches } = mockCleanupFetch({
    oldRows: [],
    recentRows: [noImageRow, foreignHost, timeoutRow, serverErrorRow, notFoundRow, validRow],
    imageStatus: (path) => {
      if (path.includes("/timeout.jpg")) return "timeout";
      if (path.includes("/server-error.jpg")) return 503;
      if (path.includes("/not-found.jpg")) return 410;
      return 200;
    },
  });
  globalThis.fetch = fetchMock;
  try {
    const result = await runCleanup({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SITE_URL: "https://grupoavitar.com",
      CLEANUP_DRY_RUN: "false",
    }, NOW);
    assert.deepEqual(result.deleted, [noImageRow.id, notFoundRow.id]);
    assert.ok(warnings.some((line) => line.includes(foreignHost.id) && line.includes("host")));
    assert.equal(deletedBatches.length, 1);
    assert.doesNotMatch(deletedBatches[0], new RegExp(timeoutRow.id));
    assert.doesNotMatch(deletedBatches[0], new RegExp(serverErrorRow.id));
    assert.doesNotMatch(deletedBatches[0], new RegExp(foreignHost.id));
  } finally {
    console.warn = previousWarn;
    console.log = previousLog;
    globalThis.fetch = previousFetch;
  }
});

test("limpieza pagina las filas antiguas más allá de 1000", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  console.log = () => {};
  const oldRows = Array.from({ length: 1001 }, (_, index) => publication({
    id: `${String(index).padStart(8, "0")}-1111-1111-1111-111111111111`,
    fecha_publicacion: "2026-10-30T12:00:00.000Z",
    texto_ia: { cargo: `Puesto ${index}`, titulo: `Puesto ${index}`, empresa: "Empresa", descripcion: "Descripción", ubicacion: "Cali" },
  }));
  const { fetchMock, readOffsets } = mockCleanupFetch({ oldRows, recentRows: [] });
  globalThis.fetch = fetchMock;
  try {
    const result = await runCleanup({
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SITE_URL: "https://grupoavitar.com",
      CLEANUP_DRY_RUN: "true",
      CLEANUP_MAX_DELETES: "1000",
    }, NOW);
    assert.equal(result.aborted, true);
    assert.equal(result.wouldDelete.length, 1001);
    assert.ok(readOffsets.some((read) => read.older && read.offset === 1000));
  } finally {
    console.log = previousLog;
    globalThis.fetch = previousFetch;
  }
});

test("limpieza se omite sin clave de servicio", async () => {
  const result = await runCleanup({
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    SITE_URL: "https://grupoavitar.com",
  }, NOW);
  assert.deepEqual(result, {
    deleted: [], wouldDelete: [], reasons: {}, skipped: true, dryRun: true, aborted: false,
  });
});

test("Google Tag Manager is installed on every static page", () => {
  const root = new URL("../", import.meta.url);
  const files = readdirSync(root).filter((name) => name.endsWith(".html"));
  assert.ok(files.length > 0);
  for (const name of files) {
    const html = readFileSync(new URL(name, root), "utf8");
    assert.match(html, /GTM-WML4WJG8/, name);
    assert.match(html, /googletagmanager\.com\/gtm\.js\?id=/, name);
    assert.match(html, /googletagmanager\.com\/gtag\/js\?id=G-29YCBD5TL9/, name);
    assert.match(html, /googletagmanager\.com\/ns\.html\?id=GTM-WML4WJG8/, name);
    assert.match(html, /integrity="sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW\+ALEwIH"/, name);
    assert.match(html, /integrity="sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz"/, name);
    assert.doesNotMatch(html, /kit\.fontawesome\.com/, name);
    assert.doesNotMatch(html, /href="#" class="social-icon"/, name);
    assert.match(html, /<!-- TODO: URL redes -->/, name);
    assert.doesNotMatch(html, /rel="noopener"(?![a-z])/, name);
    assert.doesNotMatch(html, /arnaldozxc@gmail\.com/, name);
  }
});

test("SEO de páginas estáticas: canonical único, URLs limpias e imágenes locales", () => {
  const root = new URL("../", import.meta.url);
  const files = readdirSync(root).filter((name) => name.endsWith(".html"));
  const titles = [];
  for (const name of files) {
    const html = readFileSync(new URL(name, root), "utf8");
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title, name);
    titles.push(title);
    assert.match(html, /<link rel="canonical" href="https:\/\/grupoavitar\.com\/[^"]*">/, name);
    assert.doesNotMatch(html, /href="[^"]*\.html/, name);
    assert.doesNotMatch(html, /images\.unsplash\.com/, name);
    assert.match(html, /<meta property="og:title"/, name);
    assert.doesNotMatch(html, /informaci  n|Redacci  n|selecci  n|presentaci  n/, name);
  }
  assert.equal(new Set(titles).size, files.length);
});

test("el layout dinámico carga jobs.css en lugar de estilos en línea", async () => {
  const previousFetch = globalThis.fetch;
  const previousCache = globalThis.caches;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {} },
  };
  globalThis.fetch = async () => new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" },
  });
  try {
    const response = await worker.fetch(new Request("https://grupoavitar.com/empleos"), {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: ANON_KEY,
      SITE_URL: "https://grupoavitar.com",
    });
    const html = await response.text();
    assert.match(html, /\/assets\/css\/jobs\.css\?v=20261121/);
    assert.doesNotMatch(html, /<style>/);
    assert.match(html, /href="\/about"/);
    assert.doesNotMatch(html, /href="\/[^"]*\.html/);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.caches = previousCache;
  }
});

test("configuración del Worker público usa rutas y deshabilita workers_dev", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(config.workers_dev, false);
  assert.ok(config.routes.length > 0);
  assert.equal("triggers" in config, false);
  const jobsCss = readFileSync(new URL("../assets/css/jobs.css", import.meta.url), "utf8");
  assert.match(jobsCss, /\.jobs-hero \{/);
  assert.match(jobsCss, /\.jobs-card \{/);
});

test("_headers replica la CSP y cachea los estáticos", () => {
  const headers = readFileSync(new URL("../_headers", import.meta.url), "utf8");
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.match(headers, /img-src 'self' data: https:\/\/ebrwwhjmzygiryemnmcd\.supabase\.co/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Permissions-Policy: camera=\(\)/);
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin/);
  assert.match(headers, /\/assets\/\*\n  Cache-Control: public, max-age=604800/);
});

test("las políticas de cookies y privacidad describen GTM y GA4", () => {
  const cookies = readFileSync(new URL("../cookies.html", import.meta.url), "utf8");
  const privacy = readFileSync(new URL("../privacidad.html", import.meta.url), "utf8");
  assert.match(cookies, /Google Tag Manager/);
  assert.match(cookies, /Google Analytics 4/);
  assert.match(cookies, /La medición se usa únicamente para mejorar el sitio/);
  assert.match(privacy, /Google Analytics y Google Tag Manager/);
  assert.match(privacy, /No compartimos con ellos los datos que nos envías/);
});
