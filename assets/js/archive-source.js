export function createArchiveSource(FetchSource, url) {
  const source = new FetchSource(url);
  const revision = new URL(url).pathname.match(
    /\.([a-f0-9]{64})\.pmtiles$/,
  )?.[1];
  if (!revision) return source;
  return {
    getKey: () => source.getKey(),
    async getBytes(offset, length, signal) {
      const response = await source.getBytes(offset, length, signal);
      return { ...response, etag: revision };
    },
  };
}
