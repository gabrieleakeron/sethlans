// Reverse-proxy verso un upstream REST esterno (es. il BE FastAPI Docker su :9955), usato
// in modalita' "proxy" del preview (vedi server.mjs). Passthrough trasparente: stesso metodo,
// stessi header rilevanti, stesso body grezzo, stesso status code/corpo della risposta —
// incluso il 422 {"detail": "..."} degli enum non validi del contratto REST della board.
//
// Zero dipendenze: usa il fetch globale di Node. Nessuna logica di persistenza: il SQLite
// embedded (src/db.mjs) NON va importato in questo modulo né da chi lo richiama in proxy mode.

const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

const REQUEST_TIMEOUT_MS = 30_000;

function buildForwardHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  // Auth a token condiviso (vedi "## Contratto auth" della storia s69413e22): il proxy
  // autentica SE STESSO verso l'upstream con la PROPRIA variabile d'ambiente, non fa un
  // passthrough cieco dell'header in ingresso. Se SETHLANS_SERVICE_API_TOKEN e' settata lato
  // proxy, set/override di X-Sethlans-Token con quel valore (sovrascrive un eventuale header
  // arrivato dal browser). Se non settata, l'eventuale header in ingresso resta invariato
  // (passthrough), comportamento retro-compatibile.
  const apiToken = (process.env.SETHLANS_SERVICE_API_TOKEN || "").trim();
  if (apiToken) {
    headers.set("X-Sethlans-Token", apiToken);
  }

  return headers;
}

function buildResponseHeaders(upstreamRes) {
  const headers = {};
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    // I CORS li mette già il nostro createServer: non ricopiarli dall'upstream per evitare
    // header duplicati/contraddittori (Access-Control-Allow-Origin doppio, ecc.).
    if (key.toLowerCase().startsWith("access-control-")) continue;
    headers[key] = value;
  }
  return headers;
}

/**
 * Costruisce l'handler delle route REST in modalita' proxy.
 * Stessa firma dell'handler usato in modalita' embedded: async (req, res, pathname, query).
 */
export function buildProxyHandler(upstreamBase) {
  return async function proxyHandler(req, res, pathname, query) {
    const targetUrl = new URL(req.url, upstreamBase);

    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers: buildForwardHeaders(req),
        // Body grezzo (stream), mai riparsato come JSON: preserva byte-per-byte payload come
        // immagini base64 nei commenti. duplex:"half" e' richiesto da Node per inoltrare un
        // ReadableStream come body di una fetch con metodo che lo prevede.
        body: hasBody ? req : undefined,
        duplex: hasBody ? "half" : undefined,
        signal: controller.signal,
      });

      const responseBody = Buffer.from(await upstreamRes.arrayBuffer());
      res.writeHead(upstreamRes.status, buildResponseHeaders(upstreamRes));
      res.end(responseBody);
    } catch (err) {
      const reason = err && err.message ? err.message : String(err);
      const payload = JSON.stringify({ detail: `upstream non raggiungibile: ${reason}` });
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    } finally {
      clearTimeout(timeout);
    }
  };
}
