const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function readEnv(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const HOST = '127.0.0.1';
const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const inheritedEnv = { ...process.env };
const initialFileEnv = readEnv(ENV_PATH);
const PORT = Number.parseInt(inheritedEnv.PORT || initialFileEnv.PORT || '3000', 10);
const clients = new Set();
const dashboardClients = new Set();
const sessions = new Map();

function isNumericTicketId(value) {
  const ticketId = String(value ?? '').trim();
  return ticketId.length > 0 && /^[+\d]+$/.test(ticketId) && /\d/.test(ticketId);
}

function isEmailTicketId(value) {
  return /^[^\s@]+@[^\s@]+$/.test(String(value ?? '').trim());
}

function isUsernameTicketId(value) {
  const ticketId = String(value ?? '').trim();
  return ticketId.length > 0 && !isNumericTicketId(ticketId) && !isEmailTicketId(ticketId);
}

function getUiConfig() {
  const fileEnv = readEnv(ENV_PATH);
  const value = (key, fallback) => inheritedEnv[key] || fileEnv[key] || fallback;
  const ticketName = value('UI_TICKET_NAME', 'ticket');
  const checkTicketName = value('UI_CHECK_TICKET_NAME', ticketName);
  return {
    brandName: value('UI_BRAND_NAME', 'replace-name'),
    ticketName,
    checkTicketName,
    checkNumericTicketName: value('UI_CHECK_NUMERIC_TICKET_NAME', checkTicketName),
    ticketIdLabel: value('UI_TICKET_ID_LABEL', 'Demo Ticket ID'),
    accessCodeLabel: value('UI_ACCESS_CODE_LABEL', 'Demo Access Code'),
    codeText: value('UI_CODE_TEXT', 'verification value'),
    submitLabel: value('UI_SUBMIT_LABEL', 'replace-name-6'),
    rejectionMessage: value('UI_REJECTION_MESSAGE', 'Not approved. Review the demo values and try again.'),
    productName: value('UI_PRODUCT_NAME', 'replace-name-2'),
    companyName: value('UI_COMPANY_NAME', 'replace-name-3'),
  };
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const reloadClient = `
<script>
  (() => {
    const reloadEvents = new EventSource('/__reload');
    reloadEvents.addEventListener('reload', () => location.reload());
  })();
</script>`;

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

function sendEvent(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function publicSession(session) {
  return {
    id: session.id,
    ticketId: session.ticketId,
    accessCode: session.accessCode,
    employeeId: session.employeeId,
    enrollmentId: session.enrollmentId,
    deliveryTarget: session.deliveryTarget,
    needsDeliveryTarget: isUsernameTicketId(session.ticketId),
    status: session.status,
    updatedAt: session.updatedAt,
  };
}

function broadcastSession(session) {
  const snapshot = publicSession(session);
  for (const client of dashboardClients) sendEvent(client, 'session', snapshot);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16_384) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function resolveRequestPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  const routeFiles = {
    '/': 'public/landing.html',
    '/login': 'index.html',
    '/app': 'public/app.html',
  };
  const relativePath = routeFiles[decodedPath] || decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  const isInsideRoot = filePath === ROOT || filePath.startsWith(`${ROOT}${path.sep}`);
  return isInsideRoot ? filePath : null;
}

const server = http.createServer(async (request, response) => {
  if (request.url === '/api/ui-config' && request.method === 'GET') {
    return sendJson(response, 200, getUiConfig());
  }

  if (request.url === '/__reload') {
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }

  if (request.url === '/api/dashboard/events' && request.method === 'GET') {
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    dashboardClients.add(response);
    sendEvent(response, 'snapshot', [...sessions.values()].map(publicSession));
    request.on('close', () => dashboardClients.delete(response));
    return;
  }

  const sessionEventsMatch = request.url?.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/events$/);
  if (sessionEventsMatch && request.method === 'GET') {
    const session = sessions.get(sessionEventsMatch[1]);
    if (!session) return sendJson(response, 404, { error: 'Unknown session' });
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    });
    response.write(': connected\n\n');
    session.clients.add(response);
    sendEvent(response, 'decision', {
      status: session.status,
      enrollmentId: session.enrollmentId,
      deliveryTarget: session.deliveryTarget,
    });
    request.on('close', () => session.clients.delete(response));
    return;
  }

  if (request.url === '/api/sessions' && request.method === 'POST') {
    const id = crypto.randomUUID();
    const session = {
      id,
      ticketId: '',
      accessCode: '',
      employeeId: '',
      enrollmentId: '',
      deliveryTarget: '',
      status: 'editing',
      updatedAt: new Date().toISOString(),
      clients: new Set(),
    };
    sessions.set(id, session);
    broadcastSession(session);
    return sendJson(response, 201, { id });
  }

  const sessionMatch = request.url?.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)$/);
  if (sessionMatch && request.method === 'PATCH') {
    const session = sessions.get(sessionMatch[1]);
    if (!session) return sendJson(response, 404, { error: 'Unknown session' });
    try {
      const body = await readJson(request);
      session.ticketId = String(body.ticketId ?? session.ticketId).slice(0, 120);
      session.accessCode = String(body.accessCode ?? session.accessCode).slice(0, 120);
      session.employeeId = String(body.employeeId ?? session.employeeId).slice(0, 120);
      if (body.status === 'pending') session.status = 'pending';
      else if (body.status === 'final-pending') {
        if (session.status !== 'approved') return sendJson(response, 409, { error: 'Initial approval is required' });
        if (!session.employeeId.trim()) return sendJson(response, 400, { error: 'Employee ID is required' });
        session.status = 'final-pending';
      }
      else if (body.status === 'editing' && session.status !== 'pending') session.status = 'editing';
      session.updatedAt = new Date().toISOString();
      broadcastSession(session);
      return sendJson(response, 200, publicSession(session));
    } catch {
      return sendJson(response, 400, { error: 'Invalid JSON' });
    }
  }

  const decisionMatch = request.url?.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/decision$/);
  if (decisionMatch && request.method === 'POST') {
    const session = sessions.get(decisionMatch[1]);
    if (!session) return sendJson(response, 404, { error: 'Unknown session' });
    try {
      const body = await readJson(request);
      if (!['approved', 'rejected'].includes(body.decision)) {
        return sendJson(response, 400, { error: 'Invalid decision' });
      }
      const isFinalApproval = session.status === 'final-pending';
      if (body.decision === 'approved') {
        if (isFinalApproval) {
          if (!session.employeeId.trim()) return sendJson(response, 400, { error: 'Employee ID is required for final login' });
        } else {
          const enrollmentId = String(body.enrollmentId ?? '').trim().slice(0, 80);
          if (!enrollmentId) {
            return sendJson(response, 400, { error: 'Enrollment ID is required for approval' });
          }
          const deliveryTarget = String(body.deliveryTarget ?? '').trim().slice(0, 120);
          if (isUsernameTicketId(session.ticketId) && !deliveryTarget) {
            return sendJson(response, 400, { error: 'Code delivery destination is required for a username' });
          }
          session.enrollmentId = enrollmentId;
          session.deliveryTarget = isUsernameTicketId(session.ticketId) ? deliveryTarget : '';
        }
      }
      session.status = body.decision;
      session.updatedAt = new Date().toISOString();
      broadcastSession(session);
      const decision = {
        status: session.status,
        enrollmentId: session.enrollmentId,
        deliveryTarget: session.deliveryTarget,
      };
      for (const client of session.clients) sendEvent(client, 'decision', decision);
      return sendJson(response, 200, decision);
    } catch {
      return sendJson(response, 400, { error: 'Invalid JSON' });
    }
  }

  const filePath = resolveRequestPath(request.url || '/');
  if (!filePath) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(
        error.code === 'ENOENT' ? 'Not found' : 'Server error'
      );
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    let body = file;
    if (extension === '.html') {
      body = file.toString('utf8').replace(/<\/body>/i, `${reloadClient}</body>`);
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
});

let reloadTimer;
const watcher = fs.watch(ROOT, { recursive: true }, (_eventType, filename) => {
  if (!filename || filename.startsWith('.git') || filename.startsWith('node_modules')) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const client of clients) client.write('event: reload\ndata: changed\n\n');
    console.log(`Reloaded after ${filename} changed`);
  }, 100);
});

server.listen(PORT, HOST, () => {
  console.log(`Local preview: http://${HOST}:${PORT}`);
  console.log('Watching files for changes. Press Ctrl+C to stop.');
});

function shutdown() {
  watcher.close();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
