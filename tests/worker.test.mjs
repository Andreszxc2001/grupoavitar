import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
import {
  activeVacancies,
  extractLocation,
  extractSalary,
  extractTitle,
  isPublicSupabaseKey,
  isServiceRoleKey,
  isVacancy,
  resolveImageUrl,
} from "../worker.mjs";

const SUPABASE_URL = "https://example.supabase.co";
const NOW = new Date("2026-11-15T12:00:00.000Z");

function publication(overrides = {}) {
  return {
    id: "12345678-1234-1234-1234-123456789abc",
    fecha_publicacion: "2026-11-14T12:00:00.000Z",
    tipo: "imagen",
    texto_ocr: "Se busca panadero artesanal. Ciudad: Santa Marta. Salario: $1.500.000. OCR_ONLY_TEXT_DO_NOT_RENDER",
    texto_ia: "Cargo: Panadero artesanal\nUbicación: Santa Marta\nSalario: $1.500.000",
    imagen_url: "post/foto.jpg",
    canal_nombre: "Empleos",
    canal_url: "https://example.com/canal",
    metadata: {},
    ...overrides,
  };
}

test("classifies explicit hiring posts, not job-seeker messages", () => {
  assert.equal(isVacancy(publication()), true);
  assert.equal(
    isVacancy(
      publication({
        tipo: "texto",
        texto_ocr: "",
        texto_ia:
          "**Buscamos Auxiliar Operativo en Cartagena**\nFunciones: apoyo administrativo.\nRequisitos: experiencia previa. Enviar hoja de vida.",
      }),
    ),
    true,
  );
  assert.equal(
    isVacancy(
      publication({
        tipo: "imagen",
        texto_ocr: "",
        texto_ia: "**Oportunidad laboral: Ingeniero de Procesos**",
      }),
    ),
    true,
  );
  assert.equal(
    isVacancy(
      publication({
        tipo: "texto",
        texto_ocr: "Busco empleo como panadero, tengo experiencia.",
        texto_ia: "Persona busca trabajo como panadero.",
      }),
    ),
    false,
  );
  assert.equal(
    isVacancy(
      publication({
        tipo: "imagen",
        texto_ocr: "Promoción de curso de panadería artesanal.",
        texto_ia: "",
      }),
    ),
    false,
  );
});

test("extracts title, location, and salary only from source text or metadata", () => {
  const post = publication();
  assert.equal(extractTitle(post.texto_ia, post.texto_ocr), "Panadero artesanal");
  assert.equal(extractTitle("**Vacante: Auxiliar de bodega**", ""), "Auxiliar de bodega");
  assert.equal(extractLocation(post.texto_ia, {}), "Santa Marta");
  assert.equal(extractSalary(post.texto_ia, {}), "$1.500.000");
  assert.equal(extractLocation("Buscamos panadero", {}), "");
  assert.equal(extractSalary("Buscamos panadero", {}), "");
  assert.equal(extractLocation("", { city: "Cali" }), "Cali");
});

