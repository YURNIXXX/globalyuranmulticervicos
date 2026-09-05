const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mudar-esta-senha';
const ADMIN_RECOVERY_KEY = process.env.ADMIN_RECOVERY_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-esta-chave-em-producao';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const ALLOW_LOCAL_STORAGE = process.env.ALLOW_LOCAL_STORAGE === 'true';

// Nunca deixe produção cair silenciosamente para armazenamento local.
// No Render, o sistema de ficheiros da instância é efémero e os dados seriam perdidos
// num restart/redeploy. Para desenvolvimento local, use ALLOW_LOCAL_STORAGE=true.
if (!USE_SUPABASE && !ALLOW_LOCAL_STORAGE) {
  console.error('ERRO FATAL: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não estão configuradas.');
  console.error('O servidor foi interrompido para evitar perda de dados no armazenamento local.');
  process.exit(1);
}

const supabase = USE_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;

const DATA_FILE = path.join(__dirname, 'data', 'site.json');
const IMAGE_DIR = path.join(__dirname, 'public', 'uploads', 'images');
const CV_DIR = path.join(__dirname, 'public', 'uploads', 'cvs');
[IMAGE_DIR, CV_DIR].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

function readLocalData() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function writeLocalData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
function uid(prefix = 'item') { return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`; }
function requireAuth(req, res, next) { if (!req.session.admin) return res.status(401).json({ error: 'Não autenticado.' }); next(); }
function slugify(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('servico'); }
function normalizeUrl(value = '') {
  const v = String(value).trim();
  if (!v || v === '#') return v || '#';
  if (/^(https?:)?\/\//i.test(v)) return v.startsWith('//') ? `https:${v}` : v;
  return `https://${v.replace(/^\/+/, '')}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expectedHex] = stored.split('$');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function safeSecretEqual(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
async function validAdminPassword(password) {
  const data = await readData();
  return data._admin?.passwordHash ? verifyPassword(password, data._admin.passwordHash) : String(password) === ADMIN_PASSWORD;
}

function normalizeContent(content) {
  content.settings ||= {};
  if (!content.settings.siteName || content.settings.siteName === 'Nexa MultiServiços') content.settings.siteName = 'Yuran Multicerviços';
  content.settings.primaryColor ||= '#151a16';
  content.settings.heroColor ||= '#00C9A7';
  content.settings.navHoverColor ||= '#00C9A7';
  content.settings.logo ||= '';
  content.settings.favicon ||= '';
  content._admin ||= {};
  content.socials ||= [];
  if (!content.socials.length) {
    const oldSocials = [
      ['Instagram', 'instagram', 'bi-instagram'],
      ['Facebook', 'facebook', 'bi-facebook'],
      ['LinkedIn', 'linkedin', 'bi-linkedin']
    ];
    content.socials = oldSocials.filter(([, key]) => content.settings[key] && content.settings[key] !== '#').map(([platform, key, iconClass]) => ({ id: uid('social'), platform, url: normalizeUrl(content.settings[key]), iconClass }));
  }
  const presets = {
    'eletricidade': { iconClass: 'bi-lightning-charge', oldColor: '#F28C28', color: '#F28C28' },
    'design-grafico': { iconClass: 'bi-palette', oldColor: '#708D75', color: '#00C9A7' },
    'marketing': { iconClass: 'bi-megaphone', oldColor: '#476C9B', color: '#00C9A7' },
    'agropecuaria': { iconClass: 'bi-flower1', oldColor: '#77966D', color: '#2E8B57' }
  };
  content.services = (content.services || []).map(s => {
    const preset = presets[s.id] || {};
    const next = { ...s };
    if (!next.iconClass) next.iconClass = preset.iconClass || 'bi-briefcase';
    if (preset.oldColor && String(next.color).toUpperCase() === preset.oldColor.toUpperCase()) next.color = preset.color;
    next.iconImage ||= '';
    next.banner ||= '';
    next.details ||= next.description || '';
    return next;
  });
  content.portfolio = (content.portfolio || []).map(p => ({ ...p, images: p.images?.length ? p.images : (p.image ? [p.image] : []) }));
  content.partners ||= []; content.links = (content.links || []).map(l => ({ ...l, iconClass: l.iconClass || 'bi-link-45deg' })); content.team ||= [];
  return content;
}

async function readData() {
  if (!USE_SUPABASE) return normalizeContent(readLocalData());
  const { data, error } = await supabase.from('site_content').select('content').eq('id', 'main').maybeSingle();
  if (error) throw error;
  if (!data) {
    const initial = readLocalData();
    const { error: insertError } = await supabase.from('site_content').insert({ id: 'main', content: initial });
    if (insertError) throw insertError;
    return normalizeContent(initial);
  }
  return normalizeContent(data.content);
}

async function writeData(content) {
  if (!USE_SUPABASE) return writeLocalData(content);
  const { error } = await supabase.from('site_content').upsert({ id: 'main', content, updated_at: new Date().toISOString() });
  if (error) throw error;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 16 },
  fileFilter: (_, file, cb) => cb(null, file.mimetype.startsWith('image/'))
});
const cvUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, file.mimetype === 'application/pdf')
});
function safeName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '-'); }

