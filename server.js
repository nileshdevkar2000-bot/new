'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch {}

const root = __dirname;
function loadDotEnv(file){
  if(!fs.existsSync(file)) return;
  for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#')) continue;
    const i=line.indexOf('=');
    if(i<1) continue;
    const key=line.slice(0,i).trim();
    let value=line.slice(i+1).trim();
    if((value.startsWith('\"')&&value.endsWith('\"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    if(process.env[key]===undefined) process.env[key]=value;
  }
}
loadDotEnv(path.join(root,'.env'));
const dataDir = path.join(root, '.data');
const knowledgeDir = path.join(root, 'knowledge');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(knowledgeDir, { recursive: true });

const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL_MS = 3 * 60 * 1000;
const COOKIE = 'neo_sid';
const RECOVERY_EMAIL = process.env.RECOVERY_EMAIL || 'metaneo0256@gmail.com';
const RESEND_API_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const SIGNUP_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.NEO_DEMO_MODE !== undefined ? String(process.env.NEO_DEMO_MODE).toLowerCase() !== 'false' : !IS_PROD;
const BOOTSTRAP_ADMIN_PASSWORD = process.env.NEO_ADMIN_PASSWORD || (DEMO_MODE ? 'Admin@123' : crypto.randomBytes(18).toString('base64url'));
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
const APP_VERSION = '2.4.1';
const SYSTEM_ADMIN_DEPARTMENT = 'System Administration';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon'
};

function jsonFile(name, fallback) {
  const p = path.join(dataDir, name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2));
}
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password || ''), String(salt), 64).toString('hex');
}
function userRecord(id, name, role, department, password, email = '') {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  return { id, name, role, department, email, salt, hash, disabled: false, approvedAt: new Date().toISOString() };
}
function defaultUsers() {
  const base = [userRecord('neo.admin', 'NEO Administrator', 'SYSTEM_ADMIN', SYSTEM_ADMIN_DEPARTMENT, BOOTSTRAP_ADMIN_PASSWORD, RECOVERY_EMAIL)];
  if (!DEMO_MODE) return base;
  return base.concat([
    userRecord('qa.user', 'QA User', 'QA', 'QA', process.env.NEO_QA_PASSWORD || 'QA@123'),
    userRecord('qc.user', 'QC User', 'QC', 'QC', process.env.NEO_QC_PASSWORD || 'QC@123'),
    userRecord('audit.front', 'Audit Front Room', 'AUDIT_FRONT', 'QA', 'Front@123'),
    userRecord('audit.back', 'Audit Back Room', 'AUDIT_BACK', 'QA', 'Back@123'),
    userRecord('audit.admin', 'Audit Administrator', 'AUDIT_ADMIN', 'QA', 'AuditAdmin@123')
  ]);
}

let USERS = jsonFile('users.json', defaultUsers());
if (!Array.isArray(USERS) || USERS.some(x => !x.id || !x.salt || !x.hash)) {
  USERS = defaultUsers();
  writeJson('users.json', USERS);
}
if (process.env.NEO_ADMIN_PASSWORD) {
  const bootstrapAdmin = USERS.find(x => x.role === 'SYSTEM_ADMIN' && x.id === 'neo.admin');
  if (bootstrapAdmin && bootstrapAdmin.passwordSource !== 'user') {
    const salt = crypto.randomBytes(16).toString('hex');
    bootstrapAdmin.salt = salt;
    bootstrapAdmin.hash = hashPassword(process.env.NEO_ADMIN_PASSWORD, salt);
    bootstrapAdmin.passwordSource = 'bootstrap';
    bootstrapAdmin.email = bootstrapAdmin.email || RECOVERY_EMAIL;
    writeJson('users.json', USERS);
  }
}
if (!DEMO_MODE && !process.env.NEO_ADMIN_PASSWORD) {
  const bootstrapFile = path.join(dataDir, 'INITIAL_ADMIN_CREDENTIALS.txt');
  if (!fs.existsSync(bootstrapFile)) fs.writeFileSync(bootstrapFile, `NEO System Administrator
Login ID: neo.admin
Initial password: ${BOOTSTRAP_ADMIN_PASSWORD}
Rotate this password immediately after first login.
`, { mode: 0o600 });
}
if (DEMO_MODE) {
  const demoCreds = {
    'neo.admin': BOOTSTRAP_ADMIN_PASSWORD,
    'qa.user': process.env.NEO_QA_PASSWORD || 'QA@123',
    'qc.user': process.env.NEO_QC_PASSWORD || 'QC@123',
    'audit.front': 'Front@123',
    'audit.back': 'Back@123',
    'audit.admin': 'AuditAdmin@123'
  };
  let changed = false;
  USERS = USERS.map(u => {
    if (!demoCreds[u.id]) return u;
    const salt = crypto.randomBytes(16).toString('hex'); changed = true;
    return { ...u, salt, hash: hashPassword(demoCreds[u.id], salt), disabled: false, approvedAt: u.approvedAt || new Date().toISOString() };
  });
  if (changed) writeJson('users.json', USERS);
}

let sessions = new Map();
const requestWindows = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = requestWindows.get(key) || [];
  const keep = arr.filter(t => now - t < windowMs);
  keep.push(now);
  requestWindows.set(key, keep);
  return keep.length <= max;
}
let auditEvents = jsonFile('audit-events.json', seedAuditEvents());
let auditRequests = jsonFile('audit-requests.json', seedAuditRequests());
let evidencePacks = jsonFile('evidence-packs.json', []);
let deviations = jsonFile('deviations.json', seedDeviations());
let incidents = jsonFile('incidents.json', seedIncidents());
let careerSuggestions = jsonFile('career-suggestions.json', []);
let signupRequests = jsonFile('signup-requests.json', []);
let passwordResets = jsonFile('password-resets.json', []);

function seedAuditEvents() {
  const now = new Date().toISOString();
  return [
    { id: crypto.randomUUID(), time: now, actor: 'NEO System', action: 'Deviation DEV-001 locked', dept: 'QC', type: 'system' },
    { id: crypto.randomUUID(), time: now, actor: 'QA', action: 'Reviewed incident scope', dept: 'QA', type: 'review' },
    { id: crypto.randomUUID(), time: now, actor: 'Audit Admin', action: 'Evidence request AUD-104 prepared', dept: 'QA', type: 'audit' }
  ];
}
function seedDeviations() {
  const now = new Date().toISOString();
  return [
    { id: 'DEV-001', title: 'Sampling record discrepancy', dept: 'QC', severity: 'Major', status: 'Locked', locked: true, description: 'Prototype deviation record available for controlled review.', step: 'Level 1 Investigation', evidence: ['SOP-QC-019', 'Training record', 'Instrument log'], updatedAt: now },
    { id: 'DEV-002', title: 'Cleaning log gap', dept: 'QA', severity: 'Minor', status: 'Open', locked: false, description: 'Cleaning log entry requires investigation.', step: 'Record raised', evidence: ['Cleaning log', 'SOP-MFG-042'], updatedAt: now },
    { id: 'DEV-003', title: 'Protocol window exception', dept: 'Clinical Trial', severity: 'Major', status: 'Open', locked: false, description: 'Clinical visit window exception linked to protocol review.', step: 'Impact review', evidence: ['Protocol', 'Visit record', 'Training record'], updatedAt: now },
    { id: 'DEV-004', title: 'Safety case intake variance', dept: 'Pharmacovigilance', severity: 'Major', status: 'Open', locked: false, description: 'Safety case intake requires triage and source reconciliation.', step: 'Triage', evidence: ['ICSR source', 'Case intake log'], updatedAt: now },
    { id: 'DEV-005', title: 'Supplier qualification gap', dept: 'Supply Chain', severity: 'Minor', status: 'Open', locked: false, description: 'Supplier qualification evidence is incomplete.', step: 'Investigation', evidence: ['Supplier record', 'Quality agreement'], updatedAt: now },
    { id: 'DEV-006', title: 'Regulatory submission metadata gap', dept: 'Regulatory Affairs', severity: 'Minor', status: 'Open', locked: false, description: 'Submission metadata requires controlled correction.', step: 'Assessment', evidence: ['Submission record', 'Commitment tracker'], updatedAt: now }
  ];
}
function seedIncidents() {
  const now = new Date().toISOString();
  return [
    { id: 'INC-101', dept: 'QC', title: 'Sampling observation', status: 'Open', createdAt: now },
    { id: 'INC-102', dept: 'QA', title: 'Documentation gap', status: 'Open', createdAt: now },
    { id: 'INC-103', dept: 'Manufacturing', title: 'Cleaning record question', status: 'Review', createdAt: now },
    { id: 'INC-104', dept: 'Clinical Trial', title: 'Protocol deviation signal', status: 'Open', createdAt: now },
    { id: 'INC-105', dept: 'Pharmacovigilance', title: 'Adverse event intake review', status: 'Review', createdAt: now },
    { id: 'INC-106', dept: 'Regulatory Affairs', title: 'Regulatory commitment check', status: 'Open', createdAt: now },
    { id: 'INC-107', dept: 'Supply Chain', title: 'Supplier documentation mismatch', status: 'Open', createdAt: now },
    { id: 'INC-108', dept: 'R&D', title: 'Controlled research record gap', status: 'Review', createdAt: now },
    { id: 'INC-109', dept: 'Production', title: 'Line record exception', status: 'Open', createdAt: now },
    { id: 'INC-110', dept: 'Opex', title: 'Process handoff bottleneck', status: 'Open', createdAt: now },
    { id: 'INC-111', dept: 'Medical Affairs', title: 'Medical inquiry review', status: 'Open', createdAt: now },
    { id: 'INC-112', dept: 'Complaint Handling', title: 'Product complaint triage', status: 'Open', createdAt: now }
  ];
}

function seedAuditRequests() {
  return [
    { id: 'AUD-104', title: 'Sampling procedure', dept: 'QC', status: 'REQUESTED', createdAt: new Date().toISOString(), sourceHints: ['SOP-QC-019', 'training evidence'] },
    { id: 'AUD-105', title: 'Cleaning procedure', dept: 'Manufacturing', status: 'REQUESTED', createdAt: new Date().toISOString(), sourceHints: ['SOP-MFG-042', 'related deviations', 'CAPA'] },
    { id: 'AUD-106', title: 'Change-control rationale', dept: 'QA', status: 'REQUESTED', createdAt: new Date().toISOString(), sourceHints: ['CAPA-184', 'impact assessment', 'approval history'] }
  ];
}

