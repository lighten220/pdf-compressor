// 壓縮等級：dpi = 影像降採樣解析度，qfactor = JPEG 量化（越大越小越糊）
const LEVELS = [
  { key: 'extreme', name: '極限壓縮', desc: '檔案最小，影像較模糊', dpi: 50, qfactor: 1.6, preset: '/screen' },
  { key: 'strong', name: '高度壓縮', desc: '適合螢幕閱讀、寄信', dpi: 72, qfactor: 0.9, preset: '/screen' },
  { key: 'recommended', name: '推薦', desc: '大小與品質平衡', dpi: 150, qfactor: 0.5, preset: '/ebook' },
  { key: 'light', name: '輕度壓縮', desc: '高品質，可列印', dpi: 220, qfactor: 0.2, preset: '/printer' },
  { key: 'custom', name: '自訂', desc: '自己調整解析度與品質' },
];
// 指定目標大小時，依序嘗試的設定（高品質 → 最小）
const TARGET_STEPS = [
  LEVELS[3], LEVELS[2], LEVELS[1], LEVELS[0],
  { key: 'ultra', dpi: 36, qfactor: 2.4, preset: '/screen' },
];

const $ = (id) => document.getElementById(id);
const state = { mode: 'level', level: 'recommended', items: [], running: false };

// ---------- Worker ----------
const worker = new Worker('worker.js');
const pending = new Map();
let jobSeq = 0;
let engineReady = false;

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'engine-progress') {
    showEngine(`正在載入壓縮引擎… ${Math.min(99, Math.round((m.loaded / m.total) * 100))}%（僅首次需要）`);
  } else if (m.type === 'engine-ready') {
    engineReady = true;
    $('engine').hidden = true;
  } else if (m.type === 'engine-error') {
    showEngine('壓縮引擎載入失敗：' + m.message + '，請重新整理頁面再試。');
  } else {
    const job = pending.get(m.id);
    if (!job) return;
    if (m.type === 'progress') job.onProgress?.(m.page, m.total);
    else if (m.type === 'done') { pending.delete(m.id); job.resolve(new Uint8Array(m.output)); }
    else if (m.type === 'error') { pending.delete(m.id); job.reject(new Error(m.message)); }
  }
};
worker.postMessage({ type: 'preload' });

function showEngine(text) {
  if (engineReady) return;
  $('engine').textContent = text;
  $('engine').hidden = false;
}

function runGs(bytes, settings, onProgress) {
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    // 複製一份送出，原始資料保留給「指定大小」模式重試
    const copy = bytes.slice().buffer;
    worker.postMessage({ type: 'compress', id, input: copy, settings }, [copy]);
  });
}

// ---------- 設定介面 ----------
function renderLevels() {
  $('levels').innerHTML = '';
  for (const lv of LEVELS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'level' + (lv.key === state.level ? ' active' : '');
    b.innerHTML = `<b>${lv.name}</b><span>${lv.desc}</span>`;
    b.onclick = () => { state.level = lv.key; renderLevels(); };
    $('levels').appendChild(b);
  }
  $('custom').hidden = state.level !== 'custom';
}
renderLevels();

document.querySelectorAll('.mode').forEach((btn) => {
  btn.onclick = () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll('.mode').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', b === btn);
    });
    $('mode-level').hidden = state.mode !== 'level';
    $('mode-target').hidden = state.mode !== 'target';
  };
});

$('dpi').oninput = () => { $('dpi-out').textContent = $('dpi').value; };
$('quality').oninput = () => { $('quality-out').textContent = $('quality').value; };

function currentSettings() {
  const grayscale = $('grayscale').checked;
  if (state.level === 'custom') {
    const quality = Number($('quality').value);
    const dpi = Number($('dpi').value);
    return {
      dpi,
      qfactor: 0.1 + ((100 - quality) / 100) * 2.2,
      preset: dpi <= 90 ? '/screen' : dpi <= 180 ? '/ebook' : '/printer',
      grayscale,
    };
  }
  const lv = LEVELS.find((l) => l.key === state.level);
  return { dpi: lv.dpi, qfactor: lv.qfactor, preset: lv.preset, grayscale };
}

function targetBytes() {
  const v = parseFloat($('target-size').value);
  if (!(v > 0)) return null;
  return Math.round(v * ($('target-unit').value === 'MB' ? 1024 * 1024 : 1024));
}

// ---------- 檔案處理 ----------
const drop = $('drop');
$('pick').onclick = (e) => { e.stopPropagation(); $('file-input').click(); };
drop.onclick = () => $('file-input').click();
drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); } };
$('file-input').onchange = () => { addFiles($('file-input').files); $('file-input').value = ''; };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
// 拖到頁面其他地方時不要讓瀏覽器直接開啟 PDF
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) { alert('請選擇 PDF 檔案'); return; }
  for (const file of files) {
    const item = { file, status: 'queued', settings: currentSettings(), target: state.mode === 'target' ? targetBytes() : null };
    if (state.mode === 'target' && !item.target) { alert('請輸入有效的目標大小'); return; }
    item.el = createRow(item);
    state.items.push(item);
  }
  $('results').hidden = false;
  updateSummary();
  processQueue();
}

function createRow(item) {
  const li = document.createElement('li');
  li.className = 'item';
  li.innerHTML = `
    <div class="name"></div>
    <div class="meta"></div>
    <a class="btn primary" hidden>下載</a>
    <div class="bar indeterminate"><i></i></div>`;
  li.querySelector('.name').textContent = item.file.name;
  li.querySelector('.name').title = item.file.name;
  li.querySelector('.meta').textContent = `${fmt(item.file.size)} · 等待中`;
  $('list').appendChild(li);
  return li;
}

