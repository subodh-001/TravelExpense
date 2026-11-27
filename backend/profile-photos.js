const fs = require('fs');
const path = require('path');

function getProfilePhotosFilePath(customPath = null) {
  if (customPath) return customPath;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  return path.join(dataDir, 'profile_photos.json');
}

function normalizeEmail(email) {
  return (email || '').toString().toLowerCase().trim();
}

function normalizeId(userId) {
  return (userId || '').toString().trim();
}

function deriveGoogleId(email) {
  const clean = normalizeEmail(email);
  if (!clean || !clean.includes('@')) return '';
  return `google_${clean.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/**
 * Returns true only for real usable profile image URLs or raster data URIs.
 * Rejects empty strings, inline SVG placeholders (DEFAULT_USER_AVATAR), and dicebear URLs.
 */
function isRealProfilePic(pic) {
  if (typeof pic !== 'string') return false;
  const trimmed = pic.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:image/svg+xml')) return false;
  if (lower.includes('dicebear')) return false;
  if (trimmed.includes('<')) return false;
  if (lower.startsWith('https://') || lower.startsWith('http://') || lower.startsWith('/uploads/')) {
    return true;
  }
  if (lower.startsWith('data:image/')) {
    return true;
  }
  return false;
}

/**
 * Returns true for user-uploaded or custom hosted photos (e.g. Cloudinary)
 * vs generic OAuth provider avatars like googleusercontent.com.
 */
function isCustomUploadedProfilePic(pic) {
  if (!isRealProfilePic(pic)) return false;
  const lower = pic.trim().toLowerCase();
  if (lower.includes('googleusercontent.com')) return false;
  return true;
}

/**
 * Picks the highest-priority valid picture from candidates.
 * Tier 1: Custom uploaded URL (e.g., Cloudinary / /uploads/ / raster data URI)
 * Tier 2: Other real HTTP/HTTPS URL (e.g., Google OAuth avatar)
 * Tier 3: First non-empty fallback (optional, e.g., '')
 */
function pickBestProfilePic(...candidates) {
  let firstCustom = '';
  let firstReal = '';

  for (const cand of candidates) {
    if (!isRealProfilePic(cand)) continue;
    const clean = cand.trim();
    if (!firstReal) firstReal = clean;
    if (isCustomUploadedProfilePic(clean)) {
      firstCustom = clean;
      break;
    }
  }

  if (firstCustom) return firstCustom;
  if (firstReal) return firstReal;
  return '';
}

function loadProfilePhotosRegistry(filePath = null) {
  const targetPath = getProfilePhotosFilePath(filePath);
  try {
    if (!fs.existsSync(targetPath)) return {};
    const raw = fs.readFileSync(targetPath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    console.warn('⚠️ Profile photos registry read note:', err.message);
    return {};
  }
}

function saveProfilePhotosRegistry(registry, filePath = null) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return false;
  const targetPath = getProfilePhotosFilePath(filePath);
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${targetPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tmpPath, targetPath);
    return true;
  } catch (err) {
    console.warn('⚠️ Profile photos registry write note:', err.message);
    return false;
  }
}

function findRegistryKey({ userId = '', email = '' } = {}, registry = {}) {
  const cleanEmail = normalizeEmail(email);
  const cleanId = normalizeId(userId);
  const cleanIdLower = cleanId.toLowerCase();
  const derivedId = deriveGoogleId(cleanEmail);

  const directKeys = [cleanEmail, cleanId, cleanIdLower, derivedId].filter(Boolean);
  for (const k of directKeys) {
    if (registry[k] && typeof registry[k] === 'object') return k;
  }

  for (const [key, entry] of Object.entries(registry)) {
    if (!entry || typeof entry !== 'object') continue;
    const entryEmail = normalizeEmail(entry.email);
    const entryId = normalizeId(entry.userId);
    if (
      (cleanEmail && (entryEmail === cleanEmail || key.toLowerCase() === cleanEmail)) ||
      (cleanId && (entryId === cleanId || entryId.toLowerCase() === cleanIdLower || key.toLowerCase() === cleanIdLower)) ||
      (derivedId && (entryId === derivedId || key === derivedId))
    ) {
      return key;
    }
  }
  return null;
}

function getProfilePhotoRecord({ userId = '', email = '' } = {}, registry = null, filePath = null) {
  const reg = registry || loadProfilePhotosRegistry(filePath);
  const key = findRegistryKey({ userId, email }, reg);
  if (!key) return null;
  const entry = reg[key];
  if (!entry || !isRealProfilePic(entry.picture)) return null;
  return { key, ...entry };
}

function upsertProfilePhotoRecord(
  { userId = '', email = '', name = '', picture = '', updatedAt = null } = {},
  { registry = null, filePath = null, persist = true } = {}
) {
  if (!isRealProfilePic(picture)) {
    return { changed: false, reason: 'not_real_picture', registry: registry || loadProfilePhotosRegistry(filePath) };
  }

  const reg = registry ? { ...registry } : loadProfilePhotosRegistry(filePath);
  const cleanEmail = normalizeEmail(email);
  const cleanId = normalizeId(userId) || deriveGoogleId(cleanEmail);
  const cleanPic = picture.trim();
  const existingKey = findRegistryKey({ userId: cleanId, email: cleanEmail }, reg);
  const existing = existingKey ? reg[existingKey] : null;
  const previousPicture = existing && isRealProfilePic(existing.picture) ? existing.picture.trim() : '';

  const targetKey = cleanEmail || existingKey || cleanId;
  if (!targetKey) {
    return { changed: false, reason: 'missing_identifier', registry: reg };
  }

  const nextRecord = {
    userId: cleanId || (existing && existing.userId) || '',
    email: cleanEmail || normalizeEmail(existing && existing.email) || '',
    name: (name || (existing && existing.name) || '').toString().trim(),
    picture: cleanPic,
    updatedAt: updatedAt || new Date().toISOString()
  };

  const pictureChanged = previousPicture !== cleanPic;
  const metaChanged = !existing ||
    existing.userId !== nextRecord.userId ||
    normalizeEmail(existing.email) !== nextRecord.email ||
    (nextRecord.name && existing.name !== nextRecord.name);

  if (existingKey && existingKey !== targetKey) {
    delete reg[existingKey];
  }
  reg[targetKey] = nextRecord;

  if (persist && (pictureChanged || metaChanged || existingKey !== targetKey)) {
    saveProfilePhotosRegistry(reg, filePath);
  }

  return {
    changed: pictureChanged,
    metaChanged,
    previousPicture,
    record: nextRecord,
    registry: reg
  };
}

function removeProfilePhotoRecord({ userId = '', email = '' } = {}, { filePath = null } = {}) {
  const reg = loadProfilePhotosRegistry(filePath);
  const cleanEmail = normalizeEmail(email);
  const cleanId = normalizeId(userId);
  const derivedId = deriveGoogleId(cleanEmail);
  let removed = false;

  for (const key of Object.keys(reg)) {
    const entry = reg[key];
    const kLower = key.toLowerCase();
    const eEmail = normalizeEmail(entry && entry.email);
    const eId = normalizeId(entry && entry.userId).toLowerCase();
    if (
      (cleanEmail && (kLower === cleanEmail || eEmail === cleanEmail)) ||
      (cleanId && (kLower === cleanId.toLowerCase() || eId === cleanId.toLowerCase())) ||
      (derivedId && (kLower === derivedId.toLowerCase() || eId === derivedId.toLowerCase()))
    ) {
      delete reg[key];
      removed = true;
    }
  }

  if (removed) {
    saveProfilePhotosRegistry(reg, filePath);
  }
  return removed;
}

module.exports = {
  getProfilePhotosFilePath,
  isRealProfilePic,
  isCustomUploadedProfilePic,
  pickBestProfilePic,
  loadProfilePhotosRegistry,
  saveProfilePhotosRegistry,
  getProfilePhotoRecord,
  upsertProfilePhotoRecord,
  removeProfilePhotoRecord,
  deriveGoogleId
};

