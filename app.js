/* app.js - Phiên bản cuối: local Info + ảnh pattern + video YouTube */
let games = [];

// Parse front-matter đơn giản
async function fetchGameData(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Không tải được file');
  const text = await res.text();

  let meta = {};
  let body = text;

  if (text.trimStart().startsWith('---')) {
    const endIdx = text.indexOf('\n---', 4);
    if (endIdx !== -1) {
      const yaml = text.slice(4, endIdx);
      body = text.slice(endIdx + 5).trimStart();

      yaml.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) return;
        const key = line.slice(0, colonIdx).trim();
        let val = line.slice(colonIdx + 1).trim();

        // Xử lý mảng: videos, images, ...
        if (val.startsWith('[') && val.endsWith(']')) {
          try { meta[key] = JSON.parse(val); }
          catch { meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')); }
        }
        else if (val === '' || val === '[]') meta[key] = [];
        else if (key === 'imagesStart' || key === 'imagesEnd' || key === 'imagesNumberPadding') {
          meta[key] = parseInt(val) || 1;
        }
        else meta[key] = val;
      });
    }
  }

  // Tạo summary tự động nếu chưa có
  if (!meta.summary && body) {
    const firstLine = body.split('\n')[0].trim();
    meta.summary = firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
  }

  return { meta, body };
}

// Tạo URL ảnh
function buildImageUrl(base, gameName, filename) {
  if (!base) return filename;
  if (/^https?:\/\//i.test(filename)) return filename;
  let url = base.replace(/\/+$/, '');
  if (url.includes('{game}')) url = url.replace(/\{game\}/g, encodeURIComponent(gameName));
  const f = String(filename).replace(/^\/+/, '');
  return `${url}/${f.split('/').map(encodeURIComponent).join('/')}`;
}

// Lấy danh sách ảnh
function getImageList(meta, gameName) {
  if (meta.images && Array.isArray(meta.images) && meta.images.length) {
    return meta.images.map(img => buildImageUrl(meta.imagesRawBaseUrl || meta.baseUrl, gameName, img));
  }

  if (meta.imagesRawBaseUrl && meta.imagesFilenamePattern) {
    const start = meta.imagesStart || 1;
    const end = meta.imagesEnd || 10;
    const pad = meta.imagesNumberPadding || 0;
    const list = [];
    for (let i = start; i <= end; i++) {
      let n = i.toString();
      if (pad > 0) n = n.padStart(pad, '0');
      const fname = meta.imagesFilenamePattern
        .replace(/\{game\}/g, gameName)
        .replace(/\{n\}/g, n);
      list.push(buildImageUrl(meta.imagesRawBaseUrl, gameName, fname));
    }
    return list;
  }
  return [];
}


// Load danh sách game từ Info/index.json
async function loadGameList() {
  const listEl = document.getElementById('gameList');
  const grid = document.getElementById('gameGrid');
  listEl.innerHTML = 'Đang tải...';
  grid.innerHTML = '';

  try {
    const res = await fetch('Info/index.json');
    if (!res.ok) throw new Error('Không tìm thấy Info/index.json');
    const fileList = await res.json();

    games = [];
    listEl.innerHTML = '';

    for (const item of fileList) {
      let name, path;
      if (typeof item === 'string') {
        name = item.replace(/\.txt$/i, '');
        path = `Info/${item}`;
      } else {
        name = item.name || item.replace(/\.txt$/i, '');
        path = item.path || `Info/${name}.txt`;
      }

      const li = document.createElement('li');
      li.textContent = name;
      li.onclick = () => openGame(name, path);
      listEl.appendChild(li);

      games.push({ name, path });
    }

    renderGameGrid();
    checkHashToOpen();
  } catch (err) {
    listEl.innerHTML = `Lỗi: ${err.message}<br>Hãy tạo file <code>Info/index.json</code> chứa danh sách file .txt`;
  }
}

// Render grid + lazy load thumbnail
async function renderGameGrid() {
  const grid = document.getElementById('gameGrid');
  grid.innerHTML = '';

  for (const game of games) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.onclick = () => openGame(game.name, game.path);

    const img = document.createElement('img');
    img.className = 'game-thumb';
    img.loading = 'lazy';
    img.alt = game.name;

    const title = document.createElement('div');
    title.className = 'game-title';
    title.textContent = game.name;

    const summary = document.createElement('div');
    summary.className = 'game-summary';

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(summary);
    grid.appendChild(card);

    // Load thumbnail + summary
    (async () => {
      try {
        const { meta } = await fetchGameData(game.path);
        const images = getImageList(meta, game.name);
        const firstImg = images[0] || 'placeholder.jpg';
        img.src = firstImg;
        summary.textContent = meta.summary || 'Không có mô tả';
        summary.title = meta.summary || '';
      } catch (e) {
        img.src = 'placeholder.jpg';
        summary.textContent = 'Lỗi tải';
      }
    })();
  }
}

