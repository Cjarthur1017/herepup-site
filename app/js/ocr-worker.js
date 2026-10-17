// Reads text from scanned pages on this device with Tesseract (WebAssembly). Loaded only when a scanned PDF is dropped.
/* global TesseractCore */
importScripts("../vendor/tesseract/tesseract-core.wasm.js");
let ready = null, mod = null, api = null;

function init() {
  if (!ready) {
    ready = (async () => {
      mod = await TesseractCore();
      const buf = await (await fetch(new URL("../vendor/tesseract/eng.traineddata", self.location.href))).arrayBuffer();
      mod.FS.writeFile("eng.traineddata", new Uint8Array(buf));
      api = new mod.TessBaseAPI();
      if (api.Init(null, "eng") !== 0) throw new Error("The reading engine could not load its English data.");
    })();
  }
  return ready;
}

self.onmessage = async (e) => {
  const { id, png } = e.data;
  try {
    await init();
    mod.FS.writeFile("/input", png);
    api.SetImageFile();
    const text = api.GetUTF8Text();
    self.postMessage({ id, text });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
