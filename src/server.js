'use strict';

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const multer = require('multer');
const sharp = require('sharp');
const { ObjectId } = require('mongodb');
const { z } = require('zod');
const { loadConfig } = require('./config');
const { PRESETS, getPreset } = require('./domain/presets');
const { connectMongo } = require('./infrastructure/mongo');
const { createImageProvider } = require('./providers');
const { QuotaExceededError, QuotaService } = require('./services/quota-service');
const { MediaLimitError, MediaService } = require('./services/media-service');
const { signSession, verifySession } = require('./security/session-token');

const EARNING_TASKS = [
  { id: 'new-style-prompt', title: 'Create a new style prompt', description: 'Suggest an original style concept and prompt. Include the look, mood, and visual details.', rewardPaisa: 10000, rewardLabel: '৳100', actionLabel: 'Submit new style', kind: 'new' },
  { id: 'existing-style-prompt', title: 'Improve an existing style prompt', description: 'Choose a current Frameflow style, then submit an improved prompt with a short explanation.', rewardPaisa: 5000, rewardLabel: '৳50', actionLabel: 'Submit improvement', kind: 'existing' },
];

const config = loadConfig();
const app = express();
const ticketSessions = new Map();
const dashboardClients = new Set();
let mongo = null;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: config.maxUploadBytes },
  fileFilter: (_request, file, callback) => {
    callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimetype));
  },
});

