const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile, exec } = require('child_process');
const NodeID3 = require('node-id3');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const AUDIO_DIR = path.join(__dirname, '..', 'audio');
const INBOX_DIR = path.join(AUDIO_DIR, 'inbox');
const RATED_DIR = path.join(AUDIO_DIR, 'rated');
const IMAGES_DIR = path.join(INBOX_DIR, 'images');
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist', 'client', 'browser');

const EXPORT_DIR = path.join(AUDIO_DIR, 'export');

const VALID_RATINGS = ['Bad', 'OK', 'Good', 'Real Good', 'Banger'];
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const DEFAULT_ART = 'BBBDefaultAlbumart.png';

// Parse track filename: "Artist - Album - Track (Year).mp3"
function parseTrackFilename(filename) {
  const name = filename.replace(/\.[^/.]+$/, ''); // strip extension
  // Match: Artist - Album - Track (Year) or Artist - Track (Year)
  const matchFull = name.match(/^(.+?)\s*-\s*(.+?)\s*-\s*(.+?)\s*\((\d{4})\)$/);
  if (matchFull) {
    return { artist: matchFull[1].trim(), album: matchFull[2].trim(), title: matchFull[3].trim(), year: matchFull[4] };
  }
  // Match: Artist - Track (Year)
  const matchSimple = name.match(/^(.+?)\s*-\s*(.+?)\s*\((\d{4})\)$/);
  if (matchSimple) {
    return { artist: matchSimple[1].trim(), album: '', title: matchSimple[2].trim(), year: matchSimple[3] };
  }
  return { artist: '', album: '', title: name, year: '' };
}

// Find matching album art image
function findAlbumArt(filename) {
  const parsed = parseTrackFilename(filename);
  if (!fs.existsSync(IMAGES_DIR)) return null;

  const images = fs.readdirSync(IMAGES_DIR)
    .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));

  // Try to match album: "Artist - Album (Year).jpg"
  if (parsed.album && parsed.year) {
    const albumPattern = `${parsed.artist} - ${parsed.album} (${parsed.year})`.toLowerCase();
    const match = images.find(img => {
      const imgName = img.replace(/\.[^/.]+$/, '').toLowerCase();
      return imgName === albumPattern;
    });
    if (match) return match;
  }

  // Try partial match on artist + album
  if (parsed.album) {
    const match = images.find(img => {
      const imgName = img.replace(/\.[^/.]+$/, '').toLowerCase();
      return imgName.includes(parsed.artist.toLowerCase()) && imgName.includes(parsed.album.toLowerCase());
    });
    if (match) return match;
  }

  // Try artist-only match for singles
  if (parsed.artist) {
    const match = images.find(img => {
      const imgName = img.replace(/\.[^/.]+$/, '').toLowerCase();
      return imgName.includes(parsed.artist.toLowerCase()) && imgName.includes(parsed.title.toLowerCase());
    });
    if (match) return match;
  }

  return null;
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve Angular app (production)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
}

// --- API Routes ---

