// 웹캠 + MediaPipe Hand Landmarker 로 손가락 개수 세기
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

// 랜드마크 번호: 0 손목 / 엄지 1-4 / 검지 5-8 / 중지 9-12 / 약지 13-16 / 새끼 17-20
export function countFingers(lm, thumbRatio = 0.78) {
  const w = lm[0];
  let n = 0;
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) {
    if (d(lm[tip], w) > d(lm[pip], w) * 1.12) n++;
  }
  const palm = d(lm[0], lm[9]);
  const thumbOut = d(lm[4], lm[9]) / palm > thumbRatio && d(lm[4], lm[17]) > d(lm[3], lm[17]);
  if (thumbOut) n++;
  return n;
}

export async function startHands(video, onFrame) {
  const { HandLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });
  let landmarker;
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
  });
  video.srcObject = stream;
  await video.play();

  let last = -1;
  const loop = () => {
    if (video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime;
      const res = landmarker.detectForVideo(video, performance.now());
      onFrame(res.landmarks && res.landmarks[0] ? res.landmarks[0] : null);
    }
    requestAnimationFrame(loop);
  };
  loop();
}