test("keeps image URLs untransformed and resolves storage object paths", () => {
  assert.equal(
    resolveImageUrl("post/foto original.jpg", SUPABASE_URL),
    "https://example.supabase.co/storage/v1/object/public/imagenes_posts/post/foto%20original.jpg",
  );
  assert.equal(
    resolveImageUrl("https://cdn.example.com/original.jpg", SUPABASE_URL),
    "https://cdn.example.com/original.jpg",
  );
  assert.equal(resolveImageUrl("javascript:alert(1)", SUPABASE_URL), "");
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

test("refuses a Supabase service-role key and accepts public keys", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.equal(isPublicSupabaseKey(`header.${encode({ role: "service_role" })}.signature`), false);
  assert.equal(isPublicSupabaseKey(`header.${encode({ role: "anon" })}.signature`), true);
  assert.equal(isPublicSupabaseKey("sb_publishable_example"), true);
  assert.equal(isServiceRoleKey(`header.${encode({ role: "service_role" })}.signature`), true);
  assert.equal(isServiceRoleKey(undefined), false);
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
  const serviceKey = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
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
        imagen_url: "",
        texto_ocr: "Se busca auxiliar de bodega.",
        texto_ia: "Vacante: Auxiliar de bodega\nFunciones: apoyo en inventario.",
        metadata: { city: "Cartagena" },
      }),
    ]), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      SITE_URL: "https://grupoavitar.com",
    };
    const listing = await worker.fetch(
      new Request("https://grupoavitar.com/empleos"),
      env,
    );
    const listingHtml = await listing.text();
    assert.equal(listing.status, 200);
    assert.match(listingHtml, /<h1>Encuentra una oportunidad/);
    assert.match(listingHtml, /href="\/about\.html">Nosotros/);
    assert.match(listingHtml, /href="\/services\.html">Servicios/);
    assert.match(listingHtml, /href="\/empleos" aria-current="page">Empleos/);
    assert.match(listingHtml, /href="\/contact\.html">Contacto/);
    assert.match(listingHtml, /id="mainNav"/);
    assert.match(listingHtml, /\/assets\/js\/main\.js/);
    assert.match(listingHtml, /googletagmanager\.com\/gtag\/js\?id=G-29YCBD5TL9/);
    assert.match(listingHtml, /gtag\('config', 'G-29YCBD5TL9'\)/);
    assert.doesNotMatch(listingHtml, /Se busca panadero artesanal|OCR_ONLY_TEXT_DO_NOT_RENDER/);
    assert.match(listingHtml, /<link rel="canonical" href="https:\/\/grupoavitar\.com\/empleos">/);
    assert.match(listingHtml, /panadero-artesanal-santa-marta-12345678/);
    assert.match(listingHtml, /src="\/assets\/img\/empleo-placeholder\.svg"/);
    assert.match(listingHtml, /alt="Imagen ilustrativa de una oportunidad laboral"/);
    assert.match(listingHtml, /kit\.fontawesome\.com\/3140323153\.js/);
    assert.match(listingHtml, /Ver detalle/);
    assert.match(listingHtml, /fa-solid fa-arrow-right/);
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
    assert.match(detailHtml, /<h1 class="jobs-detail-title" itemprop="headline">Panadero artesanal<\/h1>/);
    assert.match(detailHtml, /jobs-detail-grid/);
    assert.match(detailHtml, /Información clave/);
    assert.match(detailHtml, /wa\.me\/573019441676\?text=/);
    assert.match(detailHtml, /Crear mi hoja de vida/);
    assert.match(detailHtml, /fa-brands fa-whatsapp/);
    assert.match(detailHtml, /Panadero%20artesanal/);
    assert.match(detailHtml, /property="og:image"/);
    assert.doesNotMatch(detailHtml, /Se busca panadero artesanal|OCR_ONLY_TEXT_DO_NOT_RENDER|\*\*/);

    const noImageDetail = await worker.fetch(
      new Request("https://grupoavitar.com/empleos/auxiliar-de-bodega-cartagena-aaaaaaaa"),
      env,
    );
    const noImageDetailHtml = await noImageDetail.text();
    assert.equal(noImageDetail.status, 200);
    assert.match(noImageDetailHtml, /<h1 class="jobs-detail-title" itemprop="headline">Auxiliar de bodega<\/h1>/);
    assert.match(noImageDetailHtml, /src="\/assets\/img\/empleo-placeholder\.svg"/);
    assert.match(detailHtml, /Descripción/);
    assert.equal(supabaseReads, 1);
    assert.equal(forwardedKey, serviceKey);
    assert.equal(detailHtml.includes(serviceKey), false);
    assert.equal(noImageDetailHtml.includes(serviceKey), false);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});

test("shows 50 jobs per listing page and 12 featured jobs on the homepage", async () => {
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
      texto_ocr: `Vacante para auxiliar número ${number}.`,
      texto_ia: `Vacante: Auxiliar ${number}\nRequisitos: disponibilidad inmediata.`,
      imagen_url: "",
      metadata: { city: "Cali" },
    });
  });
  let supabaseReads = 0;
  globalThis.fetch = async () => {
    supabaseReads += 1;
    return new Response(JSON.stringify(posts), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
      SITE_URL: "https://grupoavitar.com",
      ASSETS: {
        fetch: async () => new Response(
          "<!doctype html><html><body><!-- FEATURED_JOBS --></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
      },
    };
    const listing = await worker.fetch(new Request("https://grupoavitar.com/empleos"), env);
    const listingHtml = await listing.text();
    assert.equal(listing.status, 200);
    assert.equal((listingHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 50);

    const secondPage = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?page=2"),
      env,
    );
    const secondPageHtml = await secondPage.text();
    assert.equal((secondPageHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 1);

    const searchAllPages = await worker.fetch(
      new Request("https://grupoavitar.com/empleos?q=Auxiliar%2051"),
      env,
    );
    const searchHtml = await searchAllPages.text();
    assert.equal((searchHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 1);
    assert.match(searchHtml, /Auxiliar 51/);

    const homepage = await worker.fetch(new Request("https://grupoavitar.com/"), env);
    const homepageHtml = await homepage.text();
    assert.equal(homepage.status, 200);
    assert.equal((homepageHtml.match(/<article class="col-md-6 col-xl-4">/g) || []).length, 12);
    assert.match(homepageHtml, /Auxiliar 12/);
    assert.doesNotMatch(homepageHtml, /Auxiliar 13/);
    assert.doesNotMatch(homepageHtml, /FEATURED_JOBS/);
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

test("separates cached anonymous reads from service-role reads", async () => {
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
    const anonEnv = {
      SUPABASE_URL,
      SUPABASE_ANON_KEY: "header.eyJyb2xlIjoiYW5vbiJ9.signature",
      SITE_URL: "https://grupoavitar.com",
    };
    const serviceEnv = {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
      SITE_URL: anonEnv.SITE_URL,
    };
    await worker.fetch(new Request("https://grupoavitar.com/empleos"), anonEnv);
    const servicePage = await worker.fetch(
      new Request("https://grupoavitar.com/empleos"),
      serviceEnv,
    );
    assert.match(await servicePage.text(), /class="col-md-6 col-xl-4"/);
    assert.equal(supabaseReads, 2);
  } finally {
    globalThis.caches = previousCache;
    globalThis.fetch = previousFetch;
  }
});
