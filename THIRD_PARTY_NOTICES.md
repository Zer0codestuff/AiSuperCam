# Third-party notices

AiSuperCam redistributes MediaPipe runtime and model assets so webcam processing can remain local to the browser.

## MediaPipe Tasks Vision

- Component: `@mediapipe/tasks-vision` 1.0.1
- Copyright: Google LLC and the MediaPipe authors
- License: Apache License 2.0; see [`third_party/Apache-2.0.txt`](third_party/Apache-2.0.txt)
- Upstream: <https://github.com/google-ai-edge/mediapipe>
- Vendored files: `public/wasm/*`

## MediaPipe model bundles

The following official MediaPipe model bundles are distributed by Google under the MediaPipe Apache 2.0 license. Their checksums match the upstream downloads.

| Local file | Upstream source | SHA-256 |
| --- | --- | --- |
| `public/models/hand_landmarker.task` | [Hand Landmarker](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task) | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |
| `public/models/face_landmarker.task` | [Face Landmarker](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `public/models/pose_landmarker_lite.task` | [Pose Landmarker Lite](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |

The notices above apply only to the listed third-party files. AiSuperCam's original source code is licensed separately under the MIT License.
