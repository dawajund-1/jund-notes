const cdn = 'https://cdn.jsdelivr.net/npm/';
const assets = [
  ['tesseract.js@6.0.1/dist/tesseract.esm.min.js', 'sha384-C+b3kNXqc/kbk8HRFKxpQIN52IuwyPg1zTyLFtZb3cvnSIRHL6+4p+cwjkQA/jLS'],
  ['tesseract.js@6.0.1/dist/worker.min.js', 'sha384-Xz8ctHtZgH/eWwOqd6igOU/kepnilz4dowW84REE2KL9DtDbxEnd/xxYhzBhNCzd'],
  ['tesseract.js-core@6.0.0/tesseract-core-lstm.wasm.js', 'sha384-lWCMZAMtmOXuoKarpaWpLArXiQPvYZg+0fqxA+vFgnwbHhJaHuJpK/DrhhbEPgVA'],
];

function abortable(run, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve().then(run).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

export async function createScanReader(signal) {
  const readySignal = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  const files = await Promise.all(assets.map(async ([path, integrity]) => {
    const response = await fetch(cdn + path, { integrity, signal: readySignal });
    if (!response.ok) throw new Error('Could not download the on-device scan reader.');
    return response.arrayBuffer();
  }));
  const urls = files.map(data => URL.createObjectURL(new Blob([data], { type: 'text/javascript' })));
  let worker;
  try {
    const { default: Tesseract } = await import(urls[0]);
    worker = await abortable(async () => {
      const instance = await Tesseract.createWorker(['ara', 'eng'], 1, {
        workerPath: urls[1], workerBlobURL: false, corePath: urls[2] + '#core.wasm.js',
      });
      if (readySignal.aborted) { await instance.terminate(); readySignal.throwIfAborted(); }
      return instance;
    }, readySignal);
    await abortable(() => worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO }), readySignal);
  } catch (error) {
    await worker?.terminate();
    throw error;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
  return {
    async read(blob, signal) {
      const pageSignal = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
      try {
        const { data } = await abortable(() => worker.recognize(blob), pageSignal);
        const text = data.text.trim();
        if (data.confidence >= 90 && (text.match(/\p{L}/gu) || []).length >= 5) return text;
        return '';
      } catch (error) {
        if (pageSignal.aborted) await worker.terminate();
        throw error;
      }
    },
    close: () => worker.terminate(),
  };
}
