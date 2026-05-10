const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const http = require('http');
const https = require('https');

const IMAGE_ROOT_FOLDER = 'Taerae Images';
const IMAGE_ROOT_ABSOLUTE = path.join(__dirname, '..', IMAGE_ROOT_FOLDER);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 20,
  timeout: 60000,
  freeSocketTimeout: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 20,
  timeout: 60000,
  freeSocketTimeout: 30000
});

function normalizeRelativeImagePath(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.replace(/\//g, '\\').trim();
  if (!normalized) return null;
  return normalized.startsWith(`${IMAGE_ROOT_FOLDER}\\`)
    ? normalized
    : `${IMAGE_ROOT_FOLDER}\\${normalized}`;
}

function toAbsoluteImagePath(relativeImagePath) {
  const normalized = normalizeRelativeImagePath(relativeImagePath);
  if (!normalized) return null;

  const relativeWithoutRoot = normalized.startsWith(`${IMAGE_ROOT_FOLDER}\\`)
    ? normalized.slice(`${IMAGE_ROOT_FOLDER}\\`.length)
    : normalized;

  return path.join(IMAGE_ROOT_ABSOLUTE, ...relativeWithoutRoot.split('\\'));
}

async function imagePathExists(relativeImagePath) {
  const absolutePath = toAbsoluteImagePath(relativeImagePath);
  if (!absolutePath) return false;
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function parseImagePathFromGitHubUrl(imageURL) {
  if (!imageURL || typeof imageURL !== 'string') return null;
  const marker = '/Taerae%20Images/';
  const markerIdx = imageURL.indexOf(marker);
  if (markerIdx === -1) return null;

  const encodedPart = imageURL.slice(markerIdx + marker.length);
  const cleanPart = encodedPart.split('?')[0].split('#')[0];
  const segments = cleanPart
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (segments.length < 3) return null;
  return normalizeRelativeImagePath(path.join(...segments));
}

function parseImagePathFromLocalUrl(imageURL) {
  if (!imageURL || typeof imageURL !== 'string') return null;
  const marker = '/images/';
  const markerIdx = imageURL.indexOf(marker);
  if (markerIdx === -1) return null;

  const encodedPart = imageURL.slice(markerIdx + marker.length);
  const cleanPart = encodedPart.split('?')[0].split('#')[0];
  const segments = cleanPart
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (segments.length < 3) return null;
  return normalizeRelativeImagePath(path.join(...segments));
}

function getImagePathFromCard(card) {
  if (!card) return null;
  return (
    normalizeRelativeImagePath(card.imagePath) ||
    parseImagePathFromLocalUrl(card.imageURL) ||
    parseImagePathFromGitHubUrl(card.imageURL)
  );
}

function buildImagePath(group, rarity, filename) {
  return normalizeRelativeImagePath(path.join(group, rarity, filename));
}

function getPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  if (process.env.HEROKU_APP_NAME) {
    return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
  }

  return null;
}

function imagePathToWebPath(relativeImagePath) {
  const normalized = normalizeRelativeImagePath(relativeImagePath);
  if (!normalized) return null;

  const withoutRoot = normalized.startsWith(`${IMAGE_ROOT_FOLDER}\\`)
    ? normalized.slice(`${IMAGE_ROOT_FOLDER}\\`.length)
    : normalized;

  const encodedSegments = withoutRoot.split('\\').map((segment) => encodeURIComponent(segment));
  return `/images/${encodedSegments.join('/')}`;
}

function buildPublicImageUrl(relativeImagePath) {
  const webPath = imagePathToWebPath(relativeImagePath);
  const base = getPublicBaseUrl();
  if (!webPath || !base) return null;
  return `${base}${webPath}`;
}

async function readImageBufferFromCard(card, { timeout = 20000 } = {}) {
  const imagePath = getImagePathFromCard(card);
  if (imagePath) {
    const absolutePath = toAbsoluteImagePath(imagePath);
    if (absolutePath && fsSync.existsSync(absolutePath)) {
      return fs.readFile(absolutePath);
    }
  }

  if (!card?.imageURL) {
    throw new Error('Card image source is missing (imagePath/imageURL not found).');
  }

  const { data } = await axios.get(card.imageURL, {
    responseType: 'arraybuffer',
    timeout,
    httpAgent,
    httpsAgent,
    decompress: true
  });

  return Buffer.from(data, 'binary');
}

function isImageFilename(filename) {
  if (!filename) return false;
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

module.exports = {
  IMAGE_ROOT_FOLDER,
  IMAGE_ROOT_ABSOLUTE,
  buildImagePath,
  buildPublicImageUrl,
  getImagePathFromCard,
  imagePathExists,
  imagePathToWebPath,
  isImageFilename,
  normalizeRelativeImagePath,
  parseImagePathFromGitHubUrl,
  readImageBufferFromCard,
  toAbsoluteImagePath
};