function safeEqual(a, b) {
  const x = Buffer.from(a || '');
  const y = Buffer.from(b || '');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function passwordMatchesConfiguredFallback(user, password) {
  const pw = String(password || '');
  if (!pw) return false;
  const candidates = [];
  if (user?.role === 'SYSTEM_ADMIN' && process.env.NEO_ADMIN_PASSWORD) candidates.push(process.env.NEO_ADMIN_PASSWORD);
  if (user?.role === 'QA' && process.env.NEO_QA_PASSWORD) candidates.push(process.env.NEO_QA_PASSWORD);
  if (user?.role === 'QC' && process.env.NEO_QC_PASSWORD) candidates.push(process.env.NEO_QC_PASSWORD);
  if (DEMO_MODE) {
    if (user?.id === 'neo.admin') candidates.push('Admin@123');
    if (user?.id === 'qa.user') candidates.push('QA@123');
    if (user?.id === 'qc.user') candidates.push('QC@123');
    if (user?.id === 'audit.front') candidates.push('Front@123');
    if (user?.id === 'audit.back') candidates.push('Back@123');
    if (user?.id === 'audit.admin') candidates.push('AuditAdmin@123');
  }
  return candidates.some(x => safeEqual(pw, x));
}
function verifyPasswordAndMigrate(user, password) {
  if (!user) return false;
  if (safeEqual(hashPassword(password, user.salt), user.hash)) return true;
  if (!passwordMatchesConfiguredFallback(user, password)) return false;
  const salt = crypto.randomBytes(16).toString('hex');
  user.salt = salt;
  user.hash = hashPassword(password, salt);
  user.disabled = false;
  user.approvedAt = user.approvedAt || new Date().toISOString();
  writeJson('users.json', USERS);
  return true;
}

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }
function tokenHash(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function sanitizeEmail(v) { return String(v || '').trim().toLowerCase().slice(0, 320); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function writeMailAudit(kind, to, subject, text) {
  const p = path.join(dataDir, 'mail-outbox.log');
  const safeText = IS_PROD ? String(text || '').replace(/(https?:\/\/[^\s]+[?&]token=)[^\s]+/gi, '$1[REDACTED]') : String(text || '');
  fs.appendFileSync(p, JSON.stringify({ time: new Date().toISOString(), kind, to, subject, text: safeText }) + '\n');
}
async function sendMail(to, subject, text) {
  writeMailAudit('mail', to, subject, text);
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    const r = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, text })
    });
    if (!r.ok) throw new Error(`Resend ${r.status}`);
    return { delivered: true, provider: 'resend' };
  }
  if (nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
    return { delivered: true, provider: 'smtp' };
  }
  if (IS_PROD) throw new Error('No production mail provider is configured. Set RESEND_* or SMTP_* before enabling account recovery.');
  return { delivered: false, provider: 'outbox' };
}
async function sendRecoveryMail(to, resetUrl, name) {
  const subject = 'NEO password recovery';
  const text = `Hello ${name || 'NEO user'},

A password recovery request was made for your NEO account.

Use this secure recovery link within 15 minutes:
${resetUrl}

If you did not request this, ignore this message.
`;
  return sendMail(to, subject, text);
}
async function sendApprovalWelcomeEmail(to, request, loginId, temporaryPassword) {
  const subject = `NEO workspace access approved · ${request.name}`;
  const text = `Hello ${request.name},\n\nYour NEO workspace access request has been approved.\n\nLogin ID: ${loginId}\n${temporaryPassword ? `Temporary password: ${temporaryPassword}\n` : 'Use the password you provided in your access request.\n'}\nSign in: ${(PUBLIC_ORIGIN || 'http://localhost:3000')}/login.html\n`;
  return sendMail(to, subject, text);
}
async function sendSignupApprovalNotice(request) {
  const subject = `NEO access approval required · ${request.name}`;
  const text = `A new NEO access request is awaiting System Administrator approval.

Name: ${request.name}
Email: ${request.email}
Department: ${request.department}
Requested role: ${request.profileRole}
Request ID: ${request.id}

Open the NEO System Maintenance page to review the request.
`;
  return sendMail(RECOVERY_EMAIL, subject, text);
}
function cleanupSecurityQueues() {
  const now = Date.now();
  signupRequests = signupRequests.filter(x => !x.expiresAt || new Date(x.expiresAt).getTime() > now || x.status === 'PENDING');
  passwordResets = passwordResets.filter(x => !x.expiresAt || new Date(x.expiresAt).getTime() > now && !x.used);
}
function newSession(user) {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, {
    user: { id: user.id, name: user.name, role: user.role, department: user.department },
    createdAt: Date.now(),
    lastActive: Date.now()
  });
  return sid;
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentSession(req, { touch = true } = {}) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.lastActive > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  if (touch) s.lastActive = Date.now();
  return { ...s, sid };
}
function requestIsHttps(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https' || Boolean(req.socket?.encrypted) || /^https:\/\//i.test(PUBLIC_ORIGIN);
}
function cookieHeader(value, maxAge = SESSION_TTL_MS / 1000, req) {
  const secure = requestIsHttps(req);
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge)}${secure ? '; Secure' : ''}`;
}
function clearCookieHeader(req) {
  const secure = requestIsHttps(req);
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'microphone=(self)',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
}
function send(res, status, data, type = 'application/json', headers = {}) {
  const base = { 'Content-Type': type, 'Cache-Control': 'no-store', ...securityHeaders(), ...headers };
  res.writeHead(status, base);
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
async function body(req) {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 2_000_000) throw new Error('Request too large');
  }
  if (!s) return {};
  return JSON.parse(s);
}
function requireOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const expected = PUBLIC_ORIGIN || `${forwardedProto || (IS_PROD ? 'https' : 'http')}://${forwardedHost || req.headers.host}`;
  const allowed = new Set([expected, ...ALLOWED_ORIGINS]);
  if (!allowed.has(origin)) { send(res, 403, { error: 'Cross-origin request rejected' }); return false; }
  return true;
}
function requireAuth(req, res, roles) {
  const s = currentSession(req);
  if (!s) { send(res, 401, { error: 'Authentication required' }); return null; }
  if (roles && roles.length && !roles.includes(s.user.role)) {
    send(res, 403, { error: 'Forbidden', role: s.user.role });
    return null;
  }
  return s;
}
function audit(actor, action, dept = 'System', type = 'system', meta = {}) {
  auditEvents.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor, action, dept, type, ...meta });
  auditEvents = auditEvents.slice(0, 2000);
  writeJson('audit-events.json', auditEvents);
}

function readKnowledge() {
  const docs = [];
  const KNOWLEDGE_HTML_DENY = new Set(['login.html','signup.html','forgot-password.html','maintenance.html','connectors.html','audit-admin.html','audit-access.html','audit-back.html','audit-front.html']);
  if (fs.existsSync(knowledgeDir)) {
    for (const file of fs.readdirSync(knowledgeDir)) {
      if (!/\.(md|txt|json)$/i.test(file)) continue;
      const p = path.join(knowledgeDir, file);
      try {
        const raw = fs.readFileSync(p, 'utf8');
        if (file.endsWith('.json')) {
          const data = JSON.parse(raw);
          for (const x of Array.isArray(data) ? data : [data]) {
            docs.push({ source: file, title: x.title || x.id || file, text: x.text || JSON.stringify(x) });
          }
        } else {
          docs.push({ source: file, title: file, text: raw });
        }
      } catch {}
    }
  }
  for (const file of fs.readdirSync(root)) {
    if (!file.endsWith('.html') || KNOWLEDGE_HTML_DENY.has(file)) continue;
    try {
      const raw = fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      docs.push({ source: file, title: file, text: raw });
    } catch {}
  }
  return docs;
}
function chunkText(text, size = 1200) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > size && current) {
      chunks.push(current.trim());
      current = word;
    } else current = (current + ' ' + word).trim();
  }
  if (current) chunks.push(current.trim());
  return chunks;
}
let knowledgeIndex = null;
function getKnowledgeIndex() {
  if (knowledgeIndex) return knowledgeIndex;
  knowledgeIndex = [];
  for (const d of readKnowledge()) {
    for (const chunk of chunkText(d.text)) {
      knowledgeIndex.push({ source: d.source, title: d.title, snippet: chunk.slice(0, 900), searchText: (d.title + ' ' + chunk).toLowerCase() });
    }
  }
  return knowledgeIndex;
}
function searchKnowledge(q, limit = 8) {
  const terms = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const d of getKnowledgeIndex()) {
      const score = terms.reduce((n, t) => n + (d.searchText.includes(t) ? 1 : 0), 0);
      if (score > 0) scored.push({ source: d.source, title: d.title, snippet: d.snippet, score });
  }
  const seen = new Set();
  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .filter(x => { const k = `${x.source}|${x.snippet}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit)
    .map(({ score, ...x }) => x);
}

function runtimeKnowledge(s) {
  const docs = [];
  const allowAll = ['SYSTEM_ADMIN', 'QA'].includes(s.user.role);
  const visible = (r) => allowAll || userCanAccessDepartment(s.user, r.dept);
  deviations.filter(visible).forEach(r => docs.push({source:'NEO deviations',title:r.id,text:`${r.title}. Department ${r.dept}. Severity ${r.severity}. Status ${r.status}. Step ${r.step}. ${r.description}. Evidence: ${(r.evidence||[]).join(', ')}`}));
  incidents.filter(visible).forEach(r => docs.push({source:'NEO incidents',title:r.id,text:`${r.title}. Department ${r.dept}. Status ${r.status}.`}));
  auditRequests.filter(visible).forEach(r => docs.push({source:'NEO audit requests',title:r.id,text:`${r.title}. Department ${r.dept}. Status ${r.status}. Source hints: ${(r.sourceHints||[]).join(', ')}. ${r.sources?`Prepared sources: ${r.sources.join(', ')}`:''}`}));
  evidencePacks.filter(p => { const r=auditRequests.find(x=>x.id===p.requestId); return r && visible(r); }).forEach(p => docs.push({source:'NEO evidence packs',title:p.id,text:`Evidence pack for ${p.requestId}. Status ${p.status}. Sources: ${(p.sources||[]).join(', ')}.`}));
  auditEvents.filter(e => allowAll || normalizeDepartment(e.dept) === userDepartmentName(s.user)).slice(0, 500).forEach(e => docs.push({source:'NEO audit trail',title:e.action,text:`${e.time}. Actor ${e.actor}. Department ${e.dept}. Action ${e.action}. Type ${e.type}.`}));
  return docs;
}
function searchRuntimeKnowledge(q, s, limit = 8) {
  const terms = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!terms.length) return [];
  const scored=[];
  for (const d of runtimeKnowledge(s)) {
    const text=(d.title+' '+d.text).toLowerCase();
    const score=terms.reduce((n,t)=>n+(text.includes(t)?1:0),0);
    if(score>0) scored.push({source:d.source,title:d.title,snippet:d.text.slice(0,900),score});
  }
  return scored.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,limit).map(({score,...x})=>x);
}
function mergedKnowledge(q, s, limit = 8) {
  const docs = [...searchRuntimeKnowledge(q, s, limit), ...searchKnowledge(q, limit)];
  const seen = new Set();
  return docs.filter(x => { const k=`${x.source}|${x.title}|${x.snippet}`; if(seen.has(k)) return false; seen.add(k); return true; }).slice(0,limit);
}
function auditQueryMeta(q){
  const raw=String(q||'');
  return { queryHash: crypto.createHash('sha256').update(raw).digest('hex').slice(0,16), chars: raw.length };
}
async function googleSearch(q) {
  if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CX) return [];
  const u = new URL('https://www.googleapis.com/customsearch/v1');
  u.searchParams.set('key', process.env.GOOGLE_API_KEY);
  u.searchParams.set('cx', process.env.GOOGLE_CX);
  u.searchParams.set('q', String(q || '').slice(0, 500));
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Google Search ${r.status}`);
  const d = await r.json();
  return (d.items || []).slice(0, 8).map(x => ({ title: x.title, url: x.link, snippet: x.snippet }));
}

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })
  ]).finally(() => clearTimeout(timer));
}

