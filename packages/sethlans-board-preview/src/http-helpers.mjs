import { HttpError } from "./http-errors.mjs";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // margine sopra i 2MB di immagini commento (base64 + envelope JSON)

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "body troppo grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(422, "body JSON non valido"));
      }
    });
    req.on("error", reject);
  });
}

export function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx === -1) return { pathname: url, query: {} };
  const pathname = url.slice(0, idx);
  const query = Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
  return { pathname, query };
}
