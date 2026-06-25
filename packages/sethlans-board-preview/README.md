# Sethlans Board — Preview

Backend + frontend in un solo processo Node.js zero-dipendenze, pensato per girare dentro
le sessioni Claude Code cloud/mobile (via **Claude Preview**, `.claude/launch.json`), dove
Docker e un ambiente Python affidabile non sono garantiti.

Non sostituisce `packages/sethlans-board` (FastAPI + React, deployment Docker/Postgres "di
produzione"): è un companion artifact con lo **stesso contratto REST**, così l'MCP server e
le skill del plugin `sethlans` funzionano senza modifiche, puntando di default a
`http://localhost:9955`.

## Avvio

```bash
cd packages/sethlans-board-preview
node server.mjs
```

Oppure via Claude Preview, che legge `.claude/launch.json` nella root del repo e lancia lo
stesso comando in questa cartella. Porta di default **9955** (override con `PORT` o
`SETHLANS_SERVICE_PORT`).

## Modalita' embedded / proxy

Il server e' **bimodale**, modalita' scelta **all'avvio** (non per-richiesta) dalla variabile
`SETHLANS_UPSTREAM_URL`:

- **assente/vuota** → modalita' **embedded** (comportamento descritto sopra, invariato):
  le route REST sono servite dal Router locale su `node:sqlite` (`data/board.db`).
- **presente** (es. `http://localhost:9955`) → modalita' **proxy**: tutte le route REST
  (`/state`, `/projects`, `/epics`, `/stories`, `/tasks`, `/agents`, `/knowledge`,
  `/mockup-comments`, `/mockups`) sono reverse-proxate verso l'upstream — metodo, header
  rilevanti, body grezzo e status code/corpo della risposta inoltrati invariati (incl. il
  **422** `{"detail": "..."}` degli enum non validi). In questa modalita' il SQLite embedded
  **non viene toccato**.

In entrambe le modalita' il frontend in `public/` resta invariato: continua a fare
`fetch("/state")` same-origin, che in proxy mode viene semplicemente inoltrato all'upstream.
Lo static serving e' sempre locale.

Esempio locale, per non collidere con il Docker su `:9955`:

```bash
PORT=9966 SETHLANS_UPSTREAM_URL=http://localhost:9955 node server.mjs
```

## Persistenza

Il database SQLite vive in `data/board.db` ed è **committato in git**: è il modo in cui i
dati sopravvivono tra sessioni cloud/mobile effimere (il container viene distrutto alla
fine della sessione). Ogni scrittura significativa (creazione/modifica progetti, epiche,
storie, task, ecc.) andrebbe seguita da un commit se si vuole conservarla.

`PRAGMA journal_mode = DELETE` (non WAL): nessun file collaterale `-wal`/`-shm`, il `.db`
riflette sempre lo stato corrente al millisecondo, quindi è sempre sicuro da committare.

## Contratto API

Stesso contratto di `packages/sethlans-board/backend/server.py` — vedi anche
`packages/sethlans-claude-plugin/board-protocol.md`:

- CRUD su `/projects`, `/epics`, `/stories`, `/tasks`, `/agents`, `/knowledge`,
  `/mockup-comments`.
- `GET /state` → snapshot completo `{projects, epics, stories, tasks, agents, knowledge,
  mockup_comments}`.
- `GET /mockups?epic_id=|story_id=|task_id=` → aggregazione blocchi ` ```mockup ``` ` con
  conteggio commenti.
- Enum non validi → **HTTP 422** con corpo `{"detail": "..."}` (mai 400/500).
- CORS aperto (`*`), `OPTIONS` gestito con 204.

## Frontend

`public/` è vanilla JS senza build step: accordion nativi `<details>/<summary>` per
Epica → Storie → Task (layout verticale, mobile-first), invece delle 3 colonne
todo/progress/done della board desktop. Poll di `GET /state` ogni 4s; lo stato di apertura
degli accordion è tenuto separato dai dati (`state.expanded`) e non viene toccato dal poll.

Il viewer è volutamente **ridotto**: mostra gerarchia, stati, fasi e conteggio mockup
(`🖼 N`), ma non renderizza mockup/knowledge/commenti inline. Per quel contenuto ricco,
su epiche/storie con `mockup_descendant_count > 0` e task con `mockup_count > 0`, se la
board React completa è raggiungibile (vedi `SETHLANS_BOARD_WEB_URL` sotto) viene mostrato
un link discreto **"Apri nella board"** che apre quella istanza in una nuova scheda. Il
link punta alla **root** della board (non esiste deep-link granulare a una specifica
epica/storia/task: il React di `packages/sethlans-board/frontend` non ha routing su
URL/hash/query-param — vedi `App.jsx`). **Estensione futura**: deep-link puntuale
all'entità, subordinato all'introduzione di routing nel React.

### `GET /config` e `SETHLANS_BOARD_WEB_URL`

Endpoint locale (non fa parte del contratto REST della board, non proxato, non gated dal
token anche se `SETHLANS_SERVICE_API_TOKEN` è settata) che esporre al frontend l'URL della
board React completa, se configurato:

```
GET /config  →  200  { "board_web_url": "http://localhost:5173" }   # se SETHLANS_BOARD_WEB_URL è settata
GET /config  →  200  { "board_web_url": null }                       # se non settata
```

`SETHLANS_BOARD_WEB_URL` è **opzionale**, letta una sola volta all'avvio (come
`SETHLANS_UPSTREAM_URL`/`SETHLANS_SERVICE_API_TOKEN`): es. `http://localhost:5173` in
locale, l'URL pubblico (Render o altro hosting) in remoto. Se assente, il frontend non
mostra alcun link — comportamento invariato, utile nel caso cloud "usa e getta" dove la
React non è disponibile.

## Note di manutenzione

`node:sqlite` (`DatabaseSync`) è **experimental** in Node 22 — stampa un
`ExperimentalWarning` cosmetico su stderr all'avvio, nessun flag richiesto. Da riverificare
ad ogni major bump di Node nel sandbox.