function connectorScopeConfig() {
  try { return JSON.parse(process.env.NEO_CONNECTOR_SCOPES || '{}'); } catch { return {}; }
}
function connectorAllowed(name, user) {
  if (user?.role === 'SYSTEM_ADMIN') return true;
  const cfg = connectorScopeConfig()[name];
  if (!cfg) return true;
  const roles = Array.isArray(cfg.roles) ? cfg.roles : null;
  const departments = Array.isArray(cfg.departments) ? cfg.departments.map(normalizeDepartment) : null;
  if (roles && !roles.includes(user.role)) return false;
  if (departments && !departments.includes(userDepartmentName(user))) return false;
  return true;
}
function connectorStatus() {
  return {
    enabled: String(process.env.NEO_CONNECTORS_ENABLED || 'true').toLowerCase() !== 'false',
    auto: String(process.env.NEO_CONNECTORS_AUTO || 'true').toLowerCase() !== 'false',
    googleDrive: Boolean(process.env.NEO_GOOGLE_DRIVE_TOKEN), microsoftGraph: Boolean(process.env.NEO_MS_GRAPH_TOKEN),
    salesforce: Boolean(process.env.NEO_SALESFORCE_BASE_URL && process.env.NEO_SALESFORCE_TOKEN), slack: Boolean(process.env.NEO_SLACK_TOKEN),
    serviceNow: Boolean(process.env.NEO_SERVICENOW_BASE_URL && process.env.NEO_SERVICENOW_TOKEN), jira: Boolean(process.env.NEO_JIRA_BASE_URL && process.env.NEO_JIRA_TOKEN), confluence: Boolean(process.env.NEO_CONFLUENCE_BASE_URL && process.env.NEO_CONFLUENCE_TOKEN),
    oauthReady: { googleDrive:Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID&&process.env.GOOGLE_OAUTH_CLIENT_SECRET&&process.env.GOOGLE_OAUTH_REDIRECT_URI), microsoftGraph:Boolean(process.env.MS_OAUTH_CLIENT_ID&&process.env.MS_OAUTH_CLIENT_SECRET&&process.env.MS_OAUTH_REDIRECT_URI), salesforce:Boolean(process.env.SF_OAUTH_CLIENT_ID&&process.env.SF_OAUTH_CLIENT_SECRET&&process.env.SF_OAUTH_REDIRECT_URI), atlassian:Boolean(process.env.ATLASSIAN_OAUTH_CLIENT_ID&&process.env.ATLASSIAN_OAUTH_CLIENT_SECRET&&process.env.ATLASSIAN_OAUTH_REDIRECT_URI), slack:Boolean(process.env.SLACK_OAUTH_CLIENT_ID&&process.env.SLACK_OAUTH_CLIENT_SECRET&&process.env.SLACK_OAUTH_REDIRECT_URI) }
  };
}
async function connectorGoogleDrive(q) {
  if (!process.env.NEO_GOOGLE_DRIVE_TOKEN) return [];
  const term = String(q || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const clauses = [`name contains '${term}'`, 'trashed = false'];
  if (process.env.NEO_GOOGLE_DRIVE_FOLDER_ID) clauses.unshift(`'${process.env.NEO_GOOGLE_DRIVE_FOLDER_ID}' in parents`);
  const params = new URLSearchParams({
    pageSize: '15',
    q: clauses.join(' and '),
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,description,parents)'
  });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${process.env.NEO_GOOGLE_DRIVE_TOKEN}` } });
  if (!r.ok) throw new Error(`Google Drive ${r.status}`);
  const d = await r.json();
  return (d.files || []).map(x => ({ connector: 'Google Drive', id: x.id, title: x.name, url: x.webViewLink || '', snippet: `${x.mimeType || 'file'} · modified ${x.modifiedTime || 'unknown'}`, metadata: x }));
}
async function connectorMicrosoftGraph(q) {
  if (!process.env.NEO_MS_GRAPH_TOKEN) return [];
  const term = String(q || '').replace(/'/g, "''");
  const endpoint = process.env.NEO_MS_GRAPH_DRIVE_ID
    ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(process.env.NEO_MS_GRAPH_DRIVE_ID)}/root/search(q='${term}')`
    : `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${term}')`;
  const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${process.env.NEO_MS_GRAPH_TOKEN}` } });
  if (!r.ok) throw new Error(`Microsoft Graph ${r.status}`);
  const d = await r.json();
  return (d.value || []).slice(0, 15).map(x => ({ connector: 'Microsoft 365 / SharePoint', id: x.id, title: x.name, url: x.webUrl || '', snippet: `${x.file?.mimeType || 'drive item'} · modified ${x.lastModifiedDateTime || 'unknown'}`, metadata: x }));
}
async function connectorSalesforce(q) {
  if (!process.env.NEO_SALESFORCE_BASE_URL || !process.env.NEO_SALESFORCE_TOKEN) return [];
  const base = process.env.NEO_SALESFORCE_BASE_URL.replace(/\/$/, '');
  const version = process.env.NEO_SALESFORCE_API_VERSION || 'v66.0';
  const term = String(q || '').replace(/[{}]/g, '').slice(0, 80);
  const sosl = `FIND {${term}*} IN ALL FIELDS RETURNING Account(Id,Name),Case(Id,CaseNumber,Subject) LIMIT 25`;
  const r = await fetch(`${base}/services/data/${version}/search/?q=${encodeURIComponent(sosl)}`, { headers: { Authorization: `Bearer ${process.env.NEO_SALESFORCE_TOKEN}` } });
  if (!r.ok) throw new Error(`Salesforce ${r.status}`);
  const d = await r.json();
  return (d.searchRecords || []).slice(0, 20).map(x => ({ connector: 'Salesforce', id: x.id, title: x.Name || x.CaseNumber || x.Subject || x.id, url: `${base}/lightning/r/${x.attributes?.type || 'record'}/${x.id}/view`, snippet: x.Subject || x.Name || x.CaseNumber || 'Salesforce record', metadata: x }));
}
async function connectorSlack(q) {
  if (!process.env.NEO_SLACK_TOKEN) return [];
  const r = await fetch(`https://slack.com/api/search.messages?query=${encodeURIComponent(String(q || '').slice(0, 200))}&count=20`, { headers: { Authorization: `Bearer ${process.env.NEO_SLACK_TOKEN}` } });
  if (!r.ok) throw new Error(`Slack ${r.status}`);
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'Slack search failed');
  return (d.messages?.matches || []).slice(0, 20).map(x => ({ connector: 'Slack', id: x.ts, title: x.channel?.name || x.username || 'Slack message', url: x.permalink || '', snippet: x.text || '', metadata: x }));
}

async function connectorServiceNow(q) {
  if (!process.env.NEO_SERVICENOW_BASE_URL || !process.env.NEO_SERVICENOW_TOKEN) return [];
  const base = process.env.NEO_SERVICENOW_BASE_URL.replace(/\/$/, '');
  const filter = encodeURIComponent(`short_descriptionLIKE${String(q || '').slice(0, 100)}^ORdescriptionLIKE${String(q || '').slice(0, 100)}`);
  const r = await fetch(`${base}/api/now/table/knowledge?sysparm_query=${filter}&sysparm_limit=15&sysparm_fields=sys_id,short_description,text,sys_updated_on`, { headers: { Authorization: `Bearer ${process.env.NEO_SERVICENOW_TOKEN}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ServiceNow ${r.status}`);
  const d = await r.json();
  return (d.result || []).map(x => ({ connector: 'ServiceNow', id: x.sys_id, title: x.short_description || x.sys_id, url: `${base}/now/nav/ui/classic/params/target/kb_knowledge.do?sys_id=${encodeURIComponent(x.sys_id)}`, snippet: `${String(x.text || '').slice(0, 700)} · updated ${x.sys_updated_on || 'unknown'}`, metadata: x }));
}
async function connectorJira(q) {
  if (!process.env.NEO_JIRA_BASE_URL || !process.env.NEO_JIRA_TOKEN) return [];
  const base = process.env.NEO_JIRA_BASE_URL.replace(/\/$/, '');
  const jql = encodeURIComponent(`text ~ \"${String(q || '').replace(/\"/g, '').slice(0, 100)}\" ORDER BY updated DESC`);
  const headers = { Accept: 'application/json' };
  if (process.env.NEO_JIRA_EMAIL) headers.Authorization = `Basic ${Buffer.from(`${process.env.NEO_JIRA_EMAIL}:${process.env.NEO_JIRA_TOKEN}`).toString('base64')}`;
  else headers.Authorization = `Bearer ${process.env.NEO_JIRA_TOKEN}`;
  const r = await fetch(`${base}/rest/api/3/search/jql?jql=${jql}&maxResults=15&fields=summary,description,status,updated`, { headers });
  if (!r.ok) throw new Error(`Jira ${r.status}`);
  const d = await r.json();
  return (d.issues || []).map(x => ({ connector: 'Jira', id: x.key, title: x.fields?.summary || x.key, url: `${base}/browse/${encodeURIComponent(x.key)}`, snippet: `${x.fields?.status?.name || ''} · updated ${x.fields?.updated || ''}`, metadata: x }));
}
async function connectorConfluence(q) {
  if (!process.env.NEO_CONFLUENCE_BASE_URL || !process.env.NEO_CONFLUENCE_TOKEN) return [];
  const base = process.env.NEO_CONFLUENCE_BASE_URL.replace(/\/$/, '');
  const cql = encodeURIComponent(`text ~ \"${String(q || '').replace(/\"/g, '').slice(0, 100)}\" ORDER BY lastmodified DESC`);
  const headers = { Accept: 'application/json' };
  if (process.env.NEO_CONFLUENCE_EMAIL) headers.Authorization = `Basic ${Buffer.from(`${process.env.NEO_CONFLUENCE_EMAIL}:${process.env.NEO_CONFLUENCE_TOKEN}`).toString('base64')}`;
  else headers.Authorization = `Bearer ${process.env.NEO_CONFLUENCE_TOKEN}`;
  const r = await fetch(`${base}/wiki/rest/api/content/search?cql=${cql}&limit=15&expand=space,version,body.storage`, { headers });
  if (!r.ok) throw new Error(`Confluence ${r.status}`);
  const d = await r.json();
  return (d.results || []).map(x => ({ connector: 'Confluence', id: x.id, title: x.title || x.id, url: x._links?.base ? `${x._links.base}${x._links.webui || ''}` : '', snippet: String(x.body?.storage?.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800), metadata: x }));
}

async function searchConnectors(q, requested, user = { role: 'SYSTEM_ADMIN', department: 'QA' }) {
  const status = connectorStatus();
  if (!status.enabled) return [];
  const names = Array.isArray(requested) && requested.length ? requested : ['googleDrive','microsoftGraph','salesforce','slack','serviceNow','jira','confluence'];
  const out = [];
  for (const name of names) {
    if (!connectorAllowed(name, user)) continue;
    try {
      if (name === 'googleDrive') out.push(...await connectorGoogleDrive(q));
      else if (name === 'microsoftGraph') out.push(...await connectorMicrosoftGraph(q));
      else if (name === 'salesforce') out.push(...await connectorSalesforce(q));
      else if (name === 'slack') out.push(...await connectorSlack(q));
      else if (name === 'serviceNow') out.push(...await connectorServiceNow(q));
      else if (name === 'jira') out.push(...await connectorJira(q));
      else if (name === 'confluence') out.push(...await connectorConfluence(q));
    } catch (e) { out.push({ connector: name, title: `${name} unavailable`, snippet: e.message, url: '' }); }
  }
  return out.slice(0, 40);
}
async function proxyGeminiChat({message, history = [], internal = [], web = [], connectors = [], user, contextDepartment, pageTitle = 'NEO', pageUrl = '/', webRequested}) {
  if (!process.env.GOOGLE_GEMINI_API_KEY) return null;
  const model = process.env.NEO_TEXT_MODEL || 'gemini-3.8-flash';
  const system = [
    'You are NEO, an enterprise operations AI assistant.',
    'Answer using the authorized NEO evidence and knowledge supplied below.',
    'Respect the authenticated user scope and department.',
    'Do not expose secrets or unnecessary personal data.',
    'For regulated workflows, distinguish evidence, recommendations and human approval; never declare a regulated decision final.',
    `Authenticated user role: ${user?.role || 'UNKNOWN'}. Department: ${contextDepartment || user?.department || 'Whole NEO'}. Current page: ${pageTitle} (${pageUrl}).`,
    'Internal NEO knowledge:', JSON.stringify(internal.slice(0, 10)),
    'Google/web knowledge:', JSON.stringify(web.slice(0, 10)),
    'Enterprise connector knowledge:', JSON.stringify(connectors.slice(0, 10))
  ].join('\n');
  const contents = history.slice(-10).map(x => ({
    role: x.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(x.content || '').slice(0, 4000) }]
  }));
  contents.push({ role: 'user', parts: [{ text: String(message || '').slice(0, 6000) }] });
  const body = {
    contents,
    system_instruction: { parts: [{ text: system }] },
    generationConfig: { temperature: 0.2, maxOutputTokens: 1400 }
  };
  if (webRequested) body.tools = [{ googleSearch: {} }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_GEMINI_API_KEY },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Gemini ${r.status}`);
  const text = (d.candidates?.[0]?.content?.parts || []).filter(x => x.text).map(x => x.text).join('\n').trim();
  return text ? { answer: text, model } : null;
}
async function proxyChat(payload) {
  if (!process.env.NEO_CHAT_URL) return null;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.NEO_CHAT_AUTH) headers.Authorization = `Bearer ${process.env.NEO_CHAT_AUTH}`;
  const r = await fetch(process.env.NEO_CHAT_URL, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Chat gateway ${r.status}`);
  return await r.json();
}
async function proxyJson(envName, payload, authEnv) {
  if (!process.env[envName]) return null;
  const target = process.env[envName];
  const headers = { 'Content-Type': 'application/json' };
  if (authEnv && process.env[authEnv]) headers.Authorization = `Bearer ${process.env[authEnv]}`;
  const r = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`${envName} ${r.status}`);
  return await r.json();
}

