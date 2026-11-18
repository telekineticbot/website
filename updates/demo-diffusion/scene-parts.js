// Shared 3D pieces for the demo diffusion update: the studio, the kitchen table,
// the sink, bowls, the robot arm, the person, and path helpers.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

export const COLORS = {
  ink: 0x14140f,
  accent: 0xff7122,
  noise: 0x6f6f68,
  arm: 0xf3f2ee,
  joint: 0x9a9c97,
  table: 0xe9e7e1,
  tableEdge: 0xd8d6cf,
  bowl: 0xf8f7f3,
  bowlInside: 0xc9472b,
  sink: 0x22221d,
};

// Scene layout in meters. The table top is at height 0.
export const ARM_BASE = new THREE.Vector3(0, 0, -0.46);
export const SHOULDER_HEIGHT = 0.26;
export const UPPER_ARM_LENGTH = 0.44;
export const FOREARM_LENGTH = 0.42;
export const GRIPPER_LENGTH = 0.13;
export const BOWL_START = new THREE.Vector3(-0.38, 0, 0.12);
// Where the bowl sits when the robot tries, so it has to adapt the person's motion.
export const BOWL_ROBOT_START = new THREE.Vector3(-0.27, 0, 0.25);
export const SINK_CENTER = new THREE.Vector3(0.4, 0, 0.06);
export const HOME = new THREE.Vector3(0.02, 0.46, -0.12);
export const SINK_DEPTH = 0.1;
export const SINK_HALF_WIDTH = 0.15;
export const SINK_HALF_DEPTH = 0.13;
// The bowl rests on the basin floor once it is in the sink.
export const BOWL_IN_SINK_HEIGHT = -SINK_DEPTH + 0.002;

// Lights, soft shadows and a shadow-only floor, shared by every scene on the page.
export function buildStudio(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);

  // Lights
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bbb5, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(-1.4, 2.6, 1.6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -1.4;
  keyLight.shadow.camera.right = 1.4;
  keyLight.shadow.camera.top = 1.4;
  keyLight.shadow.camera.bottom = -1.4;
  keyLight.shadow.radius = 6;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.015;
  scene.add(keyLight);

  // Floor that only shows shadows, so the page's studio gray shows through.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.76;
  floor.receiveShadow = true;
  scene.add(floor);

  return { scene, camera };
}

// ---------- Scene pieces ----------

export function buildTable(scene, { withSinkHole = true } = {}) {
  // Counter top with a cut-out for the sink, so the basin is open from above.
  const halfWidth = 0.85, halfDepth = 0.525;
  const outline = new THREE.Shape();
  outline.moveTo(-halfWidth, -halfDepth);
  outline.lineTo(halfWidth, -halfDepth);
  outline.lineTo(halfWidth, halfDepth);
  outline.lineTo(-halfWidth, halfDepth);
  outline.closePath();
  // Shape y runs opposite to world z once the shape is laid flat.
  const hole = new THREE.Path();
  const holeLeft = SINK_CENTER.x - SINK_HALF_WIDTH, holeRight = SINK_CENTER.x + SINK_HALF_WIDTH;
  const holeNear = -(SINK_CENTER.z + SINK_HALF_DEPTH), holeFar = -(SINK_CENTER.z - SINK_HALF_DEPTH);
  hole.moveTo(holeLeft, holeNear);
  hole.lineTo(holeLeft, holeFar);
  hole.lineTo(holeRight, holeFar);
  hole.lineTo(holeRight, holeNear);
  hole.closePath();
  if (withSinkHole) outline.holes.push(hole);
  const topGeometry = new THREE.ExtrudeGeometry(outline, { depth: 0.05, bevelEnabled: false });
  topGeometry.rotateX(-Math.PI / 2);
  topGeometry.translate(0, -0.05, 0);
  const top = new THREE.Mesh(topGeometry, new THREE.MeshStandardMaterial({ color: COLORS.table, roughness: 0.55 }));
  top.receiveShadow = true;
  top.castShadow = true;
  scene.add(top);
  const legMaterial = new THREE.MeshStandardMaterial({ color: COLORS.tableEdge, roughness: 0.6 });
  for (const [x, z] of [[-0.78, -0.45], [0.78, -0.45], [-0.78, 0.45], [0.78, 0.45]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.71, 0.05), legMaterial);
    leg.position.set(x, -0.405, z);
    leg.castShadow = true;
    scene.add(leg);
  }
}

