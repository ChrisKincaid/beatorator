const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Paths
const AUDIO_DIR = path.join(__dirname, '..', 'audio');
const INBOX_DIR = path.join(AUDIO_DIR, 'inbox');
const RATED_DIR = path.join(AUDIO_DIR, 'rated');
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist', 'client', 'browser');

const VALID_RATINGS = ['Bad', 'OK', 'Good', 'Real Good', 'Banger'];
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus']);

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