const PROFILE_ROLES = {
  'Quality Assurance': ['QA User', 'QA Reviewer', 'QA Manager'],
  'Quality Control': ['QC Analyst', 'QC Reviewer', 'QC Manager'],
  'Manufacturing': ['Manufacturing User', 'Manufacturing Reviewer', 'Manufacturing Manager'],
  'Production': ['Production User', 'Production Reviewer', 'Production Manager'],
  'Supply Chain': ['Supply Chain User', 'Supplier Quality Reviewer', 'Supply Chain Manager'],
  'R&D': ['Scientist', 'R&D Reviewer', 'R&D Manager'],
  'Clinical Trial': ['Clinical Operations User', 'Clinical Reviewer', 'Clinical Study Manager', 'Site / Feasibility Analyst'],
  'Regulatory Affairs': ['Regulatory Operations User', 'Regulatory Reviewer', 'Regulatory Manager'],
  'Pharmacovigilance': ['PV Case Processor', 'PV Reviewer', 'PV Signal Analyst', 'PV Manager'],
  'Complaint Handling': ['Complaint Specialist', 'Complaint Reviewer', 'Complaint Manager'],
  'Opex & Continuous Improvement': ['Continuous Improvement Analyst', 'Process Reviewer', 'Opex Manager'],
  'Medical Affairs': ['Medical Information Specialist', 'Medical Reviewer', 'Medical Manager'],
  'IT & Digital Operations': ['IT Service User', 'IT Reviewer', 'IT Manager']
};
const SYSTEM_ADMIN_PROFILE_ROLES = ['System Administrator'];
const DEFAULT_PROFILE_ROLES = ['Department User', 'Department Reviewer', 'Department Manager'];
function profileRolesForDepartment(dept) { const n=normalizeDepartment(dept); if(n===SYSTEM_ADMIN_DEPARTMENT) return SYSTEM_ADMIN_PROFILE_ROLES; return PROFILE_ROLES[n] || DEFAULT_PROFILE_ROLES; }

const DEPARTMENTS = {
  qa: { name: 'Quality Assurance', short: 'QA', focus: 'CAPA, audits, change control, quality systems, training and risk oversight', useCases: ['CAPA intelligence', 'Audit readiness', 'Quality risk review', 'Change control'], bridges: ['QC', 'Manufacturing', 'Clinical Trial', 'Pharmacovigilance', 'Regulatory Affairs'] },
  qc: { name: 'Quality Control', short: 'QC', focus: 'Laboratory operations, sampling, specifications, OOS/OOT and controlled records', useCases: ['Sampling intelligence', 'OOS/OOT support', 'Method/SOP search', 'Lab trend detection'], bridges: ['QA', 'R&D', 'Manufacturing', 'Pharmacovigilance'] },
  manufacturing: { name: 'Manufacturing', short: 'MFG', focus: 'Batch operations, equipment, cleaning, line events and manufacturing records', useCases: ['Batch review', 'Equipment signals', 'Deviation triage', 'Cleaning intelligence'], bridges: ['QA', 'QC', 'Supply Chain', 'Production'] },
  production: { name: 'Production', short: 'OPS', focus: 'Production execution, handoffs, line performance and operational exceptions', useCases: ['Line issue triage', 'Work instruction lookup', 'Shift handoff intelligence', 'Recurring issue detection'], bridges: ['Manufacturing', 'QA', 'Supply Chain', 'Opex'] },
  'supply-chain': { name: 'Supply Chain', short: 'SC', focus: 'Supplier quality, materials, logistics, shortages and supplier performance', useCases: ['Supplier risk', 'Material exception triage', 'Supplier evidence packs', 'Demand/quality signals'], bridges: ['QA', 'Manufacturing', 'Regulatory Affairs', 'Opex'] },
  'r-and-d': { name: 'R&D', short: 'R&D', focus: 'Research evidence, controlled documents, experiments and technology transfer', useCases: ['Research knowledge', 'Experiment evidence', 'Document intelligence', 'Tech transfer support'], bridges: ['QC', 'QA', 'Clinical Trial', 'Regulatory Affairs'] },
  clinical: { name: 'Clinical Trial', short: 'CLINICAL', focus: 'Study feasibility, startup, site intelligence, protocol execution and data review', useCases: ['Study intelligence', 'Site feasibility', 'Protocol risk review', 'Data quality support'], bridges: ['Pharmacovigilance', 'Regulatory Affairs', 'QA', 'Medical Affairs'] },
  regulatory: { name: 'Regulatory Affairs', short: 'REG', focus: 'Regulatory intelligence, submissions, commitments, labeling and authority interactions', useCases: ['Regulatory horizon scanning', 'Submission readiness', 'Commitment tracking', 'Evidence mapping'], bridges: ['Clinical Trial', 'Pharmacovigilance', 'QA', 'Medical Affairs'] },
  pharmacovigilance: { name: 'Pharmacovigilance', short: 'PV', focus: 'Safety intake, case triage, narrative review, signal detection and regulatory reporting', useCases: ['Case intake', 'Narrative support', 'Signal detection', 'Literature monitoring'], bridges: ['Clinical Trial', 'Regulatory Affairs', 'QA', 'Complaint Handling', 'Medical Affairs'] },
  'complaint-handling': { name: 'Complaint Handling', short: 'COMPLAINTS', focus: 'Product complaints, triage, investigation, quality/safety routing and customer feedback', useCases: ['Complaint triage', 'Quality-safety routing', 'Recurring signal detection', 'Response preparation'], bridges: ['QA', 'QC', 'Pharmacovigilance', 'Manufacturing'] },
  opex: { name: 'Opex & Continuous Improvement', short: 'OPEX', focus: 'Process improvement, bottlenecks, work orchestration and continuous improvement', useCases: ['Process mining', 'Handoff analysis', 'Improvement ideas', 'Action tracking'], bridges: ['All departments'] },
  'medical-affairs': { name: 'Medical Affairs', short: 'MEDICAL', focus: 'Medical information, evidence review, scientific communication and field insights', useCases: ['Medical inquiry support', 'Evidence synthesis', 'Scientific intelligence', 'Insight routing'], bridges: ['Clinical Trial', 'Pharmacovigilance', 'Regulatory Affairs', 'R&D'] },
  'it-digital': { name: 'IT & Digital Operations', short: 'IT', focus: 'Technology services, tickets, integrations, access and digital workflow operations', useCases: ['Ticket triage', 'Access workflows', 'Knowledge search', 'Integration diagnostics'], bridges: ['All departments'] }
};
const DEPARTMENT_SLUG_BY_NAME = Object.fromEntries(Object.entries(DEPARTMENTS).flatMap(([slug, x]) => [[x.name, slug], [x.short, slug]]));
function normalizeDepartment(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower === 'system administration' || lower === 'system administrator' || lower === 'system_admin') return SYSTEM_ADMIN_DEPARTMENT;
  if (DEPARTMENTS[lower]) return DEPARTMENTS[lower].name;
  const byName = Object.values(DEPARTMENTS).find(x => x.name.toLowerCase() === lower);
  if (byName) return byName.name;
  const byShort = Object.values(DEPARTMENTS).find(x => x.short.toLowerCase() === lower);
  if (byShort) return byShort.name;
  const aliases = {
    'clinical operations':'Clinical Trial', 'clinical':'Clinical Trial',
    'regulatory':'Regulatory Affairs', 'pv':'Pharmacovigilance',
    'r&d':'R&D', 'opex':'Opex & Continuous Improvement', 'it':'IT & Digital Operations',
    'qa':'Quality Assurance', 'qc':'Quality Control'
  };
  return aliases[lower] || raw;
}
function userDepartmentName(user) {
  return normalizeDepartment(user?.department || '');
}
function userCanAccessDepartment(user, dept) {
  const target = normalizeDepartment(dept);
  if (['SYSTEM_ADMIN','QA'].includes(user?.role)) return true;
  return userDepartmentName(user) === target;
}
function departmentBySlug(slug) { return DEPARTMENTS[slug] || null; }
function departmentSummary(slug, s) {
  const meta = departmentBySlug(slug); if (!meta) return null;
  const dept = meta.name === 'Opex & Continuous Improvement' ? 'Opex' : meta.name;
  if (!userCanAccessDepartment(s.user, meta.name)) return null;
  const visible = (r) => ['SYSTEM_ADMIN','QA'].includes(s.user.role) || userCanAccessDepartment(s.user, r.dept);
  const allIncidents = incidents.filter(r => normalizeDepartment(r.dept) === dept);
  const allDeviations = deviations.filter(r => normalizeDepartment(r.dept) === dept);
  const allAudit = auditRequests.filter(r => normalizeDepartment(r.dept) === dept);
  const allowedIncidents = allIncidents.filter(visible);
  const allowedDeviations = allDeviations.filter(visible);
  const allowedAudit = allAudit.filter(visible);
  const openIncidents = allowedIncidents.filter(r => !['Closed','Resolved'].includes(r.status)).length;
  const openDeviations = allowedDeviations.filter(r => !['Closed','Resolved'].includes(r.status)).length;
  const openAudit = allowedAudit.filter(r => !['PRESENTED','REJECTED'].includes(r.status)).length;
  return {
    department: meta,
    access: true,
    limited: !['SYSTEM_ADMIN','QA'].includes(s.user.role),
    kpis: { openIncidents, openDeviations, openAudit, signals: openIncidents + openDeviations + openAudit },
    recent: [...allowedIncidents.map(x=>({kind:'Incident',id:x.id,title:x.title,status:x.status})), ...allowedDeviations.map(x=>({kind:'Deviation',id:x.id,title:x.title,status:x.status})), ...allowedAudit.map(x=>({kind:'Audit',id:x.id,title:x.title,status:x.status}))].slice(0,8),
    aiPlaybook: meta.useCases,
    bridges: meta.bridges
  };
}

