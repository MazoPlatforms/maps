import { MazoMaps } from '../../sdk/index.js';
const sdk = new MazoMaps();
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      results: await sdk.search(data.query, data.options),
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: { code: error.code, message: error.message },
    });
  }
};
