# SweGBGPlayer

Media player (Electron) with automatic subtitle download and a built-in **Music Grabber** extension (yt-dlp based downloads straight into the playlist).

## Features
- Plays MP4, WebM, MKV, AVI, MOV, MP3, WAV, OGG, FLAC and more
- Playlist sidebar with add files / add folders
- Subtitle downloader (OpenSubtitles) with hash search, auto-load and auto-save
- **Extensions → Music Grabber**: paste a URL, choose MP3 or MP4, download with progress bar — finished files are added to the playlist automatically
- VLC-style right-click menu, fullscreen controls, playback speed, play history mode

## Setup

```
npm install
```

The Music Grabber extension needs two binaries that are **not** in the repo (too large for GitHub):

- [yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases) → `tools/bin/yt-dlp.exe`
- [ffmpeg.exe](https://www.gyan.dev/ffmpeg/builds/) → `tools/bin/ffmpeg.exe`

## Run / Build

```
npm start      # dev mode
npm run dist   # portable exe + installer in release/
```

Author: SweGBG