// Mở chi tiết game
async function openGame(name, path) {
  hideSidebar();
  document.getElementById('placeholder').style.display = 'none';
  document.getElementById('infoPanel').classList.remove('hidden');
  document.getElementById('gameGridSection').classList.add('hidden');
  document.getElementById('gameTitle').textContent = name;

  try {
    const { meta, body } = await fetchGameData(path);
    document.getElementById('gameText').textContent = body || 'Không có nội dung.';

    const thumbs = document.getElementById('thumbs');
    thumbs.innerHTML = 'Đang tải ảnh...';

    // === ẢNH ===
    const images = getImageList(meta, name);
    thumbs.innerHTML = '';
    if (images.length === 0) {
      thumbs.innerHTML = '<p>Không có ảnh.</p>';
    } else {
      images.forEach((url, idx) => {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'thumb';
        img.loading = 'lazy';
        img.onclick = () => openLightbox(images, idx);
        thumbs.appendChild(img);
      });
    }

    // Deep link
    history.replaceState(null, '', `#game=${encodeURIComponent(name)}`);
    document.getElementById('infoPanel').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    document.getElementById('gameText').textContent = 'Không thể tải nội dung game.';
  }
}

// Lightbox
let lightbox = { urls: [], idx: 0 };
function openLightbox(urls, idx) {
  lightbox = { urls, idx };
  document.getElementById('lightboxImg').src = urls[idx];
  document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() { document.getElementById('lightbox').classList.add('hidden'); }
function prevImage() {
  lightbox.idx = (lightbox.idx - 1 + lightbox.urls.length) % lightbox.urls.length;
  document.getElementById('lightboxImg').src = lightbox.urls[lightbox.idx];
}
function nextImage() {
  lightbox.idx = (lightbox.idx + 1) % lightbox.urls.length;
  document.getElementById('lightboxImg').src = lightbox.urls[lightbox.idx];
}

// Check hash
function checkHashToOpen() {
  const m = location.hash.match(/^#game=(.+)$/);
  if (!m) return;
  const name = decodeURIComponent(m[1]);
  const game = games.find(g => g.name === name);
  if (game) setTimeout(() => openGame(game.name, game.path), 300);
}

function hideSidebar() {
  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('overlay')?.classList.add('hidden');
}

// Events
document.getElementById('backBtn')?.addEventListener('click', () => {
  document.getElementById('infoPanel').classList.add('hidden');
  document.getElementById('gameGridSection').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
  scrollTo({ top: 0, behavior: 'smooth' });
});

document.getElementById('menuBtn')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('overlay').classList.toggle('hidden');
});

document.getElementById('overlay')?.addEventListener('click', hideSidebar);
document.getElementById('closeLightbox')?.addEventListener('click', closeLightbox);
document.getElementById('prevImg')?.addEventListener('click', prevImage);
document.getElementById('nextImg')?.addEventListener('click', nextImage);
document.querySelector('header h1')?.addEventListener('click', () => location.href = location.pathname);

document.addEventListener('keydown', e => {
  if (document.getElementById('lightbox').classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') prevImage();
  if (e.key === 'ArrowRight') nextImage();
  if (e.key === 'Escape') closeLightbox();
});

// Start
loadGameList();