const PUBLIC_FILES = new Set(['index.html', 'platform.html', 'solutions.html', 'company.html', 'careers.html', 'contact.html', 'privacy.html', 'login.html', 'signup.html', 'forgot-password.html']);
const ALL_AUTH = ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER', 'AUDIT_ADMIN', 'AUDIT_FRONT', 'AUDIT_BACK'];
const ROLE_RULES = {
  'agent.html': ALL_AUTH, 'agents.html': ALL_AUTH, 'workspace.html': ALL_AUTH, 'approvals.html': ALL_AUTH,
  'qms.html': ['SYSTEM_ADMIN', 'QA', 'QC'], 'documents.html': ['SYSTEM_ADMIN', 'QA', 'QC', 'AUDIT_ADMIN', 'AUDIT_BACK'],
  'deviations.html': ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER'], 'deviation.html': ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER'], 'incident.html': ALL_AUTH,
  'trends.html': ['SYSTEM_ADMIN', 'QA', 'QC'], 'it-tickets.html': ALL_AUTH, 'oox.html': ALL_AUTH,
  'clinical.html': ALL_AUTH, 'complaints.html': ALL_AUTH, 'careers-analytics.html': ['SYSTEM_ADMIN', 'QA'],
  'audit.html': ALL_AUTH, 'audit-access.html': ['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN'],
  'audit-front.html': ['SYSTEM_ADMIN', 'AUDIT_ADMIN', 'AUDIT_FRONT'], 'audit-back.html': ['SYSTEM_ADMIN', 'AUDIT_ADMIN', 'AUDIT_BACK'],
  'audit-admin.html': ['SYSTEM_ADMIN', 'AUDIT_ADMIN'], 'maintenance.html': ['SYSTEM_ADMIN'], 'connectors.html': ['SYSTEM_ADMIN'], 'audit-trail.html': ALL_AUTH,
  'audit-sop.html': ['SYSTEM_ADMIN', 'QA', 'QC', 'AUDIT_ADMIN', 'AUDIT_BACK'],
  'audit-pack.html': ['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN', 'AUDIT_BACK'],
  'audit-sme.html': ['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN'],
  'audit-history.html': ALL_AUTH,
  'departments.html': ALL_AUTH,
  'qa.html': ALL_AUTH, 'qc.html': ALL_AUTH,
  'manufacturing.html': ALL_AUTH, 'production.html': ALL_AUTH, 'supply-chain.html': ALL_AUTH,
  'r-and-d.html': ALL_AUTH, 'clinical.html': ALL_AUTH, 'regulatory-affairs.html': ALL_AUTH,
  'pharmacovigilance.html': ALL_AUTH, 'complaint-handling.html': ALL_AUTH,
  'opex.html': ALL_AUTH, 'medical-affairs.html': ALL_AUTH, 'it-digital.html': ALL_AUTH
};
const BLOCKED_STATIC = new Set(['server.js','package.json','package-lock.json','.env','.env.example','README.md','DEPLOYMENT.md','DESIGN_NOTES.md']);
function protectStatic(relative, session) {
  if (BLOCKED_STATIC.has(path.basename(relative))) return false;
  if (relative.startsWith('.data/') || relative.startsWith('knowledge/')) return false;
  if (PUBLIC_FILES.has(path.basename(relative))) return true;
  if (relative.startsWith('assets/')) return true;
  return Boolean(session);
}
function visibleAuditRequests(s) {
  if (s.user.role === 'QC' || s.user.role === 'DEPT_USER') return auditRequests.filter(r => normalizeDepartment(r.dept) === userDepartmentName(s.user));
  if (s.user.role === 'AUDIT_FRONT') return auditRequests;
  if (s.user.role === 'AUDIT_BACK') return auditRequests.filter(r => !['PRESENTED'].includes(r.status));
  return auditRequests;
}
function userContext(s) {
  return {
    user: s.user,
    capabilities: {
      googleSearch: Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
      chatGateway: Boolean(process.env.NEO_CHAT_URL || process.env.GOOGLE_GEMINI_API_KEY),
      speechServer: Boolean(process.env.NEO_STT_URL || process.env.NEO_TTS_URL),
      connectors: connectorStatus(),
      audit: true,
      wholeNeo: true
    }
  };
}
function publicUser(user) {
  return { id: user.id, name: user.name, role: user.role, department: user.department, email: user.email || '', disabled: !!user.disabled, approvedAt: user.approvedAt || null };
}
function scopedRecords(records, s) {
  if (['SYSTEM_ADMIN', 'QA'].includes(s.user.role)) return records;
  if (s.user.role === 'DEPT_USER' || s.user.role === 'QC') return records.filter(r => userCanAccessDepartment(s.user, r.dept));
  return records.filter(r => r.dept === s.user.department);
}

function createAuditUser(s, id, password, role) {
  if (!['AUDIT_FRONT', 'AUDIT_BACK'].includes(role)) throw new Error('Only Front Room and Back Room profiles can be created here');
  if (USERS.some(u => u.id === id)) throw new Error('Login ID already exists');
  const rec = userRecord(id, id, role, 'QA', password);
  USERS.push(rec);
  writeJson('users.json', USERS);
  audit(s.user.id, `Created ${role} access profile ${id}`, s.user.department, 'auth');
  return publicUser(rec);
}