async function processQueue() {
  if (state.running) return;
  state.running = true;
  let item;
  while ((item = state.items.find((i) => i.status === 'queued'))) {
    item.status = 'working';
    await processItem(item);
    updateSummary();
  }
  state.running = false;
}

async function processItem(item) {
  const meta = item.el.querySelector('.meta');
  const bar = item.el.querySelector('.bar');
  const fill = bar.querySelector('i');
  const setMeta = (html) => { meta.innerHTML = `${fmt(item.file.size)} · ${html}`; };
  const onProgress = (prefix) => (page, total) => {
    if (total) { bar.classList.remove('indeterminate'); fill.style.width = `${(page / total) * 100}%`; }
    setMeta(`${prefix}第 ${page}${total ? ' / ' + total : ''} 頁`);
  };

  try {
    const input = new Uint8Array(await item.file.arrayBuffer());
    setMeta(engineReady ? '壓縮中…' : '等待壓縮引擎載入…');
    let output;
    let note = '';

    if (item.target) {
      ({ output, note } = await compressToTarget(input, item, setMeta, onProgress));
    } else {
      output = await runGs(input, item.settings, onProgress('壓縮中 '));
    }

    // 壓縮後反而變大就保留原檔
    let kept = false;
    if (output.length >= input.length) { output = input; kept = true; }

    item.output = output;
    item.status = 'done';
    bar.hidden = true;
    const saved = 1 - output.length / input.length;
    setMeta(kept
      ? `<span class="warn">此檔已是最佳化狀態，無法再縮小</span>`
      : `→ <b>${fmt(output.length)}</b> <span class="saved">（縮小 ${pct(saved)}）</span>${note}`);

    const a = item.el.querySelector('a');
    item.url = URL.createObjectURL(new Blob([output], { type: 'application/pdf' }));
    a.href = item.url;
    a.download = outName(item.file.name);
    a.hidden = false;
  } catch (err) {
    item.status = 'error';
    bar.hidden = true;
    setMeta(`<span class="err">${escapeHtml(err.message.split('\n')[0])}</span>`);
    console.error(err);
  }
}

// 先試推薦等級；符合就再試更高品質，不符合就逐步加強壓縮
async function compressToTarget(input, item, setMeta, onProgress) {
  const steps = TARGET_STEPS.map((s) => ({ ...s, grayscale: item.settings.grayscale }));
  const attempt = async (i) => {
    const label = `嘗試第 ${i + 1} 種設定，`;
    return runGs(input, steps[i], onProgress(label));
  };
  const target = item.target;
  if (input.length <= target) {
    return { output: await attempt(0), note: '' };
  }

  let i = 1;
  let out = await attempt(i);
  if (out.length <= target) {
    const better = await attempt(0);
    return { output: better.length <= target ? better : out, note: '' };
  }
  let smallest = out;
  for (i = 2; i < steps.length; i++) {
    out = await attempt(i);
    if (out.length < smallest.length) smallest = out;
    if (out.length <= target) return { output: out, note: '' };
  }
  return { output: smallest, note: ` <span class="warn">· 無法壓到 ${fmt(target)} 以下，已給最小結果</span>` };
}

function updateSummary() {
  const done = state.items.filter((i) => i.status === 'done');
  const before = done.reduce((s, i) => s + i.file.size, 0);
  const after = done.reduce((s, i) => s + i.output.length, 0);
  $('summary').textContent = done.length
    ? `共 ${done.length} 個檔案：${fmt(before)} → ${fmt(after)}（節省 ${pct(1 - after / before)}）`
    : '';
  $('zip').disabled = done.length < 1 || state.items.some((i) => i.status === 'queued' || i.status === 'working');
}

$('zip').onclick = async () => {
  const done = state.items.filter((i) => i.status === 'done');
  if (done.length === 1) { done[0].el.querySelector('a').click(); return; }
  $('zip').disabled = true;
  $('zip').textContent = '打包中…';
  const zip = new JSZip();
  const used = new Set();
  for (const item of done) {
    let name = outName(item.file.name);
    for (let n = 2; used.has(name); n++) name = outName(item.file.name).replace(/\.pdf$/i, `(${n}).pdf`);
    used.add(name);
    zip.file(name, item.output);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '壓縮後PDF.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  $('zip').textContent = '全部下載（ZIP）';
  updateSummary();
};

$('clear').onclick = () => {
  if (state.running && !confirm('還有檔案在壓縮中，確定要清除嗎？')) return;
  // 正在壓縮的那個無法中斷，保留在清單上；其餘全部移除
  const keep = state.items.filter((i) => i.status === 'working');
  for (const item of state.items) {
    if (keep.includes(item)) continue;
    if (item.status === 'queued') item.status = 'cancelled';
    if (item.url) URL.revokeObjectURL(item.url);
    item.el.remove();
  }
  state.items = keep;
  $('results').hidden = keep.length === 0;
  updateSummary();
};

// ---------- 工具 ----------
function fmt(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}
function pct(ratio) { const p = ratio * 100; return (p >= 99 ? p.toFixed(1) : Math.round(p)) + '%'; }
function outName(name) { return name.replace(/\.pdf$/i, '') + '_壓縮.pdf'; }
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
