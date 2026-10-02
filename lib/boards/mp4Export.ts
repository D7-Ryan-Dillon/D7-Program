// Turns a BoardAnimation into an H.264 MP4 using the browser's own hardware
// video encoder (WebCodecs) and a tiny muxer. Same frames as the GIF, but
// typically 10-20x smaller and full colour. An MP4 has no loop flag -- it is
// one revolution, and a player's "loop" switch repeats it seamlessly.

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { BoardAnimation } from "./exportBoard";

export function mp4Supported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

/** H.264 High profile at the lowest level that holds this frame size and
 * rate (level limits are in 16x16 macroblocks). */
function avcCodec(width: number, height: number, fps: number): string {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  if (mbs <= 8192 && mbs * fps <= 245760) return "avc1.640028"; // 4.0
  if (mbs <= 36864 && mbs * fps <= 983040) return "avc1.640033"; // 5.1
  return "avc1.640034"; // 5.2
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function encodeMp4(source: BoardAnimation, fps: number, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const codec = avcCodec(source.width, source.height, fps);
  const config: VideoEncoderConfig = {
    codec,
    width: source.width,
    height: source.height,
    // Flat colour graphics need far less than photographic video does.
    bitrate: Math.min(40_000_000, Math.max(2_000_000, source.width * source.height * fps * 0.2)),
    framerate: fps,
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error("This browser can't encode MP4 at that size. Try a smaller width, or export a GIF.");

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: "avc", width: source.width, height: source.height, frameRate: fps }, fastStart: "in-memory" });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(config);

  try {
    const frameMicros = 1_000_000 / fps;
    const keyEvery = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < source.frameCount; i++) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      if (failure) throw failure;
      source.renderFrame(i);
      const frame = new VideoFrame(source.canvas, { timestamp: Math.round(i * frameMicros), duration: Math.round(frameMicros) });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      onProgress(i + 1, source.frameCount);
      // Don't let the encoder queue run away from the renderer.
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      await yieldToUi();
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  return new Blob([target.buffer], { type: "video/mp4" });
}
