import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";
import {
  activeVacancies,
  isPublicSupabaseKey,
  isServiceRoleKey,
  isVacancy,
  parseJsonObject,
  resolveImageUrl,
  vacancyJsonFromSources,
} from "../worker.mjs";

const SUPABASE_URL = "https://example.supabase.co";
const NOW = new Date("2026-11-15T12:00:00.000Z");

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
    imagen_url: "",
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
    assert.match(listingHtml, /<footer class="footer-nexora">/);
    assert.match(listingHtml, /logo1\.png/);
    assert.match(listingHtml, /href="\/privacidad\.html"/);
    assert.match(listingHtml, /Escribir por WhatsApp/);
    assert.match(listingHtml, /href="\/assets\/favicon\/favicon-32x32\.png"/);
    assert.match(listingHtml, /href="\/assets\/favicon\/favicon\.ico"/);
    assert.match(listingHtml, /googletagmanager\.com\/gtag\/js\?id=G-29YCBD5TL9/);
    assert.match(listingHtml, /gtag\('config', 'G-29YCBD5TL9'\)/);
    assert.doesNotMatch(listingHtml, /vacancy_whatsapp_click|view_vacancy/);
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
    assert.match(detailHtml, /id="vacancy-whatsapp-cta"/);
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

    assert.ok(supabaseReads >= 4);
    assert.equal(forwardedKey, serviceKey);
    assert.equal(detailHtml.includes(serviceKey), false);
    assert.equal(noImageDetailHtml.includes(serviceKey), false);
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
      imagen_url: "",
      metadata: {},
    });
  });
  let supabaseReads = 0;
  const requestedLimits = [];
  globalThis.fetch = async (requestUrl) => {
    supabaseReads += 1;
    const query = new URL(requestUrl);
    const limit = Number(query.searchParams.get("limit"));
    const offset = Number(query.searchParams.get("offset") || 0);
    requestedLimits.push({ limit, offset });
    const orFilters = query.searchParams.getAll("or");
    const matches = posts.filter((post) => orFilters.every((filter) => {
      const patterns = [...filter.matchAll(/ilike\.\*([^*]+)\*/g)].map((match) => match[1]);
      return patterns.some((pattern) => [JSON.stringify(post.texto_ia), post.texto_ocr, post.canal_nombre]
        .some((value) => String(value).toLowerCase().includes(pattern)));
    }));
    return new Response(JSON.stringify(matches.slice(offset, offset + limit)), {
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
    assert.deepEqual(requestedLimits[0], { limit: 100, offset: 0 });

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
    assert.ok(supabaseReads >= 5);
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
      SUPABASE_SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
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
