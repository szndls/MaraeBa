/**
 * 긴 수업(40분)도 지원하려고, 하나의 마이크 스트림을 유지한 채 일정 시간마다
 * MediaRecorder를 새로 시작해서 "조각" 파일을 만든다 — WebM/MP4는 컨테이너
 * 헤더가 파일 맨 앞에만 있어서, 녹음 중간에 그냥 버퍼만 잘라내면 그 조각 자체로는
 * 디코딩이 안 된다. 그래서 조각마다 완전히 새 MediaRecorder를 쓴다(약간의 끊김이
 * 생기지만 1초 미만이라 받아쓰기에 거의 영향 없음). 화면의 녹음 시간 표시는 이
 * 전환과 무관하게 계속 이어진다.
 */
export interface ChunkedRecorder {
  /** 마지막 조각을 마무리하고 스트림을 끈다. 그 조각도 onChunk로 전달된다. */
  stop(): Promise<void>;
}

export function startChunkedRecording(
  stream: MediaStream,
  mimeType: string,
  chunkSeconds: number,
  onChunk: (blob: Blob, offsetSeconds: number) => void
): ChunkedRecorder {
  let rec: MediaRecorder;
  let offsetSeconds = 0;

  function beginChunk(forOffsetSeconds: number) {
    const chunks: Blob[] = [];
    const current = new MediaRecorder(stream, { mimeType: mimeType || undefined, audioBitsPerSecond: 32000 });
    current.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    current.onstop = () => {
      onChunk(new Blob(chunks, { type: current.mimeType || "audio/webm" }), forOffsetSeconds);
    };
    current.start();
    rec = current;
  }

  beginChunk(offsetSeconds);

  const rotateTimer = setInterval(() => {
    const finished = rec;
    offsetSeconds += chunkSeconds;
    const nextOffset = offsetSeconds;
    finished.stop();
    beginChunk(nextOffset);
  }, chunkSeconds * 1000);

  return {
    stop(): Promise<void> {
      clearInterval(rotateTimer);
      return new Promise((resolve) => {
        const finished = rec;
        const previousOnStop = finished.onstop;
        finished.onstop = (ev) => {
          if (typeof previousOnStop === "function") previousOnStop.call(finished, ev);
          stream.getTracks().forEach((t) => t.stop());
          resolve();
        };
        finished.stop();
      });
    },
  };
}
