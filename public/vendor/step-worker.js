/* This worker is deliberately a classic worker: Emscripten's glue file uses importScripts. */
importScripts('./occt-import-js.js');

self.onmessage = async ({ data }) => {
  try {
    const occt = await occtimportjs({ locateFile: (path) => `./${path}` });
    const result = occt.ReadStepFile(new Uint8Array(data.buffer), data.params);
    if (!result?.success || !result.meshes?.length) {
      throw new Error('此檔案沒有可顯示的 STEP 幾何，或檔案格式不正確。');
    }

    const transfers = [];
    const meshes = result.meshes.map((source) => {
      const position = Float32Array.from(source.attributes?.position?.array ?? []);
      const normal = source.attributes?.normal?.array
        ? Float32Array.from(source.attributes.normal.array)
        : null;
      const index = Uint32Array.from(source.index?.array ?? []);
      if (!position.length || !index.length) return null;
      transfers.push(position.buffer, index.buffer);
      if (normal) transfers.push(normal.buffer);
      return {
        name: source.name || 'STEP mesh',
        color: source.color || null,
        position,
        normal,
        index,
      };
    }).filter(Boolean);

    if (!meshes.length) throw new Error('STEP 解析完成，但找不到可繪製的三角形。');
    self.postMessage({ type: 'complete', meshes }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'STEP 解析失敗。' });
  }
};
