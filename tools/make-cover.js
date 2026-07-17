// Renders release/cover-itch.png (630x500) for the itch.io page.
// Run: npx electron tools/make-cover.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 630, H = 500;

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${W}px; height:${H}px; overflow:hidden;
    font-family:'Segoe UI', sans-serif; color:#eee;
    background:
      radial-gradient(ellipse 500px 380px at 82% 18%, rgba(233,69,96,0.22), transparent 65%),
      radial-gradient(ellipse 420px 320px at 12% 88%, rgba(80,80,180,0.25), transparent 65%),
      linear-gradient(160deg, #23234a 0%, #16213e 45%, #0f0f1a 100%);
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:26px;
  }
  .logo { position:relative; width:150px; height:150px; }
  .circle {
    position:absolute; inset:0; border-radius:50%;
    background:linear-gradient(180deg, #e94560, #c93550);
    box-shadow:0 12px 44px rgba(233,69,96,0.5);
    display:flex; align-items:center; justify-content:center;
  }
  .tri {
    width:0; height:0; margin-left:14px;
    border-top:38px solid transparent; border-bottom:38px solid transparent;
    border-left:62px solid #fff;
  }
  .wave { position:absolute; top:50%; left:50%; border:6px solid rgba(255,200,210,0.85); border-radius:50%;
    border-left-color:transparent; border-top-color:transparent; border-bottom-color:transparent; }
  .w1 { width:190px; height:190px; transform:translate(-50%,-50%) rotate(0deg); }
  .w2 { width:230px; height:230px; transform:translate(-50%,-50%) rotate(0deg); border-width:5px; opacity:0.6; }
  h1 { font-size:52px; font-weight:700; letter-spacing:1px; }
  h1 .swe { color:#e94560; }
  .tag { font-size:19px; color:#bbb; text-align:center; line-height:1.5; }
  .chips { display:flex; gap:10px; }
  .chip {
    font-size:13px; padding:6px 14px; border-radius:20px;
    background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#ddd;
  }
  .chip.hot { background:rgba(233,69,96,0.18); border-color:rgba(233,69,96,0.5); color:#ff9aab; }
</style></head><body>
  <div class="logo">
    <div class="wave w2"></div>
    <div class="wave w1"></div>
    <div class="circle"><div class="tri"></div></div>
  </div>
  <h1><span class="swe">SweGBG</span>Player</h1>
  <div class="tag">Media player with built-in music downloader<br>and automatic subtitles</div>
  <div class="chips">
    <span class="chip hot">&#9835; Music Grabber</span>
    <span class="chip">MP3 / MP4</span>
    <span class="chip">Subtitles</span>
    <span class="chip">Playlists</span>
  </div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: false, frame: false,
    webPreferences: { offscreen: true }
  });
  win.setContentSize(W, H);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'release', 'cover-itch.png');
  fs.writeFileSync(out, img.toPNG());
  console.log('Wrote ' + out + ' (' + img.getSize().width + 'x' + img.getSize().height + ')');
  app.quit();
});
