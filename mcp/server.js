#!/usr/bin/env node
'use strict';
/*
 * Duckweed's Dungeon Drafter as an MCP server (Model Context Protocol), so Claude can make dungeon maps
 * and the content that goes with them in one conversation.
 *
 * It speaks the protocol over stdio: one JSON message per line in on stdin, one per line out on stdout.
 * Nothing else may be written to stdout, so anything for a person to read goes to stderr.
 *
 * This file is the protocol only; the tools are in lib/tools.js.
 */
const readline = require('readline');
const { createTools } = require('./lib/tools');
const { ToolError } = require('./lib/errors');
const pkg = require('./package.json');

/** Protocol versions this server can speak, newest first. It answers with the client's if it is one of them. */
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = [
  "Duckweed's Dungeon Drafter makes dungeon maps on a 5 ft grid: rooms of several shapes, hallways, doors and entrances.",
  'To draft a dungeon: generate_dungeon (or open_dungeon for a saved one), read the description, then write the content for each room.',
  'Always call rooms by the numbers printed on the map, as the description does, so the content matches the picture.',
  'If the layout needs changing, edit_dungeon draws and deletes hallways and changes doors; save_dungeon keeps the picture and the data.',
].join(' ');

const text = (s) => ({ type: 'text', text: s });

/**
 * The server as a function: a message in (already parsed), the reply out, or null when none is due
 * (notifications get no reply).
 */
function createServer({ tools = createTools(), log = (s) => process.stderr.write(`${s}\n`) } = {}) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  function callTool(params) {
    const tool = params && byName.get(params.name);
    if (!tool) return { error: { code: -32602, message: `Unknown tool: ${params && params.name}` } };
    try {
      const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
      if (typeof args !== 'object' || Array.isArray(args)) throw new ToolError('The arguments must be an object.');
      const out = tool.run(args);
      const content = [text(out.text)];
      if (out.png) content.push({ type: 'image', data: out.png.toString('base64'), mimeType: 'image/png' });
      return { result: { content } };
    } catch (err) {
      if (!(err instanceof ToolError)) log(`${tool.name} failed: ${err && err.stack ? err.stack : err}`);
      const message = err instanceof ToolError ? err.message : `Something went wrong inside ${tool.name}: ${err && err.message ? err.message : err}`;
      return { result: { content: [text(message)], isError: true } };
    }
  }

  function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
    }
    const notification = msg.id === undefined || msg.id === null;
    if (notification) return null; // initialized, cancelled, ...: nothing to answer
    const reply = (body) => ({ jsonrpc: '2.0', id: msg.id, ...body });
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params && msg.params.protocolVersion;
        return reply({
          result: {
            protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'dungeon-maker', version: pkg.version },
            instructions: INSTRUCTIONS,
          },
        });
      }
      case 'ping':
        return reply({ result: {} });
      case 'tools/list':
        return reply({ result: { tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) } });
      case 'tools/call':
        return reply(callTool(msg.params));
      default:
        return reply({ error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  }

  return { handle };
}

/** Read messages from stdin until it closes, answering each on stdout. */
function serve(input = process.stdin, output = process.stdout) {
  const server = createServer();
  const send = (obj) => output.write(`${JSON.stringify(obj)}\n`);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const text = line.charCodeAt(0) === 0xfeff ? line.slice(1) : line; // some tools (PowerShell, for one) put a byte-order mark before the first line
    if (text.trim() === '') return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const reply = server.handle(msg);
    if (reply) send(reply);
  });
  // when stdin ends there is nothing left to wait for, and the process ends by itself once what it wrote has gone out
  // (process.exit() here could cut off a big picture still on its way down a pipe)
  process.stderr.write(`dungeon-maker ${pkg.version} ready\n`);
}

if (require.main === module) {
  process.on('uncaughtException', (err) => process.stderr.write(`dungeon-maker crashed: ${err && err.stack ? err.stack : err}\n`));
  serve();
}

module.exports = { createServer, serve, INSTRUCTIONS, SUPPORTED };