function invalidateKnowledgeIndex() { knowledgeIndex = null; }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = decodeURIComponent(u.pathname);
    const session = currentSession(req, { touch: true });

    if (req.method !== 'GET' && !requireOrigin(req, res)) return;

    if (req.method === 'GET' && p === '/healthz') {
      return send(res, 200, { ok: true, service: 'neo', time: new Date().toISOString(), mode: DEMO_MODE ? 'demo' : 'production' });
    }
    if (req.method === 'GET' && p === '/api/public-status') {
      const adminExists = USERS.some(u => u.role === 'SYSTEM_ADMIN' && !u.disabled);
      return send(res, 200, { ok:true, version:APP_VERSION, demoMode:DEMO_MODE, adminProvisioned:adminExists, recoveryConfigured:Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM) || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM), liveVoiceConfigured:Boolean(process.env.GOOGLE_GEMINI_API_KEY), geminiTextConfigured:Boolean(process.env.GOOGLE_GEMINI_API_KEY), originConfigured:Boolean(PUBLIC_ORIGIN || ALLOWED_ORIGINS.length) });
    }
    if (req.method === 'GET' && p === '/api/session') {
      const s = currentSession(req, { touch: false });
      return send(res, 200, {
        authenticated: !!s,
        user: s?.user || null,
        expiresAt: s ? s.lastActive + SESSION_TTL_MS : null,
        mode: DEMO_MODE ? 'demo' : 'production',
        startup: { server: true, publicOrigin: PUBLIC_ORIGIN || null },
        capabilities: s ? userContext(s).capabilities : null
      });
    }
    if (req.method === 'GET' && p === '/api/registration-options') {
      return send(res, 200, { departments: [...Object.values(DEPARTMENTS).map(x => x.name), SYSTEM_ADMIN_DEPARTMENT], roles: { ...PROFILE_ROLES, [SYSTEM_ADMIN_DEPARTMENT]: SYSTEM_ADMIN_PROFILE_ROLES } });
    }
    if (req.method === 'POST' && p === '/api/signup') {
      cleanupSecurityQueues();
      const b = await body(req);
      const name = String(b.name || '').trim().slice(0, 120);
      const email = sanitizeEmail(b.email);
      const department = String(b.department || '').trim().slice(0, 120);
      const profileRole = String(b.profileRole || 'Department User').trim().slice(0, 120);
      const requestedLogin = String(b.loginId || '').trim();
      if (!name || !validEmail(email) || !department) return send(res, 400, { error: 'Name, valid email and department are required.' });
      const normalizedSignupDept = normalizeDepartment(department);
      if (normalizedSignupDept !== SYSTEM_ADMIN_DEPARTMENT && !DEPARTMENT_SLUG_BY_NAME[normalizedSignupDept]) return send(res, 400, { error: 'Select a valid NEO department.' });
      if (!profileRolesForDepartment(normalizedSignupDept).includes(profileRole)) return send(res, 400, { error: 'Select a valid role for the chosen department.' });
      if (!rateLimit(`signup:${req.socket.remoteAddress || 'unknown'}`, 8, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many access requests. Please try again later.' });
      if (USERS.some(u => u.email && u.email.toLowerCase() === email) || signupRequests.some(x => x.email === email && x.status === 'PENDING')) return send(res, 409, { error: 'An account or pending access request already exists for this email.' });
      const loginId = requestedLogin || `${name.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'').slice(0,38)}.${crypto.randomInt(1000,9999)}`;
      if (!/^[A-Za-z0-9._-]{3,80}$/.test(loginId) || USERS.some(u => u.id === loginId)) return send(res, 409, { error: 'That login ID is unavailable. Choose another.' });
      const requestedPassword = String(b.password || '');
      if (requestedPassword && requestedPassword.length < 10) return send(res, 400, { error: 'Password must be at least 10 characters, or leave it blank for an administrator-issued temporary password.' });
      let passwordHash = '', passwordSalt = '';
      if (requestedPassword) { passwordSalt = crypto.randomBytes(16).toString('hex'); passwordHash = hashPassword(requestedPassword, passwordSalt); }
      const rec = { id: crypto.randomUUID(), name, email, department, profileRole, requestedLoginId: loginId, passwordHash, passwordSalt, status: 'PENDING', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SIGNUP_REQUEST_TTL_MS).toISOString() };
      signupRequests.unshift(rec); writeJson('signup-requests.json', signupRequests);
      audit('public-signup', `Access request ${rec.id} submitted for ${department}`, department, 'auth', { requestId: rec.id });
      try { await sendSignupApprovalNotice(rec); } catch (e) { writeMailAudit('signup-notification-error', RECOVERY_EMAIL, 'NEO signup approval notification', e.message); }
      return send(res, 201, { ok: true, status: 'PENDING', message: 'Access request submitted. A System Administrator must approve it before login is enabled.' });
    }
    if (req.method === 'POST' && p === '/api/password/forgot') {
      if (!rateLimit(`forgot:${req.socket.remoteAddress || 'unknown'}`, 10, 60 * 60 * 1000)) return send(res, 429, { error: 'Too many recovery requests. Please try again later.' });
      cleanupSecurityQueues();
      const b = await body(req);
      const email = sanitizeEmail(b.email);
      if (!validEmail(email)) return send(res, 400, { error: 'Enter a valid email address.' });
      const user = USERS.find(u => (u.email || '').toLowerCase() === email && !u.disabled);
      if (!user) return send(res, 200, { ok: true, message: 'If that account is eligible for recovery, instructions have been sent.' });
      const token = randomToken(32);
      const targetEmail = user.role === 'SYSTEM_ADMIN' ? RECOVERY_EMAIL : email;
      const base = PUBLIC_ORIGIN || `${requestIsHttps(req) ? 'https' : 'http'}://${req.headers.host || 'localhost:3000'}`;
      const resetUrl = `${base}/forgot-password.html?token=${encodeURIComponent(token)}`;
      let delivery = { delivered: false, provider: 'outbox' };
      try { delivery = await sendRecoveryMail(targetEmail, resetUrl, user.name); } catch (e) {
        writeMailAudit('recovery-error', targetEmail, 'NEO password recovery', e.message);
        if (IS_PROD) return send(res, 503, { error: 'Production password recovery email is not configured.' });
      }
      passwordResets.push({ tokenHash: tokenHash(token), userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString(), used: false });
      writeJson('password-resets.json', passwordResets);
      audit(user.id, 'Password recovery requested', user.department, 'auth', { target: targetEmail === RECOVERY_EMAIL ? 'recovery-email' : 'registered-email' });
      const response = { ok:true, message:'If that account is eligible for recovery, instructions have been sent.', delivered: delivery.delivered && !DEMO_MODE ? true : undefined };
      if (!IS_PROD) response.testResetUrl = resetUrl;
      return send(res, 200, response);
    }
    if (req.method === 'POST' && p === '/api/password/reset') {
      cleanupSecurityQueues();
      const b = await body(req);
      const token = String(b.token || '');
      const password = String(b.password || '');
      if (password.length < 8) return send(res, 400, { error: 'New password must be at least 8 characters.' });
      const rec = passwordResets.find(x => x.tokenHash === tokenHash(token) && !x.used && new Date(x.expiresAt).getTime() > Date.now());
      if (!rec) return send(res, 400, { error: 'Recovery link is invalid or expired.' });
      const user = USERS.find(x => x.id === rec.userId && !x.disabled);
      if (!user) return send(res, 404, { error: 'Account not found.' });
      const salt = crypto.randomBytes(16).toString('hex'); user.salt = salt; user.hash = hashPassword(password, salt); user.disabled = false; user.passwordSource = 'user';
      rec.used = true; writeJson('users.json', USERS); writeJson('password-resets.json', passwordResets);
      audit(user.id, 'Password reset completed', user.department, 'auth');
      return send(res, 200, { ok: true, message: 'Password reset complete. You can now sign in.' });
    }
    if (req.method === 'POST' && p === '/api/login') {
      if (!rateLimit(`login:${req.socket.remoteAddress || 'unknown'}`, 20, 10 * 60 * 1000)) return send(res, 429, { error: 'Too many login attempts. Please wait and try again.' });
      const b = await body(req);
      const id = String(b.id || '').trim();
      const password = String(b.password || '');
      const normalizedId = id.toLowerCase();
      const user = USERS.find(x => !x.disabled && (x.id.toLowerCase() === normalizedId || (x.email && x.email.toLowerCase() === normalizedId)));
      if (!user) {
        cleanupSecurityQueues();
        const pending = signupRequests.find(x => x.status === 'PENDING' && (x.requestedLoginId?.toLowerCase() === normalizedId || x.email?.toLowerCase() === normalizedId));
        if (pending) return send(res, 403, { code: 'ACCOUNT_PENDING_APPROVAL', error: 'Your NEO access request is still pending System Administrator approval.' });
        return send(res, 401, { code: 'INVALID_CREDENTIALS', error: 'Login ID/email or password is incorrect.' });
      }
      if (!verifyPasswordAndMigrate(user, password)) {
        return send(res, 401, { code: 'INVALID_CREDENTIALS', error: 'Login ID/email or password is incorrect.' });
      }
      if (user.passwordResetRequired) {
        return send(res, 403, { code: 'PASSWORD_RESET_REQUIRED', error: 'Password reset is required before entering NEO.', resetRequired: true });
      }
      if (user.passwordSource !== 'user') { user.passwordSource = 'user'; writeJson('users.json', USERS); }
      const sid = newSession(user);
      audit(user.id, 'Signed in', user.department, 'auth');
      return send(res, 200, { ok: true, user: publicUser(user) }, 'application/json', { 'Set-Cookie': cookieHeader(sid, SESSION_TTL_MS / 1000, req) });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      if (session) { sessions.delete(session.sid); audit(session.user.id, 'Signed out', session.user.department, 'auth'); }
      return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': clearCookieHeader(req) });
    }
    if (req.method === 'POST' && p === '/api/touch') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      return send(res, 200, { ok: true, expiresAt: s.lastActive + SESSION_TTL_MS });
    }
    if (req.method === 'GET' && p === '/api/access') {
      const s = requireAuth(req, res); if (!s) return;
      return send(res, 200, { ...userContext(s), pages: Object.fromEntries(Object.entries(ROLE_RULES).map(([page, roles]) => [page, roles.includes(s.user.role)])) });
    }
    if (req.method === 'GET' && p === '/api/admin/signup-requests') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      cleanupSecurityQueues();
      return send(res, 200, { requests: signupRequests.map(({passwordHash,passwordSalt,...r}) => ({...r,passwordSet:!!passwordHash})) });
    }
    if (req.method === 'POST' && p === '/api/admin/signup-requests') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      const b = await body(req);
      const id = String(b.requestId || ''); const decision = String(b.decision || '').toUpperCase();
      const request = signupRequests.find(x => x.id === id);
      if (!request) return send(res, 404, { error: 'Signup request not found.' });
      if (request.status !== 'PENDING') return send(res, 409, { error: 'Signup request has already been processed.' });
      if (!['APPROVE','REJECT'].includes(decision)) return send(res, 400, { error: 'Decision must be APPROVE or REJECT.' });
      if (decision === 'REJECT') { request.status = 'REJECTED'; request.reviewedBy = s.user.id; request.reviewedAt = new Date().toISOString(); writeJson('signup-requests.json', signupRequests); audit(s.user.id, `Rejected signup request ${id}`, request.department, 'auth', { requestId: id }); return send(res, 200, { ok: true, request }); }
      let loginId = String(request.requestedLoginId || '').trim();
      if (USERS.some(u => u.id === loginId)) loginId = `${loginId}.${crypto.randomInt(100,999)}`;
      const tempPassword = String(b.temporaryPassword || '');
      const approvedDepartment = normalizeDepartment(request.department);
      const baseRole = approvedDepartment === SYSTEM_ADMIN_DEPARTMENT ? 'SYSTEM_ADMIN' : approvedDepartment === 'Quality Assurance' ? 'QA' : approvedDepartment === 'Quality Control' ? 'QC' : 'DEPT_USER';
      let user;
      if (request.passwordHash && request.passwordSalt && !tempPassword) {
        user = { id: loginId, name: request.name, role: baseRole, department: approvedDepartment, email: request.email, salt: request.passwordSalt, hash: request.passwordHash, disabled: false, approvedAt: new Date().toISOString() };
      } else {
        const finalPassword = tempPassword || `Neo@${crypto.randomInt(100000,999999)}`;
        if (finalPassword.length < 10) return send(res, 400, { error: 'Temporary password must be at least 10 characters.' });
        user = userRecord(loginId, request.name, baseRole, approvedDepartment, finalPassword, request.email);
        }
      user.profileRole = request.profileRole; user.approvedBy = s.user.id;
      USERS.push(user); writeJson('users.json', USERS);
      request.status = 'APPROVED'; request.reviewedBy = s.user.id; request.reviewedAt = new Date().toISOString(); request.loginId = loginId; request.role = baseRole; request.temporaryPasswordIssued = true; writeJson('signup-requests.json', signupRequests);
      audit(s.user.id, `Approved signup request ${id}`, request.department, 'auth', { requestId: id, userId: loginId });
      try { await sendApprovalWelcomeEmail(user.email, request, loginId, tempPassword || null); } catch (e) { writeMailAudit('approval-email-error', user.email, 'NEO access approval', e.message); }
      return send(res, 200, { ok: true, request: { ...request, passwordHash: undefined, passwordSalt: undefined }, user: publicUser(user), temporaryPassword: tempPassword || null });
    }
    if (req.method === 'GET' && p === '/api/admin/audit-users') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'AUDIT_ADMIN']); if (!s) return;
      return send(res, 200, { users: USERS.filter(u => ['AUDIT_FRONT', 'AUDIT_BACK'].includes(u.role)).map(publicUser) });
    }
    if (req.method === 'POST' && p === '/api/admin/audit-users') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'AUDIT_ADMIN']); if (!s) return;
      const b = await body(req);
      const id = String(b.id || '').trim();
      const password = String(b.password || '');
      const role = String(b.role || '');
      if (!/^[A-Za-z0-9._-]{3,80}$/.test(id)) return send(res, 400, { error: 'Login ID must contain only letters, numbers, dot, underscore or hyphen.' });
      if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
      try { return send(res, 201, { ok: true, user: createAuditUser(s, id, password, role) }); }
      catch (e) { return send(res, 409, { error: e.message }); }
    }
    if (req.method === 'GET' && p === '/api/admin/users') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      return send(res, 200, { users: USERS.map(publicUser) });
    }
    if (req.method === 'POST' && p === '/api/admin/test-email') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      try {
        const result = await sendMail(RECOVERY_EMAIL, 'NEO production email test', `NEO production email test from System Administrator on ${new Date().toISOString()}.`);
        audit(s.user.id, 'Production email test', s.user.department, 'auth', { provider: result.provider });
        return send(res, 200, { ok: true, ...result, target: RECOVERY_EMAIL });
      } catch (e) {
        writeMailAudit('test-email-error', RECOVERY_EMAIL, 'NEO production email test', e.message);
        return send(res, 503, { ok: false, error: e.message });
      }
    }
    if (req.method === 'POST' && p === '/api/admin/users') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      const b = await body(req); const id = String(b.id || '').trim();
      const action = String(b.action || '').toUpperCase(); const user = USERS.find(x => x.id === id);
      if (!user) return send(res, 404, { error: 'User not found.' });
      if (user.role === 'SYSTEM_ADMIN' && id === s.user.id && action === 'DISABLE') return send(res, 400, { error: 'You cannot disable your own System Administrator account.' });
      if (action === 'DISABLE') user.disabled = true;
      else if (action === 'ENABLE') user.disabled = false;
      else if (action === 'FORCE_PASSWORD_RESET') { user.passwordResetRequired = true; }
      else return send(res, 400, { error: 'Unsupported maintenance action.' });
      writeJson('users.json', USERS); audit(s.user.id, `${action} user ${id}`, user.department, 'auth', { targetUserId: id });
      return send(res, 200, { ok: true, user: publicUser(user) });
    }
    if (req.method === 'POST' && p === '/api/career-suggestions') {
      const b = await body(req);
      const rec = { id: crypto.randomUUID(), type: String(b.type || 'Other').slice(0, 100), suggestion: String(b.suggestion || '').trim().slice(0, 3000), createdAt: new Date().toISOString() };
      if (!rec.suggestion) return send(res, 400, { error: 'Suggestion is required' });
      careerSuggestions.unshift(rec); careerSuggestions = careerSuggestions.slice(0, 500); writeJson('career-suggestions.json', careerSuggestions);
      audit('public-contact', `Career/product suggestion submitted: ${rec.type}`, 'Public', 'career');
      return send(res, 201, { ok: true, id: rec.id });
    }

    if (req.method === 'GET' && p === '/api/departments/summary') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const slug = String(u.searchParams.get('dept') || '').trim();
      const summary = departmentSummary(slug, s);
      if (!summary) return send(res, 404, { error: 'Department not found' });
      return send(res, 200, summary);
    }

    if (req.method === 'GET' && p === '/api/incidents') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER']); if (!s) return;
      return send(res, 200, { incidents: scopedRecords(incidents, s), scope: ['SYSTEM_ADMIN', 'QA'].includes(s.user.role) ? 'ALL' : userDepartmentName(s.user) });
    }
    if (req.method === 'POST' && p === '/api/deviations') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER']); if (!s) return;
      const b = await body(req);
      const dept = normalizeDepartment(String(b.dept || s.user.department));
      if (!DEPARTMENTS[DEPARTMENT_SLUG_BY_NAME[dept]]) return send(res, 400, { error: 'Invalid department selected.' });
      if (!String(b.title || '').trim()) return send(res, 400, { error: 'Deviation title is required.' });
      if (!String(b.description || '').trim()) return send(res, 400, { error: 'Initial observation is required.' });
      if (!['SYSTEM_ADMIN','QA'].includes(s.user.role) && !userCanAccessDepartment(s.user, dept)) return send(res, 403, { error: 'Record is outside your department scope' });
      const n = Math.max(1, ...deviations.map(x => Number(String(x.id).replace(/\D/g,'')) || 0)) + 1;
      const rec = { id: `DEV-${String(n).padStart(3,'0')}`, title: String(b.title || 'Untitled deviation').slice(0,300), dept, severity: String(b.severity || 'Minor'), status: 'Open', locked: false, description: String(b.description || '').slice(0,4000), step: 'Record raised', evidence: [String(b.ref || 'Initial observation')], createdBy: s.user.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      deviations.push(rec); writeJson('deviations.json', deviations); audit(s.user.id, `Created deviation ${rec.id}`, rec.dept, 'qms', { deviationId: rec.id }); return send(res, 201, { deviation: rec });
    }

    if (req.method === 'GET' && p === '/api/deviations') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER']); if (!s) return;
      return send(res, 200, { deviations: scopedRecords(deviations, s) });
    }
    const devMatch = p.match(/^\/api\/deviations\/([^/]+)$/);
    if (devMatch && req.method === 'GET') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER']); if (!s) return;
      const rec = deviations.find(x => x.id === devMatch[1]);
      if (!rec) return send(res, 404, { error: 'Deviation not found' });
      if (!['SYSTEM_ADMIN', 'QA'].includes(s.user.role) && !userCanAccessDepartment(s.user, rec.dept)) return send(res, 403, { error: 'Record is outside your department scope' });
      return send(res, 200, { deviation: rec });
    }
    if (devMatch && req.method === 'POST') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'QC', 'DEPT_USER']); if (!s) return;
      const rec = deviations.find(x => x.id === devMatch[1]);
      if (!rec) return send(res, 404, { error: 'Deviation not found' });
      if (!['SYSTEM_ADMIN', 'QA'].includes(s.user.role) && !userCanAccessDepartment(s.user, rec.dept)) return send(res, 403, { error: 'Record is outside your department scope' });
      const b = await body(req);
      const action = String(b.action || '');
      if (action === 'sign-level-1') {
        if (rec.locked) return send(res, 409, { error: 'Deviation step is already locked' });
        rec.locked = true; rec.status = 'Locked'; rec.step = 'Level 1 Investigation'; rec.signedBy = s.user.id; rec.signedAt = new Date().toISOString();
        writeJson('deviations.json', deviations);
        audit(s.user.id, `Deviation ${rec.id} signed and locked`, rec.dept, 'qms', { deviationId: rec.id });
        return send(res, 200, { deviation: rec });
      }
      return send(res, 400, { error: 'Unsupported deviation action' });
    }

    if (req.method === 'POST' && p === '/api/knowledge/search') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const b = await body(req);
      const target = String(b.department || '').trim();
      if (target && !userCanAccessDepartment(s.user, target)) return send(res, 403, { error: 'Department knowledge is outside your access scope' });
      const scoped = target ? { ...s, user: { ...s.user, department: normalizeDepartment(target) } } : s;
      const results = mergedKnowledge(b.q, scoped, Math.min(Number(b.limit || 8), 20));
      audit(s.user.id, `Internal knowledge search (${auditQueryMeta(b.q).queryHash})`, s.user.department, 'knowledge', auditQueryMeta(b.q));
      return send(res, 200, { results, source: 'NEO internal knowledge' });
    }
    if (req.method === 'POST' && p === '/api/google-search') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const b = await body(req);
      if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_CX) {
        return send(res, 503, { configured: false, results: [], error: 'Google Programmable Search is not configured on the server.' });
      }
      let results = [];
      try { results = await googleSearch(String(b.q || '').slice(0, 500)); }
      catch (e) { return send(res, 502, { configured: true, results: [], error: e.message }); }
      audit(s.user.id, `Google search (${auditQueryMeta(b.q).queryHash})`, s.user.department, 'knowledge', auditQueryMeta(b.q));
      return send(res, 200, { configured: true, results });
    }
    if (req.method === 'GET' && p === '/api/connectors/status') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      return send(res, 200, connectorStatus());
    }
    if (req.method === 'GET' && p === '/api/admin/system-check') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN']); if (!s) return;
      return send(res, 200, { version:APP_VERSION, login:true, session:true, approvalQueue:signupRequests.filter(x=>x.status==='PENDING').length, recoveryConfigured:Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_FROM)||Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&process.env.SMTP_FROM), liveVoiceConfigured:Boolean(process.env.GOOGLE_GEMINI_API_KEY), geminiTextConfigured:Boolean(process.env.GOOGLE_GEMINI_API_KEY), connectors:connectorStatus(), publicOrigin:PUBLIC_ORIGIN||null, allowedOrigins:ALLOWED_ORIGINS });
    }
    if (req.method === 'POST' && p === '/api/connectors/search') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const b = await body(req);
      const q = String(b.q || '').trim();
      if (!q) return send(res, 400, { error: 'Search query is required.' });
      const results = await searchConnectors(q, Array.isArray(b.connectors) ? b.connectors.map(String) : null, s.user);
      audit(s.user.id, `Enterprise connector search (${auditQueryMeta(q).queryHash})`, s.user.department, 'knowledge', auditQueryMeta(q));
      return send(res, 200, { results, configured: connectorStatus() });
    }
    if (req.method === 'POST' && p === '/api/neo-chat') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const b = await body(req);
      const message = String(b.message || '').trim();
      if (!message) return send(res, 400, { error: 'Message is required' });
      const history = Array.isArray(b.history) ? b.history.slice(-10).map(x => ({ role: x?.role === 'user' ? 'user' : 'assistant', content: String(x?.content || '').slice(0, 4000) })) : [];
      const requestedDept = String(b.department || '').trim().toLowerCase();
      const pageTitle = String(b.pageTitle || 'NEO').slice(0, 180);
      const pageUrl = String(b.pageUrl || '/').slice(0, 300);
      let contextDept = s.user.department || '';
      if (requestedDept && DEPARTMENTS[requestedDept]) {
        const requestedName = DEPARTMENTS[requestedDept].name;
        if (['SYSTEM_ADMIN','QA'].includes(s.user.role) || requestedName === s.user.department) contextDept = requestedName;
      }
      const scopedSession = contextDept ? { ...s, user: { ...s.user, department: contextDept } } : s;
      const asksCrossFunctional = /\b(cross[- ]?functional|across departments|other department|company[- ]wide|whole NEO|all departments|enterprise[- ]wide|global context|bridge to)\b/i.test(message);
      const broadScope = s.user.role === 'SYSTEM_ADMIN' || (asksCrossFunctional && s.user.role === 'QA');
      const knowledgeSession = broadScope ? s : scopedSession;
      const internal = mergedKnowledge(`${message} ${contextDept} ${pageTitle}`, knowledgeSession, broadScope ? 18 : 10);
      const webRequested = b.web === true || /\b(google|web|internet|latest|news|current|today|recent)\b/i.test(message);
      const connectorRequested = b.connectors === true || (String(process.env.NEO_CONNECTORS_AUTO || 'true').toLowerCase() !== 'false' && /\b(sharepoint|onedrive|drive|microsoft 365|m365|salesforce|crm|slack|teams|enterprise|company records|internal system)\b/i.test(message));
      const retrievalTimeout = Math.max(900, Number(process.env.NEO_RETRIEVAL_TIMEOUT_MS || 1800));
      const webPromise = webRequested && process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX
        ? withTimeout(googleSearch(message), retrievalTimeout, [{ title: 'Google search timed out', snippet: 'External search exceeded the fast-response window.', url: '' }]).catch(e => [{ title: 'Google search unavailable', snippet: e.message, url: '' }])
        : Promise.resolve([]);
      const connectorPromise = connectorRequested
        ? withTimeout(searchConnectors(message, Array.isArray(b.connectorsList) ? b.connectorsList : null, s.user), retrievalTimeout, [{ connector: 'enterprise', title: 'Enterprise search timed out', snippet: 'Connector search exceeded the fast-response window.', url: '' }]).catch(e => [{ connector: 'enterprise', title: 'Connector search unavailable', snippet: e.message, url: '' }])
        : Promise.resolve([]);
      const [web, connectors] = await Promise.all([webPromise, connectorPromise]);
      let gateway = null;
      try {
        gateway = await withTimeout(proxyChat({
          message,
          user: s.user,
          scope: requestedDept ? `department:${requestedDept}` : 'whole-neo',
          contextDepartment: contextDept,
          pageTitle,
          pageUrl,
          internalKnowledge: internal,
          webKnowledge: web,
          enterpriseKnowledge: connectors,
          conversationHistory: history,
          guardrails: { humanApprovalRequired: true, regulatedCommunicationAutonomous: false }
        }), Math.max(1200, Number(process.env.NEO_CHAT_TIMEOUT_MS || 2800)), null);
      } catch (e) {
        gateway = { error: e.message };
      }
      if (!gateway && process.env.GOOGLE_GEMINI_API_KEY) {
        try {
          gateway = await withTimeout(proxyGeminiChat({ message, history, internal, web, connectors, user: s.user, contextDepartment: contextDept, pageTitle, pageUrl, webRequested }), Number(process.env.NEO_CHAT_TIMEOUT_MS || 2800), null);
        } catch (e) {
          gateway = { error: e.message };
        }
      }
      audit(s.user.id, `NEO question (${auditQueryMeta(message).queryHash})`, s.user.department, 'agent', auditQueryMeta(message));
      if (gateway?.answer || gateway?.output_text || gateway?.text) {
        return send(res, 200, {
          answer: gateway.answer || gateway.output_text || gateway.text,
          internal,
          web,
          connectors,
          configured: { chat: !!process.env.NEO_CHAT_URL, google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX), enterprise: connectorStatus() }
        });
      }
      const fallback = [
        `NEO workspace answer`,
        `Question: ${message}`,
        `Internal knowledge:\n${internal.length ? internal.map((x, i) => `${i + 1}. ${x.title}\n${x.snippet}`).join('\n\n') : 'No internal matches found.'}`,
        web.length ? `Google results:\n${web.map((x, i) => `${i + 1}. ${x.title}\n${x.snippet}\n${x.url}`).join('\n\n')}` : 'Google results: none requested or Google is not configured.',
        connectors.length ? `Enterprise connector results:\n${connectors.map((x, i) => `${i + 1}. [${x.connector}] ${x.title}\n${x.snippet}\n${x.url || ''}`).join('\n\n')}` : 'Enterprise connectors: none requested or none configured.',
        `Access scope: ${s.user.role} / ${s.user.department}${contextDept && contextDept !== s.user.department ? ` · context: ${contextDept}` : ''}.`
      ].join('\n\n');
      return send(res, 200, {
        answer: fallback,
        internal,
        web,
        connectors,
        configured: { chat: !!process.env.NEO_CHAT_URL, google: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX), enterprise: connectorStatus() }
      });
    }
    if (req.method === 'POST' && p === '/api/voice/workflow') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const b = await body(req);
      const department = normalizeDepartment(String(b.department || s.user.department));
      if (!userCanAccessDepartment(s.user, department)) return send(res, 403, { error: 'Department voice workflow is outside your access scope' });
      const action = String(b.action || 'general').toLowerCase();
      const presets = {
        'Clinical Trial': {
          feasibility: 'Clinical study feasibility, site selection criteria, enrollment evidence, country footprint and operational constraints.',
          protocol: 'Clinical protocol risk, eligibility windows, operational hotspots, deviations and data quality.',
          startup: 'Clinical study start-up, site readiness, training, document collection and controlled milestones.',
          safety: 'Clinical safety-event handoff to Pharmacovigilance using minimum-necessary, authorized information.'
        },
        'Pharmacovigilance': {
          intake: 'Safety case intake, source reconciliation, seriousness/expectedness checks and triage workflow.',
          signal: 'Pharmacovigilance signal detection, recurring patterns, product-event relationships and review evidence.',
          literature: 'Safety literature monitoring, evidence extraction and controlled regulatory follow-up.',
          narrative: 'Case narrative drafting support based on authorized source records with human medical review required.'
        }
      }[department] || {};
      const preset = presets[action] || 'Use the authorized department knowledge and return the most relevant workflow steps, evidence and next controlled action.';
      const query = `${preset} ${String(b.query || '').slice(0, 1200)}`.trim();
      const results = searchRuntimeKnowledge(query, s, 8);
      audit(s.user.id, `Voice workflow ${department} / ${action}`, s.user.department, 'agent', { department, action, ...auditQueryMeta(query) });
      return send(res, 200, { department, action, workflow: preset, results });
    }

    if (req.method === 'POST' && p === '/api/voice/live-token') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      if (!process.env.GOOGLE_GEMINI_API_KEY) return send(res, 503, { error: 'Google Gemini Live is not configured on the server' });
      const vb = await body(req);
      const requestedVoiceDepartment = normalizeDepartment(String(vb.department || s.user.department || ''));
      const pageTitle = String(vb.pageTitle || 'NEO').slice(0, 180);
      const pageUrl = String(vb.pageUrl || '/').slice(0, 300);
      if (requestedVoiceDepartment && !userCanAccessDepartment(s.user, requestedVoiceDepartment)) return send(res, 403, { error: 'Voice context is outside your access scope' });
      const voiceDepartment = requestedVoiceDepartment || userDepartmentName(s.user);
      const now = Date.now();
      const payload = {
        uses: 1,
        expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: `models/${process.env.NEO_LIVE_MODEL || 'gemini-3.8-live'}`,
          config: {
            responseModalities: ['AUDIO'],
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: {},
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            explicitVadSignal: false
          }
        }
      };
      try {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_GEMINI_API_KEY },
          body: JSON.stringify(payload)
        });
        const d = await r.json();
        if (!r.ok || !d.name) return send(res, 502, { error: d.error?.message || 'Unable to create live voice token' });
        audit(s.user.id, 'Created ephemeral Gemini Live voice session', s.user.department, 'agent');
        const firstName = String(s.user.name || 'there').trim().split(/\s+/)[0] || 'there';
        const hour = new Date().getHours();
        const greetingTime = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
        const voiceProfile = {
          department: voiceDepartment,
          workflows: voiceDepartment === 'Clinical Trial' ? ['feasibility','protocol','startup','safety'] : voiceDepartment === 'Pharmacovigilance' ? ['intake','signal','literature','narrative'] : [],
          pageTitle,
          pageUrl,
          greeting: `${firstName}, welcome to NEO. ${greetingTime}. How may I help with your ${voiceDepartment || userDepartmentName(s.user)} team?`,
          systemInstruction: `You are NEO, an enterprise operations voice assistant. Greet the user naturally as ${firstName}. Start in the ${voiceDepartment || 'Whole NEO'} department context. ${greetingTime}, and ask how you can help the ${voiceDepartment || userDepartmentName(s.user)} team. Stay inside the user's permission scope. When the user explicitly asks for cross-functional information and their role permits it, bridge to other authorized departments without losing the current department context. For Clinical Trial, focus on study feasibility, protocol risk, start-up and safety handoffs. For Pharmacovigilance, focus on case intake, signal detection, literature monitoring and narrative support. Use internal knowledge tools before making claims about NEO records and use Google Search for current external facts. Do not expose personal data unnecessarily and never declare a regulated decision final without human approval.`
        };
        return send(res, 200, { token: d.name, model: process.env.NEO_LIVE_MODEL || 'gemini-3.8-live', expiresAt: payload.expireTime, sessionStartsBy: payload.newSessionExpireTime, user: s.user, voiceProfile });
      } catch (e) {
        return send(res, 502, { error: e.message });
      }
    }

    if (req.method === 'POST' && p === '/api/voice/transcribe') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      if (!process.env.NEO_STT_URL) return send(res, 503, { error: 'Server STT provider is not configured' });
      const b = await body(req);
      const result = await proxyJson('NEO_STT_URL', b, 'NEO_STT_AUTH');
      audit(s.user.id, 'Voice transcription request', s.user.department, 'agent');
      return send(res, 200, result || {});
    }
    if (req.method === 'POST' && p === '/api/voice/speak') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      if (!process.env.NEO_TTS_URL) return send(res, 503, { error: 'Server TTS provider is not configured' });
      const b = await body(req);
      const result = await proxyJson('NEO_TTS_URL', b, 'NEO_TTS_AUTH');
      audit(s.user.id, 'Voice synthesis request', s.user.department, 'agent');
      return send(res, 200, result || {});
    }

    if (p === '/api/audit/requests' && req.method === 'GET') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      return send(res, 200, { requests: visibleAuditRequests(s) });
    }
    if (p === '/api/audit/requests' && req.method === 'POST') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'DEPT_USER', 'AUDIT_ADMIN', 'AUDIT_FRONT']); if (!s) return;
      const b = await body(req);
      const title = String(b.title || '').trim();
      if (!title) return send(res, 400, { error: 'Audit question is required' });
      const dept = normalizeDepartment(String(b.dept || s.user.department || 'QA'));
      if (s.user.role === 'DEPT_USER' && dept !== userDepartmentName(s.user)) return send(res, 403, { error: 'Department users can only create audit requests for their own department' });
      if (s.user.role === 'AUDIT_FRONT' && !['Quality Assurance', 'Quality Control', 'Manufacturing', 'Clinical Trial'].includes(dept)) return send(res, 403, { error: 'Front Room cannot create requests for that department' });
      const nextId = Math.max(100, ...auditRequests.map(r => Number(String(r.id).replace(/\D/g, '')) || 0)) + 1;
      const rec = { id: `AUD-${nextId}`, title: title.slice(0, 500), dept, status: 'REQUESTED', createdAt: new Date().toISOString(), sourceHints: [] };
      auditRequests.push(rec); writeJson('audit-requests.json', auditRequests);
      audit(s.user.id, `Created audit request ${rec.id}`, rec.dept, 'audit', { requestId: rec.id });
      return send(res, 201, rec);
    }
    const reqMatch = p.match(/^\/api\/audit\/requests\/([^/]+)$/);
    if (reqMatch && req.method === 'POST') {
      const id = reqMatch[1];
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const b = await body(req);
      const rec = auditRequests.find(r => r.id === id);
      if (!rec) return send(res, 404, { error: 'Request not found' });
      if (s.user.role === 'QC' && rec.dept !== 'QC') return send(res, 403, { error: 'QC is limited to QC audit requests' });
      const allowed = {
        REQUESTED: ['SEARCHED'], SEARCHED: ['PACK_PREPARED'], PACK_PREPARED: ['SME_REVIEW'], SME_REVIEW: ['APPROVED', 'REJECTED'], APPROVED: ['PRESENTED'], REJECTED: ['REQUESTED']
      }[rec.status] || [];
      const next = String(b.status || '');
      if (!allowed.includes(next)) return send(res, 409, { error: `Invalid transition ${rec.status} → ${next}` });
      const roleByTransition = {
        SEARCHED: ['AUDIT_BACK', 'AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN'],
        PACK_PREPARED: ['AUDIT_BACK', 'AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN'],
        SME_REVIEW: ['AUDIT_BACK', 'AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN'],
        APPROVED: ['AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN'],
        REJECTED: ['AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN'],
        PRESENTED: ['AUDIT_FRONT', 'AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN'],
        REQUESTED: ['AUDIT_FRONT', 'AUDIT_ADMIN', 'QA', 'SYSTEM_ADMIN']
      };
      if (!roleByTransition[next].includes(s.user.role)) return send(res, 403, { error: `Role ${s.user.role} cannot perform ${next}` });
      if (next === 'PRESENTED' && rec.status !== 'APPROVED') return send(res, 409, { error: 'Only approved evidence can be presented' });
      if (next === 'APPROVED' && rec.status !== 'SME_REVIEW') return send(res, 409, { error: 'Only SME-reviewed requests can be approved' });
      rec.status = next;
      rec.updatedAt = new Date().toISOString();
      rec.updatedBy = s.user.id;
      if (Array.isArray(b.sources)) rec.sources = b.sources.slice(0, 50).map(x => String(x).slice(0, 500));
      if (b.note) rec.note = String(b.note).slice(0, 2000);
      writeJson('audit-requests.json', auditRequests);
      audit(s.user.id, `${id} → ${next}`, rec.dept, 'audit', { requestId: id });
      return send(res, 200, rec);
    }
    if (p === '/api/audit/packs' && req.method === 'POST') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN', 'AUDIT_BACK']); if (!s) return;
      const b = await body(req);
      const requestId = String(b.requestId || '');
      const request = auditRequests.find(r => r.id === requestId);
      if (!request) return send(res, 404, { error: 'Audit request not found' });
      if (s.user.role === 'AUDIT_BACK' && !['Quality Control', 'Manufacturing', 'Quality Assurance', 'Clinical Trial'].includes(normalizeDepartment(request.dept))) return send(res, 403, { error: 'Back Room scope does not allow this department' });
      if (!['SEARCHED', 'PACK_PREPARED'].includes(request.status)) return send(res, 409, { error: `Request must be SEARCHED or PACK_PREPARED; current ${request.status}` });
      const pack = {
        id: crypto.randomUUID(),
        requestId,
        createdAt: new Date().toISOString(),
        createdBy: s.user.id,
        sources: Array.isArray(b.sources) ? b.sources.map(x => String(x).slice(0, 500)) : [],
        status: 'DRAFT'
      };
      evidencePacks.push(pack); writeJson('evidence-packs.json', evidencePacks);
      request.status = 'PACK_PREPARED'; request.updatedAt = new Date().toISOString(); request.updatedBy = s.user.id; request.packId = pack.id;
      writeJson('audit-requests.json', auditRequests);
      audit(s.user.id, `Evidence pack created for ${pack.requestId}`, s.user.department, 'audit', { requestId: pack.requestId, packId: pack.id });
      return send(res, 201, pack);
    }
    if (p === '/api/audit/packs' && req.method === 'GET') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN', 'AUDIT_BACK']); if (!s) return;
      const requestId = u.searchParams.get('requestId');
      let packs = requestId ? evidencePacks.filter(x => x.requestId === requestId) : evidencePacks;
      return send(res, 200, { packs });
    }
    if (p === '/api/audit/sme' && req.method === 'POST') {
      const s = requireAuth(req, res, ['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN']); if (!s) return;
      const b = await body(req);
      const id = String(b.requestId || '');
      const request = auditRequests.find(r => r.id === id);
      if (!request) return send(res, 404, { error: 'Audit request not found' });
      if (request.status !== 'SME_REVIEW') return send(res, 409, { error: `Request is not awaiting SME review (${request.status})` });
      const decision = String(b.decision || 'PENDING');
      if (!['APPROVED', 'REJECTED'].includes(decision)) return send(res, 400, { error: 'Decision must be APPROVED or REJECTED' });
      const rec = { requestId: id, reviewer: s.user.id, decision, notes: String(b.notes || '').slice(0, 3000), time: new Date().toISOString() };
      const pack = evidencePacks.find(x => x.id === request.packId);
      if (pack) { pack.status = decision; pack.review = rec; writeJson('evidence-packs.json', evidencePacks); }
      request.status = decision;
      request.updatedAt = rec.time;
      request.updatedBy = s.user.id;
      writeJson('audit-requests.json', auditRequests);
      audit(s.user.id, `SME review ${id}: ${decision}`, s.user.department, 'audit', { requestId: id });
      return send(res, 200, rec);
    }
    if (p === '/api/audit/history' && req.method === 'GET') {
      const s = requireAuth(req, res, ALL_AUTH); if (!s) return;
      const dept = u.searchParams.get('dept');
      const data = dept && !['SYSTEM_ADMIN', 'QA', 'AUDIT_ADMIN'].includes(s.user.role)
        ? auditEvents.filter(e => normalizeDepartment(e.dept) === userDepartmentName(s.user))
        : auditEvents;
      return send(res, 200, { events: data });
    }

    if (req.method === 'GET') {
      const relative = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const file = path.resolve(root, relative);
      if (!file.startsWith(root)) return send(res, 403, { error: 'Forbidden' });
      if (ROLE_RULES[relative]) {
        if (!session) return send(res, 302, '', 'text/plain', { Location: '/login.html?next=' + encodeURIComponent('/' + relative) });
        if (!ROLE_RULES[relative].includes(session.user.role)) {
          return send(res, 403, `<!doctype html><title>Access denied</title><p>Role ${session.user.role} cannot open ${relative}.</p><p><a href="/workspace.html">Back to workspace</a></p>`, 'text/html');
        }
      } else if (!protectStatic(relative, session)) {
        return send(res, 302, '', 'text/plain', { Location: '/login.html?next=' + encodeURIComponent('/' + relative) });
      }
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        if (ext === '.html') {
          let html = fs.readFileSync(file, 'utf8');
          const isAgent = relative === 'agent.html';
          const isPublic = PUBLIC_FILES.has(path.basename(relative));
          if (!isPublic && !isAgent && !html.includes('/assets/voice-companion.js')) {
            html = html.replace('</head>', '<script defer src="/assets/voice-companion.js"></script></head>');
          }
          res.writeHead(200, { 'Content-Type': mime[ext], 'Cache-Control': 'no-store', ...securityHeaders() });
          return res.end(html);
        }
        res.writeHead(200, {
          'Content-Type': mime[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
          ...securityHeaders()
        });
        return fs.createReadStream(file).pipe(res);
      }
      return send(res, 404, { error: 'Not found' });
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: DEMO_MODE ? e.message : 'Internal server error' });
  }
});

setInterval(() => {
  for (const [sid, s] of sessions) if (Date.now() - s.lastActive > SESSION_TTL_MS) sessions.delete(sid);
}, 15000).unref();

server.listen(PORT, () => console.log(`NEO server running at http://localhost:${PORT}`));
