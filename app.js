/*
  app.js - Static frontend that reads game info from a repo's `Info` folder
  and lists images from an external images repo (folders named per game).
  Configuration: see config.example.json and README.md
*/

const cfgPath = 'config.json';
const cfgFallback = 'config.example.json';
let config = null;
let authToken = null;
let games = [];
// cache for thumbnails and summaries to avoid re-fetching
const thumbCache = new Map();

async function loadConfig(){
  try{
    const r = await fetch(cfgPath);
    if(!r.ok) throw new Error('no config');
    config = await r.json();
  }catch(e){
    const r2 = await fetch(cfgFallback);
    config = await r2.json();
  }
}

function apiHeaders(){
  const h = { 'Accept': 'application/vnd.github.v3+json' };
  if(authToken) h['Authorization'] = `token ${authToken}`;
  return h;
}

// Helpers to build safe URLs: encode each path segment and avoid double-appending the game folder
function encodePath(p){
  return p.split('/').map(s=>encodeURIComponent(s)).join('/');
}

function buildImageUrl(base, gameName, filename){
  // If filename is already an absolute URL, return as-is
  if(typeof filename === 'string' && /^https?:\/\//i.test(filename)) return filename;
  if(!base) return `/${encodePath(String(filename))}`;
  // Replace {game} token if present
  let resolvedBase = String(base);
  if(resolvedBase.includes('{game}')){
    resolvedBase = resolvedBase.replace(/\{game\}/g, encodeURIComponent(gameName));
  }
  // normalize slashes
  resolvedBase = resolvedBase.replace(/\/+$/,'');
  // normalize filename and encode each segment
  let f = String(filename || '').replace(/^\/+/, '');
  const parts = f.split('/').filter(Boolean).map(s=>encodeURIComponent(s));
  const url = `${resolvedBase}/${parts.join('/')}`;
  // debug helper (only logs in console; harmless in production)
  try{ if(window && window.console) console.debug('buildImageUrl ->', { base: resolvedBase, gameName, filename: f, url }); }catch(e){}
  return url;
}

async function fetchContents(owner, repo, path, branch){
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: apiHeaders() });
  if(res.status===404) return null;
  if(!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function fetchRaw(url){
  const res = await fetch(url, { headers: apiHeaders() });
  if(!res.ok) throw new Error('Failed to fetch raw');
  return res.text();
}

function setRepoInfoLine(){
  const el = document.getElementById('repoInfo');
  if(!el) return;
  if(config && config.localInfo){
    el.textContent = `${config.infoBasePath || 'Info'} (local)`;
  }else if(config && config.siteRepoOwner && config.siteRepoName){
    el.textContent = `${config.siteRepoOwner}/${config.siteRepoName}`;
  }else{
    el.textContent = '';
  }
}

async function loadGameList(){
  const listEl = document.getElementById('gameList');
  listEl.innerHTML = 'Đang tải...';
  // reset collected games for grid rendering
  games = [];

  // Local Info mode: the site serves an index JSON listing files/names.
  if(config && config.localInfo){
    try{
      const idxPath = config.infoIndexPath || `${config.infoBasePath || 'Info'}/index.json`;
      const r = await fetch(idxPath);
      if(!r.ok) throw new Error('index not found');
      const list = await r.json();
      if(!Array.isArray(list) || list.length===0){ listEl.innerHTML = 'Info index rỗng'; return; }
      listEl.innerHTML = '';
      list.sort((a,b)=>{
        const na = (typeof a==='string'? a : a.name);
        const nb = (typeof b==='string'? b : b.name);
        return na.localeCompare(nb, undefined, {sensitivity:'base'});
      });
      list.forEach(item=>{
        const name = (typeof item==='string'? (item.replace(/\.txt$/i,'').replace(/\/+$/,'').replace(/^\/+/,'')) : item.name);
        const li = document.createElement('li');
        li.textContent = name;
        // Build local text URL: if item already a file path, use it; else use basePath/name.txt
        let txtUrl;
        if(typeof item==='string' && item.toLowerCase().endsWith('.txt')){
          txtUrl = `${config.infoBasePath || 'Info'}/${item}`;
        }else if(typeof item==='object' && item.path){
          txtUrl = item.path;
        }else{
          txtUrl = `${config.infoBasePath || 'Info'}/${encodeURIComponent(name)}.txt`;
        }
        li.onclick = ()=>openGame(name, txtUrl);
        listEl.appendChild(li);
        // collect games for grid (localInfo)
        games.push({ name, txtUrl });
      });
      // render game grid (thumbnails)
      renderGameGrid(games);
      // if URL contains a game hash, open it after rendering
      try{ checkHashToOpen(); }catch(e){}
      return;
    }catch(err){
      listEl.innerHTML = 'Không tìm thấy `Info` index. Tạo file JSON tại `'+(config.infoIndexPath|| (config.infoBasePath+'/index.json'))+'`.';
      return;
    }
  }

  // Default: fetch using GitHub API from configured site repo
  const items = await fetchContents(config.siteRepoOwner, config.siteRepoName, 'Info', config.siteBranch);
  if(!items){ listEl.innerHTML = 'Không tìm thấy thư mục Info'; return; }
  const txtFiles = items.filter(i=>i.type==='file' && i.name.toLowerCase().endsWith('.txt'));
  if(txtFiles.length===0){ listEl.innerHTML = 'Không có file .txt trong Info'; return; }
  listEl.innerHTML = '';
  txtFiles.sort((a,b)=>a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
  txtFiles.forEach(file=>{
    const li = document.createElement('li');
    const name = file.name.replace(/\.txt$/i,'');
    li.textContent = name;
    li.onclick = ()=>openGame(name, file.download_url);
    listEl.appendChild(li);
    // collect games for grid
    games.push({ name, txtUrl: file.download_url });
  });
  // render game grid (thumbnails)
  renderGameGrid(games);
  try{ checkHashToOpen(); }catch(e){}
}

async function openGame(name, txtUrl){
  // Switch to single-game view: hide grid and show info panel
  const gridSection = document.getElementById('gameGridSection');
  if(gridSection) gridSection.classList.add('hidden');
  document.getElementById('placeholder').style.display='none';
  document.getElementById('infoPanel').classList.remove('hidden');
  document.getElementById('gameTitle').textContent = name;
  try{
    let text;
    if(config && config.localInfo){
      const r = await fetch(txtUrl);
      if(!r.ok) throw new Error('Không thể tải nội dung local');
      text = await r.text();
    }else{
      text = await fetchRaw(txtUrl);
    }
    // parse optional front-matter metadata
    const { meta, body } = parseMetaFromText(text);
    document.getElementById('gameText').textContent = body;
    await loadGallery(name, meta);
    // update URL so this game can be linked and reopened directly
    try{ location.hash = 'game=' + encodeURIComponent(name); }catch(e){}
    // smooth-scroll the info panel into view so user doesn't have to scroll manually
    try{ document.getElementById('infoPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }catch(e){}
  }catch(e){ document.getElementById('gameText').textContent = 'Không thể tải nội dung.' }
}

// Parse a simple YAML-like front-matter block delimited by '---' at the start
function parseMetaFromText(txt){
  if(!txt || !txt.startsWith('---')) return { meta: null, body: txt };
  const endMarker = '\n---';
  const endIdx = txt.indexOf(endMarker, 3);
  if(endIdx === -1) return { meta: null, body: txt };
  const block = txt.slice(3, endIdx + 1).trim();
  const body = txt.slice(endIdx + endMarker.length).trim();
  const lines = block.split(/\r?\n/).map(l=>l.replace(/\r/g,'')).filter(Boolean);
  const meta = {};
  let currentKey = null;
  for(const line of lines){
    if(line.startsWith('-') && currentKey){
      const v = line.slice(1).trim();
      if(!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(v);
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if(m){
      const key = m[1];
      let val = m[2] || '';
      if(val.startsWith('[') && val.endsWith(']')){
        try{ meta[key] = JSON.parse(val); }catch(e){ meta[key] = val; }
      }else if(val === ''){
        meta[key] = meta[key] || [];
      }else{
        meta[key] = isNumeric(val) ? Number(val) : val;
      }
      currentKey = key;
    }
  }
  return { meta, body };
}

function isNumeric(v){ return !isNaN(v) && v !== '' && v !== null; }

// Convert various YouTube URL formats (watch?v=..., youtu.be/...) or raw id
function youtubeEmbedUrl(u){
  if(!u) return null;
  // already embed
  const mEmbed = u.match(/^https?:\/\/(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_\-]+)/);
  if(mEmbed) return u;
  // youtu.be short link
  let m = u.match(/youtu\.be\/([A-Za-z0-9_\-]+)/);
  if(m) return 'https://www.youtube.com/embed/' + m[1];
  // watch?v= or &v=
  m = u.match(/[?&]v=([A-Za-z0-9_\-]+)/);
  if(m) return 'https://www.youtube.com/embed/' + m[1];
  // just an id
  if(/^[A-Za-z0-9_\-]{6,}$/.test(u)) return 'https://www.youtube.com/embed/' + u;
  return null;
}

async function loadGallery(gameName, meta){
  const thumbs = document.getElementById('thumbs');
  thumbs.innerHTML = 'Đang tải ảnh...';
  const videoContainer = document.getElementById('videoContainer');
  if(videoContainer) videoContainer.innerHTML = '';

  // render videos (YouTube) if provided in front-matter (videos:, video:, youtube:)
  try{
    const vids = [];
    if(meta){
      if(meta.videos) vids.push(...(Array.isArray(meta.videos)? meta.videos : [meta.videos]));
      else if(meta.video) vids.push(...(Array.isArray(meta.video)? meta.video : [meta.video]));
      else if(meta.youtube) vids.push(...(Array.isArray(meta.youtube)? meta.youtube : [meta.youtube]));
    }
    if(vids.length && videoContainer){
      vids.forEach(v => {
        const s = String(v||'').trim();
        const embed = youtubeEmbedUrl(s);
        if(!embed) return;
        const wrap = document.createElement('div'); wrap.className = 'video-wrap';
        const ifr = document.createElement('iframe');
        ifr.src = embed + '?rel=0';
        ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        ifr.allowFullscreen = true; ifr.loading = 'lazy';
        wrap.appendChild(ifr);
        videoContainer.appendChild(wrap);
      });
    }
  }catch(e){}

  // Priority: per-file meta -> global config -> GitHub API fallback

  // If meta provides explicit images array
  if(meta && meta.images && Array.isArray(meta.images) && meta.images.length>0){
    const list = meta.images.map(x => {
      if(/^https?:\/\//i.test(x)) return x;
      const base = meta.imagesRawBaseUrl || config.imagesRawBaseUrl || '';
      if(base) return buildImageUrl(base, gameName, x);
      return x;
    });
    thumbs.innerHTML = '';
    list.forEach((u, idx)=>{ const im=document.createElement('img'); im.src=u; im.className='thumb'; im.loading='lazy'; im.onclick=()=>openLightbox(list, idx); thumbs.appendChild(im); });
    return;
  }

  // If meta provides raw base + pattern
  if(meta && meta.imagesRawBaseUrl && meta.imagesFilenamePattern){
    const start = Number(meta.imagesStart || meta.start || config.imagesStart || 1);
    const end = Number(meta.imagesEnd || meta.end || config.imagesEnd || 10);
    const pad = Number(meta.imagesNumberPadding || meta.numberPadding || config.imagesNumberPadding || 0);
    const urls = [];
    for(let i=start;i<=end;i++){ let n=String(i); if(pad>0) n=n.padStart(pad,'0'); let fname = meta.imagesFilenamePattern.replace(/\{game\}/g, gameName).replace(/\{n\}/g,n); urls.push(buildImageUrl(meta.imagesRawBaseUrl, gameName, fname)); }
    thumbs.innerHTML = '';
    urls.forEach((u, idx)=>{ const im=document.createElement('img'); im.src=u; im.className='thumb'; im.loading='lazy'; im.onclick=()=>openLightbox(urls, idx); thumbs.appendChild(im); });
    return;
  }

  // Mode 1: imagesIndexUrl (meta overrides config)
  const indexUrl = (meta && meta.imagesIndexUrl) ? meta.imagesIndexUrl : (config && config.imagesIndexUrl);
  if(true){
    try{
      const r = await fetch(indexUrl, { headers: apiHeaders() });
      if(!r.ok) throw new Error('Không thể tải index ảnh');
      const index = await r.json();
      const list = index[gameName] || index[encodeURIComponent(gameName)] || index[gameName.replace(/%20/g,' ')];
      if(!Array.isArray(list) || list.length===0){ thumbs.innerHTML = 'Không có ảnh trong index cho game này.'; return; }
      const urls = list.map(x => {
        if(typeof x !== 'string') return null;
        if(/^https?:\/\//i.test(x)) return x;
        const base = (meta && meta.imagesRawBaseUrl) ? meta.imagesRawBaseUrl : config.imagesRawBaseUrl;
        if(base) return buildImageUrl(base, gameName, x);
        return x;
      }).filter(Boolean);
      thumbs.innerHTML = '';
      urls.forEach((u, idx)=>{ const im=document.createElement('img'); im.src=u; im.className='thumb'; im.loading='lazy'; im.onclick=()=>openLightbox(urls, idx); thumbs.appendChild(im); });
      return;
    }catch(err){ thumbs.innerHTML = 'Không thể tải index ảnh.'; return; }
  }

  // // Mode 2: global raw base + pattern
  // if(config && config.imagesRawBaseUrl && config.imagesFilenamePattern){
  //   const start = Number(config.imagesStart || 1);
  //   const end = Number(config.imagesEnd || 10);
  //   const pad = Number(config.imagesNumberPadding || 0);
  //   const urls = [];
  //   for(let i=start;i<=end;i++){ let n=String(i); if(pad>0) n=n.padStart(pad,'0'); let fname = config.imagesFilenamePattern.replace(/\{game\}/g, gameName).replace(/\{n\}/g,n); urls.push(buildImageUrl(config.imagesRawBaseUrl, gameName, fname)); }
  //   thumbs.innerHTML = '';
  //   urls.forEach((u, idx)=>{ const im=document.createElement('img'); im.src=u; im.className='thumb'; im.loading='lazy'; im.onclick=()=>openLightbox(urls, idx); thumbs.appendChild(im); });
  //   return;
  // }

  // // Mode 3: fallback to GitHub API listing (original behavior)
  // const path = `${config.imagesFolderPrefix || ''}/${gameName}`.replace(/^\/+/, '');
  // const items = await fetchContents(config.imagesRepoOwner, config.imagesRepoName, path, config.imagesRepoBranch);
  // if(!items){ thumbs.innerHTML = 'Không tìm thấy thư mục ảnh cho game này.'; return; }
  // const images = items.filter(i=>i.type==='file' && /\.(png|jpe?g|gif|webp|bmp)$/i.test(i.name));
  // if(images.length===0){ thumbs.innerHTML = 'Không có ảnh trong thư mục này.'; return; }
  // thumbs.innerHTML = '';
  // const urls = images.map(i=>i.download_url);
  // images.forEach((img, idx)=>{ const im=document.createElement('img'); im.src = img.download_url; im.className='thumb'; im.loading='lazy'; im.onclick = ()=>openLightbox(urls, idx); thumbs.appendChild(im); });
}

// Resolve a single thumbnail URL for a game (first available image)
async function getThumbnailForGame(gameName, txtUrl){
  try{
    // Try per-file meta first, also extract a short summary to show under thumbnail
    let text;
    if(config && config.localInfo){
      const r = await fetch(txtUrl);
      if(!r.ok) throw new Error('no txt');
      text = await r.text();
    }else{
      text = await fetchRaw(txtUrl);
    }
    const { meta, body } = parseMetaFromText(text);
    let summary = null;
    if(meta && meta.summary){
      if(Array.isArray(meta.summary)) summary = meta.summary.join(' ');
      else summary = String(meta.summary);
    }else if(body){
      const firstLine = (body||'').split(/\r?\n/)[0] || '';
      summary = firstLine.trim();
    }
    if(meta){
      if(meta.images && Array.isArray(meta.images) && meta.images.length>0){
        const x = meta.images[0];
        if(/^https?:\/\//i.test(x)) return { url: x, summary };
        const base = meta.imagesRawBaseUrl || config.imagesRawBaseUrl || '';
        if(base) return { url: buildImageUrl(base, gameName, x), summary };
        return { url: x, summary };
      }
      if(meta.imagesRawBaseUrl && meta.imagesFilenamePattern){
        const pad = Number(meta.imagesNumberPadding || meta.numberPadding || config.imagesNumberPadding || 0);
        const n = (pad>0) ? String(meta.imagesStart||1).padStart(pad,'0') : String(meta.imagesStart||1);
        const fname = meta.imagesFilenamePattern.replace(/\{game\}/g, gameName).replace(/\{n\}/g, n);
        return { url: buildImageUrl(meta.imagesRawBaseUrl, gameName, fname), summary };
      }
      if(meta.imagesIndexUrl){
        const r = await fetch(meta.imagesIndexUrl, { headers: apiHeaders() });
        if(r.ok){ const idx = await r.json(); const lst = idx[gameName] || idx[encodeURIComponent(gameName)] || idx[gameName.replace(/%20/g,' ')]; if(Array.isArray(lst) && lst.length) return { url: (/^https?:\/\//i.test(lst[0]) ? lst[0] : (meta.imagesRawBaseUrl? buildImageUrl(meta.imagesRawBaseUrl, gameName, lst[0]) : lst[0])), summary }; }
      }
    }

    // global images index
    if(config && config.imagesIndexUrl){
      try{
        const r2 = await fetch(config.imagesIndexUrl, { headers: apiHeaders() });
        if(r2.ok){ const idx2 = await r2.json(); const lst2 = idx2[gameName] || idx2[encodeURIComponent(gameName)] || idx2[gameName.replace(/%20/g,' ')]; if(Array.isArray(lst2) && lst2.length) return { url: (/^https?:\/\//i.test(lst2[0]) ? lst2[0] : (config.imagesRawBaseUrl? buildImageUrl(config.imagesRawBaseUrl, gameName, lst2[0]) : lst2[0])), summary }; }
      }catch(e){}
    }

    // global pattern
    if(config && config.imagesRawBaseUrl && config.imagesFilenamePattern){
      const pad = Number(config.imagesNumberPadding || 0);
      const n = (pad>0) ? String(config.imagesStart||1).padStart(pad,'0') : String(config.imagesStart||1);
      const fname = config.imagesFilenamePattern.replace(/\{game\}/g, gameName).replace(/\{n\}/g, n);
      return { url: buildImageUrl(config.imagesRawBaseUrl, gameName, fname), summary };
    }

    // fallback to GitHub API listing in images repo
    try{
      const path = `${config.imagesFolderPrefix || ''}/${gameName}`.replace(/^\/+/, '');
      const items = await fetchContents(config.imagesRepoOwner, config.imagesRepoName, path, config.imagesRepoBranch);
      if(items && Array.isArray(items)){
        const images = items.filter(i=>i.type==='file' && /\.(png|jpe?g|gif|webp|bmp)$/i.test(i.name));
        if(images.length) return { url: images[0].download_url, summary };
      }
    }catch(e){}
    return { url: null, summary };
  }catch(e){
    return { url: null, summary: null };
  }
}

// Render the game grid on main area; fetch thumbnails asynchronously
async function renderGameGrid(gamesList){
  const grid = document.getElementById('gameGrid');
  if(!grid) return;
  grid.innerHTML = '';
  // create cards with placeholders. Thumbnails and summaries will be loaded
  // lazily when the card enters viewport (IntersectionObserver).
  const observer = ('IntersectionObserver' in window) ? new IntersectionObserver((entries, obs)=>{
    entries.forEach(en => {
      if(!en.isIntersecting) return;
      const card = en.target;
      obs.unobserve(card);
      const name = card.dataset.name;
      const txtUrl = card.dataset.txturl;
      loadCardData({ name, txtUrl }, card);
    });
  }, { root: null, rootMargin: '200px', threshold: 0.1 }) : null;

  gamesList.forEach(g=>{
    const card = document.createElement('div'); card.className = 'game-card';
    card.dataset.name = g.name;
    card.dataset.txturl = g.txtUrl;
    const img = document.createElement('img'); img.className = 'game-thumb'; img.alt = g.name; img.src = '';
    const title = document.createElement('div'); title.className = 'game-title'; title.textContent = g.name;
    const summ = document.createElement('div'); summ.className = 'game-summary'; summ.textContent = '';
    card.appendChild(img); card.appendChild(title); card.appendChild(summ);
    card.onclick = ()=> openGame(g.name, g.txtUrl);
    grid.appendChild(card);
    if(observer) observer.observe(card); else loadCardData(g, card); // fallback: load immediately
  });
}

// Load thumbnail and summary for a single card (used by IntersectionObserver)
async function loadCardData(g, card){
  try{
    if(thumbCache.has(g.name)){
      const cached = thumbCache.get(g.name);
      applyThumbToCard(cached, card);
      return;
    }
    const imgEl = card.querySelector('.game-thumb');
    const sumEl = card.querySelector('.game-summary');
    // show subtle loading background
    imgEl.style.background = 'linear-gradient(90deg, #071024 0%, #0b1220 50%, #071024 100%)';
    const thumb = await getThumbnailForGame(g.name, g.txtUrl);
    thumbCache.set(g.name, thumb);
    applyThumbToCard(thumb, card);
  }catch(e){
    // keep placeholder look
  }
}

function applyThumbToCard(thumb, card){
  const imgEl = card.querySelector('.game-thumb');
  const sumEl = card.querySelector('.game-summary');
  if(thumb && thumb.url) { imgEl.src = thumb.url; imgEl.style.background = ''; }
  else { imgEl.style.background = '#071024'; }
  if(thumb && thumb.summary){ sumEl.textContent = thumb.summary; sumEl.title = thumb.summary; }
}

// If the URL contains a hash like #game=NAME, open that game (used for deep-linking)
function checkHashToOpen(){
  if(!location.hash) return;
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^game=(.*)$/);
  if(!m) return;
  const name = decodeURIComponent(m[1]);
  const entry = games.find(g=>g.name === name);
  if(entry){
    // delay slightly to allow grid to finish rendering
    setTimeout(()=>{ openGame(entry.name, entry.txtUrl); }, 150);
  }
}

let currentLightbox = { urls: [], idx: 0 };
function openLightbox(urls, idx){
  currentLightbox.urls = urls; currentLightbox.idx = idx;
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src = urls[idx];
  lb.classList.remove('hidden');
}
function closeLightbox(){ document.getElementById('lightbox').classList.add('hidden'); }
function prevImage(){
  if(!currentLightbox.urls.length) return;
  currentLightbox.idx = (currentLightbox.idx-1 + currentLightbox.urls.length) % currentLightbox.urls.length;
  document.getElementById('lightboxImg').src = currentLightbox.urls[currentLightbox.idx];
}
function nextImage(){
  if(!currentLightbox.urls.length) return;
  currentLightbox.idx = (currentLightbox.idx+1) % currentLightbox.urls.length;
  document.getElementById('lightboxImg').src = currentLightbox.urls[currentLightbox.idx];
}

function wireUI(){
  const menuBtn = document.getElementById('menuBtn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  function openSidebar(){ sidebar.classList.add('mobile-open'); overlay.classList.remove('hidden'); }
  function closeSidebar(){ sidebar.classList.remove('mobile-open'); overlay.classList.add('hidden'); }
  if(menuBtn){ menuBtn.onclick = ()=>{ if(sidebar.classList.contains('mobile-open')) closeSidebar(); else openSidebar(); } }
  // Make header title clickable to return to the main grid (home)
  const headerTitle = document.querySelector('header h1');
  if(headerTitle){
    headerTitle.style.cursor = 'pointer';
    headerTitle.onclick = ()=>{
      // hide info panel, show grid
      const info = document.getElementById('infoPanel'); if(info) info.classList.add('hidden');
      const grid = document.getElementById('gameGridSection'); if(grid) grid.classList.remove('hidden');
      // remove hash and scroll to top
      try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
      try{ window.scrollTo({ top: 0, behavior: 'smooth' }); }catch(e){}
    };
  }
  if(overlay) overlay.onclick = ()=> closeSidebar();
  document.getElementById('backBtn').onclick = ()=>{
    // Return from single-game view to the grid
    document.getElementById('infoPanel').classList.add('hidden');
    const grid = document.getElementById('gameGridSection'); if(grid) grid.classList.remove('hidden');
    // Keep placeholder hidden (grid is visible). Clear URL hash.
    try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
    try{ window.scrollTo({ top: 0, behavior: 'smooth' }); }catch(e){}
  };
  document.getElementById('closeLightbox').onclick = ()=>closeLightbox();
  document.getElementById('prevImg').onclick = ()=>prevImage();
  document.getElementById('nextImg').onclick = ()=>nextImage();
  document.addEventListener('keydown', e=>{
    if(document.getElementById('lightbox').classList.contains('hidden')) return;
    if(e.key==='ArrowLeft') prevImage();
    if(e.key==='ArrowRight') nextImage();
    if(e.key==='Escape') closeLightbox();
  });
  document.getElementById('applyToken').onclick = ()=>{
    authToken = document.getElementById('tokenInput').value.trim() || null; loadGameList();
  }
}

// Hide sidebar on mobile automatically when a game is opened
const originalOpenGame = openGame;
openGame = async function(name, txtUrl){
  const sidebar = document.getElementById('sidebar');
  if(sidebar && sidebar.classList.contains('mobile-open')){
    sidebar.classList.remove('mobile-open');
    const overlay = document.getElementById('overlay'); if(overlay) overlay.classList.add('hidden');
  }
  return await originalOpenGame(name, txtUrl);
}

async function init(){
  wireUI();
  await loadConfig();
  setRepoInfoLine();
  await loadGameList();
}

init().catch(e=>{
  console.error(e);
  const listEl = document.getElementById('gameList');
  if(listEl) listEl.innerHTML = 'Lỗi: '+e.message;
});
