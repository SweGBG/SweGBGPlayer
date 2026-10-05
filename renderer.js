(function() {
  const video = document.getElementById('video-player');
  const dropZone = document.getElementById('drop-zone');
  const subtitleOverlay = document.getElementById('subtitle-overlay');
  const progressContainer = document.getElementById('progress-container');
  const progressPlayed = document.getElementById('progress-played');
  const progressBuffered = document.getElementById('progress-buffered');
  const progressHandle = document.getElementById('progress-handle');
  const progressTooltip = document.getElementById('progress-tooltip');
  const timeDisplay = document.getElementById('time-display');
  const nowPlaying = document.getElementById('now-playing');
  const volumeSlider = document.getElementById('volume-slider');
  const speedSelect = document.getElementById('speed-select');

  let playlist = [];
  let currentIndex = -1;
  let currentFilePath = null;
  let playHistory = [];
  let histPos = -1;
  let historyMode = localStorage.getItem('historyMode') === '1';
  let navigatingHistory = false;
  let recentFiles = JSON.parse(localStorage.getItem('recentFiles') || '[]');
  let subtitles = [];
  let currentSubtitleIndex = -1;
  let loadedSubtitles = [];
  let activeSubtitleIdx = -1;
  let contextMenu = null;
  let controlsTimeout = null;

  // Open file passed on the command line ("Open with MPlayer")
  window.api.onOpenPath(async (filePath) => {
    const name = await window.api.getFileName(filePath);
    addFilesToPlaylist([{ name: name + getExt(filePath), path: filePath }]);
    playIndex(playlist.length - 1);
  });

  // ── Top menus (File / Playback / Subtitles) ──
  document.getElementById('menu-file').addEventListener('click', (e) => {
    e.stopPropagation();
    showTopMenu(e.currentTarget, buildFileMenu);
  });
  document.getElementById('menu-playback').addEventListener('click', (e) => {
    e.stopPropagation();
    showTopMenu(e.currentTarget, buildPlaybackMenu);
  });
  document.getElementById('menu-subtitles').addEventListener('click', (e) => {
    e.stopPropagation();
    showTopMenu(e.currentTarget, buildSubtitlesMenu);
  });
  document.getElementById('menu-extensions').addEventListener('click', (e) => {
    e.stopPropagation();
    showTopMenu(e.currentTarget, buildExtensionsMenu);
  });

  function buildExtensionsMenu(menu) {
    const grabberOpen = !document.getElementById('grabber-panel').classList.contains('hidden');
    let html = `<div class="menu-item ${grabberOpen ? 'active' : ''}" data-action="grabber">Music Grabber ${grabberOpen ? '&#10003;' : ''}</div>`;
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="playlist">Playlist Panel</div>`;
    menu.innerHTML = html;
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        closeContextMenu();
        if (action === 'grabber') toggleGrabberPanel();
        else if (action === 'playlist') toggleSidebar();
      });
    });
  }

  function showTopMenu(btn, builder) {
    const wasOpen = contextMenu && contextMenu.dataset.owner === btn.id;
    closeContextMenu();
    if (wasOpen) return;

    const menu = document.createElement('div');
    menu.className = 'sub-context-menu top-menu';
    menu.dataset.owner = btn.id;
    builder(menu);
    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
    contextMenu = menu;
    btn.classList.add('open');
  }

  function buildFileMenu(menu) {
    let html = `<div class="menu-item" data-action="open">Open File... <span class="shortcut">Ctrl+O</span></div>`;
    html += `<div class="menu-item" data-action="open-folder">Open Folder...</div>`;
    html += `<div class="separator"></div>`;
    if (recentFiles.length > 0) {
      html += recentFiles.map((r, i) =>
        `<div class="menu-item" data-action="recent" data-idx="${i}">
          <span>${escapeHtml(r.name)}<span class="recent-path">${escapeHtml(r.path)}</span></span>
        </div>`
      ).join('');
      html += `<div class="separator"></div>`;
      html += `<div class="menu-item" data-action="clear-recent">Clear Recent Files</div>`;
      html += `<div class="separator"></div>`;
    } else {
      html += `<div class="menu-item disabled">No recent files</div>`;
      html += `<div class="separator"></div>`;
    }
    html += `<div class="menu-item" data-action="exit">Exit</div>`;
    menu.innerHTML = html;

    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        closeContextMenu();
        if (action === 'open') openFileDialog();
        else if (action === 'open-folder') {
          const result = await window.api.openFolder();
          if (!result.canceled && result.filePaths.length > 0) {
            const res = await window.api.listMediaFiles(result.filePaths[0]);
            if (res.success && res.files.length > 0) {
              const startAt = playlist.length;
              addFilesToPlaylist(res.files);
              playIndex(startAt);
            }
          }
        }
        else if (action === 'recent') {
          const r = recentFiles[parseInt(item.dataset.idx)];
          const exists = await window.api.pathExists(r.path);
          if (exists) {
            addFilesToPlaylist([r]);
            playPath(r.path);
          } else {
            recentFiles = recentFiles.filter(x => x.path !== r.path);
            localStorage.setItem('recentFiles', JSON.stringify(recentFiles));
          }
        }
        else if (action === 'clear-recent') {
          recentFiles = [];
          localStorage.setItem('recentFiles', '[]');
        }
        else if (action === 'exit') window.api.windowClose();
      });
    });
  }

  function buildPlaybackMenu(menu) {
    let html = `<div class="menu-item" data-action="playpause">${video.paused ? 'Play' : 'Pause'} <span class="shortcut">Space</span></div>`;
    html += `<div class="menu-item" data-action="stop">Stop</div>`;
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="prev">Previous Track</div>`;
    html += `<div class="menu-item" data-action="next">Next Track</div>`;
    html += `<div class="menu-item ${historyMode ? 'active' : ''}" data-action="histmode">History Mode ${historyMode ? '&#10003;' : ''}</div>`;
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="fullscreen">Fullscreen <span class="shortcut">F</span></div>`;
    menu.innerHTML = html;
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        closeContextMenu();
        if (action === 'playpause') togglePlay();
        else if (action === 'stop') { video.pause(); video.currentTime = 0; updatePlayIcon(); }
        else if (action === 'prev') prevTrack();
        else if (action === 'next') nextTrack();
        else if (action === 'histmode') btnHistory.click();
        else if (action === 'fullscreen') toggleFullscreen();
      });
    });
  }

  function buildSubtitlesMenu(menu) {
    let html = `<div class="menu-item ${activeSubtitleIdx === -1 ? 'active' : ''}" data-action="off">No Subtitles</div>`;
    loadedSubtitles.forEach((s, i) => {
      html += `<div class="menu-item ${i === activeSubtitleIdx ? 'active' : ''}" data-action="select" data-idx="${i}">${escapeHtml(s.name)}</div>`;
    });
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="load">Load Subtitle File...</div>`;
    html += `<div class="menu-item" data-action="download">Download Subtitles...</div>`;
    menu.innerHTML = html;
    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        closeContextMenu();
        if (action === 'off') { activeSubtitleIdx = -1; subtitles = []; subtitleOverlay.innerHTML = ''; updateSubButton(); }
        else if (action === 'select') { activeSubtitleIdx = parseInt(item.dataset.idx); subtitles = loadedSubtitles[activeSubtitleIdx].cues; updateSubButton(); }
        else if (action === 'load') await loadSubtitleFile();
        else if (action === 'download') {
          document.getElementById('subtitle-panel').classList.remove('hidden');
          if (currentFilePath) autoSearchOnlineSubtitles(currentFilePath);
        }
      });
    });
  }

  // ── Title bar ──
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.windowMinimize());
  document.getElementById('btn-maximize').addEventListener('click', () => window.api.windowMaximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.windowClose());

  // ── Drop zone: whole window accepts dropped media files ──
  const MEDIA_EXT_RE = /\.(mp4|webm|mkv|avi|mov|wmv|flv|ogv|m4v|3gp|mp3|wav|ogg|flac|aac|m4a|wma)$/i;
  const SUB_EXT_RE = /\.(srt|vtt|sub|ssa|ass)$/i;

  dropZone.addEventListener('click', openFileDialog);

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) dropZone.classList.remove('drag-over');
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const dropped = Array.from(e.dataTransfer.files)
      .map(f => ({ name: f.name, path: window.api.getPathForFile(f) }))
      .filter(f => f.path);

    // Dropped subtitle file: load it onto the current video
    for (const f of dropped.filter(f => SUB_EXT_RE.test(f.name))) {
      const res = await window.api.readSubtitleFile(f.path);
      if (res.success) {
        const parsed = parseSubtitle(res.content, res.ext);
        if (parsed.length > 0) {
          loadedSubtitles.push({ name: f.name, cues: parsed, path: f.path });
          activeSubtitleIdx = loadedSubtitles.length - 1;
          subtitles = parsed;
          updateSubButton();
        }
      }
    }

    const media = dropped.filter(f => MEDIA_EXT_RE.test(f.name));
    if (media.length > 0) {
      const startAt = playlist.length;
      addFilesToPlaylist(media);
      const firstNew = playlist.findIndex(p => p.path === media[0].path);
      playIndex(firstNew >= 0 ? firstNew : startAt);
    }
  });

  async function openFileDialog() {
    const result = await window.api.openFile();
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const name = await window.api.getFileName(filePath);
      addFilesToPlaylist([{ name: name + getExt(filePath), path: filePath }]);
      playIndex(playlist.length - 1);
    }
  }

  function getExt(p) {
    const m = p.match(/\.[^.]+$/);
    return m ? m[0] : '';
  }

  // ── Playlist ──
  function addFilesToPlaylist(files) {
    files.forEach(f => {
      if (!playlist.find(p => p.path === f.path)) {
        playlist.push(f);
      }
    });
    renderPlaylist();
  }

  function renderPlaylist() {
    const container = document.getElementById('playlist');
    container.innerHTML = playlist.map((item, i) => `
      <div class="playlist-item ${i === currentIndex ? 'active' : ''}" data-index="${i}">
        <svg class="pl-icon" viewBox="0 0 24 24"><polygon fill="currentColor" points="8,5 19,12 8,19"/></svg>
        <span class="pl-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <button class="pl-remove" data-index="${i}" title="Remove">&#x2715;</button>
      </div>
    `).join('');

    container.querySelectorAll('.playlist-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('pl-remove')) return;
        playIndex(parseInt(el.dataset.index));
      });
    });

    container.querySelectorAll('.pl-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        playlist.splice(idx, 1);
        if (idx === currentIndex) {
          if (playlist.length > 0) playIndex(Math.min(idx, playlist.length - 1));
          else resetPlayer();
        } else if (idx < currentIndex) {
          currentIndex--;
        }
        renderPlaylist();
      });
    });
  }

  function playIndex(index) {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    const item = playlist[index];
    currentFilePath = item.path;

    // Track play history (unless we're navigating through it)
    if (!navigatingHistory) {
      playHistory = playHistory.slice(0, histPos + 1);
      if (playHistory[histPos] !== item.path) {
        playHistory.push(item.path);
        histPos = playHistory.length - 1;
      }
    }

    addToRecent(item);
    loadMedia(item.path, item.name);
    renderPlaylist();
  }

  function playPath(path) {
    const idx = playlist.findIndex(p => p.path === path);
    if (idx >= 0) playIndex(idx);
  }

  function nextTrack() {
    if (historyMode && histPos < playHistory.length - 1) {
      histPos++;
      navigatingHistory = true;
      playPath(playHistory[histPos]);
      navigatingHistory = false;
    } else {
      playIndex(currentIndex + 1);
    }
  }

  function prevTrack() {
    if (historyMode && histPos > 0) {
      histPos--;
      navigatingHistory = true;
      playPath(playHistory[histPos]);
      navigatingHistory = false;
    } else {
      playIndex(currentIndex - 1);
    }
  }

  // ── Recent files ──
  function addToRecent(item) {
    recentFiles = recentFiles.filter(r => r.path !== item.path);
    recentFiles.unshift({ name: item.name, path: item.path });
    recentFiles = recentFiles.slice(0, 10);
    localStorage.setItem('recentFiles', JSON.stringify(recentFiles));
  }

  function loadMedia(filePath, name) {
    video.src = `file://${filePath.replace(/\\/g, '/')}`;
    video.classList.add('visible');
    dropZone.classList.add('hidden');
    video.play();
    nowPlaying.textContent = name;
    document.getElementById('title-text').textContent = `SweGBGPlayer - ${name}`;

    subtitles = [];
    subtitleOverlay.innerHTML = '';
    activeSubtitleIdx = -1;
    loadedSubtitles = [];
    updateSubButton();

    autoLoadSubtitle(filePath).then(foundLocal => {
      if (!foundLocal) autoSearchOnlineSubtitles(filePath);
    });
  }

  // Auto-search online: opens the subtitle panel and searches by hash first, then filename
  async function autoSearchOnlineSubtitles(filePath) {
    const name = await window.api.getFileName(filePath);
    document.getElementById('sub-search-input').value = name;
    document.getElementById('subtitle-panel').classList.remove('hidden');
    showSubStatus('Auto-searching subtitles...');
    document.getElementById('sub-results').innerHTML = '';

    const lang = document.getElementById('sub-language').value;
    try {
      const hashResult = await window.api.computeHash(filePath);
      if (!hashResult.error) {
        const result = await window.api.searchSubtitlesOS({
          hash: hashResult.hash,
          fileSize: hashResult.size,
          filename: name,
          language: lang
        });
        if (result.success && result.results.length > 0) {
          showSubStatus(`Found ${result.results.length} subtitle(s) — click one to download & apply`);
          renderSubResults(result.results);
          return;
        }
      }
      // Fall back to name search
      const result2 = await window.api.searchSubtitlesOS({ hash: '', fileSize: 0, filename: name, language: lang });
      if (result2.success && result2.results.length > 0) {
        showSubStatus(`Found ${result2.results.length} subtitle(s) — click one to download & apply`);
        renderSubResults(result2.results);
      } else {
        showSubStatus('No subtitles found online for this file.');
      }
    } catch (e) {
      showSubStatus('Subtitle search failed: ' + e.message);
    }
  }

  async function autoLoadSubtitle(filePath) {
    const dir = await window.api.getFileDir(filePath);
    const baseName = await window.api.getFileName(filePath);
    const exts = ['.srt', '.vtt', '.sub', '.ssa', '.ass'];
    let found = false;
    for (const ext of exts) {
      const subPath = dir + '\\' + baseName + ext;
      const result = await window.api.readSubtitleFile(subPath);
      if (result.success) {
        const parsed = parseSubtitle(result.content, result.ext);
        if (parsed.length > 0) {
          loadedSubtitles.push({ name: baseName + ext, cues: parsed, path: subPath });
          activeSubtitleIdx = loadedSubtitles.length - 1;
          subtitles = parsed;
          updateSubButton();
          found = true;
        }
      }
    }
    return found;
  }

  function resetPlayer() {
    video.pause();
    video.removeAttribute('src');
    video.classList.remove('visible');
    dropZone.classList.remove('hidden');
    currentIndex = -1;
    currentFilePath = null;
    subtitles = [];
    subtitleOverlay.innerHTML = '';
    nowPlaying.textContent = '';
    document.getElementById('title-text').textContent = 'SweGBGPlayer';
    timeDisplay.textContent = '0:00 / 0:00';
    progressPlayed.style.width = '0';
    progressHandle.style.left = '0';
  }

  // ── Playback Controls ──
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-stop').addEventListener('click', () => {
    video.pause();
    video.currentTime = 0;
    updatePlayIcon();
  });
  document.getElementById('btn-prev').addEventListener('click', prevTrack);
  document.getElementById('btn-next').addEventListener('click', nextTrack);

  // History mode toggle
  const btnHistory = document.getElementById('btn-history');
  btnHistory.classList.toggle('active', historyMode);
  btnHistory.addEventListener('click', () => {
    historyMode = !historyMode;
    btnHistory.classList.toggle('active', historyMode);
    localStorage.setItem('historyMode', historyMode ? '1' : '0');
  });

  function togglePlay() {
    if (!video.src) { openFileDialog(); return; }
    if (video.paused) video.play();
    else video.pause();
  }

  video.addEventListener('play', updatePlayIcon);
  video.addEventListener('pause', updatePlayIcon);
  video.addEventListener('ended', () => {
    updatePlayIcon();
    if (currentIndex < playlist.length - 1) playIndex(currentIndex + 1);
  });

  function updatePlayIcon() {
    document.getElementById('icon-play').style.display = video.paused ? '' : 'none';
    document.getElementById('icon-pause').style.display = video.paused ? 'none' : '';
  }

  // ── Progress ──
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    const pct = (video.currentTime / video.duration) * 100;
    progressPlayed.style.width = pct + '%';
    progressHandle.style.left = pct + '%';
    timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    renderSubtitle();
  });

  video.addEventListener('progress', () => {
    if (video.buffered.length > 0) {
      const pct = (video.buffered.end(video.buffered.length - 1) / video.duration) * 100;
      progressBuffered.style.width = pct + '%';
    }
  });

  let seeking = false;
  progressContainer.addEventListener('mousedown', (e) => {
    seeking = true;
    seekTo(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (seeking) seekTo(e);
    showTooltip(e);
  });
  document.addEventListener('mouseup', () => { seeking = false; });

  progressContainer.addEventListener('mousemove', showTooltip);
  progressContainer.addEventListener('mouseleave', () => { progressTooltip.style.display = 'none'; });

  function seekTo(e) {
    if (!video.duration) return;
    const rect = progressContainer.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * video.duration;
  }

  function showTooltip(e) {
    if (!video.duration) return;
    const rect = progressContainer.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right) return;
    const pct = (e.clientX - rect.left) / rect.width;
    progressTooltip.textContent = formatTime(pct * video.duration);
    progressTooltip.style.left = (e.clientX - rect.left) + 'px';
    progressTooltip.style.display = '';
  }

  // ── Volume ──
  volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(volumeSlider.value);
    video.muted = false;
    updateVolumeIcon();
  });

  document.getElementById('btn-volume').addEventListener('click', () => {
    video.muted = !video.muted;
    updateVolumeIcon();
  });

  function updateVolumeIcon() {
    document.getElementById('icon-vol').style.display = video.muted ? 'none' : '';
    document.getElementById('icon-mute').style.display = video.muted ? '' : 'none';
  }

  // ── Speed ──
  speedSelect.addEventListener('change', () => {
    video.playbackRate = parseFloat(speedSelect.value);
  });

  // ── Fullscreen ──
  async function toggleFullscreen() {
    const fs = await window.api.windowFullscreen();
    document.body.classList.toggle('fullscreen', fs);
    if (!fs) {
      document.body.classList.remove('controls-visible', 'hide-cursor');
      clearTimeout(controlsTimeout);
    }
  }
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

  // Double-click video to toggle fullscreen
  video.addEventListener('dblclick', toggleFullscreen);

  // Left-click on video: never pauses — in fullscreen it slides up the control bar
  // (Space is the play/pause key, like modern players)
  video.addEventListener('click', () => {
    if (document.body.classList.contains('fullscreen')) {
      showControlsTemporarily();
    }
  });

  function showControlsTemporarily() {
    document.body.classList.add('controls-visible');
    document.body.classList.remove('hide-cursor');
    clearTimeout(controlsTimeout);
    controlsTimeout = setTimeout(() => {
      // Keep controls visible while hovering over them
      if (!document.getElementById('controls').matches(':hover')) {
        document.body.classList.remove('controls-visible');
        document.body.classList.add('hide-cursor');
      }
    }, 3000);
  }

  // Show controls in fullscreen on mouse move; hide cursor when idle
  document.addEventListener('mousemove', () => {
    if (document.body.classList.contains('fullscreen')) {
      showControlsTemporarily();
    }
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); openFileDialog(); return; }
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowRight': video.currentTime += 5; break;
      case 'ArrowLeft': video.currentTime -= 5; break;
      case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.05); volumeSlider.value = video.volume; break;
      case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.05); volumeSlider.value = video.volume; break;
      case 'f': case 'F': document.getElementById('btn-fullscreen').click(); break;
      case 'm': case 'M': document.getElementById('btn-volume').click(); break;
      case 'Escape':
        window.api.isFullscreen().then(fs => {
          if (fs) document.getElementById('btn-fullscreen').click();
        });
        break;
    }
  });

  // ── Playlist sidebar (visible by default, state remembered) ──
  function toggleSidebar() {
    const hidden = document.getElementById('sidebar').classList.toggle('hidden');
    localStorage.setItem('sidebarHidden', hidden ? '1' : '0');
  }
  if (localStorage.getItem('sidebarHidden') !== '1') {
    document.getElementById('sidebar').classList.remove('hidden');
  }
  document.getElementById('btn-playlist').addEventListener('click', toggleSidebar);
  document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('hidden');
    localStorage.setItem('sidebarHidden', '1');
  });
  document.getElementById('btn-add-files').addEventListener('click', async () => {
    const result = await window.api.openFile();
    if (!result.canceled) {
      for (const fp of result.filePaths) {
        const name = await window.api.getFileName(fp);
        addFilesToPlaylist([{ name: name + getExt(fp), path: fp }]);
      }
    }
  });
  document.getElementById('btn-add-folder').addEventListener('click', async () => {
    const result = await window.api.openFolder();
    if (!result.canceled && result.filePaths.length > 0) {
      const res = await window.api.listMediaFiles(result.filePaths[0]);
      if (res.success) addFilesToPlaylist(res.files);
    }
  });

  // ── Subtitle button (context menu) ──
  document.getElementById('btn-subtitle').addEventListener('click', (e) => {
    e.stopPropagation();
    showSubtitleMenu(e);
  });

  function showSubtitleMenu(e) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'sub-context-menu';

    let html = `<div class="menu-item ${activeSubtitleIdx === -1 ? 'active' : ''}" data-action="off">No Subtitles</div>`;

    loadedSubtitles.forEach((sub, i) => {
      html += `<div class="menu-item ${i === activeSubtitleIdx ? 'active' : ''}" data-action="select" data-idx="${i}">${escapeHtml(sub.name)}</div>`;
    });

    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="load">Load Subtitle File...</div>`;
    html += `<div class="menu-item" data-action="download">Download Subtitles...</div>`;

    menu.innerHTML = html;

    const rect = e.target.closest('button').getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    document.body.appendChild(menu);
    contextMenu = menu;

    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (action === 'off') {
          activeSubtitleIdx = -1;
          subtitles = [];
          subtitleOverlay.innerHTML = '';
          updateSubButton();
        } else if (action === 'select') {
          activeSubtitleIdx = parseInt(item.dataset.idx);
          subtitles = loadedSubtitles[activeSubtitleIdx].cues;
          updateSubButton();
        } else if (action === 'load') {
          await loadSubtitleFile();
        } else if (action === 'download') {
          document.getElementById('subtitle-panel').classList.remove('hidden');
          if (currentFilePath) {
            const name = await window.api.getFileName(currentFilePath);
            document.getElementById('sub-search-input').value = name;
          }
        }
        closeContextMenu();
      });
    });
  }

  document.addEventListener('click', closeContextMenu);

  function closeContextMenu() {
    if (contextMenu) { contextMenu.remove(); contextMenu = null; }
    document.querySelectorAll('.sub-context-menu.submenu').forEach(el => el.remove());
    document.querySelectorAll('.menu-btn.open').forEach(b => b.classList.remove('open'));
  }

  // ── VLC-style right-click menu on video ──
  document.getElementById('video-container').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showVideoContextMenu(e.clientX, e.clientY);
  });

  function showVideoContextMenu(x, y) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'sub-context-menu';

    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const hasVideo = !!video.src;

    let html = '';
    if (hasVideo) {
      html += `<div class="menu-item" data-action="playpause">${video.paused ? '&#9654; Play' : '&#10074;&#10074; Pause'}</div>`;
      html += `<div class="menu-item" data-action="stop">&#9632; Stop</div>`;
      html += `<div class="separator"></div>`;
      html += `<div class="menu-item" data-action="jump-back">&#8630; Jump back 10s</div>`;
      html += `<div class="menu-item" data-action="jump-fwd">&#8631; Jump forward 10s</div>`;
      html += `<div class="separator"></div>`;
    }
    html += `<div class="menu-item has-submenu" data-submenu="subtitles">Subtitles &#9656;</div>`;
    html += `<div class="menu-item has-submenu" data-submenu="speed">Playback Speed &#9656;</div>`;
    html += `<div class="menu-item" data-action="mute">${video.muted ? 'Unmute' : 'Mute'}</div>`;
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="fullscreen">Fullscreen</div>`;
    html += `<div class="menu-item" data-action="playlist">Playlist</div>`;
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="open">Open File...</div>`;

    menu.innerHTML = html;
    document.body.appendChild(menu);

    // Position (avoid overflow)
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
    contextMenu = menu;

    menu.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', async (e2) => {
        e2.stopPropagation();
        const action = item.dataset.action;
        const submenu = item.dataset.submenu;

        if (submenu === 'subtitles') {
          showSubtitleSubmenu(item);
          return;
        }
        if (submenu === 'speed') {
          showSpeedSubmenu(item, speeds);
          return;
        }

        switch (action) {
          case 'playpause': togglePlay(); break;
          case 'stop': video.pause(); video.currentTime = 0; updatePlayIcon(); break;
          case 'jump-back': video.currentTime -= 10; break;
          case 'jump-fwd': video.currentTime += 10; break;
          case 'mute': video.muted = !video.muted; updateVolumeIcon(); break;
          case 'fullscreen': document.getElementById('btn-fullscreen').click(); break;
          case 'playlist': toggleSidebar(); break;
          case 'open': openFileDialog(); break;
        }
        closeContextMenu();
      });
    });
  }

  function showSpeedSubmenu(parentItem, speeds) {
    removeSubmenus();
    const sub = document.createElement('div');
    sub.className = 'sub-context-menu submenu';
    sub.innerHTML = speeds.map(s =>
      `<div class="menu-item ${video.playbackRate === s ? 'active' : ''}" data-speed="${s}">${s}x</div>`
    ).join('');
    positionSubmenu(sub, parentItem);
    sub.querySelectorAll('.menu-item').forEach(it => {
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        video.playbackRate = parseFloat(it.dataset.speed);
        speedSelect.value = it.dataset.speed;
        closeContextMenu();
      });
    });
  }

  function showSubtitleSubmenu(parentItem) {
    removeSubmenus();
    const sub = document.createElement('div');
    sub.className = 'sub-context-menu submenu';

    let html = `<div class="menu-item ${activeSubtitleIdx === -1 ? 'active' : ''}" data-action="off">No Subtitles</div>`;
    loadedSubtitles.forEach((s, i) => {
      html += `<div class="menu-item ${i === activeSubtitleIdx ? 'active' : ''}" data-action="select" data-idx="${i}">${escapeHtml(s.name)}</div>`;
    });
    html += `<div class="separator"></div>`;
    html += `<div class="menu-item" data-action="load">Load Subtitle File...</div>`;
    html += `<div class="menu-item" data-action="download">Download Subtitles...</div>`;
    sub.innerHTML = html;
    positionSubmenu(sub, parentItem);

    sub.querySelectorAll('.menu-item').forEach(it => {
      it.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = it.dataset.action;
        if (action === 'off') {
          activeSubtitleIdx = -1; subtitles = []; subtitleOverlay.innerHTML = ''; updateSubButton();
        } else if (action === 'select') {
          activeSubtitleIdx = parseInt(it.dataset.idx);
          subtitles = loadedSubtitles[activeSubtitleIdx].cues;
          updateSubButton();
        } else if (action === 'load') {
          closeContextMenu();
          await loadSubtitleFile();
          return;
        } else if (action === 'download') {
          document.getElementById('subtitle-panel').classList.remove('hidden');
          if (currentFilePath) autoSearchOnlineSubtitles(currentFilePath);
        }
        closeContextMenu();
      });
    });
  }

  function removeSubmenus() {
    document.querySelectorAll('.sub-context-menu.submenu').forEach(el => el.remove());
  }

  function positionSubmenu(sub, parentItem) {
    document.body.appendChild(sub);
    const rect = parentItem.getBoundingClientRect();
    const sw = sub.offsetWidth, sh = sub.offsetHeight;
    let left = rect.right + 2;
    if (left + sw > window.innerWidth) left = rect.left - sw - 2;
    let top = rect.top;
    if (top + sh > window.innerHeight) top = window.innerHeight - sh - 8;
    sub.style.left = left + 'px';
    sub.style.top = Math.max(4, top) + 'px';
  }

  async function loadSubtitleFile() {
    const result = await window.api.openSubtitle();
    if (!result.canceled && result.filePaths.length > 0) {
      const subPath = result.filePaths[0];
      const res = await window.api.readSubtitleFile(subPath);
      if (res.success) {
        const parsed = parseSubtitle(res.content, res.ext);
        if (parsed.length > 0) {
          const name = await window.api.getFileName(subPath);
          loadedSubtitles.push({ name: name + res.ext, cues: parsed, path: subPath });
          activeSubtitleIdx = loadedSubtitles.length - 1;
          subtitles = parsed;
          updateSubButton();
        }
      }
    }
  }

  function updateSubButton() {
    document.getElementById('btn-subtitle').classList.toggle('has-sub', activeSubtitleIdx >= 0);
  }

  // ── Subtitle rendering ──
  function renderSubtitle() {
    if (subtitles.length === 0) { subtitleOverlay.innerHTML = ''; return; }
    const t = video.currentTime;
    const cue = subtitles.find(c => t >= c.start && t <= c.end);
    if (cue) {
      subtitleOverlay.innerHTML = cue.text.split('\n').map(line => `<div class="sub-line">${escapeHtml(line)}</div>`).join('');
    } else {
      subtitleOverlay.innerHTML = '';
    }
  }

  // ── Subtitle parsing ──
  function parseSubtitle(content, ext) {
    content = content.replace(/^﻿/, '');
    if (ext === '.srt') return parseSRT(content);
    if (ext === '.vtt') return parseVTT(content);
    if (ext === '.ass' || ext === '.ssa') return parseASS(content);
    if (ext === '.sub') return parseSUB(content);
    if (content.includes('-->')) return parseSRT(content);
    return [];
  }

  function parseSRT(text) {
    const cues = [];
    const blocks = text.trim().split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      let timeLineIdx = lines.findIndex(l => l.includes('-->'));
      if (timeLineIdx === -1) continue;
      const timeParts = lines[timeLineIdx].split('-->');
      if (timeParts.length !== 2) continue;
      const start = parseTimestamp(timeParts[0].trim());
      const end = parseTimestamp(timeParts[1].trim());
      if (isNaN(start) || isNaN(end)) continue;
      const text = lines.slice(timeLineIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (text) cues.push({ start, end, text });
    }
    return cues;
  }

  function parseVTT(text) {
    const content = text.replace(/^WEBVTT[^\n]*\n/, '');
    return parseSRT(content);
  }

  function parseASS(text) {
    const cues = [];
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('Dialogue:')) {
        const parts = line.substring(9).split(',');
        if (parts.length >= 10) {
          const start = parseASSTime(parts[1].trim());
          const end = parseASSTime(parts[2].trim());
          const textContent = parts.slice(9).join(',')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n')
            .replace(/\\n/g, '\n')
            .trim();
          if (!isNaN(start) && !isNaN(end) && textContent) {
            cues.push({ start, end, text: textContent });
          }
        }
      }
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  function parseSUB(text) {
    const cues = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const match = line.match(/^\{(\d+)\}\{(\d+)\}(.+)$/);
      if (match) {
        const fps = 25;
        cues.push({
          start: parseInt(match[1]) / fps,
          end: parseInt(match[2]) / fps,
          text: match[3].replace(/\|/g, '\n').trim()
        });
      }
    }
    return cues;
  }

  function parseTimestamp(ts) {
    ts = ts.replace(',', '.').trim();
    const m = ts.match(/(\d+):(\d+):(\d+)[\.,]?(\d*)/);
    if (!m) {
      const m2 = ts.match(/(\d+):(\d+)[\.,]?(\d*)/);
      if (m2) return parseInt(m2[1]) * 60 + parseInt(m2[2]) + (m2[3] ? parseInt(m2[3].padEnd(3, '0')) / 1000 : 0);
      return NaN;
    }
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + (m[4] ? parseInt(m[4].padEnd(3, '0')) / 1000 : 0);
  }

  function parseASSTime(ts) {
    const m = ts.match(/(\d+):(\d+):(\d+)[\.,](\d+)/);
    if (!m) return NaN;
    return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4].padEnd(2, '0')) / 100;
  }

  // ── Subtitle Download Panel ──
  document.getElementById('btn-sub-download').addEventListener('click', () => {
    const panel = document.getElementById('subtitle-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden') && currentFilePath) {
      window.api.getFileName(currentFilePath).then(name => {
        document.getElementById('sub-search-input').value = name;
      });
    }
  });

  document.getElementById('btn-close-sub-panel').addEventListener('click', () => {
    document.getElementById('subtitle-panel').classList.add('hidden');
  });

  document.getElementById('btn-search-subs').addEventListener('click', searchSubsByName);
  document.getElementById('btn-hash-search').addEventListener('click', searchSubsByHash);

  document.getElementById('sub-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchSubsByName();
  });

  async function searchSubsByName() {
    const query = document.getElementById('sub-search-input').value.trim();
    const lang = document.getElementById('sub-language').value;
    if (!query) return;

    showSubStatus('Searching...');
    document.getElementById('sub-results').innerHTML = '';

    try {
      const url = `https://rest.opensubtitles.org/search/query-${encodeURIComponent(query)}/sublanguageid-${lang}`;
      const result = await window.api.searchSubtitlesOS({ hash: '', fileSize: 0, filename: query, language: lang });

      if (result.success && result.results.length > 0) {
        showSubStatus(`Found ${result.results.length} subtitle(s)`);
        renderSubResults(result.results);
      } else {
        showSubStatus('No subtitles found. Try a different search term.');
      }
    } catch (e) {
      showSubStatus('Search failed: ' + e.message);
    }
  }

  async function searchSubsByHash() {
    if (!currentFilePath) {
      showSubStatus('No file loaded');
      return;
    }

    const lang = document.getElementById('sub-language').value;
    showSubStatus('Computing file hash...');
    document.getElementById('sub-results').innerHTML = '';

    try {
      const hashResult = await window.api.computeHash(currentFilePath);
      if (hashResult.error) {
        showSubStatus('Hash failed: ' + hashResult.error);
        return;
      }

      showSubStatus('Searching by hash...');
      const result = await window.api.searchSubtitlesOS({
        hash: hashResult.hash,
        fileSize: hashResult.size,
        filename: '',
        language: lang
      });

      if (result.success && result.results.length > 0) {
        showSubStatus(`Found ${result.results.length} subtitle(s) by hash`);
        renderSubResults(result.results);
      } else {
        showSubStatus('No hash match. Try name search instead.');
      }
    } catch (e) {
      showSubStatus('Search failed: ' + e.message);
    }
  }

  function showSubStatus(msg) {
    document.getElementById('sub-status').textContent = msg;
  }

  function renderSubResults(results) {
    const container = document.getElementById('sub-results');
    container.innerHTML = results.map((r, i) => {
      const name = r.SubFileName || r.MovieReleaseName || 'Unknown';
      const rating = r.SubRating || '0';
      const downloads = r.SubDownloadsCnt || '0';
      const format = r.SubFormat || 'srt';
      return `
        <div class="sub-result-item" data-index="${i}">
          <div class="sub-result-info">
            <div class="sub-result-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
            <div class="sub-result-meta">
              <span class="rating">${parseFloat(rating).toFixed(1)}</span>
              <span>${downloads} downloads</span>
              <span>${format.toUpperCase()}</span>
            </div>
          </div>
          <button class="sub-result-dl" data-url="${escapeHtml(r.SubDownloadLink || '')}" data-name="${escapeHtml(name)}" data-format="${format}">Download</button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.sub-result-dl').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (btn.classList.contains('downloaded')) return;

        const url = btn.dataset.url;
        const subName = btn.dataset.name;
        const format = btn.dataset.format || 'srt';

        btn.textContent = '...';

        try {
          const result = await window.api.downloadSubtitle({ url });
          if (result.success) {
            const ext = '.' + format;
            const parsed = parseSubtitle(result.content, ext);
            if (parsed.length > 0) {
              loadedSubtitles.push({ name: subName, cues: parsed });
              activeSubtitleIdx = loadedSubtitles.length - 1;
              subtitles = parsed;
              updateSubButton();
              btn.textContent = 'Applied';
              btn.classList.add('downloaded');

              // Save into the program's download folder
              let dlName = subName;
              if (!dlName.toLowerCase().endsWith(ext)) dlName += ext;
              const dlRes = await window.api.saveSubtitleDownload({ content: result.content, filename: dlName });
              if (dlRes.success) showSubStatus('Saved to: ' + dlRes.path);

              // Also save next to the video so it auto-loads next time
              if (currentFilePath) {
                const dir = await window.api.getFileDir(currentFilePath);
                const baseName = await window.api.getFileName(currentFilePath);
                await window.api.saveSubtitleFile({
                  content: result.content,
                  dir,
                  filename: baseName + ext
                });
              }
            } else {
              btn.textContent = 'No cues';
            }
          } else {
            btn.textContent = 'Failed';
          }
        } catch (e) {
          btn.textContent = 'Error';
        }

        setTimeout(() => {
          if (!btn.classList.contains('downloaded')) btn.textContent = 'Download';
        }, 3000);
      });
    });
  }

  // ── Music Grabber extension ──
  const grabberPanel = document.getElementById('grabber-panel');
  const grabberUrl = document.getElementById('grabber-url');
  const grabberFormat = document.getElementById('grabber-format');
  const grabberDirLabel = document.getElementById('grabber-dir');
  const grabberJobsEl = document.getElementById('grabber-jobs');
  let grabberDir = localStorage.getItem('grabberDir') || '';
  const grabberActive = new Map(); // jobId -> job element refs

  async function initGrabberDir() {
    if (!grabberDir) grabberDir = await window.api.grabberDefaultDir();
    grabberDirLabel.textContent = grabberDir;
    grabberDirLabel.title = grabberDir;
  }
  initGrabberDir();

  function toggleGrabberPanel() {
    grabberPanel.classList.toggle('hidden');
    if (!grabberPanel.classList.contains('hidden')) grabberUrl.focus();
  }

  document.getElementById('btn-grabber').addEventListener('click', toggleGrabberPanel);

  document.getElementById('btn-close-grabber-panel').addEventListener('click', () => {
    grabberPanel.classList.add('hidden');
  });

  document.getElementById('btn-grabber-choose-dir').addEventListener('click', async () => {
    const result = await window.api.grabberChooseDir();
    if (!result.canceled && result.filePaths.length > 0) {
      grabberDir = result.filePaths[0];
      localStorage.setItem('grabberDir', grabberDir);
      grabberDirLabel.textContent = grabberDir;
      grabberDirLabel.title = grabberDir;
    }
  });

  document.getElementById('btn-grabber-open-dir').addEventListener('click', () => {
    window.api.grabberOpenDir(grabberDir);
  });

  document.getElementById('btn-grabber-download').addEventListener('click', startGrab);
  grabberUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGrab(); });

  function showGrabberStatus(msg) {
    document.getElementById('grabber-status').textContent = msg;
  }

  async function startGrab() {
    const url = grabberUrl.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { showGrabberStatus('Enter a valid http(s) URL.'); return; }

    const available = await window.api.grabberToolsAvailable();
    if (!available) { showGrabberStatus('yt-dlp.exe missing in tools\\bin folder.'); return; }

    const format = grabberFormat.value;
    const res = await window.api.grabberStart({ url, format, outDir: grabberDir });
    if (!res.success) { showGrabberStatus(res.error); return; }

    grabberUrl.value = '';
    showGrabberStatus('');

    const job = document.createElement('div');
    job.className = 'grabber-job';
    job.innerHTML = `
      <div class="grabber-job-info">
        <div class="grabber-job-name" title="${escapeHtml(url)}">${escapeHtml(url)}</div>
        <div class="grabber-job-bar"><div class="grabber-job-fill"></div></div>
        <div class="grabber-job-meta">Starting... (${format.toUpperCase()})</div>
      </div>
      <button class="grabber-job-btn" data-role="action">Cancel</button>
    `;
    grabberJobsEl.prepend(job);

    const refs = {
      el: job,
      fill: job.querySelector('.grabber-job-fill'),
      meta: job.querySelector('.grabber-job-meta'),
      name: job.querySelector('.grabber-job-name'),
      btn: job.querySelector('[data-role=action]')
    };
    refs.btn.addEventListener('click', () => {
      if (refs.done) return;
      window.api.grabberCancel(res.jobId);
      refs.meta.textContent = 'Cancelled';
      refs.btn.remove();
      refs.done = true;
    });
    grabberActive.set(res.jobId, refs);
  }

  window.api.onGrabberProgress(({ jobId, percent, line }) => {
    const refs = grabberActive.get(jobId);
    if (!refs || refs.done) return;
    if (percent !== null) {
      refs.fill.style.width = percent + '%';
      refs.meta.textContent = percent.toFixed(1) + '%';
    } else if (line.startsWith('[ExtractAudio]')) {
      refs.meta.textContent = 'Converting to MP3...';
    } else if (line.startsWith('[Merger]')) {
      refs.meta.textContent = 'Merging video...';
    } else if (line === '[swegbg] updating') {
      refs.fill.style.width = '0%';
      refs.meta.textContent = 'Updating downloader, retrying...';
    }
  });

  window.api.onGrabberDone(async ({ jobId, success, filePath, error }) => {
    const refs = grabberActive.get(jobId);
    if (!refs || refs.done) return;
    refs.done = true;
    if (success && filePath) {
      refs.fill.style.width = '100%';
      refs.el.classList.add('success');
      const name = await window.api.getFileName(filePath);
      const displayName = name + getExt(filePath);
      refs.name.textContent = displayName;
      refs.name.title = filePath;
      refs.meta.textContent = 'Done — added to playlist';
      refs.btn.textContent = 'Play';
      refs.btn.onclick = () => playPath(filePath);
      // Straight into the playlist, visible in the sidebar
      addFilesToPlaylist([{ name: displayName, path: filePath }]);
      document.getElementById('sidebar').classList.remove('hidden');
    } else {
      refs.el.classList.add('failed');
      refs.meta.textContent = 'Failed: ' + (error || 'unknown error');
      refs.btn.remove();
    }
    grabberActive.delete(jobId);
  });

  // ── Helpers ──
  function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