export function buildSink(scene) {
  // An undermount steel basin: the counter's cut edge forms the top of the opening,
  // and a closed steel box hangs below it, so no two surfaces share a plane.
  const group = new THREE.Group();
  const basinMaterial = new THREE.MeshStandardMaterial({ color: 0xa7aaa4, roughness: 0.45, metalness: 0.55 });
  const wall = 0.006;
  const counterThickness = 0.05;
  const basinTop = -counterThickness;
  const basinHeight = SINK_DEPTH - counterThickness;
  const outerWidth = SINK_HALF_WIDTH * 2 + wall * 2;
  const outerDepth = SINK_HALF_DEPTH * 2 + wall * 2;
  const pieces = [
    // floor, with its top face at the basin's depth
    [outerWidth, wall, outerDepth, 0, -SINK_DEPTH - wall / 2, 0],
    // four walls just outside the opening, below the counter
    [outerWidth, basinHeight, wall, 0, basinTop - basinHeight / 2, -SINK_HALF_DEPTH - wall / 2],
    [outerWidth, basinHeight, wall, 0, basinTop - basinHeight / 2, SINK_HALF_DEPTH + wall / 2],
    [wall, basinHeight, SINK_HALF_DEPTH * 2, -SINK_HALF_WIDTH - wall / 2, basinTop - basinHeight / 2, 0],
    [wall, basinHeight, SINK_HALF_DEPTH * 2, SINK_HALF_WIDTH + wall / 2, basinTop - basinHeight / 2, 0],
  ];
  for (const [width, height, depth, x, y, z] of pieces) {
    const piece = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), basinMaterial);
    piece.position.set(x, y, z);
    piece.receiveShadow = true;
    group.add(piece);
  }
  const drain = new THREE.Mesh(
    new THREE.CircleGeometry(0.022, 32),
    new THREE.MeshStandardMaterial({ color: 0x4a4b46, roughness: 0.5, metalness: 0.5 }),
  );
  drain.rotation.x = -Math.PI / 2;
  drain.position.y = -SINK_DEPTH + 0.0015;
  group.add(drain);
  // Tap on the right side of the opening, away from the arm's path.
  const tapMaterial = new THREE.MeshStandardMaterial({ color: 0xd9dbd6, roughness: 0.2, metalness: 0.9 });
  const tapSide = SINK_HALF_WIDTH + 0.05;
  const tapCurve = new THREE.CatmullRomCurve3([
    v(tapSide, 0, 0), v(tapSide, 0.17, 0), v(tapSide - 0.03, 0.22, 0), v(tapSide - 0.065, 0.2, 0), v(tapSide - 0.07, 0.165, 0),
  ]);
  const tap = new THREE.Mesh(new THREE.TubeGeometry(tapCurve, 48, 0.011, 16, false), tapMaterial);
  tap.castShadow = true;
  group.add(tap);
  const tapBase = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.02, 24), tapMaterial);
  tapBase.position.set(tapSide, 0.01, 0);
  tapBase.castShadow = true;
  group.add(tapBase);
  group.position.copy(SINK_CENTER);
  scene.add(group);
  return { group };
}

export function buildBowl(scene, { outsideColor = COLORS.bowl, insideColor = COLORS.bowlInside, size = 1 } = {}) {
  // A lathe profile gives a simple ceramic bowl with an orange glaze inside.
  const outline = [];
  for (let index = 0; index <= 16; index += 1) {
    const angle = (index / 16) * (Math.PI / 2);
    outline.push(new THREE.Vector2(0.03 + 0.055 * Math.sin(angle), 0.06 * (1 - Math.cos(angle))));
  }
  const outside = new THREE.Mesh(
    new THREE.LatheGeometry(outline, 48),
    new THREE.MeshStandardMaterial({ color: outsideColor, roughness: 0.25, side: THREE.FrontSide }),
  );
  const inside = new THREE.Mesh(
    new THREE.LatheGeometry(outline.map((point) => new THREE.Vector2(point.x * 0.9, point.y + 0.004)), 48),
    new THREE.MeshStandardMaterial({ color: insideColor, roughness: 0.35, side: THREE.BackSide }),
  );
  // Close the bottom so the bowl doesn't show a hole from above.
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), inside.material);
  bottom.material = new THREE.MeshStandardMaterial({ color: insideColor, roughness: 0.35 });
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.004;
  const group = new THREE.Group();
  group.add(outside, inside, bottom);
  outside.castShadow = true;
  group.scale.setScalar(size);
  group.position.copy(BOWL_START);
  scene.add(group);
  return group;
}

