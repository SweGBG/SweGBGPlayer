const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

let mainWindow;

const MEDIA_EXTS = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ogv', '.m4v', '.3gp', '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];

function findMediaArg(argv) {
  return argv.slice(1).find(a => {
    try {
      return !a.startsWith('-') && fs.existsSync(a) && MEDIA_EXTS.includes(path.extname(a).toLowerCase());
    } catch { return false; }
  });
}

// Single instance: double-clicking an associated file opens it in the running player
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const fileArg = findMediaArg(argv);
      if (fileArg) mainWindow.webContents.send('open-path', path.resolve(fileArg));
    }
  });
}

function getAppBaseDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(app.getPath('exe'));
  return __dirname;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#1a1a2e',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  Menu.setApplicationMenu(null);

  // Open media file passed on the command line (e.g. "Open with MPlayer")
  mainWindow.webContents.on('did-finish-load', () => {
    const fileArg = findMediaArg(process.argv);
    if (fileArg) {
      mainWindow.webContents.send('open-path', path.resolve(fileArg));
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'ogv', 'm4v', '3gp'] },
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result;
});

ipcMain.handle('open-subtitle', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'sub', 'ssa', 'ass'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result;
});

ipcMain.handle('read-subtitle-file', async (event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { success: true, content, ext: path.extname(filePath).toLowerCase() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-subtitle-file', async (event, { content, dir, filename }) => {
  try {
    const savePath = path.join(dir, filename);
    fs.writeFileSync(savePath, content, 'utf-8');
    return { success: true, path: savePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Save downloaded subtitle into <program folder>\download\ (falls back to userData if not writable)
ipcMain.handle('save-subtitle-download', async (event, { content, filename }) => {
  const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');
  const tryDirs = [
    path.join(getAppBaseDir(), 'download'),
    path.join(app.getPath('userData'), 'download')
  ];
  for (const dir of tryDirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const savePath = path.join(dir, safeName);
      fs.writeFileSync(savePath, content, 'utf-8');
      return { success: true, path: savePath };
    } catch (e) { /* try next */ }
  }
  return { success: false, error: 'Could not write download folder' };
});

ipcMain.handle('path-exists', (event, p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

ipcMain.handle('get-file-dir', (event, filePath) => {
  return path.dirname(filePath);
});

ipcMain.handle('get-file-name', (event, filePath) => {
  return path.parse(filePath).name;
});

ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());
ipcMain.handle('window-fullscreen', () => {
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});
ipcMain.handle('is-fullscreen', () => mainWindow.isFullScreen());

function computeOSHash(filePath) {
  return new Promise((resolve, reject) => {
    const HASH_CHUNK_SIZE = 65536;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    if (fileSize < HASH_CHUNK_SIZE * 2) {
      return reject(new Error('File too small for hash'));
    }

    const fd = fs.openSync(filePath, 'r');
    const headBuf = Buffer.alloc(HASH_CHUNK_SIZE);
    const tailBuf = Buffer.alloc(HASH_CHUNK_SIZE);

    fs.readSync(fd, headBuf, 0, HASH_CHUNK_SIZE, 0);
    fs.readSync(fd, tailBuf, 0, HASH_CHUNK_SIZE, fileSize - HASH_CHUNK_SIZE);
    fs.closeSync(fd);

    let hash = BigInt(fileSize);
    for (let i = 0; i < HASH_CHUNK_SIZE; i += 8) {
      hash = (hash + headBuf.readBigUInt64LE(i)) & BigInt('0xFFFFFFFFFFFFFFFF');
      hash = (hash + tailBuf.readBigUInt64LE(i)) & BigInt('0xFFFFFFFFFFFFFFFF');
    }

    resolve({ hash: hash.toString(16).padStart(16, '0'), size: fileSize });
  });
}

ipcMain.handle('compute-hash', async (event, filePath) => {
  try {
    return await computeOSHash(filePath);
  } catch (e) {
    return { error: e.message };
  }
});

function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'SubDB/1.0 (MPlayer/1.0; https://github.com)',
        'Accept-Encoding': 'gzip',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, options).then(resolve).catch(reject);
      }

      const chunks = [];
      const stream = res.headers['content-encoding'] === 'gzip'
        ? res.pipe(zlib.createGunzip())
        : res;

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

ipcMain.handle('search-subtitles-opensubtitles', async (event, { hash, fileSize, filename, language }) => {
  try {
    const lang = language || 'eng';
    const searchName = encodeURIComponent(filename || '');

    const url = `https://rest.opensubtitles.org/search/moviebytesize-${fileSize}/moviehash-${hash}/sublanguageid-${lang}`;

    const resp = await httpGet(url, {
      headers: {
        'User-Agent': 'TemporaryUserAgent',
        'Accept': 'application/json'
      }
    });

    if (resp.statusCode === 200) {
      const data = JSON.parse(resp.body.toString('utf-8'));
      return { success: true, results: data.slice(0, 25) };
    }

    const nameUrl = `https://rest.opensubtitles.org/search/query-${searchName}/sublanguageid-${lang}`;
    const resp2 = await httpGet(nameUrl, {
      headers: {
        'User-Agent': 'TemporaryUserAgent',
        'Accept': 'application/json'
      }
    });

    if (resp2.statusCode === 200) {
      const data = JSON.parse(resp2.body.toString('utf-8'));
      return { success: true, results: data.slice(0, 25) };
    }

    return { success: false, error: `HTTP ${resp2.statusCode}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('search-subtitles-subdb', async (event, { filePath }) => {
  try {
    const HASH_SIZE = 65536;
    const stat = fs.statSync(filePath);
    if (stat.size < HASH_SIZE * 2) return { success: false, error: 'File too small' };

    const fd = fs.openSync(filePath, 'r');
    const headBuf = Buffer.alloc(HASH_SIZE);
    const tailBuf = Buffer.alloc(HASH_SIZE);
    fs.readSync(fd, headBuf, 0, HASH_SIZE, 0);
    fs.readSync(fd, tailBuf, 0, HASH_SIZE, stat.size - HASH_SIZE);
    fs.closeSync(fd);

    const combined = Buffer.concat([headBuf, tailBuf]);
    const hash = crypto.createHash('md5').update(combined).digest('hex');

    const url = `https://api.thesubdb.com/?action=search&hash=${hash}`;
    const resp = await httpGet(url, {
      headers: { 'User-Agent': 'SubDB/1.0 (MPlayer/1.0; https://github.com)' }
    });

    if (resp.statusCode === 200) {
      const langs = resp.body.toString('utf-8').split(',');
      return { success: true, hash, languages: langs };
    }
    return { success: false, error: 'No subtitles found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('download-subtitle-subdb', async (event, { hash, language }) => {
  try {
    const url = `https://api.thesubdb.com/?action=download&hash=${hash}&language=${language}`;
    const resp = await httpGet(url, {
      headers: { 'User-Agent': 'SubDB/1.0 (MPlayer/1.0; https://github.com)' }
    });
    if (resp.statusCode === 200) {
      return { success: true, content: resp.body.toString('utf-8') };
    }
    return { success: false, error: `HTTP ${resp.statusCode}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('download-subtitle', async (event, { url }) => {
  try {
    const resp = await httpGet(url);
    if (resp.statusCode === 200) {
      let body = resp.body;
      // OpenSubtitles serves gzipped .gz files — detect gzip magic bytes and decompress
      if (body.length > 2 && body[0] === 0x1f && body[1] === 0x8b) {
        body = zlib.gunzipSync(body);
      }
      return { success: true, content: body.toString('utf-8') };
    }
    return { success: false, error: `HTTP ${resp.statusCode}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result;
});

// ── Music Grabber extension ──
// Locate bundled yt-dlp/ffmpeg: portable dir, packaged resources, or dev tree
function findToolsDir() {
  const candidates = [
    path.join(getAppBaseDir(), 'tools', 'bin'),
    process.resourcesPath ? path.join(process.resourcesPath, 'tools', 'bin') : null,
    path.join(__dirname, 'tools', 'bin')
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'yt-dlp.exe'))) return dir;
  }
  return null;
}

ipcMain.handle('grabber-tools-available', () => !!findToolsDir());

ipcMain.handle('grabber-default-dir', () => {
  const desktopMusic = path.join(app.getPath('home'), 'Desktop', 'Music');
  if (fs.existsSync(desktopMusic)) return desktopMusic;
  return path.join(app.getPath('music'), 'SweGBGPlayer');
});

ipcMain.handle('grabber-choose-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result;
});

ipcMain.handle('grabber-open-dir', (event, dir) => {
  if (dir && fs.existsSync(dir)) shell.openPath(dir);
});

const grabberJobs = new Map();
let grabberJobSeq = 0;

ipcMain.handle('grabber-start', (event, { url, format, outDir }) => {
  const toolsDir = findToolsDir();
  if (!toolsDir) return { success: false, error: 'yt-dlp.exe not found (tools\\bin)' };
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {
    return { success: false, error: 'Cannot create folder: ' + e.message };
  }

  const jobId = ++grabberJobSeq;
  const args = [
    '--no-playlist',
    '--newline',
    // AV/proxy HTTPS inspection breaks yt-dlp's cert chain on this machine
    '--no-check-certificates',
    // Use installed Node.js as JS runtime so YouTube serves all formats
    '--js-runtimes', 'node',
    '--ffmpeg-location', toolsDir,
    '-o', path.join(outDir, '%(title)s.%(ext)s')
  ];
  if (format === 'mp3') {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4');
  }
  args.push(url);

  const proc = spawn(path.join(toolsDir, 'yt-dlp.exe'), args, { windowsHide: true });
  grabberJobs.set(jobId, proc);

  let lastDestination = null;
  let errorTail = '';

  const handleLine = (line) => {
    line = line.trim();
    if (!line) return;
    const dest = line.match(/^\[(?:download|ExtractAudio|Merger)\]\s+(?:Destination:\s+|Merging formats into ")(.+?)"?$/);
    if (dest) lastDestination = dest[1];
    const prog = line.match(/^\[download\]\s+([\d.]+)%/);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('grabber-progress', {
        jobId,
        percent: prog ? parseFloat(prog[1]) : null,
        line
      });
    }
  };

  let stdoutBuf = '';
  proc.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    const lines = stdoutBuf.split(/\r?\n/);
    stdoutBuf = lines.pop();
    lines.forEach(handleLine);
  });
  proc.stderr.on('data', (d) => {
    errorTail = (errorTail + d.toString()).slice(-2000);
  });

  proc.on('close', (code) => {
    grabberJobs.delete(jobId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('grabber-done', {
        jobId,
        success: code === 0,
        filePath: lastDestination,
        error: code === 0 ? null : (errorTail.trim().split('\n').pop() || `yt-dlp exited with code ${code}`)
      });
    }
  });
  proc.on('error', (e) => {
    grabberJobs.delete(jobId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('grabber-done', { jobId, success: false, filePath: null, error: e.message });
    }
  });

  return { success: true, jobId };
});

ipcMain.handle('grabber-cancel', (event, jobId) => {
  const proc = grabberJobs.get(jobId);
  if (proc) {
    proc.kill();
    grabberJobs.delete(jobId);
    return true;
  }
  return false;
});

ipcMain.handle('list-media-files', async (event, dirPath) => {
  try {
    const exts = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ogv', '.m4v', '.mp3', '.wav', '.ogg', '.flac'];
    const files = fs.readdirSync(dirPath)
      .filter(f => exts.includes(path.extname(f).toLowerCase()))
      .map(f => ({ name: f, path: path.join(dirPath, f) }));
    return { success: true, files };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