// GET /api/tracks - List all unrated tracks in inbox
app.get('/api/tracks', (req, res) => {
  try {
    if (!fs.existsSync(INBOX_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(INBOX_DIR)
      .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map(f => {
        const stats = fs.statSync(path.join(INBOX_DIR, f));
        return {
          filename: f,
          size: stats.size,
          addedAt: stats.mtimeMs
        };
      })
      .sort((a, b) => a.addedAt - b.addedAt);

    res.json(files);
  } catch (err) {
    console.error('Error listing tracks:', err);
    res.status(500).json({ error: 'Failed to list tracks' });
  }
});

// GET /api/tracks/:filename/stream - Stream an audio file
app.get('/api/tracks/:filename/stream', (req, res) => {
  const filename = req.params.filename;

  // Prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(INBOX_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filename).toLowerCase();

  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.opus': 'audio/opus'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // Support range requests (needed for seeking on mobile)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// POST /api/tracks/:filename/rate - Rate a track and move it
app.post('/api/tracks/:filename/rate', (req, res) => {
  const filename = req.params.filename;
  const { rating } = req.body;

  // Prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!rating || !VALID_RATINGS.includes(rating)) {
    return res.status(400).json({ error: `Invalid rating. Must be one of: ${VALID_RATINGS.join(', ')}` });
  }

  const sourcePath = path.join(INBOX_DIR, filename);
  const destDir = path.join(RATED_DIR, rating);
  const destPath = path.join(destDir, filename);

  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  try {
    // Ensure destination directory exists
    fs.mkdirSync(destDir, { recursive: true });

    // Handle duplicate filenames
    let finalPath = destPath;
    if (fs.existsSync(destPath)) {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        finalPath = path.join(destDir, `${name} (${counter})${ext}`);
        counter++;
      }
    }

    fs.renameSync(sourcePath, finalPath);

    res.json({
      success: true,
      filename: path.basename(finalPath),
      rating,
      movedTo: finalPath
    });
  } catch (err) {
    console.error('Error moving track:', err);
    res.status(500).json({ error: 'Failed to move track' });
  }
});

// GET /api/rated/:rating/tracks - List tracks in a rated folder
app.get('/api/rated/:rating/tracks', (req, res) => {
  const rating = req.params.rating;
  if (!VALID_RATINGS.includes(rating)) {
    return res.status(400).json({ error: `Invalid rating. Must be one of: ${VALID_RATINGS.join(', ')}` });
  }

  try {
    const dir = path.join(RATED_DIR, rating);
    if (!fs.existsSync(dir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(dir)
      .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map(f => {
        const stats = fs.statSync(path.join(dir, f));
        return {
          filename: f,
          size: stats.size,
          addedAt: stats.mtimeMs
        };
      })
      .sort((a, b) => a.addedAt - b.addedAt);

    res.json(files);
  } catch (err) {
    console.error('Error listing rated tracks:', err);
    res.status(500).json({ error: 'Failed to list rated tracks' });
  }
});

// GET /api/rated/:rating/tracks/:filename/stream - Stream a rated track
app.get('/api/rated/:rating/tracks/:filename/stream', (req, res) => {
  const { rating, filename } = req.params;

  if (!VALID_RATINGS.includes(rating)) {
    return res.status(400).json({ error: 'Invalid rating' });
  }

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(RATED_DIR, rating, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filename).toLowerCase();

  const mimeTypes = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// POST /api/rated/:rating/tracks/:filename/rate - Re-rate a track (move between rated folders)
app.post('/api/rated/:rating/tracks/:filename/rate', (req, res) => {
  const { rating: sourceRating, filename } = req.params;
  const { rating: newRating } = req.body;

  if (!VALID_RATINGS.includes(sourceRating)) {
    return res.status(400).json({ error: 'Invalid source rating' });
  }

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!newRating || !VALID_RATINGS.includes(newRating)) {
    return res.status(400).json({ error: `Invalid rating. Must be one of: ${VALID_RATINGS.join(', ')}` });
  }

  const sourcePath = path.join(RATED_DIR, sourceRating, filename);
  const destDir = path.join(RATED_DIR, newRating);
  const destPath = path.join(destDir, filename);

  if (!fs.existsSync(sourcePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  try {
    fs.mkdirSync(destDir, { recursive: true });

    let finalPath = destPath;
    if (fs.existsSync(destPath) && sourcePath !== destPath) {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        finalPath = path.join(destDir, `${name} (${counter})${ext}`);
        counter++;
      }
    }

    if (sourcePath !== finalPath) {
      fs.renameSync(sourcePath, finalPath);
    }

    res.json({
      success: true,
      filename: path.basename(finalPath),
      rating: newRating,
      movedTo: finalPath
    });
  } catch (err) {
    console.error('Error re-rating track:', err);
    res.status(500).json({ error: 'Failed to re-rate track' });
  }
});

// --- Metadata / Tag Mode Routes ---

// GET /api/images - List all available album art images
app.get('/api/images', (req, res) => {
  try {
    if (!fs.existsSync(IMAGES_DIR)) return res.json([]);
    const images = fs.readdirSync(IMAGES_DIR)
      .filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort();
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// GET /api/images/:filename - Serve album art images
app.get('/api/images/:filename', (req, res) => {
  const filename = req.params.filename;
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }
  res.sendFile(filePath);
});

// GET /api/rated/:rating/tracks/:filename/metadata - Read metadata + find album art
app.get('/api/rated/:rating/tracks/:filename/metadata', (req, res) => {
  const { rating, filename } = req.params;
  if (!VALID_RATINGS.includes(rating)) {
    return res.status(400).json({ error: 'Invalid rating' });
  }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(RATED_DIR, rating, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  try {
    const tags = NodeID3.read(filePath);
    const parsed = parseTrackFilename(filename);
    const artImage = findAlbumArt(filename);

    // Extract URL tags
    const urlTags = tags.userDefinedUrl || [];
    const radioUrl = (urlTags.find(u => u.description === 'RADIO_STATION_URL') || {}).url || '';

    res.json({
      current: {
        artist: tags.artist || '',
        title: tags.title || '',
        album: tags.album || '',
        year: tags.year || '',
        genre: tags.genre || '',
        trackNumber: tags.trackNumber || '',
        composer: tags.composer || '',
        publisher: tags.publisher || '',
        comment: (tags.comment && tags.comment.text) ? tags.comment.text : '',
        radioStationUrl: radioUrl,
        hasEmbeddedArt: !!(tags.image && tags.image.imageBuffer)
      },
      suggested: {
        artist: parsed.artist,
        title: parsed.title,
        album: parsed.album,
        year: parsed.year,
        genre: '',
        trackNumber: '',
        composer: '',
        publisher: '',
        comment: '',
        radioStationUrl: 'www.boombapboombox.com'
      },
      albumArt: artImage,
      defaultArt: DEFAULT_ART
    });
  } catch (err) {
    console.error('Error reading metadata:', err);
    res.status(500).json({ error: 'Failed to read metadata' });
  }
});

// POST /api/rated/:rating/tracks/:filename/metadata - Write metadata + embed album art
app.post('/api/rated/:rating/tracks/:filename/metadata', (req, res) => {
  const { rating, filename } = req.params;
  if (!VALID_RATINGS.includes(rating)) {
    return res.status(400).json({ error: 'Invalid rating' });
  }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(RATED_DIR, rating, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const { artist, title, album, year, genre, trackNumber, composer, publisher, comment, radioStationUrl, embedArt, artFilename } = req.body;

  // Validate artFilename if provided
  if (artFilename && (artFilename.includes('..') || artFilename.includes('/') || artFilename.includes('\\'))) {
    return res.status(400).json({ error: 'Invalid art filename' });
  }

  try {
    const tags = {
      artist: artist || '',
      title: title || '',
      album: album || '',
      year: year || '',
      genre: genre || '',
      trackNumber: trackNumber || '',
      composer: composer || '',
      publisher: publisher || ''
    };

    // Comment tag
    if (comment) {
      tags.comment = { language: 'eng', shortText: '', text: comment };
    }

    // Radio station URL stored as user-defined URL
    if (radioStationUrl) {
      tags.userDefinedUrl = [{ description: 'RADIO_STATION_URL', url: radioStationUrl }];
    }

    // Embed album art if requested
    if (embedArt) {
      // Use explicitly chosen art, then auto-detected, then default
      let artFile = null;
      if (artFilename) {
        artFile = artFilename;
      } else {
        artFile = findAlbumArt(filename) || DEFAULT_ART;
      }
      const artPath = path.join(IMAGES_DIR, artFile);
      if (fs.existsSync(artPath)) {
        const ext = path.extname(artFile).toLowerCase();
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
        tags.image = {
          mime: mimeMap[ext] || 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'Album Art',
          imageBuffer: fs.readFileSync(artPath)
        };
      }
    }

    const success = NodeID3.update(tags, filePath);
    if (!success) {
      return res.status(500).json({ error: 'Failed to write tags' });
    }

    // Update .tagged.json manifest
    const taggedPath = path.join(RATED_DIR, rating, '.tagged.json');
    let tagged = [];
    if (fs.existsSync(taggedPath)) {
      try { tagged = JSON.parse(fs.readFileSync(taggedPath, 'utf8')); } catch { tagged = []; }
    }
    if (!tagged.includes(filename)) {
      tagged.push(filename);
    }
    fs.writeFileSync(taggedPath, JSON.stringify(tagged, null, 2));

    res.json({ success: true, tagged: tagged.length });
  } catch (err) {
    console.error('Error writing metadata:', err);
    res.status(500).json({ error: 'Failed to write metadata' });
  }
});

// GET /api/rated/:rating/tagged - Get the tagged manifest
app.get('/api/rated/:rating/tagged', (req, res) => {
  const { rating } = req.params;
  if (!VALID_RATINGS.includes(rating)) {
    return res.status(400).json({ error: 'Invalid rating' });
  }

  const taggedPath = path.join(RATED_DIR, rating, '.tagged.json');
  let tagged = [];
  if (fs.existsSync(taggedPath)) {
    try { tagged = JSON.parse(fs.readFileSync(taggedPath, 'utf8')); } catch { tagged = []; }
  }
  res.json(tagged);
});

// GET /api/stats - Get counts per rating folder
app.get('/api/stats', (req, res) => {
  try {
    const stats = { inbox: 0 };

    if (fs.existsSync(INBOX_DIR)) {
      stats.inbox = fs.readdirSync(INBOX_DIR)
        .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase())).length;
    }

    for (const rating of VALID_RATINGS) {
      const dir = path.join(RATED_DIR, rating);
      if (fs.existsSync(dir)) {
        stats[rating] = fs.readdirSync(dir)
          .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase())).length;
      } else {
        stats[rating] = 0;
      }
    }

    res.json(stats);
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// --- Export endpoints ---

// Shared export job state (in-memory, one job at a time)
let exportJob = { running: false, total: 0, done: 0, success: 0, failed: 0, errors: [], finished: false };

// GET /api/export/check - confirm ffmpeg is installed
app.get('/api/export/check', (req, res) => {
  exec('ffmpeg -version', (error) => {
    res.json({ available: !error });
  });
});

// GET /api/export/status - poll progress during a running job
app.get('/api/export/status', (req, res) => {
  res.json({ ...exportJob });
});

// POST /api/export - kick off async export job
app.post('/api/export', (req, res) => {
  if (exportJob.running) {
    return res.status(409).json({ error: 'Export already running' });
  }
  exportJob = { running: true, total: 0, done: 0, success: 0, failed: 0, errors: [], finished: false };
  runExport().catch(err => {
    exportJob.running = false;
    exportJob.finished = true;
    exportJob.errors.push(err.message);
  });
  res.json({ started: true });
});

async function runExport() {
  // Ensure export subdirs exist
  for (const rating of VALID_RATINGS) {
    const dir = path.join(EXPORT_DIR, rating);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Collect all MP3s across all rated folders
  const jobs = [];
  for (const rating of VALID_RATINGS) {
    const ratedDir = path.join(RATED_DIR, rating);
    if (!fs.existsSync(ratedDir)) continue;
    const files = fs.readdirSync(ratedDir)
      .filter(f => path.extname(f).toLowerCase() === '.mp3');
    for (const file of files) jobs.push({ rating, file });
  }
  exportJob.total = jobs.length;

  // Process in batches of 3 in parallel
  const CONCURRENCY = 3;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(({ rating, file }) => new Promise(resolve => {
      const input = path.join(RATED_DIR, rating, file);
      const output = path.join(EXPORT_DIR, rating, file);
      execFile('ffmpeg', [
        '-i', input,
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',
        '-y',
        output
      ], (err) => {
        exportJob.done++;
        if (err) {
          exportJob.failed++;
          // Trim ffmpeg's verbose error to just the first line
          const msg = (err.message || '').split('\n')[0].slice(0, 120);
          exportJob.errors.push(`${rating}/${file}: ${msg}`);
        } else {
          exportJob.success++;
        }
        resolve();
      });
    })));
  }

  exportJob.running = false;
  exportJob.finished = true;
}

// SPA fallback - serve Angular index.html for all other routes
app.get('*', (req, res) => {
  const indexPath = path.join(CLIENT_DIST, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Client app not built. Run: cd client && ng build' });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Beat-A-Rater server running at http://localhost:${PORT}`);
  console.log(`  Inbox folder: ${INBOX_DIR}`);
  console.log(`  Rated folder: ${RATED_DIR}\n`);
});