export function buildArm(scene) {
  const shellMaterial = new THREE.MeshStandardMaterial({ color: COLORS.arm, roughness: 0.35 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xc9cbc6, roughness: 0.18, metalness: 0.9 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a25, roughness: 0.45 });
  const parts = {};
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, SHOULDER_HEIGHT, 32), shellMaterial);
  pedestal.position.copy(ARM_BASE).add(v(0, SHOULDER_HEIGHT / 2, 0));
  parts.shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.068, 32, 24), shellMaterial);
  parts.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.052, 32, 24), shellMaterial);
  parts.wrist = new THREE.Mesh(new THREE.SphereGeometry(0.04, 32, 24), shellMaterial);
  parts.upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.046, 1, 32), metalMaterial);
  parts.forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 1, 32), metalMaterial);
  parts.hand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.05), darkMaterial);
  parts.leftFinger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.032), darkMaterial);
  parts.rightFinger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.032), darkMaterial);
  parts.handGroup = new THREE.Group();
  parts.handGroup.add(parts.hand, parts.leftFinger, parts.rightFinger);
  for (const mesh of [pedestal, parts.shoulder, parts.elbow, parts.wrist, parts.upperArm, parts.forearm, parts.hand, parts.leftFinger, parts.rightFinger]) {
    mesh.castShadow = true;
  }
  scene.add(pedestal, parts.shoulder, parts.elbow, parts.wrist, parts.upperArm, parts.forearm, parts.handGroup);
  parts.meshes = [pedestal, parts.shoulder, parts.elbow, parts.wrist, parts.upperArm, parts.forearm];
  return parts;
}

// A simple person standing behind the counter, holding a handheld gripper.
export function buildPerson(scene) {
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd9cbb8, roughness: 0.7 });
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: 0x6f7a86, roughness: 0.8 });
  const toolMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a25, roughness: 0.45 });
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.62, 8, 24), shirtMaterial);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24), skinMaterial);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, 1, 20), shirtMaterial);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 16), skinMaterial);
  const tool = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), toolMaterial);
  handle.position.y = 0.09;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.04), toolMaterial);
  palm.position.y = 0.035;
  const leftFinger = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.03), toolMaterial);
  const rightFinger = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.03), toolMaterial);
  tool.add(handle, palm, leftFinger, rightFinger);
  group.add(body, head, arm, hand, tool);
  for (const mesh of [body, head, arm, hand, handle, palm, leftFinger, rightFinger]) mesh.castShadow = true;
  group.visible = false;
  scene.add(group);
  return { group, body, head, arm, hand, tool, leftFinger, rightFinger };
}

// The person stays behind the counter and leans along with their hand; one arm reaches the tool.
export function posePerson(person, toolTip, toolOpen) {
  const bodyX = clamp(toolTip.x * 0.6, -0.32, 0.32);
  const bodyZ = -0.72;
  person.body.position.set(bodyX, 0.12, bodyZ);
  person.head.position.set(bodyX, 0.66, bodyZ + 0.02);
  const shoulder = v(bodyX + (toolTip.x >= bodyX ? 0.13 : -0.13), 0.4, bodyZ + 0.05);
  const grip = toolTip.clone().add(v(0, 0.15, 0));
  placeBetween(person.arm, shoulder, grip);
  person.hand.position.copy(grip);
  person.tool.position.copy(toolTip);
  const gap = 0.025 + 0.04 * toolOpen;
  person.leftFinger.position.set(-gap, 0, 0);
  person.rightFinger.position.set(gap, 0, 0);
}

