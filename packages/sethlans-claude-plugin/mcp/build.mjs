#!/usr/bin/env node
// Build MCP server — wrapper per build tool Java (Gradle e Maven).
// Zero dipendenze: usa child_process di Node. Stesso pattern stdio di server.mjs
// (JSON-RPC 2.0 su stdin/stdout, newline-delimited).
//
// Tool esposti:
//   build_gradle      — esegue task Gradle (./gradlew se presente, altrimenti gradle)
//   build_maven       — esegue goal Maven  (./mvnw   se presente, altrimenti mvn)
//   build_list_tasks  — elenca task Gradle o lifecycle Maven standard
//
// Niente timeout di default esagerati: 2 minuti per task singoli, configurabile.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const SERVER_INFO = { name: "build", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2024-11-05";
const DEFAULT_TIMEOUT_MS = 120_000;

// ----------------------------- esecuzione processo -----------------------------

function runProcess(cmd, args, cwd, timeoutMs) {
  return new Promise((done) => {
    const out = [];
    const err = [];
    const proc = spawn(cmd, args, { cwd, shell: false });
    const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);

    proc.stdout.on("data", (d) => out.push(d));
    proc.stderr.on("data", (d) => err.push(d));
    proc.on("close", (code) => {
      clearTimeout(timer);
      done({
        exit_code: code ?? -1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        success: code === 0,
      });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      done({ exit_code: -1, stdout: "", stderr: e.message, success: false });
    });
  });
}

// Preferisce il wrapper locale (./gradlew / ./mvnw) al comando globale.
function gradleCmd(cwd) {
  return existsSync(join(cwd, "gradlew")) ? "./gradlew" : "gradle";
}
function mavenCmd(cwd) {
  return existsSync(join(cwd, "mvnw")) ? "./mvnw" : "mvn";
}

// ----------------------------- definizione dei tool -----------------------------

const TOOLS = [
  {
    name: "build_gradle",
    description:
      "Esegue uno o più task Gradle nel progetto indicato. Usa ./gradlew se presente, " +
      "altrimenti gradle dal PATH. Ritorna exit_code, stdout, stderr e success.",
    inputSchema: {
      type: "object",
      properties: {
        working_dir: {
          type: "string",
          description: "Percorso assoluto della root del progetto Gradle.",
        },
        tasks: {
          type: "array",
          items: { type: "string" },
          description: "Task da eseguire (es. ['test'], ['clean', 'build']).",
        },
        extra_args: {
          type: "array",
          items: { type: "string" },
          description: "Argomenti aggiuntivi passati a Gradle (es. ['--info', '-x', 'integrationTest']).",
        },
        timeout_ms: {
          type: "integer",
          description: "Timeout in ms (default 120000).",
        },
      },
      required: ["working_dir", "tasks"],
    },
    handler: async ({ working_dir, tasks, extra_args = [], timeout_ms = DEFAULT_TIMEOUT_MS }) => {
      const cwd = resolve(working_dir);
      return runProcess(gradleCmd(cwd), [...tasks, ...extra_args], cwd, timeout_ms);
    },
  },

  {
    name: "build_maven",
    description:
      "Esegue uno o più goal Maven nel progetto indicato. Usa ./mvnw se presente, " +
      "altrimenti mvn dal PATH. Ritorna exit_code, stdout, stderr e success.",
    inputSchema: {
      type: "object",
      properties: {
        working_dir: {
          type: "string",
          description: "Percorso assoluto della root del progetto Maven.",
        },
        goals: {
          type: "array",
          items: { type: "string" },
          description: "Goal da eseguire (es. ['test'], ['clean', 'package', '-DskipITs']).",
        },
        extra_args: {
          type: "array",
          items: { type: "string" },
          description: "Argomenti aggiuntivi passati a Maven (es. ['-Pprod', '-DskipTests']).",
        },
        timeout_ms: {
          type: "integer",
          description: "Timeout in ms (default 120000).",
        },
      },
      required: ["working_dir", "goals"],
    },
    handler: async ({ working_dir, goals, extra_args = [], timeout_ms = DEFAULT_TIMEOUT_MS }) => {
      const cwd = resolve(working_dir);
      return runProcess(mavenCmd(cwd), [...goals, ...extra_args], cwd, timeout_ms);
    },
  },

  {
    name: "build_list_tasks",
    description:
      "Elenca i task disponibili. Per Gradle: ./gradlew tasks --all. " +
      "Per Maven: ritorna i goal del lifecycle standard (non esiste un comando equivalente).",
    inputSchema: {
      type: "object",
      properties: {
        working_dir: {
          type: "string",
          description: "Percorso assoluto della root del progetto.",
        },
        tool: {
          type: "string",
          enum: ["gradle", "maven"],
          description: "gradle | maven.",
        },
      },
      required: ["working_dir", "tool"],
    },
    handler: async ({ working_dir, tool }) => {
      const cwd = resolve(working_dir);
      if (tool === "gradle") {
        return runProcess(gradleCmd(cwd), ["tasks", "--all"], cwd, DEFAULT_TIMEOUT_MS);
      }
      return {
        exit_code: 0,
        stdout: [
          "Maven lifecycle goals (in ordine di esecuzione):",
          "  validate, initialize",
          "  generate-sources, process-sources, generate-resources,",
          "  process-resources, compile, process-classes",
          "  generate-test-sources, process-test-sources, generate-test-resources,",
          "  process-test-resources, test-compile, process-test-classes, test",
          "  prepare-package, package",
          "  pre-integration-test, integration-test, post-integration-test, verify",
          "  install, deploy",
          "",
          "Tip: mvn help:describe -Dcmd=<goal>  per i dettagli di un goal specifico.",
        ].join("\n"),
        stderr: "",
        success: true,
      };
    },
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ----------------------------- dispatch JSON-RPC -----------------------------

async function handleToolCall(name, args) {
  const tool = TOOL_BY_NAME[name];
  if (!tool) {
    return { content: [{ type: "text", text: `Tool sconosciuto: ${name}` }], isError: true };
  }
  try {
    const result = await tool.handler(args || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Errore build: ${err.message}` }],
      isError: true,
    };
  }
}

async function dispatch(msg) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: msg.params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    case "tools/call":
      return handleToolCall(msg.params?.name, msg.params?.arguments);
    default:
      throw { code: -32601, message: `Metodo non supportato: ${msg.method}` };
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function onMessage(msg) {
  if (msg.id === undefined || msg.id === null) return;
  try {
    const result = await dispatch(msg);
    send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (err) {
    const error =
      err && typeof err.code === "number"
        ? { code: err.code, message: err.message }
        : { code: -32603, message: err?.message || String(err) };
    send({ jsonrpc: "2.0", id: msg.id, error });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    onMessage(msg);
  }
});
