// Builds SkeletonPacket JSON matching the Python backend format exactly
const LANDMARK_NAMES = [
  'nose',
  'left_eye_inner','left_eye','left_eye_outer',
  'right_eye_inner','right_eye','right_eye_outer',
  'left_ear','right_ear',
  'mouth_left','mouth_right',
  'left_shoulder','right_shoulder',
  'left_elbow','right_elbow',
  'left_wrist','right_wrist',
  'left_pinky','right_pinky',
  'left_index','right_index',
  'left_thumb','right_thumb',
  'left_hip','right_hip',
  'left_knee','right_knee',
  'left_ankle','right_ankle',
  'left_heel','right_heel',
  'left_foot_index','right_foot_index'
];

const MIN_VISIBILITY = 0.5;
const MIN_PRESENCE = 0.5;

function buildSkeletonPacket(result, depthResults, config, videoWidth, videoHeight) {
  const normalizedLandmarks = result.landmarks[0];
  const worldLandmarks = result.worldLandmarks ? result.worldLandmarks[0] : null;
  if (!normalizedLandmarks) return null;

  const depthMap = new Map();
  (depthResults || []).forEach(d => {
    if (d.depthMeters != null) depthMap.set(d.landmarkIndex, d.depthMeters);
  });

  const joints = {};
  const keypoints2D = {};
  const pointDepthsM = {};
  const bodyPartDepths = [];

  normalizedLandmarks.forEach((lm, index) => {
    const vis = lm.visibility != null ? lm.visibility : 1.0;
    const pres = lm.presence != null ? lm.presence : 1.0;
    if (vis < MIN_VISIBILITY || pres < MIN_PRESENCE) return;

    const name = LANDMARK_NAMES[index] || ('landmark_' + index);
    const cx = Math.min(Math.max(lm.x, 0), 1);
    const cy = Math.min(Math.max(lm.y, 0), 1);
    const xPx = cx * (videoWidth - 1);
    const yPx = cy * (videoHeight - 1);
    const relZ = lm.z;

    const depthM = depthMap.get(index);
    const distCm = depthM != null ? depthM * 100.0 : -1.0;

    keypoints2D[name] = [cx, cy];
    if (depthM != null) pointDepthsM[name] = depthM;

    if (worldLandmarks && index < worldLandmarks.length) {
      const w = worldLandmarks[index];
      joints[name] = [w.x, w.y, w.z];
    } else {
      joints[name] = [lm.x, lm.y, lm.z];
    }

    bodyPartDepths.push({
      landmark_id: index,
      name: name.toUpperCase(),
      x: xPx,
      y: yPx,
      depth: relZ,
      distance_cm: distCm
    });
  });

  return {
    device: config.isUsingLiDAR ? 'ios_lidar_mediapipe' : 'ios_stereo_mediapipe',
    timestamp: Date.now() / 1000.0,
    exercise: config.exercise || 'standing_knee_flexion',
    depth_mode: config.depthMode || 'stereo_depth',
    joints: joints,
    all_joints: null,
    keypoints_2d: keypoints2D,
    point_depths_m: pointDepthsM,
    camera_position: null,
    camera_intrinsics: null,
    camera_width: videoWidth,
    camera_height: videoHeight,
    arm_head_distance_m: null,
    arm_head_state: null,
    arm_head_quality: null,
    arm_head_source: null,
    video_frame_base64: null,
    video_width: null,
    video_height: null,
    body_part_depths: bodyPartDepths,
    landmark_depths: bodyPartDepths
  };
}
