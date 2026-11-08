const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const UPSTREAM_PORT = 3001;

// Run the Notion MCP server directly from node_modules (no npx / npm wrapper
// process) with a capped heap. If either process dies, exit so Railway restarts.
const cli = path.join(
  path.dirname(require.resolve('@notionhq/notion-mcp-server/package.json')),
  'bin',
  'cli.mjs'
);
const child = spawn(
  process.execPath,
  ['--max-old-space-size=192', cli, '--transport', 'http', '--port', String(UPSTREAM_PORT)],
  { stdio: 'inherit' }
);
child.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { child.kill(sig); process.exit(0); });
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 20 });

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: UPSTREAM_PORT,
      path: req.url,
      method: req.method,
      agent,
      headers: {
        ...req.headers,
        authorization: `Bearer ${process.env.AUTH_TOKEN}`,
        host: `localhost:${UPSTREAM_PORT}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.on('aborted', () => proxyReq.destroy());
  res.on('close', () => proxyReq.destroy());
  req.pipe(proxyReq);
});

server.listen(process.env.PORT || 3000);
