const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mudar-esta-senha';
const ADMIN_RECOVERY_KEY = process.env.ADMIN_RECOVERY_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'troque-esta-chave-em-producao';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';
const VERIFICATION_BUCKET = process.env.SUPABASE_VERIFICATION_BUCKET || 'verification-documents';
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
  content.settings.logo ||= ''; // legado V4/V6.2
  content.settings.headerLogo ||= content.settings.logo || '';
  content.settings.heroLogo ||= content.settings.logo || '';
  content.settings.address ||= content.settings.location || '';
  content.settings.favicon ||= '';
  content.settings.heroBackgroundImage ||= '';
  content.settings.heroOverlay = content.settings.heroOverlay ?? '0.24';
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
  content.portfolio = (content.portfolio || []).map(p => ({ ...p, images: p.images?.length ? p.images : (p.image ? [p.image] : []), featured: typeof p.featured === 'boolean' ? p.featured : true }));
  content.partners = (content.partners || []).map(p => ({ ...p, logoLight: p.logoLight || p.logo || '', logoDark: p.logoDark || p.logo || '' })); content.links = (content.links || []).map(l => ({ ...l, iconClass: l.iconClass || 'bi-link-45deg' })); content.team ||= [];
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
const identityUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_, file, cb) => cb(null, file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf')
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

async function savePrivateIdentityUpload(file, profileId, side) {
  if (!file || !USE_SUPABASE) throw new Error('Documentos de identificação requerem Supabase.');
  const ext = path.extname(file.originalname || '').replace(/[^.a-zA-Z0-9]/g, '') || (file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
  const storagePath = `professionals/${profileId}/${side}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  const { error } = await supabase.storage.from(VERIFICATION_BUCKET).upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw error;
  return storagePath;
}
async function deletePrivateIdentityUpload(storagePath) {
  if (!storagePath || !USE_SUPABASE) return;
  await supabase.storage.from(VERIFICATION_BUCKET).remove([storagePath]);
}
function visitorHash(req) {
  return crypto.createHash('sha256').update(`${req.ip || ''}|${req.get('user-agent') || ''}|${SESSION_SECRET}`).digest('hex');
}

app.get('/api/site', async (_, res) => {
  try { const data = await readData(); const { _admin, ...publicData } = data; res.json(publicData); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível carregar os dados.' }); }
});

app.get('/api/public-config', (_, res) => res.json({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  googleOAuthAvailable: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}));

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

app.post('/api/admin/settings/assets', requireAuth, imageUpload.fields([{ name: 'headerLogo', maxCount: 1 }, { name: 'heroLogo', maxCount: 1 }, { name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }, { name: 'heroBackground', maxCount: 1 }]), async (req, res) => {
  try {
    const data = await readData();
    data.settings ||= {};
    if (req.files?.headerLogo?.[0]) {
      data.settings.headerLogo = await saveUpload(req.files.headerLogo[0], 'images');
    }
    if (req.files?.heroLogo?.[0]) {
      data.settings.heroLogo = await saveUpload(req.files.heroLogo[0], 'images');
    }
    // Compatibilidade com formulários antigos: um logo legado preenche as duas áreas.
    if (req.files?.logo?.[0]) {
      const legacy = await saveUpload(req.files.logo[0], 'images');
      data.settings.logo = legacy; data.settings.headerLogo = legacy; data.settings.heroLogo = legacy;
    }
    if (req.files?.favicon?.[0]) {
      if (data.settings.favicon) await deleteUpload(data.settings.favicon);
      data.settings.favicon = await saveUpload(req.files.favicon[0], 'images');
    }
    if (req.body.removeHeroBackground === '1' && data.settings.heroBackgroundImage) {
      await deleteUpload(data.settings.heroBackgroundImage);
      data.settings.heroBackgroundImage = '';
    }
    if (req.files?.heroBackground?.[0]) {
      if (data.settings.heroBackgroundImage) await deleteUpload(data.settings.heroBackgroundImage);
      data.settings.heroBackgroundImage = await saveUpload(req.files.heroBackground[0], 'images');
    }
    await writeData(data); res.json(data.settings);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar identidade visual e fundo.' }); }
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
      featured: req.body.featured === 'on' || req.body.featured === 'true' || req.body.featured === '1'
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
      featured: req.body.featured === 'on' || req.body.featured === 'true' || req.body.featured === '1',
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
app.post('/api/admin/partners', requireAuth, imageUpload.fields([{ name: 'logoLight', maxCount: 1 }, { name: 'logoDark', maxCount: 1 }, { name: 'logo', maxCount: 1 }]), async (req, res) => {
  try {
    const data = await readData();
    const legacy = req.files?.logo?.[0] ? await saveUpload(req.files.logo[0], 'images') : '';
    const logoLight = req.files?.logoLight?.[0] ? await saveUpload(req.files.logoLight[0], 'images') : legacy;
    const logoDark = req.files?.logoDark?.[0] ? await saveUpload(req.files.logoDark[0], 'images') : legacy;
    const item = { id: uid('partner'), name: req.body.name || 'Parceiro', logo: legacy, logoLight, logoDark, url: normalizeUrl(req.body.url) };
    data.partners.push(item); await writeData(data); res.json(item);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao adicionar parceiro.' }); }
});
app.delete('/api/admin/partners/:id', requireAuth, async (req, res) => {
  try {
    const data = await readData(); const item = data.partners.find(i => i.id === req.params.id);
    for (const url of new Set([item?.logo, item?.logoLight, item?.logoDark].filter(Boolean))) await deleteUpload(url);
    data.partners = data.partners.filter(i => i.id !== req.params.id); await writeData(data); res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover parceiro.' }); }
});

// PORTFÓLIO: múltiplas imagens por projeto.
app.post('/api/admin/portfolio', requireAuth, imageUpload.array('images', 12), async (req, res) => {
  try {
    const data = await readData();
    const images = [];
    for (const file of req.files || []) images.push(await saveUpload(file, 'images'));
    const item = { id: uid('portfolio'), title: req.body.title || 'Projeto', service: req.body.service || '', description: req.body.description || '', link: normalizeUrl(req.body.link || ''), images, image: images[0] || '', featured: req.body.featured === 'on' || req.body.featured === 'true' || req.body.featured === '1' };
    data.portfolio.unshift(item); await writeData(data); res.json(item);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao publicar projeto.' }); }
});
app.patch('/api/admin/portfolio/:id/featured', requireAuth, async (req, res) => {
  try {
    const data = await readData();
    const index = data.portfolio.findIndex(i => i.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Projeto não encontrado.' });
    data.portfolio[index].featured = Boolean(req.body.featured);
    await writeData(data); res.json(data.portfolio[index]);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao alterar destaque.' }); }
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
// V6.2 — PLATAFORMA DE PROFISSIONAIS
// Identidade, Google, recuperação, métricas, avaliações e denúncias.
// ============================================================
function requireProfessional(req, res, next) {
  if (!req.session.professionalId) return res.status(401).json({ error: 'Faça login como profissional.' });
  next();
}
function professionalSessionRow(p = {}) {
  const { user_id, id_front_path, id_back_path, pre_suspension_status, ...safe } = p;
  return safe;
}
function digits(value = '') { return String(value).replace(/\D/g, ''); }
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
async function releaseExpiredSuspensions() {
  if (!USE_SUPABASE) return;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('professional_profiles').select('id,pre_suspension_status').eq('status', 'suspended').lt('suspended_until', now);
  if (error) return console.error('Erro ao liberar suspensões expiradas:', error.message);
  for (const p of data || []) {
    const restore = ['approved','pending'].includes(p.pre_suspension_status) ? p.pre_suspension_status : 'pending';
    await supabase.from('professional_profiles').update({ status: restore, suspended_until: null, suspension_reason: '', pre_suspension_status: '', updated_at: now }).eq('id', p.id);
  }
}
async function getProfessionalSessionProfile(id) {
  await releaseExpiredSuspensions();
  const { data, error } = await supabase.from('professional_profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
function canPublish(profile) {
  return profile && profile.verification_status === 'approved' && !['suspended','rejected'].includes(profile.status);
}
async function recordProfessionalEvent(req, professionalId, eventType, { serviceId = null, channel = '', scopeKey = 'general' } = {}) {
  try {
    const item = { id: crypto.randomUUID(), professional_id: professionalId, service_id: serviceId || null, event_type: eventType, channel, scope_key: scopeKey || 'general', visitor_hash: visitorHash(req), event_day: new Date().toISOString().slice(0,10), created_at: new Date().toISOString() };
    const { error } = await supabase.from('professional_events').insert(item);
    if (error && error.code !== '23505') throw error;
  } catch (error) { console.error('Métrica não registada:', error.message); }
}

app.post('/api/professional/register', identityUpload.fields([{ name: 'idFront', maxCount: 1 }, { name: 'idBack', maxCount: 1 }]), async (req, res) => {
  let frontPath = '', backPath = '';
  try {
    if (!USE_SUPABASE) return res.status(503).json({ error: 'O cadastro de profissionais requer Supabase.' });
    const name = String(req.body.name || '').trim();
    const address = String(req.body.address || '').trim();
    const location = String(req.body.location || '').trim();
    const phone = String(req.body.phone || '').trim();
    const whatsapp = String(req.body.whatsapp || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');
    const front = req.files?.idFront?.[0], back = req.files?.idBack?.[0];
    const googleIdentity = req.body.googleRegistration === '1' ? req.session.googleIdentity : null;
    if (name.length < 3) return res.status(400).json({ error: 'Informe o nome completo.' });
    if (!address) return res.status(400).json({ error: 'Informe o endereço.' });
    if (digits(phone).length < 8) return res.status(400).json({ error: 'Informe um número de celular válido.' });
    if (digits(whatsapp).length < 8) return res.status(400).json({ error: 'Informe um número de WhatsApp válido.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'As duas senhas não coincidem.' });
    if (!front || !back) return res.status(400).json({ error: 'Carregue a frente e o verso do documento de identificação.' });
    if (googleIdentity && googleIdentity.email !== email) return res.status(400).json({ error: 'O e-mail deve ser o mesmo da conta Google.' });
    const { data: exists, error: existsError } = await supabase.from('professional_users').select('id').eq('email', email).maybeSingle();
    if (existsError) throw existsError;
    if (exists) return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
    const userId = crypto.randomUUID(), profileId = crypto.randomUUID(), slug = await uniqueProfessionalSlug(name), now = new Date().toISOString();
    frontPath = await savePrivateIdentityUpload(front, profileId, 'front');
    backPath = await savePrivateIdentityUpload(back, profileId, 'back');
    const { error: userError } = await supabase.from('professional_users').insert({ id: userId, email, password_hash: hashPassword(password), google_sub: googleIdentity?.sub || null, auth_provider: googleIdentity ? 'google+password' : 'password', created_at: now, updated_at: now });
    if (userError) throw userError;
    const { error: profileError } = await supabase.from('professional_profiles').insert({ id: profileId, user_id: userId, name, slug, email, address, location, phone, whatsapp, status: 'pending', verified: false, verification_status: 'pending', id_front_path: frontPath, id_back_path: backPath, identity_submitted_at: now, created_at: now, updated_at: now });
    if (profileError) { await supabase.from('professional_users').delete().eq('id', userId); throw profileError; }
    req.session.professionalId = profileId;
    delete req.session.googleIdentity;
    res.json({ ok: true, profile: { id: profileId, name, slug, email, status: 'pending', verification_status: 'pending' } });
  } catch (error) {
    console.error(error);
    if (frontPath) await deletePrivateIdentityUpload(frontPath);
    if (backPath) await deletePrivateIdentityUpload(backPath);
    res.status(500).json({ error: 'Não foi possível criar a conta.' });
  }
});

app.post('/api/professional/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '');
    const { data: user, error } = await supabase.from('professional_users').select('*').eq('email', email).maybeSingle();
    if (error) throw error;
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const { data: profile, error: pError } = await supabase.from('professional_profiles').select('*').eq('user_id', user.id).maybeSingle();
    if (pError) throw pError;
    if (!profile) return res.status(404).json({ error: 'Perfil profissional não encontrado.' });
    req.session.professionalId = profile.id;
    res.json({ ok: true, profile: professionalSessionRow(profile) });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível iniciar sessão.' }); }
});

app.post('/api/professional/google-login', async (req, res) => {
  try {
    if (!SUPABASE_ANON_KEY) return res.status(503).json({ error: 'Login Google ainda não está configurado no servidor.' });
    const token = String(req.body.accessToken || '');
    if (!token) return res.status(400).json({ error: 'Token Google ausente.' });
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.email) return res.status(401).json({ error: 'Não foi possível validar a conta Google.' });
    const googleUser = authData.user, email = googleUser.email.toLowerCase();
    let { data: account, error } = await supabase.from('professional_users').select('*').eq('google_sub', googleUser.id).maybeSingle();
    if (error) throw error;
    if (!account) {
      const byEmail = await supabase.from('professional_users').select('*').eq('email', email).maybeSingle();
      if (byEmail.error) throw byEmail.error;
      account = byEmail.data;
      if (account) await supabase.from('professional_users').update({ google_sub: googleUser.id, auth_provider: 'google+password', updated_at: new Date().toISOString() }).eq('id', account.id);
    }
    if (account) {
      const { data: profile, error: pError } = await supabase.from('professional_profiles').select('*').eq('user_id', account.id).maybeSingle();
      if (pError) throw pError;
      if (!profile) return res.status(404).json({ error: 'Perfil profissional não encontrado.' });
      req.session.professionalId = profile.id;
      return res.json({ ok: true, needsRegistration: false });
    }
    req.session.googleIdentity = { sub: googleUser.id, email, name: googleUser.user_metadata?.full_name || googleUser.user_metadata?.name || '' };
    res.json({ ok: true, needsRegistration: true, googleProfile: { email, name: req.session.googleIdentity.name } });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao entrar com Google.' }); }
});
app.get('/api/professional/google-pending', (req, res) => res.json({ googleProfile: req.session.googleIdentity ? { email: req.session.googleIdentity.email, name: req.session.googleIdentity.name } : null }));

app.post('/api/professional/logout', requireProfessional, (req, res) => { delete req.session.professionalId; res.json({ ok: true }); });
app.get('/api/professional/session', async (req, res) => {
  try {
    if (!req.session.professionalId) return res.json({ authenticated: false });
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    if (!profile) return res.json({ authenticated: false });
    res.json({ authenticated: true, profile: professionalSessionRow(profile) });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar sessão.' }); }
});
app.post('/api/professional/change-password', requireProfessional, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || ''), newPassword = String(req.body.newPassword || ''), confirmPassword = String(req.body.confirmPassword || '');
    if (newPassword.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'As duas novas senhas não coincidem.' });
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    const { data: user, error } = await supabase.from('professional_users').select('*').eq('id', profile.user_id).single();
    if (error) throw error;
    if (!verifyPassword(currentPassword, user.password_hash)) return res.status(401).json({ error: 'A senha atual está incorreta.' });
    const { error: updateError } = await supabase.from('professional_users').update({ password_hash: hashPassword(newPassword), updated_at: new Date().toISOString() }).eq('id', user.id);
    if (updateError) throw updateError;
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao alterar a senha.' }); }
});
app.post('/api/professional/recovery-request', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase(), whatsapp = digits(req.body.whatsapp || '');
    const generic = { ok: true, message: 'Se os dados coincidirem com uma conta, o pedido será enviado à administração para validação.' };
    if (!email || whatsapp.length < 8) return res.json(generic);
    const { data: profile, error } = await supabase.from('professional_profiles').select('id,whatsapp').eq('email', email).maybeSingle();
    if (error) throw error;
    if (!profile || digits(profile.whatsapp) !== whatsapp) return res.json(generic);
    const { data: pending } = await supabase.from('password_reset_requests').select('id').eq('professional_id', profile.id).eq('status', 'pending').maybeSingle();
    if (!pending) await supabase.from('password_reset_requests').insert({ id: crypto.randomUUID(), professional_id: profile.id, email, whatsapp, status: 'pending', created_at: new Date().toISOString() });
    res.json(generic);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Não foi possível enviar o pedido de recuperação.' }); }
});

app.get('/api/professional/dashboard', requireProfessional, async (req, res) => {
  try {
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    const [{ data: services, error: se }, { data: projects, error: pe }, { data: events }, { data: ratings }] = await Promise.all([
      supabase.from('professional_services').select('*').eq('professional_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('professional_projects').select('*').eq('professional_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('professional_events').select('event_type,visitor_hash').eq('professional_id', profile.id),
      supabase.from('professional_ratings').select('stars').eq('professional_id', profile.id).eq('status', 'published')
    ]);
    if (se) throw se; if (pe) throw pe;
    const ratingAvg = ratings?.length ? ratings.reduce((a,x)=>a+Number(x.stars||0),0)/ratings.length : 0;
    const uniqueViews = new Set((events||[]).filter(x=>x.event_type==='view').map(x=>x.visitor_hash)).size;
    const uniqueContacts = new Set((events||[]).filter(x=>x.event_type==='contact').map(x=>x.visitor_hash)).size;
    res.json({ profile: professionalSessionRow(profile), services: services || [], projects: projects || [], metrics: { views: uniqueViews, contacts: uniqueContacts, ratingAvg, ratingCount: ratings?.length || 0 } });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar o painel.' }); }
});

app.put('/api/professional/profile', requireProfessional, imageUpload.fields([{ name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const current = await getProfessionalSessionProfile(req.session.professionalId);
    if (!current) return res.status(404).json({ error: 'Perfil não encontrado.' });
    const phone = String(req.body.phone || '').trim(), whatsapp = String(req.body.whatsapp || '').trim(), address = String(req.body.address || '').trim();
    if (digits(phone).length < 8 || digits(whatsapp).length < 8 || !address) return res.status(400).json({ error: 'Endereço, celular e WhatsApp são obrigatórios.' });
    let photo = current.photo || '';
    if (req.files?.photo?.[0]) { if (photo) await deleteUpload(photo); photo = await saveUpload(req.files.photo[0], 'images'); }
    const name = String(req.body.name || current.name).trim();
    const update = { name, slug: name !== current.name ? await uniqueProfessionalSlug(name, current.id) : current.slug, specialty: String(req.body.specialty || '').trim(), bio: String(req.body.bio || '').trim(), address, location: String(req.body.location || '').trim(), phone, whatsapp, website: normalizeUrl(req.body.website || ''), linkedin: normalizeUrl(req.body.linkedin || ''), instagram: normalizeUrl(req.body.instagram || ''), photo, status: current.status === 'approved' ? 'pending' : current.status, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('professional_profiles').update(update).eq('id', current.id).select('*').single();
    if (error) throw error; res.json(professionalSessionRow(data));
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar o perfil.' }); }
});
app.post('/api/professional/profile/cv', requireProfessional, cvUpload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um PDF.' });
    const current = await getProfessionalSessionProfile(req.session.professionalId);
    if (current.cv_url) await deleteUpload(current.cv_url);
    const cv_url = await saveUpload(req.file, 'cvs');
    const { data, error } = await supabase.from('professional_profiles').update({ cv_url, status: current.status === 'approved' ? 'pending' : current.status, updated_at: new Date().toISOString() }).eq('id', current.id).select('*').single();
    if (error) throw error; res.json(professionalSessionRow(data));
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar CV.' }); }
});
app.post('/api/professional/identity', requireProfessional, identityUpload.fields([{ name: 'idFront', maxCount: 1 }, { name: 'idBack', maxCount: 1 }]), async (req, res) => {
  try {
    const front = req.files?.idFront?.[0], back = req.files?.idBack?.[0];
    if (!front || !back) return res.status(400).json({ error: 'Envie novamente a frente e o verso.' });
    const current = await getProfessionalSessionProfile(req.session.professionalId);
    const frontPath = await savePrivateIdentityUpload(front, current.id, 'front');
    const backPath = await savePrivateIdentityUpload(back, current.id, 'back');
    if (current.id_front_path) await deletePrivateIdentityUpload(current.id_front_path);
    if (current.id_back_path) await deletePrivateIdentityUpload(current.id_back_path);
    const { data, error } = await supabase.from('professional_profiles').update({ id_front_path: frontPath, id_back_path: backPath, verification_status: 'pending', verification_reason: '', verified: false, identity_submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', current.id).select('*').single();
    if (error) throw error; res.json(professionalSessionRow(data));
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao reenviar documentos.' }); }
});

app.post('/api/professional/services', requireProfessional, async (req, res) => {
  try {
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    if (!canPublish(profile)) return res.status(403).json({ error: profile.verification_status !== 'approved' ? 'Aguarde a autenticação dos seus documentos antes de publicar.' : 'Esta conta não pode publicar neste momento.' });
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe o título do serviço.' });
    const item = { id: crypto.randomUUID(), professional_id: profile.id, title, slug: `${slugify(title)}-${crypto.randomBytes(2).toString('hex')}`, category: String(req.body.category || '').trim(), description: String(req.body.description || '').trim(), price: String(req.body.price || '').trim(), status: 'pending', rejection_reason: '', featured: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('professional_services').insert(item).select('*').single();
    if (error) throw error; res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: error.message || 'Erro ao enviar serviço.' }); }
});
app.delete('/api/professional/services/:id', requireProfessional, async (req, res) => {
  try { const { error } = await supabase.from('professional_services').delete().eq('id', req.params.id).eq('professional_id', req.session.professionalId); if (error) throw error; res.json({ ok: true }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover serviço.' }); }
});
app.post('/api/professional/projects', requireProfessional, imageUpload.array('images', 8), async (req, res) => {
  try {
    const profile = await getProfessionalSessionProfile(req.session.professionalId);
    if (!canPublish(profile)) return res.status(403).json({ error: profile.verification_status !== 'approved' ? 'Aguarde a autenticação dos seus documentos antes de publicar.' : 'Esta conta não pode publicar neste momento.' });
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Informe o título do projeto.' });
    const images = []; for (const f of req.files || []) images.push(await saveUpload(f, 'images'));
    const item = { id: crypto.randomUUID(), professional_id: profile.id, title, slug: `${slugify(title)}-${crypto.randomBytes(2).toString('hex')}`, description: String(req.body.description || '').trim(), project_url: normalizeUrl(req.body.project_url || ''), images, status: 'pending', rejection_reason: '', featured: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('professional_projects').insert(item).select('*').single();
    if (error) throw error; res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: error.message || 'Erro ao enviar projeto.' }); }
});
app.delete('/api/professional/projects/:id', requireProfessional, async (req, res) => {
  try {
    const { data: item } = await supabase.from('professional_projects').select('images').eq('id', req.params.id).eq('professional_id', req.session.professionalId).maybeSingle();
    for (const url of item?.images || []) await deleteUpload(url);
    const { error } = await supabase.from('professional_projects').delete().eq('id', req.params.id).eq('professional_id', req.session.professionalId); if (error) throw error; res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao remover projeto.' }); }
});

// Público: perfis aprovados. O selo `verified` é um distintivo manual da administração.
app.get('/api/professionals', async (req, res) => {
  try {
    await releaseExpiredSuspensions();
    const [{ data: profiles, error: pe }, { data: services, error: se }] = await Promise.all([
      supabase.from('professional_profiles').select('id,name,slug,photo,specialty,bio,location,verified').eq('status', 'approved').order('created_at', { ascending: false }),
      supabase.from('professional_services').select('id,professional_id,title,category').eq('status', 'approved').order('created_at', { ascending: false })
    ]);
    if (pe) throw pe; if (se) throw se;
    const term = String(req.query.q || '').trim().toLowerCase();
    let result = (profiles || []).map(p => ({ ...p, services: (services || []).filter(s => s.professional_id === p.id).map(({professional_id,...rest})=>rest) }));
    if (term) result = result.filter(p => [p.name,p.specialty,p.location,p.bio,...p.services.flatMap(s=>[s.title,s.category])].some(v => String(v||'').toLowerCase().includes(term)));
    res.json(result);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar profissionais.' }); }
});
app.get('/api/professionals/:slug', async (req, res) => {
  try {
    await releaseExpiredSuspensions();
    const { data: profile, error } = await supabase.from('professional_profiles').select('id,name,slug,photo,specialty,bio,location,phone,whatsapp,email,website,linkedin,instagram,cv_url,verified').eq('slug', req.params.slug).eq('status', 'approved').maybeSingle();
    if (error) throw error; if (!profile) return res.status(404).json({ error: 'Profissional não encontrado.' });
    const [{ data: services, error: se }, { data: projects, error: pe }, { data: ratings, error: re }] = await Promise.all([
      supabase.from('professional_services').select('id,title,slug,category,description,price').eq('professional_id', profile.id).eq('status', 'approved').order('created_at', { ascending: false }),
      supabase.from('professional_projects').select('id,title,slug,description,project_url,images').eq('professional_id', profile.id).eq('status', 'approved').order('created_at', { ascending: false }),
      supabase.from('professional_ratings').select('stars,comment,scope_key,created_at').eq('professional_id', profile.id).eq('status', 'published').order('created_at', { ascending: false })
    ]);
    if (se) throw se; if (pe) throw pe; if (re) throw re;
    await recordProfessionalEvent(req, profile.id, 'view');
    const avg = ratings?.length ? ratings.reduce((a,x)=>a+Number(x.stars||0),0)/ratings.length : 0;
    res.json({ profile, services: services || [], projects: projects || [], rating: { average: avg, count: ratings?.length || 0, reviews: ratings || [] } });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar profissional.' }); }
});
app.post('/api/professionals/:slug/contact', async (req, res) => {
  try {
    const { data: profile, error } = await supabase.from('professional_profiles').select('id').eq('slug', req.params.slug).eq('status', 'approved').maybeSingle();
    if (error) throw error; if (!profile) return res.status(404).json({ error: 'Profissional não encontrado.' });
    const serviceId = req.body.serviceId || null, channel = String(req.body.channel || 'whatsapp').slice(0,30), scopeKey = `${channel}:${serviceId || 'general'}`;
    await recordProfessionalEvent(req, profile.id, 'contact', { serviceId, channel, scopeKey });
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao registar contacto.' }); }
});
app.post('/api/professionals/:slug/rating', async (req, res) => {
  try {
    const stars = Number(req.body.stars), scopeKey = String(req.body.scopeKey || 'general'), comment = String(req.body.comment || '').trim().slice(0,1000);
    if (![1,2,3,4,5].includes(stars)) return res.status(400).json({ error: 'Escolha de 1 a 5 estrelas.' });
    const { data: profile, error } = await supabase.from('professional_profiles').select('id').eq('slug', req.params.slug).eq('status', 'approved').maybeSingle();
    if (error) throw error; if (!profile) return res.status(404).json({ error: 'Profissional não encontrado.' });
    let serviceId = null;
    if (scopeKey !== 'general') {
      const { data: service } = await supabase.from('professional_services').select('id').eq('id', scopeKey).eq('professional_id', profile.id).eq('status', 'approved').maybeSingle();
      if (!service) return res.status(400).json({ error: 'Serviço inválido.' });
      serviceId = service.id;
    }
    const vh = visitorHash(req), now = new Date().toISOString();
    const { data: existing } = await supabase.from('professional_ratings').select('id').eq('professional_id', profile.id).eq('scope_key', scopeKey).eq('visitor_hash', vh).maybeSingle();
    if (existing) await supabase.from('professional_ratings').update({ stars, comment, service_id: serviceId, status: 'published', updated_at: now }).eq('id', existing.id);
    else await supabase.from('professional_ratings').insert({ id: crypto.randomUUID(), professional_id: profile.id, service_id: serviceId, scope_key: scopeKey, stars, comment, visitor_hash: vh, status: 'published', created_at: now, updated_at: now });
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao guardar avaliação.' }); }
});
app.post('/api/professionals/:slug/report', async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim(), details = String(req.body.details || '').trim().slice(0,2000), reporterContact = String(req.body.reporterContact || '').trim().slice(0,250);
    const allowed = ['fraude','informacao_falsa','conteudo_copiado','conduta','spam','outro'];
    if (!allowed.includes(reason)) return res.status(400).json({ error: 'Selecione o motivo da denúncia.' });
    const { data: profile, error } = await supabase.from('professional_profiles').select('id').eq('slug', req.params.slug).eq('status', 'approved').maybeSingle();
    if (error) throw error; if (!profile) return res.status(404).json({ error: 'Profissional não encontrado.' });
    await supabase.from('professional_reports').insert({ id: crypto.randomUUID(), professional_id: profile.id, reason, details, reporter_contact: reporterContact, visitor_hash: visitorHash(req), status: 'open', created_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao enviar denúncia.' }); }
});
app.get('/api/featured-professional-projects', async (_, res) => {
  try {
    const { data, error } = await supabase.from('professional_projects').select('id,title,description,project_url,images,professional_profiles!inner(name,slug,specialty,status,verified)').eq('status', 'approved').eq('featured', true).eq('professional_profiles.status', 'approved').order('updated_at', { ascending: false }).limit(12);
    if (error) throw error;
    res.json((data || []).map(x => ({ id: x.id, title: x.title, description: x.description, link: x.project_url, images: x.images || [], image: x.images?.[0] || '', service: x.professional_profiles?.specialty || 'Profissional', professionalName: x.professional_profiles?.name || '', professionalSlug: x.professional_profiles?.slug || '' })));
  } catch (error) { console.error(error); res.json([]); }
});

app.get('/profissionais', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professionals.html')));
app.get('/profissional', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professional-login.html')));
app.get('/profissional/google-callback', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professional-google-callback.html')));
app.get('/profissional/dashboard', (_, res) => res.sendFile(path.join(__dirname, 'professional', 'dashboard.html')));
app.get('/profissional/:slug', (_, res) => res.sendFile(path.join(__dirname, 'public', 'professional-profile.html')));
app.use('/professional-assets', express.static(path.join(__dirname, 'professional')));

// Moderação administrativa.
app.get('/api/admin/moderation', requireAuth, async (req, res) => {
  try {
    await releaseExpiredSuspensions();
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
    const map = { professionals: 'professional_profiles', services: 'professional_services', projects: 'professional_projects' }, table = map[req.params.type];
    if (!table) return res.status(400).json({ error: 'Tipo inválido.' });
    const allowed = ['pending','approved','rejected','suspended'], status = String(req.body.status || '');
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
    if (table === 'professional_profiles' && status === 'approved') {
      const { data: profile } = await supabase.from('professional_profiles').select('verification_status').eq('id', req.params.id).maybeSingle();
      if (profile?.verification_status !== 'approved') return res.status(400).json({ error: 'Valide primeiro o documento de identificação.' });
    }
    const update = { status, rejection_reason: status === 'rejected' ? String(req.body.rejection_reason || '').trim() : '', updated_at: new Date().toISOString() };
    if (table === 'professional_profiles' && status !== 'suspended') Object.assign(update, { suspended_until: null, suspension_reason: '', pre_suspension_status: '' });
    const { data, error } = await supabase.from(table).update(update).eq('id', req.params.id).select('*').single(); if (error) throw error;
    await supabase.from('moderation_logs').insert({ id: crypto.randomUUID(), target_type: req.params.type, target_id: req.params.id, action: status, reason: String(req.body.rejection_reason || ''), created_at: new Date().toISOString() });
    res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao moderar item.' }); }
});
app.patch('/api/admin/featured/:type/:id', requireAuth, async (req, res) => {
  try {
    const map = { services: 'professional_services', projects: 'professional_projects' }, table = map[req.params.type];
    if (!table) return res.status(400).json({ error: 'Tipo inválido.' });
    const featured = Boolean(req.body.featured);
    const { data, error } = await supabase.from(table).update({ featured, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('status', 'approved').select('*').single();
    if (error) throw error; res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao alterar destaque.' }); }
});
app.get('/api/admin/professionals/:id/identity/:side', requireAuth, async (req, res) => {
  try {
    const field = req.params.side === 'front' ? 'id_front_path' : req.params.side === 'back' ? 'id_back_path' : null;
    if (!field) return res.status(400).json({ error: 'Lado inválido.' });
    const { data: profile, error } = await supabase.from('professional_profiles').select(field).eq('id', req.params.id).maybeSingle();
    if (error) throw error; const storagePath = profile?.[field];
    if (!storagePath) return res.status(404).json({ error: 'Documento não encontrado.' });
    const { data, error: signError } = await supabase.storage.from(VERIFICATION_BUCKET).createSignedUrl(storagePath, 600);
    if (signError) throw signError; res.json({ url: data.signedUrl });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao abrir documento.' }); }
});
app.patch('/api/admin/professionals/:id/verification', requireAuth, async (req, res) => {
  try {
    const status = String(req.body.status || ''), reason = String(req.body.reason || '').trim();
    if (!['approved','rejected','pending'].includes(status)) return res.status(400).json({ error: 'Estado de verificação inválido.' });
    if (status === 'rejected' && !reason) return res.status(400).json({ error: 'Informe o motivo da rejeição.' });
    const update = { verification_status: status, verification_reason: status === 'rejected' ? reason : '', identity_verified_at: status === 'approved' ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('professional_profiles').update(update).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    await supabase.from('moderation_logs').insert({ id: crypto.randomUUID(), target_type: 'identity', target_id: req.params.id, action: status, reason, created_at: new Date().toISOString() });
    res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao validar identidade.' }); }
});

app.patch('/api/admin/professionals/:id/verified', requireAuth, async (req, res) => {
  try {
    const verified = req.body.verified === true || req.body.verified === 'true';
    const { data: current, error: ce } = await supabase.from('professional_profiles').select('id,status,verification_status').eq('id', req.params.id).maybeSingle();
    if (ce) throw ce; if (!current) return res.status(404).json({ error: 'Profissional não encontrado.' });
    if (verified && (current.status !== 'approved' || current.verification_status !== 'approved')) return res.status(400).json({ error: 'Aprove o perfil e valide a identidade antes de atribuir o selo verificado.' });
    const { data, error } = await supabase.from('professional_profiles').update({ verified, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    await supabase.from('moderation_logs').insert({ id: crypto.randomUUID(), target_type: 'professional', target_id: req.params.id, action: verified ? 'verified_badge_on' : 'verified_badge_off', reason: 'Selo público alterado manualmente pela administração.', created_at: new Date().toISOString() });
    res.json(data);
  } catch (error) { console.error(error); res.status(500).json({ error: error.message || 'Erro ao alterar selo verificado.' }); }
});

app.get('/api/admin/analytics', requireAuth, async (req, res) => {
  try {
    const [{ data: profiles, error: pe }, { data: events, error: ee }, { data: ratings, error: re }, { data: reports, error: rpe }] = await Promise.all([
      supabase.from('professional_profiles').select('id,name,slug,status,verified,warning_count').order('created_at', { ascending: false }),
      supabase.from('professional_events').select('professional_id,event_type,visitor_hash'),
      supabase.from('professional_ratings').select('professional_id,stars,status'),
      supabase.from('professional_reports').select('professional_id,status')
    ]); if (pe) throw pe; if (ee) throw ee; if (re) throw re; if (rpe) throw rpe;
    const result = (profiles || []).map(p => {
      const ev = (events || []).filter(x=>x.professional_id===p.id), rr=(ratings||[]).filter(x=>x.professional_id===p.id&&x.status==='published'), rp=(reports||[]).filter(x=>x.professional_id===p.id&&x.status==='open');
      return { ...p, views: new Set(ev.filter(x=>x.event_type==='view').map(x=>x.visitor_hash)).size, contacts: new Set(ev.filter(x=>x.event_type==='contact').map(x=>x.visitor_hash)).size, ratingCount: rr.length, ratingAvg: rr.length ? rr.reduce((a,x)=>a+Number(x.stars||0),0)/rr.length : 0, openReports: rp.length };
    });
    res.json(result);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar desempenho.' }); }
});
app.get('/api/admin/reports', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('professional_reports').select('*, professional_profiles(name,slug,status,warning_count)').order('created_at', { ascending: false });
    if (error) throw error; res.json(data || []);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar denúncias.' }); }
});
app.post('/api/admin/reports/:id/action', requireAuth, async (req, res) => {
  try {
    const action = String(req.body.action || ''), reason = String(req.body.reason || '').trim();
    if (!['warn','suspend','dismiss','delete'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' });
    const { data: report, error } = await supabase.from('professional_reports').select('*').eq('id', req.params.id).single(); if (error) throw error;
    const { data: profile, error: pe } = await supabase.from('professional_profiles').select('*').eq('id', report.professional_id).single(); if (pe) throw pe;
    if (action === 'warn') {
      const message = reason || 'A administração recebeu uma denúncia e emitiu uma advertência. Reveja os seus dados e práticas profissionais.';
      await supabase.from('professional_profiles').update({ warning_count: Number(profile.warning_count || 0) + 1, last_warning: message, updated_at: new Date().toISOString() }).eq('id', profile.id);
      await supabase.from('professional_reports').update({ status: 'actioned', admin_action: 'warn', reviewed_at: new Date().toISOString() }).eq('id', report.id);
      await supabase.from('moderation_logs').insert({ id: crypto.randomUUID(), target_type: 'professional', target_id: profile.id, action: 'warning', reason: message, created_at: new Date().toISOString() });
    } else if (action === 'suspend') {
      const days = Math.min(365, Math.max(1, Number(req.body.suspensionDays || 7))), until = new Date(Date.now()+days*86400000).toISOString();
      const previous = profile.status === 'suspended' ? (profile.pre_suspension_status || 'pending') : profile.status;
      await supabase.from('professional_profiles').update({ status: 'suspended', pre_suspension_status: previous, suspended_until: until, suspension_reason: reason || `Suspensão temporária por ${days} dia(s).`, updated_at: new Date().toISOString() }).eq('id', profile.id);
      await supabase.from('professional_reports').update({ status: 'actioned', admin_action: `suspend_${days}d`, reviewed_at: new Date().toISOString() }).eq('id', report.id);
    } else if (action === 'dismiss') {
      await supabase.from('professional_reports').update({ status: 'dismissed', admin_action: 'dismiss', reviewed_at: new Date().toISOString() }).eq('id', report.id);
    } else if (action === 'delete') {
      if (profile.id_front_path) await deletePrivateIdentityUpload(profile.id_front_path);
      if (profile.id_back_path) await deletePrivateIdentityUpload(profile.id_back_path);
      await supabase.from('professional_reports').update({ status: 'actioned', admin_action: 'delete', reviewed_at: new Date().toISOString() }).eq('id', report.id);
      await supabase.from('professional_users').delete().eq('id', profile.user_id);
    }
    res.json({ ok: true });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao aplicar ação.' }); }
});

app.get('/api/admin/password-reset-requests', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('password_reset_requests').select('*, professional_profiles(name,slug,user_id)').order('created_at', { ascending: false });
    if (error) throw error; res.json(data || []);
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao carregar pedidos de recuperação.' }); }
});
app.post('/api/admin/password-reset-requests/:id/reset', requireAuth, async (req, res) => {
  try {
    const { data: request, error } = await supabase.from('password_reset_requests').select('*, professional_profiles(user_id,name)').eq('id', req.params.id).eq('status','pending').maybeSingle();
    if (error) throw error; if (!request) return res.status(404).json({ error: 'Pedido pendente não encontrado.' });
    const temporaryPassword = `${crypto.randomBytes(4).toString('hex')}A7!`;
    const { error: ue } = await supabase.from('professional_users').update({ password_hash: hashPassword(temporaryPassword), updated_at: new Date().toISOString() }).eq('id', request.professional_profiles.user_id); if (ue) throw ue;
    await supabase.from('password_reset_requests').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', request.id);
    res.json({ ok: true, temporaryPassword, name: request.professional_profiles.name });
  } catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao redefinir senha.' }); }
});
app.post('/api/admin/password-reset-requests/:id/reject', requireAuth, async (req, res) => {
  try { const { error } = await supabase.from('password_reset_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', req.params.id); if (error) throw error; res.json({ ok: true }); }
  catch (error) { console.error(error); res.status(500).json({ error: 'Erro ao rejeitar pedido.' }); }
});

app.get('/health', (_, res) => res.json({ ok: true, storage: USE_SUPABASE ? 'supabase' : 'local', persistent: USE_SUPABASE, supabaseConfigured: USE_SUPABASE }));
app.listen(PORT, () => { console.log(`Site disponível na porta ${PORT}`); console.log(`Armazenamento: ${USE_SUPABASE ? 'Supabase (persistente)' : 'local (desenvolvimento)'}`); });
