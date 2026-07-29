/* This worker is deliberately classic: Emscripten's glue file uses importScripts. */
importScripts('./occt-import-js.js');

let occtPromise;

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ type: 'progress', value: 10, note: '正在載入幾何核心…' });
    occtPromise ??= occtimportjs({ locateFile: (path) => `./${path}` });
    const occt = await occtPromise;
    self.postMessage({ type: 'progress', value: 18, note: '正在解析 STEP 曲面…' });
    const result = occt.ReadStepFile(new Uint8Array(data.buffer), data.params);
    if (!result?.success || !result.meshes?.length) {
      throw new Error('STEP 檔案沒有可顯示的幾何資料。');
    }

    const transfers = [];
    const meshes = result.meshes.map((source, index) => {
      const progressInterval = Math.max(1, Math.floor(result.meshes.length / 20));
      if (index % progressInterval === 0) {
        self.postMessage({
          type: 'progress',
          value: 86 + (index / result.meshes.length) * 10,
          note: '正在整理模型網格…',
        });
      }
      const position = Float32Array.from(source.attributes?.position?.array ?? []);
      const normal = source.attributes?.normal?.array
        ? Float32Array.from(source.attributes.normal.array)
        : null;
      const indices = Uint32Array.from(source.index?.array ?? []);
      if (!position.length || !indices.length) return null;
      transfers.push(position.buffer, indices.buffer);
      if (normal) transfers.push(normal.buffer);
      return {
        name: source.name || 'STEP mesh',
        color: source.color || null,
        brepFaces: (source.brep_faces ?? []).map(({ first, last }) => ({ first, last })),
        position,
        normal,
        index: indices,
      };
    }).filter(Boolean);

    if (!meshes.length) throw new Error('STEP 檔案沒有有效的模型網格。');
    self.postMessage({ type: 'progress', value: 96, note: '正在傳送模型資料…' });
    self.postMessage({ type: 'complete', meshes }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'STEP 解析失敗。' });
  }
};
