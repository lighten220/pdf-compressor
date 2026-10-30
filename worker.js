// 在 Web Worker 裡執行 Ghostscript（WASM），避免卡住畫面
const GS_BASE = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/';
importScripts(GS_BASE + 'gs.js');

let wasmModulePromise = null;

// 下載並編譯 wasm 一次，之後每個工作重複使用（瀏覽器也會快取下載）
function loadWasm() {
  if (wasmModulePromise) return wasmModulePromise;
  wasmModulePromise = (async () => {
    const res = await fetch(GS_BASE + 'gs.wasm');
    if (!res.ok) throw new Error('無法下載壓縮引擎（HTTP ' + res.status + '）');
    // CDN 可能以 gzip 傳送，Content-Length 不是解壓後大小，所以用已知的實際大小
    const total = 16177271;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      postMessage({ type: 'engine-progress', loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    const mod = await WebAssembly.compile(bytes);
    postMessage({ type: 'engine-ready' });
    return mod;
  })();
  wasmModulePromise.catch(() => { wasmModulePromise = null; });
  return wasmModulePromise;
}

function buildArgs(s) {
  const dpi = s.dpi;
  const monoDpi = Math.min(Math.max(dpi * 2, 150), 300);
  const args = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dPDFSETTINGS=' + s.preset,
    '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true',
    '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic',
    '-dColorImageDownsampleThreshold=1.0',
    '-dGrayImageDownsampleThreshold=1.0',
    '-dMonoImageDownsampleThreshold=1.0',
    '-dColorImageResolution=' + dpi,
    '-dGrayImageResolution=' + dpi,
    '-dMonoImageResolution=' + monoDpi,
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
    '-dColorImageFilter=/DCTEncode',
    '-dGrayImageFilter=/DCTEncode',
  ];
  if (s.grayscale) {
    args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
  }
  // QFactor 越大 JPEG 品質越低、檔案越小
  const q = s.qfactor.toFixed(2);
  const dict = `<< /QFactor ${q} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >>`;
  args.push(
    '-sOutputFile=/out.pdf',
    '-c', `<< /ColorACSImageDict ${dict} /GrayACSImageDict ${dict} /ColorImageDict ${dict} /GrayImageDict ${dict} >> setdistillerparams`,
    '-f', '/in.pdf'
  );
  return args;
}

async function compress(id, input, settings) {
  const wasmModule = await loadWasm();
  let totalPages = 0;
  const log = [];

  const gs = await Module({
    noInitialRun: true,
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(wasmModule, imports).then((inst) => done(inst));
      return {};
    },
    print(line) {
      let m = /Processing pages \d+ through (\d+)/.exec(line);
      if (m) totalPages = Number(m[1]);
      m = /^Page (\d+)/.exec(line);
      if (m) postMessage({ type: 'progress', id, page: Number(m[1]), total: totalPages });
    },
    printErr(line) { log.push(line); },
  });

  gs.FS.writeFile('/in.pdf', new Uint8Array(input));
  try {
    gs.callMain(buildArgs(settings));
  } catch (e) {
    // Emscripten 以拋出 ExitStatus 的方式結束程式，非 0 才算失敗
    if (!(e && e.name === 'ExitStatus' && e.status === 0)) log.push(String(e && e.message || e));
  }

  let out;
  try {
    out = gs.FS.readFile('/out.pdf');
  } catch {
    out = null;
  }
  if (!out || out.length === 0) {
    throw new Error('壓縮失敗，檔案可能已加密或損毀。' + (log.length ? '\n' + log.slice(-3).join('\n') : ''));
  }
  return out;
}

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'preload') {
    loadWasm().catch((err) => postMessage({ type: 'engine-error', message: err.message }));
    return;
  }
  if (msg.type === 'compress') {
    try {
      const out = await compress(msg.id, msg.input, msg.settings);
      postMessage({ type: 'done', id: msg.id, output: out.buffer }, [out.buffer]);
    } catch (err) {
      postMessage({ type: 'error', id: msg.id, message: err.message || String(err) });
    }
  }
};
