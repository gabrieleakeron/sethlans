import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { sendJson, parseQuery } from "./src/http-helpers.mjs";
import { serveStatic } from "./src/static.mjs";

// Prefissi delle route REST del contratto della board (vedi board-protocol.md). Usati per
// discriminare API-vs-static in modalita' proxy, dove non esiste un Router locale da
// interrogare con match(): qualunque pathname che inizia con uno di questi va inoltrato
// all'upstream, il resto e' servito da public/ (FE invariato).
const REST_PREFIXES = [
  "/state",
  "/projects",
  "/epics",
  "/stories",
  "/tasks",
  "/agents",
  "/knowledge",
  "/mockup-comments",
  "/mockups",
];

function isRestPath(pathname) {
  return REST_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Confronto a tempo costante del token (vedi "## Contratto auth" della storia
// s69413e22): timingSafeEqual richiede buffer di pari lunghezza, quindi gestiamo
// la lunghezza diversa come "non valido" senza farlo lanciare (e senza fare un
// confronto a lunghezza variabile, che reintrodurrebbe il leak via timing).
function isValidToken(expected, received) {
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// Costruisce l'handler REST in modalita' EMBEDDED (Router + route + node:sqlite). Tutti gli
// import del chain DB sono dinamici e raggiunti SOLO da questo ramo: importarli staticamente
// in cima al file farebbe creare data/board.db anche in modalita' proxy (side-effect di
// src/db.mjs a import-time), violando il vincolo di isolamento delle due modalita'.
async function buildEmbeddedHandler() {
  const { Router } = await import("./src/router.mjs");
  const { readJsonBody } = await import("./src/http-helpers.mjs");
  const { HttpError } = await import("./src/http-errors.mjs");

  const { registerProjectRoutes } = await import("./src/routes/projects.mjs");
  const { registerEpicRoutes } = await import("./src/routes/epics.mjs");
  const { registerStoryRoutes } = await import("./src/routes/stories.mjs");
  const { registerTaskRoutes } = await import("./src/routes/tasks.mjs");
  const { registerAgentRoutes } = await import("./src/routes/agents.mjs");
  const { registerKnowledgeRoutes } = await import("./src/routes/knowledge.mjs");
  const { registerMockupCommentRoutes } = await import("./src/routes/mockupComments.mjs");
  const { registerMockupAggregationRoutes } = await import("./src/routes/mockups.mjs");
  const { registerStateRoutes } = await import("./src/routes/state.mjs");

  const router = new Router();
  registerProjectRoutes(router);
  registerEpicRoutes(router);
  registerStoryRoutes(router);
  registerTaskRoutes(router);
  registerAgentRoutes(router);
  registerKnowledgeRoutes(router);
  registerMockupCommentRoutes(router);
  registerMockupAggregationRoutes(router);
  registerStateRoutes(router);

  return async function embeddedHandler(req, res, pathname, query) {
    const match = router.match(req.method, pathname);

    if (!match) {
      // Nessuna route REST per questo metodo+path: stesso fallback di sempre (404 JSON,
      // lo static serving per i GET e' gia' stato gestito a monte da isRestPath/server).
      sendJson(res, 404, { detail: "non trovato" });
      return;
    }

    try {
      let body = {};
      if (req.method === "POST" || req.method === "PATCH") {
        body = await readJsonBody(req);
      }
      const result = await match.handler(req, res, match.params, query, body);
      if (Array.isArray(result) && result.length === 2 && typeof result[0] === "number") {
        sendJson(res, result[0], result[1]);
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { detail: err.message });
      } else {
        console.error(err);
        sendJson(res, 500, { detail: "errore interno" });
      }
    }
  };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "*",
  "Access-Control-Allow-Headers": "*",
};

async function main() {
  // Switch di modalita' deciso UNA VOLTA all'avvio (non per-richiesta): vuoto/assente ⇒
  // embedded (comportamento attuale, invariato); presente ⇒ proxy verso l'upstream REST.
  const upstream = (process.env.SETHLANS_UPSTREAM_URL || "").trim();
  const mode = upstream ? "proxy" : "embedded";

  // Token condiviso opzionale (vedi "## Contratto auth" della storia s69413e22, source of
  // truth, replicato identico al middleware FastAPI). Letto una volta sola all'avvio: vuoto/
  // assente ⇒ nessuna auth, comportamento invariato (default retro-compatibile).
  const apiToken = (process.env.SETHLANS_SERVICE_API_TOKEN || "").trim();

  // URL della board React completa (storia s50550dcb, "## Decisioni architetturali" §1),
  // opzionale: usato dal FE del viewer ridotto per mostrare il link "Apri nella board" sulle
  // entita' con mockup. Letto una volta sola all'avvio (come upstream/apiToken sopra), mai
  // riletto per-richiesta; vuoto/assente ⇒ null (nessun link lato FE, invariato).
  const boardWebUrl = (process.env.SETHLANS_BOARD_WEB_URL || "").trim() || null;

  const restHandler = upstream
    ? (await import("./src/proxy.mjs")).buildProxyHandler(upstream)
    : await buildEmbeddedHandler();

  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const { pathname, query } = parseQuery(req.url);

    // GET /config: concern locale del preview (NON fa parte del contratto REST della board),
    // gestito qui PRIMA del check isRestPath/restHandler cosi' funziona identico in embedded e
    // proxy. Volutamente fuori da REST_PREFIXES: altrimenti in proxy verrebbe inoltrato
    // all'upstream (dove non esiste) e gli si applicherebbe il gate auth a token sotto — deve
    // restare senza auth e non proxato (storia s50550dcb, "## Decisioni architetturali" §1).
    if (pathname === "/config") {
      if (req.method === "GET") {
        sendJson(res, 200, { board_web_url: boardWebUrl });
      } else {
        sendJson(res, 404, { detail: "non trovato" });
      }
      return;
    }

    // Static serving sempre locale in entrambe le modalita': la discriminazione API-vs-static
    // usa i prefissi REST del contratto. In embedded il Router fa comunque match fine per
    // metodo+path (un GET su un prefisso REST senza route esatta torna 404 JSON, non static),
    // esattamente come nel comportamento originale pre-bimodale.
    if (!isRestPath(pathname)) {
      if (req.method === "GET") {
        serveStatic(req, res);
      } else {
        sendJson(res, 404, { detail: "non trovato" });
      }
      return;
    }

    // Gate auth a token condiviso (solo route REST: OPTIONS e static sono gia' usciti sopra).
    // Un solo check qui copre ENTRAMBE le modalita' (embedded e proxy) perche' e' a monte di
    // restHandler. Se SETHLANS_SERVICE_API_TOKEN non e' settata, nessuna auth (invariato).
    if (apiToken) {
      const received = req.headers["x-sethlans-token"];
      if (typeof received !== "string" || !isValidToken(apiToken, received)) {
        sendJson(res, 401, { detail: "token mancante o non valido" });
        return;
      }
    }

    await restHandler(req, res, pathname, query);
  });

  const port = Number(process.env.PORT || process.env.SETHLANS_SERVICE_PORT || 9955);
  server.listen(port, "0.0.0.0", () => {
    // server.address().port riflette la porta effimera reale quando port=0 (es. nei test);
    // con una porta esplicita coincide semplicemente con port.
    const boundPort = server.address().port;
    console.log(`Sethlans Board Preview (${mode}) in ascolto su http://0.0.0.0:${boundPort}`);
  });
}

main();