// Place the arm so the gripper tip reaches the target, using two-link inverse kinematics.
export function poseArm(arm, gripperTip, gripperOpen) {
  const shoulderPoint = ARM_BASE.clone().add(v(0, SHOULDER_HEIGHT, 0));
  const wristPoint = gripperTip.clone().add(v(0, GRIPPER_LENGTH, 0));
  const towardWrist = wristPoint.clone().sub(shoulderPoint);
  const horizontal = v(towardWrist.x, 0, towardWrist.z);
  const horizontalDistance = Math.max(0.001, horizontal.length());
  const horizontalDirection = horizontal.normalize();
  const verticalDistance = towardWrist.y;
  const reach = Math.min(UPPER_ARM_LENGTH + FOREARM_LENGTH - 0.001, Math.hypot(horizontalDistance, verticalDistance));
  const angleToWrist = Math.atan2(verticalDistance, horizontalDistance);
  const elbowBend = Math.acos(clamp(
    (UPPER_ARM_LENGTH ** 2 + reach ** 2 - FOREARM_LENGTH ** 2) / (2 * UPPER_ARM_LENGTH * reach), -1, 1));
  const upperArmAngle = angleToWrist + elbowBend;
  const elbowPoint = shoulderPoint.clone()
    .addScaledVector(horizontalDirection, UPPER_ARM_LENGTH * Math.cos(upperArmAngle))
    .add(v(0, UPPER_ARM_LENGTH * Math.sin(upperArmAngle), 0));
  // If the target is out of reach, put the wrist at the end of the forearm.
  const forearmDirection = wristPoint.clone().sub(elbowPoint).normalize();
  const reachedWrist = elbowPoint.clone().addScaledVector(forearmDirection, FOREARM_LENGTH);

  arm.shoulder.position.copy(shoulderPoint);
  arm.elbow.position.copy(elbowPoint);
  arm.wrist.position.copy(reachedWrist);
  placeBetween(arm.upperArm, shoulderPoint, elbowPoint);
  placeBetween(arm.forearm, elbowPoint, reachedWrist);

  // The hand points straight down and turns to face away from the base.
  arm.handGroup.position.copy(reachedWrist).add(v(0, -GRIPPER_LENGTH * 0.45, 0));
  arm.handGroup.rotation.set(0, Math.atan2(horizontalDirection.x, horizontalDirection.z) + Math.PI / 2, 0);
  const fingerGap = 0.03 + 0.05 * gripperOpen;
  arm.leftFinger.position.set(-fingerGap, -0.045, 0);
  arm.rightFinger.position.set(fingerGap, -0.045, 0);
}

export function placeBetween(mesh, fromPoint, toPoint) {
  const direction = toPoint.clone().sub(fromPoint);
  mesh.position.copy(fromPoint).addScaledVector(direction, 0.5);
  mesh.scale.set(1, direction.length(), 1);
  mesh.quaternion.setFromUnitVectors(v(0, 1, 0), direction.normalize());
}

// ---------- Paths ----------

export function makePath(points, markers) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const lastIndex = points.length - 1;
  return {
    points,
    curve,
    graspAt: markers.grasp !== undefined ? markers.grasp / lastIndex : null,
    releaseAt: markers.release !== undefined ? markers.release / lastIndex : null,
  };
}

export function makeTube(scene, curve, color, radius, baseOpacity = 1) {
  const segments = 240;
  const radialSegments = 10;
  const geometry = new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity: baseOpacity });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, material, baseOpacity, indicesPerSegment: radialSegments * 6, segments };
}

export function setTubeDrawn(tube, amount) {
  const drawnSegments = Math.round(clamp01(amount) * tube.segments);
  tube.mesh.visible = drawnSegments > 0;
  tube.mesh.geometry.setDrawRange(0, drawnSegments * tube.indicesPerSegment);
}

// Where the bowl is while the gripper moves along a path: on the table before the grasp,
// in the gripper while carrying, and at the destination after the release.
export function bowlAlong(path, motion, gripperTip, destination, restingHeight, startPosition) {
  if (path.graspAt === null || motion < path.graspAt) return startPosition;
  if (motion < path.releaseAt) return gripperTip.clone().add(v(0, -0.055, 0));
  return v(destination.x, restingHeight, destination.z);
}

export function gripOpenAlong(path, motion) {
  if (path.graspAt === null) return 1;
  if (motion < path.graspAt - 0.02) return 1;
  if (motion < path.releaseAt) return 0.25;
  return 1;
}

// ---------- Small helpers ----------

// Repeatable random numbers, so the noise looks the same on every visit.
export function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

export function v(x, y, z) { return new THREE.Vector3(x, y, z); }
export function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
export function clamp01(value) { return clamp(value, 0, 1); }
export function ease(value) { return value * value * (3 - 2 * value); }
