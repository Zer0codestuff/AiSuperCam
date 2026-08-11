import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export function handDistance(
  landmarks: NormalizedLandmark[],
  first: number,
  second: number,
) {
  return Math.hypot(
    landmarks[first].x - landmarks[second].x,
    landmarks[first].y - landmarks[second].y,
    landmarks[first].z - landmarks[second].z,
  );
}

function fingerExtended(
  landmarks: NormalizedLandmark[],
  tip: number,
  pip: number,
) {
  return handDistance(landmarks, tip, 0) > handDistance(landmarks, pip, 0) * 1.1;
}

export function isLShape(landmarks: NormalizedLandmark[]) {
  if (landmarks.length < 21) return false;

  const indexExtended = fingerExtended(landmarks, 8, 6);
  const middleFolded = !fingerExtended(landmarks, 12, 10);
  const ringFolded = !fingerExtended(landmarks, 16, 14);
  const pinkyFolded = !fingerExtended(landmarks, 20, 18);
  const thumbExtended =
    handDistance(landmarks, 4, 5) > handDistance(landmarks, 3, 5) * 1.18;

  const indexVector = {
    x: landmarks[8].x - landmarks[5].x,
    y: landmarks[8].y - landmarks[5].y,
  };
  const thumbVector = {
    x: landmarks[4].x - landmarks[2].x,
    y: landmarks[4].y - landmarks[2].y,
  };
  const dot = indexVector.x * thumbVector.x + indexVector.y * thumbVector.y;
  const magnitude =
    Math.hypot(indexVector.x, indexVector.y) *
      Math.hypot(thumbVector.x, thumbVector.y) || 1;
  const cosine = Math.abs(dot / magnitude);

  return (
    indexExtended &&
    thumbExtended &&
    middleFolded &&
    ringFolded &&
    pinkyFolded &&
    cosine < 0.67
  );
}