async function saveUpload(file, folder) {
  if (!file) return '';
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName(file.originalname)}`;
  if (USE_SUPABASE) {
    const storagePath = `${folder}/${filename}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw error;
    return supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }
  const dir = folder === 'cvs' ? CV_DIR : IMAGE_DIR;
  fs.writeFileSync(path.join(dir, filename), file.buffer);
  return `/uploads/${folder}/${filename}`;
}

async function deleteUpload(url) {
  if (!url) return;
  if (USE_SUPABASE) {
    const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
    const index = url.indexOf(marker);
    if (index >= 0) await supabase.storage.from(STORAGE_BUCKET).remove([decodeURIComponent(url.slice(index + marker.length))]);
    return;
  }
  if (url.startsWith('/uploads/')) {
    const localPath = path.join(__dirname, 'public', url.replace(/^\//, ''));
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  }
}

app.get('/api/site', async (_, res) => {
  try { const data = await readData(); const { _admin, ...publicData } = data; res.json(publicData); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível carregar os dados.' }); }
});

app.get('/servico/:id', (_, res) => res.sendFile(path.join(__dirname, 'public', 'service.html')));

app.post('/api/admin/login', async (req, res) => {
  try {
    if (await validAdminPassword(req.body.password)) { req.session.admin = true; return res.json({ ok: true }); }
    res.status(401).json({ error: 'Senha incorreta.' });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível validar a senha.' }); }
});
app.post('/api/admin/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!(await validAdminPassword(currentPassword))) return res.status(401).json({ error: 'A senha atual está incorreta.' });
    if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    const data = await readData();
    data._admin ||= {}; data._admin.passwordHash = hashPassword(newPassword); data._admin.passwordUpdatedAt = new Date().toISOString();
    await writeData(data);
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao alterar a senha.' }); }
});
app.post('/api/admin/recover-password', async (req, res) => {
  try {
    if (!ADMIN_RECOVERY_KEY) return res.status(503).json({ error: 'Recuperação ainda não configurada. Defina ADMIN_RECOVERY_KEY no Render.' });
    const { recoveryKey, newPassword } = req.body || {};
    if (!safeSecretEqual(recoveryKey, ADMIN_RECOVERY_KEY)) return res.status(401).json({ error: 'Código de recuperação inválido.' });
    if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    const data = await readData();
    data._admin ||= {}; data._admin.passwordHash = hashPassword(newPassword); data._admin.passwordUpdatedAt = new Date().toISOString();
    await writeData(data);
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao recuperar a senha.' }); }
});
app.post('/api/admin/logout', requireAuth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/session', (req, res) => res.json({ authenticated: !!req.session.admin }));

app.put('/api/admin/settings', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    data.settings = { ...data.settings, ...req.body };
    await writeData(data); res.json(data.settings);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar configurações.' }); }
});

app.post('/api/admin/settings/assets', requireAuth, imageUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), async (req, res) => {
  try {
    const data = await readData();
    data.settings ||= {};
    if (req.files?.logo?.[0]) {
      if (data.settings.logo) await deleteUpload(data.settings.logo);
      data.settings.logo = await saveUpload(req.files.logo[0], 'images');
    }
    if (req.files?.favicon?.[0]) {
      if (data.settings.favicon) await deleteUpload(data.settings.favicon);
      data.settings.favicon = await saveUpload(req.files.favicon[0], 'images');
    }
    await writeData(data); res.json(data.settings);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar identidade visual.' }); }
});

// SERVIÇOS: cor, ícone Bootstrap/personalizado, banner e página própria.
app.post('/api/admin/services', requireAuth, imageUpload.fields([{ name: 'iconImage', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), async (req, res) => {
  try {
    const data = await readData();
    const baseId = slugify(req.body.title);
    let id = baseId; let n = 2;
    while (data.services.some(s => s.id === id)) id = `${baseId}-${n++}`;
    const item = {
      id,
      title: req.body.title || 'Serviço',
      iconClass: req.body.iconClass || 'bi-briefcase',
      iconImage: req.files?.iconImage?.[0] ? await saveUpload(req.files.iconImage[0], 'images') : '',
      color: req.body.color || '#00A884',
      description: req.body.description || '',
      details: req.body.details || req.body.description || '',
      banner: req.files?.banner?.[0] ? await saveUpload(req.files.banner[0], 'images') : '',
      featured: true
    };
    data.services.push(item); await writeData(data); res.json(item);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao adicionar serviço.' }); }
});

app.put('/api/admin/services/:id', requireAuth, imageUpload.fields([{ name: 'iconImage', maxCount: 1 }, { name: 'banner', maxCount: 1 }]), async (req, res) => {
  try {
    const data = await readData();
    const index = data.services.findIndex(s => s.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Serviço não encontrado.' });
    const old = data.services[index];
    let iconImage = old.iconImage || '';
    let banner = old.banner || '';
    if (req.files?.iconImage?.[0]) { if (iconImage) await deleteUpload(iconImage); iconImage = await saveUpload(req.files.iconImage[0], 'images'); }
    if (req.files?.banner?.[0]) { if (banner) await deleteUpload(banner); banner = await saveUpload(req.files.banner[0], 'images'); }
    data.services[index] = {
      ...old,
      title: req.body.title ?? old.title,
      iconClass: req.body.iconClass ?? old.iconClass ?? 'bi-briefcase',
      color: req.body.color ?? old.color,
      description: req.body.description ?? old.description,
      details: req.body.details ?? old.details ?? old.description,
      iconImage, banner
    };
    await writeData(data); res.json(data.services[index]);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao atualizar serviço.' }); }
});

app.delete('/api/admin/services/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const item = data.services.find(s => s.id === req.params.id);
    if (item?.iconImage) await deleteUpload(item.iconImage);
    if (item?.banner) await deleteUpload(item.banner);
    data.services = data.services.filter(s => s.id !== req.params.id);
    await writeData(data); res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover serviço.' }); }
});

// LIGAÇÕES e REDES SOCIAIS.
['links', 'socials'].forEach(collection => {
  app.post(`/api/admin/${collection}`, requireAuth, async (req, res) => {
    try {
      const data = await readData();
      const prefix = collection === 'socials' ? 'social' : 'link';
      const item = { id: uid(prefix), ...req.body, url: normalizeUrl(req.body.url || '') };
      data[collection] ||= []; data[collection].push(item); await writeData(data); res.json(item);
    } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao adicionar item.' }); }
  });
  app.delete(`/api/admin/${collection}/:id`, requireAuth, async (req, res) => {
    try { const data = await readData(); data[collection] = (data[collection] || []).filter(i => i.id !== req.params.id); await writeData(data); res.json({ ok: true }); }
    catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover item.' }); }
  });
});

// PARCEIROS: upload de logo + URL externa normalizada.
app.post('/api/admin/partners', requireAuth, imageUpload.single('logo'), async (req, res) => {
  try {
    const data = await readData();
    const item = { id: uid('partner'), name: req.body.name || 'Parceiro', logo: req.file ? await saveUpload(req.file, 'images') : '', url: normalizeUrl(req.body.url) };
    data.partners.push(item); await writeData(data); res.json(item);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao adicionar parceiro.' }); }
});
app.delete('/api/admin/partners/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData(); const item = data.partners.find(i => i.id === req.params.id);
    if (item?.logo) await deleteUpload(item.logo);
    data.partners = data.partners.filter(i => i.id !== req.params.id); await writeData(data); res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover parceiro.' }); }
});

// PORTFÓLIO: múltiplas imagens por projeto.
app.post('/api/admin/portfolio', requireAuth, imageUpload.array('images', 12), async (req, res) => {
  try {
    const data = await readData();
    const images = [];
    for (const file of req.files || []) images.push(await saveUpload(file, 'images'));
    const item = { id: uid('portfolio'), title: req.body.title || 'Projeto', service: req.body.service || '', description: req.body.description || '', link: normalizeUrl(req.body.link || ''), images, image: images[0] || '' };
    data.portfolio.unshift(item); await writeData(data); res.json(item);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao publicar projeto.' }); }
});
app.delete('/api/admin/portfolio/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData(); const item = data.portfolio.find(i => i.id === req.params.id);
    const imgs = item?.images?.length ? item.images : (item?.image ? [item.image] : []);
    for (const url of imgs) await deleteUpload(url);
    data.portfolio = data.portfolio.filter(i => i.id !== req.params.id); await writeData(data); res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover projeto.' }); }
});

// EQUIPA + CV.
app.post('/api/admin/team', requireAuth, imageUpload.single('photo'), async (req, res) => {
  try {
    const data = await readData();
    const item = { id: uid('team'), name: req.body.name || 'Profissional', role: req.body.role || '', bio: req.body.bio || '', photo: req.file ? await saveUpload(req.file, 'images') : '', cv: '' };
    data.team.push(item); await writeData(data); res.json(item);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao adicionar profissional.' }); }
});
app.post('/api/admin/team/:id/cv', requireAuth, cvUpload.single('cv'), async (req, res) => {
  try {
    const data = await readData(); const index = data.team.findIndex(i => i.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Profissional não encontrado.' });
    if (!req.file) return res.status(400).json({ error: 'Envie um PDF.' });
    if (data.team[index].cv) await deleteUpload(data.team[index].cv);
    data.team[index].cv = await saveUpload(req.file, 'cvs'); await writeData(data); res.json(data.team[index]);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar CV.' }); }
});
app.delete('/api/admin/team/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData(); const item = data.team.find(i => i.id === req.params.id);
    if (item?.photo) await deleteUpload(item.photo); if (item?.cv) await deleteUpload(item.cv);
    data.team = data.team.filter(i => i.id !== req.params.id); await writeData(data); res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover profissional.' }); }
});



// ============================================================
// V6.1 — PLATAFORMA DE PROFISSIONAIS
// Cadastro/login, perfis, serviços/projetos e moderação admin.
// ============================================================
function requireProfessional(req, res, next) {
  if (!req.session.professionalId) return res.status(401).json({ error: 'Faça login como profissional.' });
  next();
}
function professionalPublicRow(p = {}) {
  const { user_id, ...safe } = p;
  return safe;
}
async function uniqueProfessionalSlug(name, excludeId = null) {
  const base = slugify(name || 'profissional');
  let candidate = base, n = 2;
  while (true) {
    let q = supabase.from('professional_profiles').select('id').eq('slug', candidate).limit(1);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) return candidate;
    candidate = `${base}-${n++}`;
  }
}
async function getProfessionalSessionProfile(id) {
  const { data, error } = await supabase.from('professional_profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

app.post('/api/professional/register', async (req, res) => {
  try {
    if (!USE_SUPABASE) return res.status(503).json({ error: 'O cadastro de profissionais requer Supabase.' });
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Informe o seu nome.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    const { data: exists, error: existsError } = await supabase.from('professional_users').select('id').eq('email', email).maybeSingle();
    if (existsError) throw existsError;
    if (exists) return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
    const userId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const slug = await uniqueProfessionalSlug(name);
    const now = new Date().toISOString();
    const { error: userError } = await supabase.from('professional_users').insert({ id: userId, email, password_hash: hashPassword(password), created_at: now, updated_at: now });
    if (userError) throw userError;
    const { error: profileError } = await supabase.from('professional_profiles').insert({ id: profileId, user_id: userId, name, slug, email, status: 'pending', verified: false, created_at: now, updated_at: now });
    if (profileError) { await supabase.from('professional_users').delete().eq('id', userId); throw profileError; }
    req.session.professionalId = profileId;
    res.json({ ok: true, profile: { id: profileId, name, slug, email, status: 'pending' } });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível criar a conta.' }); }
});

app.post('/api/professional/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { data: user, error } = await supabase.from('professional_users').select('*').eq('email', email).maybeSingle();
    if (error) throw error;
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const { data: profile, error: pError } = await supabase.from('professional_profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (pError) throw pError;
    if (!profile) return res.status(404).json({ error: 'Perfil profissional não encontrado.' });
    if (profile.status === 'suspended') return res.status(403).json({ error: 'Esta conta está suspensa.' });
    req.session.professionalId = profile.id;
    res.json({ ok: true, profile: professionalPublicRow(profile) });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível iniciar sessão.' }); }
});
app.post('/api/professional/logout', requireProfessional, (req, res) => { delete req.session.professionalId; res.json({ ok: true }); });
app.get('/api/professional/session', async (req, res) => {
  try {
    if (!req.session.professionalId) return res.json({ authenticated: false });
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    if (!profile) return res.json({ authenticated: false });
    res.json({ authenticated: true, profile: professionalPublicRow(profile) });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar sessão.' }); }
});

app.get('/api/professional/dashboard', requireProfessional, async (req, res) => {
  try {
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    const [{ data: services, error: se }, { data: projects, error: pe }] = await Promise.all([
      supabase.from('professional_services').select('*').eq('professional_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('professional_projects').select('*').eq('professional_id', profile.id).order('created_at', { ascending: false })
    ]);
    if (se) throw se; if (pe) throw pe;
    res.json({ profile: professionalPublicRow(profile), services: services || [], projects: projects || [] });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar o painel.' }); }
});

app.put('/api/professional/profile', requireProfessional, imageUpload.fields([{ name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const current = await getProfessionalSessionProfile(req.session.professionalId);
    if (!current) return res.status(404).json({ error: 'Perfil não encontrado.' });
    let photo = current.photo || '';
    if (req.files?.photo?.[0]) { if (photo) await deleteUpload(photo); photo = await saveUpload(req.files.photo[0], 'images'); }
    const name = String(req.body.name || current.name).trim();
    const update = {
      name,
      slug: name !== current.name ? await uniqueProfessionalSlug(name, current.id) : current.slug,
      specialty: String(req.body.specialty || '').trim(),
      bio: String(req.body.bio || '').trim(),
      location: String(req.body.location || '').trim(),
      phone: String(req.body.phone || '').trim(),
      whatsapp: String(req.body.whatsapp || '').trim(),
      website: normalizeUrl(req.body.website || ''),
      linkedin: normalizeUrl(req.body.linkedin || ''),
      instagram: normalizeUrl(req.body.instagram || ''),
      photo,
      status: current.status === 'approved' ? 'pending' : current.status,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('professional_profiles').update(update).eq('id', current.id).select('*').single();
    if (error) throw error;
    res.json(professionalPublicRow(data));
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar o perfil.' }); }
});
app.post('/api/professional/profile/cv', requireProfessional, cvUpload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um PDF.' });
    const current = await getProfessionalSessionProfile(req.session.professionalId);
    if (current.cv_url) await deleteUpload(current.cv_url);
    const cv_url = await saveUpload(req.file, 'cvs');
    const { data, error } = await supabase.from('professional_profiles').update({ cv_url, status: current.status === 'approved' ? 'pending' : current.status, updated_at: new Date().toISOString() }).eq('id', current.id).select('*').single();
    if (error) throw error;
    res.json(professionalPublicRow(data));
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar CV.' }); }
});

app.post('/api/professional/services', requireProfessional, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe o título do serviço.' });
    const item = {
      id: crypto.randomUUID(), professional_id: req.session.professionalId,
      title, slug: `${slugify(title)}-${crypto.randomBytes(2).toString('hex')}`,
      category: String(req.body.category || '').trim(), description: String(req.body.description || '').trim(),
      price: String(req.body.price || '').trim(), status: 'pending', rejection_reason: '',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('professional_services').insert(item).select('*').single();
    if (error) throw error; res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao enviar serviço.' }); }
});
app.delete('/api/professional/services/:id', requireProfessional, async (req, res) => {
  try { const { error } = await supabase.from('professional_services').delete().eq('id', req.params.id).eq('professional_id', req.session.professionalId); if (error) throw error; res.json({ ok: true }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover serviço.' }); }
});

app.post('/api/professional/projects', requireProfessional, imageUpload.array('images', 8), async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe o título do projeto.' });
    const images = []; for (const f of req.files || []) images.push(await saveUpload(f, 'images'));
    const item = { id: crypto.randomUUID(), professional_id: req.session.professionalId, title, slug: `${slugify(title)}-${crypto.randomBytes(2).toString('hex')}`, description: String(req.body.description || '').trim(), project_url: normalizeUrl(req.body.project_url || ''), images, status: 'pending', rejection_reason: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('professional_projects').insert(item).select('*').single();
    if (error) throw error; res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao enviar projeto.' }); }
});
app.delete('/api/professional/projects/:id', requireProfessional, async (req, res) => {
  try {
    const { data: item } = await supabase.from('professional_projects').select('images').eq('id', req.params.id).eq('professional_id', req.session.professionalId).maybeSingle();
    for (const url of item?.images || []) await deleteUpload(url);
    const { error } = await supabase.from('professional_projects').delete().eq('id', req.params.id).eq('professional_id', req.session.professionalId); if (error) throw error; res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover projeto.' }); }
});

// Público: apenas perfis/conteúdos aprovados.
app.get('/api/professionals', async (req, res) => {
  try {
    let q = supabase.from('professional_profiles').select('id,name,slug,photo,specialty,bio,location,verified').eq('status', 'approved').order('created_at', { ascending: false });
    const term = String(req.query.q || '').trim(); if (term) q = q.or(`name.ilike.%${term}%,specialty.ilike.%${term}%,location.ilike.%${term}%`);
    const { data, error } = await q; if (error) throw error; res.json(data || []);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar profissionais.' }); }
});
app.get('/api/professionals/:slug', async (req, res) => {
  try {
    const { data: profile, error } = await supabase.from('professional_profiles').select('id,name,slug,photo,specialty,bio,location,phone,whatsapp,email,website,linkedin,instagram,cv_url,verified').eq('slug', req.params.slug).eq('status', 'approved').maybeSingle();
    if (error) throw error; if (!profile) return res.status(404).json({ error: 'Profissional não encontrado.' });
    const [{ data: services, error: se }, { data: projects, error: pe }] = await Promise.all([
      supabase.from('professional_services').select('id,title,slug,category,description,price').eq('professional_id', profile.id).eq('status', 'approved').order('created_at', { ascending: false }),
      supabase.from('professional_projects').select('id,title,slug,description,project_url,images').eq('professional_id', profile.id).eq('status', 'approved').order('created_at', { ascending: false })
    ]); if (se) throw se; if (pe) throw pe;
    res.json({ profile, services: services || [], projects: projects || [] });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar profissional.' }); }
});
app.get('/profissionais', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professionals.html')));
app.get('/profissional', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professional-login.html')));
app.get('/profissional/dashboard', (_, res) => res.sendFile(path.join(__dirname, 'professional', 'dashboard.html')));
app.get('/profissional/:slug', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professional-profile.html')));
app.use('/professional-assets', express.static(path.join(__dirname, 'professional')));

// Moderação administrativa.
app.get('/api/admin/moderation', requireAuth, async (req, res) => {
  try {
    const [{ data: professionals, error: pe }, { data: services, error: se }, { data: projects, error: pre }] = await Promise.all([
      supabase.from('professional_profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('professional_services').select('*, professional_profiles(name,slug)').order('created_at', { ascending: false }),
      supabase.from('professional_projects').select('*, professional_profiles(name,slug)').order('created_at', { ascending: false })
    ]); if (pe) throw pe; if (se) throw se; if (pre) throw pre;
    res.json({ professionals: professionals || [], services: services || [], projects: projects || [] });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar moderação.' }); }
});
app.patch('/api/admin/moderation/:type/:id', requireAuth, async (req, res) => {
  try {
    const map = { professionals: 'professional_profiles', services: 'professional_services', projects: 'professional_projects' };
    const table = map[req.params.type]; if (!table) return res.status(400).json({ error: 'Tipo inválido.' });
    const allowed = ['pending','approved','rejected','suspended'];
    const status = String(req.body.status || ''); if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
    const update = { status, updated_at: new Date().toISOString() };
    if (table !== 'professional_profiles') update.rejection_reason = status === 'rejected' ? String(req.body.rejection_reason || '').trim() : '';
    if (table === 'professional_profiles') update.rejection_reason = status === 'rejected' ? String(req.body.rejection_reason || '').trim() : '';
    const { data, error } = await supabase.from(table).update(update).eq('id', req.params.id).select('*').single(); if (error) throw error;
    await supabase.from('moderation_logs').insert({ id: crypto.randomUUID(), target_type: req.params.type, target_id: req.params.id, action: status, reason: String(req.body.rejection_reason || ''), created_at: new Date().toISOString() });
    res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao moderar item.' }); }
});

app.get('/health', (_, res) => res.json({ ok: true, storage: USE_SUPABASE ? 'supabase' : 'local', persistent: USE_SUPABASE, supabaseConfigured: USE_SUPABASE }));
app.listen(PORT, () => { console.log(`Site disponível na porta ${PORT}`); console.log(`Armazenamento: ${USE_SUPABASE ? 'Supabase (persistente)' : 'local (desenvolvimento)'}`); });
