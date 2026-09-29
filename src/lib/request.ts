export async function readJson(request: Request, limit = 2048): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required.");
  const decoder = new TextDecoder();
  let size = 0, body = "";
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Request is too large."); }
      body += decoder.decode(value,{stream:true});
    }
    body += decoder.decode();
    return JSON.parse(body);
  } finally { reader.releaseLock(); }
}