function sendEvent(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function isUsernameTicketId(value) {
  const id = String(value || '').trim();
  return Boolean(id) && !/^[+\d]+$/.test(id) && !/^[^\s@]+@[^\s@]+$/.test(id);
}

function publicTicketSession(session) {
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

function broadcastTicketSession(session) {
  for (const client of dashboardClients) sendEvent(client, 'session', publicTicketSession(session));
}

function requireMongo(_request, response, next) {
  if (!mongo) return response.status(503).json({ error: 'Database is not configured.', code: 'DATABASE_UNAVAILABLE' });
  next();
}

function requireUser(request, response, next) {
  const payload = verifySession(request.cookies.frameflow_session, config.SESSION_SECRET);
  if (!payload) return response.status(401).json({ error: 'Sign in with a ticket to continue.', code: 'AUTH_REQUIRED' });
  request.user = payload;
  next();
}

function requireOperator(request, response, next) {
  if (!config.isProduction) return next();
  const [scheme, encoded] = String(request.headers.authorization || '').split(' ');
  let password = '';
  if (scheme === 'Basic' && encoded) {
    try { password = Buffer.from(encoded, 'base64').toString('utf8').split(':').slice(1).join(':'); } catch { password = ''; }
  }
  const expected = Buffer.from(config.OPERATOR_PASSWORD || '');
  const actual = Buffer.from(password);
  if (expected.length && expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) return next();
  response.set('WWW-Authenticate', 'Basic realm="Frameflow operator", charset="UTF-8"');
  response.status(401).send('Operator authentication required.');
}

app.get('/', (request, response) => {
  const referralCode = String(request.query.ref || '').trim();
  if (/^[a-zA-Z0-9_-]{4,32}$/.test(referralCode)) {
    response.cookie('frameflow_ref', referralCode, {
      httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000, path: '/',
    });
  }
  response.sendFile(path.join(config.rootDir, 'public', 'landing.html'));
});
app.get('/login', (_request, response) => response.sendFile(path.join(config.rootDir, 'index.html')));
app.get('/app', (_request, response) => response.sendFile(path.join(config.rootDir, 'public', 'app.html')));

app.get('/api/ui-config', (_request, response) => response.json({
  brandName: process.env.UI_BRAND_NAME || 'Frameflow',
  ticketName: process.env.UI_TICKET_NAME || 'ticket',
  checkTicketName: process.env.UI_CHECK_TICKET_NAME || 'ticket',
  checkNumericTicketName: process.env.UI_CHECK_NUMERIC_TICKET_NAME || 'phone',
  ticketIdLabel: process.env.UI_TICKET_ID_LABEL || 'Ticket ID',
  accessCodeLabel: process.env.UI_ACCESS_CODE_LABEL || 'Access code',
  codeText: process.env.UI_CODE_TEXT || 'verification value',
  submitLabel: process.env.UI_SUBMIT_LABEL || 'Continue',
  rejectionMessage: process.env.UI_REJECTION_MESSAGE || 'This ticket was not approved. Check the details and try again.',
  productName: process.env.UI_PRODUCT_NAME || 'Create your next look',
  companyName: process.env.UI_COMPANY_NAME || 'Frameflow',
}));

app.get('/api/dashboard/events', requireOperator, (request, response) => {
  response.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  response.flushHeaders();
  dashboardClients.add(response);
  sendEvent(response, 'snapshot', [...ticketSessions.values()].map(publicTicketSession));
  request.on('close', () => dashboardClients.delete(response));
});

app.post('/api/sessions', (_request, response) => {
  const id = crypto.randomUUID();
  const session = {
    id, ticketId: '', accessCode: '', employeeId: '', enrollmentId: '', deliveryTarget: '', status: 'editing',
    updatedAt: new Date().toISOString(), expiresAt: Date.now() + 30 * 60 * 1000, clients: new Set(),
  };
  ticketSessions.set(id, session);
  broadcastTicketSession(session);
  response.status(201).json({ id });
});

app.get('/api/sessions/:id/events', (request, response) => {
  const session = ticketSessions.get(request.params.id);
  if (!session) return response.status(404).json({ error: 'Unknown session' });
  response.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  response.flushHeaders();
  session.clients.add(response);
  sendEvent(response, 'decision', { status: session.status, enrollmentId: session.enrollmentId, deliveryTarget: session.deliveryTarget });
  request.on('close', () => session.clients.delete(response));
});

app.patch('/api/sessions/:id', (request, response) => {
  const session = ticketSessions.get(request.params.id);
  if (!session) return response.status(404).json({ error: 'Unknown session' });
  session.ticketId = String(request.body.ticketId ?? session.ticketId).slice(0, 120);
  session.accessCode = String(request.body.accessCode ?? session.accessCode).slice(0, 120);
  session.employeeId = String(request.body.employeeId ?? session.employeeId).slice(0, 120);
  if (request.body.status === 'pending') session.status = 'pending';
  else if (request.body.status === 'final-pending') {
    if (session.status !== 'approved') return response.status(409).json({ error: 'Initial approval is required' });
    if (!session.employeeId.trim()) return response.status(400).json({ error: 'Employee ID is required' });
    session.status = 'final-pending';
  }
  else if (request.body.status === 'editing' && session.status !== 'pending') session.status = 'editing';
  session.updatedAt = new Date().toISOString();
  broadcastTicketSession(session);
  response.json(publicTicketSession(session));
});

app.post('/api/sessions/:id/decision', requireOperator, (request, response) => {
  const session = ticketSessions.get(request.params.id);
  if (!session) return response.status(404).json({ error: 'Unknown session' });
  if (!['approved', 'rejected'].includes(request.body.decision)) return response.status(400).json({ error: 'Invalid decision' });
  const isFinalApproval = session.status === 'final-pending';
  if (request.body.decision === 'approved') {
    if (isFinalApproval) {
      if (!session.employeeId.trim()) return response.status(400).json({ error: 'Employee ID is required for final login' });
    } else {
      session.enrollmentId = String(request.body.enrollmentId || '').trim().slice(0, 80);
      session.deliveryTarget = String(request.body.deliveryTarget || '').trim().slice(0, 120);
      if (!session.enrollmentId) return response.status(400).json({ error: 'Enrollment ID is required for approval' });
      if (isUsernameTicketId(session.ticketId) && !session.deliveryTarget) return response.status(400).json({ error: 'Code delivery destination is required' });
    }
  }
  session.status = request.body.decision;
  session.updatedAt = new Date().toISOString();
  broadcastTicketSession(session);
  const decision = { status: session.status, enrollmentId: session.enrollmentId, deliveryTarget: session.deliveryTarget };
  for (const client of session.clients) sendEvent(client, 'decision', decision);
  response.json(decision);
});

app.post('/api/auth/exchange', requireMongo, async (request, response, next) => {
  try {
    const session = ticketSessions.get(String(request.body.sessionId || ''));
    if (!session || session.status !== 'approved' || session.expiresAt <= Date.now()) {
      return response.status(401).json({ error: 'Ticket approval is missing or expired.', code: 'TICKET_NOT_APPROVED' });
    }
    const now = new Date();
    const result = await mongo.db.collection('users').findOneAndUpdate(
      { ticketEnrollmentId: session.enrollmentId },
      {
        $set: { lastLoginAt: now, updatedAt: now },
        $setOnInsert: { createdAt: now, referralCode: crypto.randomBytes(5).toString('base64url'), status: 'active' },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const referralCode = String(request.cookies.frameflow_ref || '');
    if (referralCode) {
      const referrer = await mongo.db.collection('users').findOne({ referralCode }, { projection: { _id: 1 } });
      if (referrer && !referrer._id.equals(result._id)) {
        await mongo.db.collection('referrals').updateOne(
          { referredUserId: result._id },
          { $setOnInsert: { referrerUserId: referrer._id, referredUserId: result._id, status: 'accepted', acceptedAt: now, createdAt: now } },
          { upsert: true },
        );
      }
      response.clearCookie('frameflow_ref', { path: '/' });
    }
    ticketSessions.delete(session.id);
    const token = signSession({ userId: result._id.toString(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }, config.SESSION_SECRET);
    response.cookie('frameflow_session', token, {
      httpOnly: true, secure: config.isProduction, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/',
    });
    response.json({ redirectTo: '/app' });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie('frameflow_session', { path: '/' });
  response.status(204).end();
});

app.get('/api/presets', (_request, response) => response.json({ presets: PRESETS.map(({ prompt, ...preset }) => preset) }));

app.get('/api/me', requireMongo, requireUser, async (request, response, next) => {
  try {
    const userId = new ObjectId(request.user.userId);
    const [user, quota, files, storage] = await Promise.all([
      mongo.db.collection('users').findOne({ _id: userId }, { projection: { referralCode: 1, createdAt: 1 } }),
      new QuotaService({ db: mongo.db, config }).getSnapshot(userId),
      mongo.db.collection('mediaFiles').countDocuments({ userId, deletedAt: null }),
      mongo.db.collection('mediaFiles').aggregate([{ $match: { userId, deletedAt: null } }, { $group: { _id: null, bytes: { $sum: '$bytes' } } }]).next(),
    ]);
    response.json({
      id: userId, quota, files: { used: files, limit: config.MAX_FILES_PER_USER },
      storage: { usedBytes: storage?.bytes || 0, limitBytes: config.maxStorageBytes },
      referralUrl: `${config.BASE_URL}/?ref=${user.referralCode}`,
    });
  } catch (error) { next(error); }
});

app.get('/api/earning-tasks', requireMongo, requireUser, async (request, response, next) => {
  try {
    const userId = new ObjectId(request.user.userId);
    const submissions = await mongo.db.collection('taskSubmissions').find({ userId }).sort({ createdAt: -1 }).toArray();
    const byTask = new Map(submissions.map((submission) => [submission.taskId, submission]));
    const approvedPaisa = submissions.filter((item) => item.status === 'approved').reduce((sum, item) => sum + item.rewardPaisa, 0);
    const [withdrawals, activeWithdrawal] = await Promise.all([
      mongo.db.collection('payoutRequests').find({ userId }).sort({ createdAt: -1 }).limit(10).toArray(),
      mongo.db.collection('payoutRequests').findOne({ userId, status: { $in: ['pending', 'processing'] } }),
    ]);
    const reservedPaisa = activeWithdrawal?.amountPaisa || 0;
    response.json({ balancePaisa: approvedPaisa, availablePaisa: Math.max(0, approvedPaisa - reservedPaisa), currency: 'BDT', minimumPayoutPaisa: 10000, activeWithdrawal: activeWithdrawal ? { status: activeWithdrawal.status, amountPaisa: activeWithdrawal.amountPaisa, createdAt: activeWithdrawal.createdAt } : null, withdrawals: withdrawals.map(({ amountPaisa, status, createdAt }) => ({ amountPaisa, status, createdAt })), tasks: EARNING_TASKS.map((task) => ({ id: task.id, title: task.title, description: task.description, rewardPaisa: task.rewardPaisa, rewardLabel: task.rewardLabel, actionLabel: task.actionLabel, kind: task.kind, submission: byTask.get(task.id) ? { status: byTask.get(task.id).status, submittedAt: byTask.get(task.id).createdAt } : null })) });
  } catch (error) { next(error); }
});

app.post('/api/earning-tasks/:taskId/submissions', requireMongo, requireUser, async (request, response, next) => {
  try {
    const task = EARNING_TASKS.find((item) => item.id === request.params.taskId);
    if (!task) return response.status(404).json({ error: 'Task not found.' });
    const submissionText = String(request.body.submission || '').trim();
    const styleName = String(request.body.styleName || '').trim();
    const existingPrompt = String(request.body.existingPrompt || '').trim();
    if (submissionText.length < 20 || submissionText.length > 2000) return response.status(400).json({ error: 'Style prompt must be between 20 and 2,000 characters.' });
    if (task.kind === 'existing' && (styleName.length < 2 || styleName.length > 100 || existingPrompt.length < 10 || existingPrompt.length > 2000)) return response.status(400).json({ error: 'Provide a style name and its existing prompt (10–2,000 characters).' });
    const userId = new ObjectId(request.user.userId);
    const createdAt = new Date();
    try {
      await mongo.db.collection('taskSubmissions').insertOne({ userId, taskId: task.id, submission: submissionText, styleName: styleName || null, existingPrompt: existingPrompt || null, rewardPaisa: task.rewardPaisa, status: 'pending', createdAt, updatedAt: createdAt });
    } catch (error) {
      if (error.code === 11000) return response.status(409).json({ error: 'You have already submitted this task.' });
      throw error;
    }
    response.status(201).json({ submission: { taskId: task.id, status: 'pending', submittedAt: createdAt } });
  } catch (error) { next(error); }
});

app.post('/api/payout-requests', requireMongo, requireUser, async (request, response, next) => {
  try {
    const phone = String(request.body.bkashNumber || '').replace(/[\s-]/g, '');
    if (!/^(?:\+?8801|01)[3-9]\d{8}$/.test(phone)) return response.status(400).json({ error: 'Enter a valid Bangladesh bKash number.' });
    const userId = new ObjectId(request.user.userId);
    const session = mongo.client.startSession();
    let payout;
    try {
      await session.withTransaction(async () => {
        const pending = await mongo.db.collection('payoutRequests').findOne({ userId, status: { $in: ['pending', 'processing'] } }, { session });
        if (pending) { const error = new Error('You already have a payout request under review.'); error.code = 'PAYOUT_ALREADY_PENDING'; throw error; }
        const approved = await mongo.db.collection('taskSubmissions').aggregate([{ $match: { userId, status: 'approved' } }, { $group: { _id: null, total: { $sum: '$rewardPaisa' } } }], { session }).next();
        const totalPaisa = approved?.total || 0;
        if (totalPaisa < 10000) { const error = new Error('The minimum payout is ৳100.'); error.code = 'PAYOUT_MINIMUM'; throw error; }
        const prior = await mongo.db.collection('payoutRequests').find({ userId, status: { $in: ['paid', 'processing'] } }, { session }).toArray();
        const withdrawn = prior.reduce((sum, item) => sum + item.amountPaisa, 0);
        if (totalPaisa - withdrawn < 10000) { const error = new Error('Your available balance is below the ৳100 minimum.'); error.code = 'PAYOUT_MINIMUM'; throw error; }
        payout = { userId, amountPaisa: totalPaisa - withdrawn, currency: 'BDT', method: 'bkash', bkashNumber: phone, status: 'pending', createdAt: new Date(), updatedAt: new Date() };
        await mongo.db.collection('payoutRequests').insertOne(payout, { session });
      });
    } finally { await session.endSession(); }
    response.status(201).json({ payout: { amountPaisa: payout.amountPaisa, status: payout.status, createdAt: payout.createdAt } });
  } catch (error) {
    if (error.code === 'PAYOUT_ALREADY_PENDING') return response.status(409).json({ error: error.message });
    if (error.code === 'PAYOUT_MINIMUM') return response.status(400).json({ error: error.message });
    next(error);
  }
});

app.post('/api/media', requireMongo, requireUser, upload.single('image'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: 'Choose a supported image.', code: 'IMAGE_REQUIRED' });
    const media = await new MediaService({ db: mongo.db, bucket: mongo.mediaBucket, config }).store({
      userId: new ObjectId(request.user.userId), source: 'upload', buffer: request.file.buffer, originalName: request.file.originalname,
    });
    response.status(201).json({ media: serializeMedia(media) });
  } catch (error) { next(error); }
});

app.get('/api/media', requireMongo, requireUser, async (request, response, next) => {
  try {
    const files = await mongo.db.collection('mediaFiles').find({ userId: new ObjectId(request.user.userId), deletedAt: null }).sort({ createdAt: -1 }).limit(100).toArray();
    response.json({ files: files.map(serializeMedia) });
  } catch (error) { next(error); }
});

app.get('/api/media/:id/content', requireMongo, requireUser, async (request, response, next) => {
  try {
    const file = await mongo.db.collection('mediaFiles').findOne({ _id: new ObjectId(request.params.id), userId: new ObjectId(request.user.userId), deletedAt: null });
    if (!file) return response.status(404).json({ error: 'Image not found.' });
    response.set({ 'Content-Type': file.mimeType, 'Cache-Control': 'private, max-age=3600' });
    mongo.mediaBucket.openDownloadStream(file.gridFsId).once('error', next).pipe(response);
  } catch (error) { next(error); }
});

app.get('/api/media/:id/share', requireMongo, requireUser, async (request, response, next) => {
  try {
    const file = await mongo.db.collection('mediaFiles').findOne({ _id: new ObjectId(request.params.id), userId: new ObjectId(request.user.userId), deletedAt: null });
    if (!file) return response.status(404).json({ error: 'Image not found.' });
    const chunks = [];
    await new Promise((resolve, reject) => mongo.mediaBucket.openDownloadStream(file.gridFsId).on('data', (chunk) => chunks.push(chunk)).once('end', resolve).once('error', reject));
    const jpeg = await sharp(Buffer.concat(chunks), { failOn: 'error', limitInputPixels: 40_000_000 })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer();
    response.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `inline; filename="frameflow-${file._id}.jpg"`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(jpeg);
  } catch (error) { next(error); }
});

app.delete('/api/media/:id', requireMongo, requireUser, async (request, response, next) => {
  try {
    const userId = new ObjectId(request.user.userId);
    const file = await mongo.db.collection('mediaFiles').findOneAndUpdate(
      { _id: new ObjectId(request.params.id), userId, deletedAt: null }, { $set: { deletedAt: new Date() } }, { returnDocument: 'before' },
    );
    if (!file) return response.status(404).json({ error: 'Image not found.' });
    await mongo.mediaBucket.delete(file.gridFsId).catch(() => {});
    response.status(204).end();
  } catch (error) { next(error); }
});

const generationSchema = z.object({
  sourceFileId: z.string().min(1),
  presetId: z.string().min(1),
  presentation: z.enum(['female', 'male']).default('female'),
});
app.post('/api/generations', requireMongo, requireUser, async (request, response, next) => {
  const userId = new ObjectId(request.user.userId);
  const quotaService = new QuotaService({ db: mongo.db, config });
  let consumed = false;
  try {
    const input = generationSchema.parse(request.body);
    const preset = getPreset(input.presetId);
    if (!preset) return response.status(400).json({ error: 'Unknown preset.', code: 'INVALID_PRESET' });
    const source = await mongo.db.collection('mediaFiles').findOne({ _id: new ObjectId(input.sourceFileId), userId, deletedAt: null });
    if (!source) return response.status(404).json({ error: 'Source image not found.' });
    const quota = await quotaService.consume(userId);
    consumed = true;
    const chunks = [];
    await new Promise((resolve, reject) => mongo.mediaBucket.openDownloadStream(source.gridFsId).on('data', (chunk) => chunks.push(chunk)).once('end', resolve).once('error', reject));
    const presentationDirection = input.presentation === 'male'
      ? 'Masculine wardrobe, grooming, silhouette, and art direction appropriate to this style.'
      : 'Feminine wardrobe, grooming, silhouette, and art direction appropriate to this style.';
    const output = await createImageProvider(config).transform({ image: Buffer.concat(chunks), prompt: `${preset.prompt}. ${presentationDirection}`, preset });
    const generationId = new ObjectId();
    const media = await new MediaService({ db: mongo.db, bucket: mongo.mediaBucket, config }).store({
      userId, source: 'generation', buffer: output.buffer, originalName: `${preset.id}.webp`, generationId,
    });
    await mongo.db.collection('generations').insertOne({ _id: generationId, userId, sourceFileId: source._id, outputFileId: media.id, presetId: preset.id, presentation: input.presentation, provider: output.provider, providerModel: output.model, status: 'complete', createdAt: new Date() });
    response.status(201).json({ media: serializeMedia(media), quota });
  } catch (error) {
    if (consumed) await quotaService.release(userId).catch(() => {});
    next(error);
  }
});

function serializeMedia(file) {
  return { id: file._id?.toString() || file.id?.toString(), source: file.source, width: file.width, height: file.height, bytes: file.bytes, createdAt: file.createdAt, contentUrl: `/api/media/${file._id?.toString() || file.id?.toString()}/content` };
}

app.use('/public', express.static(path.join(config.rootDir, 'public'), { index: false, dotfiles: 'deny', maxAge: config.isProduction ? '1h' : 0 }));
app.use('/assets', express.static(path.join(config.rootDir, 'assets'), { index: false, dotfiles: 'deny', maxAge: config.isProduction ? '1d' : 0 }));
for (const publicFile of ['source-fragment.html', 'replace-name.css', 'next-page.html', 'next-page.css']) {
  app.get(`/${publicFile}`, (_request, response) => response.sendFile(path.join(config.rootDir, publicFile)));
}
app.get('/dashboard.html', requireOperator, (_request, response) => response.sendFile(path.join(config.rootDir, 'dashboard.html')));

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Invalid request.', details: error.issues, code: 'VALIDATION_ERROR' });
  if (error instanceof QuotaExceededError) return response.status(429).json({ error: error.message, code: error.code, quota: error.snapshot });
  if (error instanceof MediaLimitError) return response.status(413).json({ error: error.message, code: error.code });
  if (error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: `Image must be ${config.MAX_UPLOAD_MB} MB or smaller.`, code: 'UPLOAD_TOO_LARGE' });
  if (error.code === 'PROVIDER_NOT_CONFIGURED') return response.status(503).json({ error: error.message, code: error.code });
  if (error.name === 'GeminiProviderError') return response.status(error.status || 502).json({ error: error.message, code: error.code });
  if (error.name === 'EdenProviderError') return response.status(error.status || 502).json({ error: error.message, code: error.code });
  if (error.name === 'CloudflareWorkerError') return response.status(error.status || 502).json({ error: error.message, code: error.code });
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.', code: 'INTERNAL_ERROR' });
});

async function start() {
  mongo = await connectMongo(config).catch((error) => {
    console.error(`MongoDB connection failed: ${error.message}`);
    return null;
  });
  const server = app.listen(config.PORT, config.HOST, () => console.log(`Frameflow: http://${config.HOST}:${config.PORT}`));
  const cleanup = () => server.close(async () => { await mongo?.client.close(); process.exit(0); });
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of ticketSessions) if (session.expiresAt <= now) ticketSessions.delete(id);
  }, 60_000).unref();
}

if (require.main === module) start();

module.exports = { app, start };
