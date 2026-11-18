// Scroll-driven 3D story for the demo diffusion update.
// Every frame is a pure function of (active step, progress through that step),
// so scrolling up and down scrubs the story in both directions.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const stageElement = document.querySelector('.stage');
const canvas = stageElement.querySelector('canvas');
const stepElements = [...document.querySelectorAll('.step')];
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (error) {
  document.documentElement.classList.add('no-webgl');
}

const COLORS = {
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
const ARM_BASE = new THREE.Vector3(0, 0, -0.46);
const SHOULDER_HEIGHT = 0.26;
const UPPER_ARM_LENGTH = 0.44;
const FOREARM_LENGTH = 0.42;
const GRIPPER_LENGTH = 0.13;
const BOWL_START = new THREE.Vector3(-0.38, 0, 0.12);
const SINK_CENTER = new THREE.Vector3(0.4, 0, 0.06);
const HOME = new THREE.Vector3(0.02, 0.46, -0.12);
const SINK_DEPTH = 0.1;
const SINK_HALF_WIDTH = 0.15;
const SINK_HALF_DEPTH = 0.13;
// The bowl rests on the basin floor once it is in the sink.
const BOWL_IN_SINK_HEIGHT = -SINK_DEPTH + 0.002;

if (renderer) start();

function start() {
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

  buildTable(scene);
  const sink = buildSink(scene);
  const bowl = buildBowl(scene);
  const arm = buildArm(scene);

  // Paths
  const taskPath = makePath([
    HOME,
    v(BOWL_START.x, 0.3, BOWL_START.z),
    v(BOWL_START.x, 0.075, BOWL_START.z),
    v(BOWL_START.x, 0.32, BOWL_START.z),
    v(0.0, 0.44, 0.1),
    v(SINK_CENTER.x, 0.32, SINK_CENTER.z),
    v(SINK_CENTER.x, 0.075 - SINK_DEPTH * 0.6, SINK_CENTER.z),
    v(SINK_CENTER.x, 0.3, SINK_CENTER.z),
  ], { grasp: 2, release: 6 });

  // pi0.5's own cleaned-up motion: close to the demo, not a copy of it.
  const ownPath = makePath(taskPath.points.map((point, index) => {
    if (index === 0 || index === 2 || index === 6) return point.clone();
    return point.clone().add(v(0.018 * Math.sin(index * 1.7), 0.02 * Math.cos(index * 1.3), 0.02 * Math.sin(index * 2.1)));
  }), { grasp: 2, release: 6 });

  const wanderPath = makePath([
    HOME,
    v(-0.18, 0.34, 0.02),
    v(-0.3, 0.17, 0.24),
    v(-0.46, 0.2, 0.02),
    v(-0.22, 0.28, -0.04),
    v(-0.05, 0.36, 0.2),
    v(0.12, 0.3, 0.06),
    v(-0.12, 0.38, -0.02),
  ], {});

  const demoTube = makeTube(scene, taskPath.curve, COLORS.accent, 0.0075);
  const ownTube = makeTube(scene, ownPath.curve, COLORS.ink, 0.006);
  const wanderTube = makeTube(scene, wanderPath.curve, COLORS.noise, 0.005);
  // Noise dots: each sits at a point along a path plus a random offset.
  const DOT_COUNT = 72;
  const dotGeometry = new THREE.SphereGeometry(0.009, 10, 8);
  const dotMaterial = new THREE.MeshStandardMaterial({ color: COLORS.noise, roughness: 0.5, transparent: true, opacity: 0.9 });
  const dots = new THREE.InstancedMesh(dotGeometry, dotMaterial, DOT_COUNT);
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(dots);
  const dotOffsets = [];
  const randomGenerator = seededRandom(7);
  for (let index = 0; index < DOT_COUNT; index += 1) {
    dotOffsets.push(v(randomGenerator() * 2 - 1, randomGenerator() * 2 - 1, randomGenerator() * 2 - 1).normalize().multiplyScalar(0.35 + randomGenerator() * 0.65));
  }
  const dotMatrix = new THREE.Matrix4();

  // Smoothed values so jumps between steps become short motions.
  const shown = {
    gripperTip: HOME.clone(),
    bowlPosition: BOWL_START.clone(),
    gripperOpen: 1,
    cameraPosition: v(0.15, 1.25, 1.85),
    cameraTarget: v(0, 0.17, 0),
  };

  // Each step returns what the scene should look like at progress (0 to 1).
  const steps = [
    // 0. The setup
    (progress) => ({
      gripperTip: HOME.clone().add(v(0, 0.02 * Math.sin(progress * Math.PI * 2), 0)),
      bowlPosition: BOWL_START,
      camera: [v(0.55 - progress * 0.4, 1.2, 1.85), v(0, 0.17, 0)],
    }),
    // 1. pi0.5 alone: wanders and never picks the bowl up
    (progress) => ({
      gripperTip: wanderPath.curve.getPoint(ease(progress)),
      bowlPosition: BOWL_START,
      tubes: [[wanderTube, ease(progress)]],
      camera: [v(0.15, 1.25, 1.85), v(-0.05, 0.2, 0)],
    }),
    // 2. One expert demo: the orange line draws itself from the bowl to the sink
    (progress) => ({
      gripperTip: HOME,
      bowlPosition: BOWL_START,
      tubes: [[demoTube, ease(progress)]],
      camera: [v(0.05, 1.35, 1.75), v(0, 0.2, 0)],
    }),
    // 3. How pi0.5 normally moves: start from random noise, clean it up
    (progress) => {
      const cleanup = ease(clamp01((progress - 0.15) / 0.75));
      return {
        gripperTip: HOME,
        bowlPosition: BOWL_START,
        dots: { path: wanderPath, spread: 0.55, cleanup, color: COLORS.noise },
        tubes: [[wanderTube, cleanup > 0.98 ? 1 : 0]],
        camera: [v(0.05, 1.35, 1.75), v(0, 0.2, 0)],
      };
    },
    // 4. Our change: start from the demo plus some noise
    (progress) => ({
      gripperTip: HOME,
      bowlPosition: BOWL_START,
      tubes: [[demoTube, 1, 1 - 0.65 * ease(progress)]],
      dots: { path: taskPath, spread: 0.07 * ease(progress), cleanup: 0, color: COLORS.accent },
      camera: [v(0.05, 1.35, 1.75), v(0, 0.2, 0)],
    }),
    // 5. pi0.5 cleans that up into its own motion and does the task
    (progress) => {
      const cleanup = ease(clamp01(progress / 0.3));
      const motion = ease(clamp01((progress - 0.3) / 0.65));
      const pathPoint = ownPath.curve.getPoint(motion);
      return {
        gripperTip: pathPoint,
        bowlPosition: bowlAlong(ownPath, motion, pathPoint, SINK_CENTER, BOWL_IN_SINK_HEIGHT),
        gripperOpen: gripOpenAlong(ownPath, motion),
        tubes: [[demoTube, 1, 0.35], [ownTube, cleanup]],
        dots: cleanup < 1 ? { path: ownPath, spread: 0.07, cleanup, color: COLORS.accent, fade: 1 - cleanup } : null,
        camera: [v(0.2, 1.2, 1.7), v(0.02, 0.18, 0)],
      };
    },
  ];

  const allTubes = [demoTube, ownTube, wanderTube];

  function currentStoryPosition() {
    const viewportMiddle = window.innerHeight * 0.55;
    for (let index = 0; index < stepElements.length; index += 1) {
      const box = stepElements[index].getBoundingClientRect();
      if (box.bottom > viewportMiddle) {
        const progress = clamp01((viewportMiddle - box.top) / box.height);
        return { stepIndex: index, progress };
      }
    }
    return { stepIndex: stepElements.length - 1, progress: 1 };
  }

  let lastActiveIndex = -1;
  function markActiveStep(stepIndex) {
    if (stepIndex === lastActiveIndex) return;
    stepElements.forEach((element, index) => element.classList.toggle('is-active', index === stepIndex));
    lastActiveIndex = stepIndex;
  }

  function applyState(state, damping) {
    shown.gripperTip.lerp(state.gripperTip, damping);
    shown.bowlPosition.lerp(state.bowlPosition, damping);
    shown.gripperOpen += ((state.gripperOpen ?? 1) - shown.gripperOpen) * damping;
    // Every shot is framed a little wider and higher than its raw numbers, so the raised elbow stays in view.
    const cameraTarget = state.camera[1].clone().add(v(0, 0.05, 0));
    const cameraPosition = cameraTarget.clone().addScaledVector(state.camera[0].clone().sub(state.camera[1]), 1.12);
    shown.cameraPosition.lerp(cameraPosition, damping * 0.6);
    shown.cameraTarget.lerp(cameraTarget, damping * 0.6);

    poseArm(arm, shown.gripperTip, shown.gripperOpen);
    bowl.position.copy(shown.bowlPosition);

    allTubes.forEach((tube) => { tube.mesh.visible = false; });
    for (const [tube, amount, opacity] of state.tubes ?? []) {
      setTubeDrawn(tube, amount);
      tube.material.opacity = (opacity ?? 1) * tube.baseOpacity;
    }

    if (state.dots) {
      dots.visible = true;
      dotMaterial.color.setHex(state.dots.color);
      dotMaterial.opacity = 0.9 * (state.dots.fade ?? 1);
      for (let index = 0; index < DOT_COUNT; index += 1) {
        const along = state.dots.path.curve.getPoint(index / (DOT_COUNT - 1));
        const noisy = along.clone().addScaledVector(dotOffsets[index], state.dots.spread);
        const position = noisy.lerp(along, state.dots.cleanup);
        position.y = Math.max(position.y, 0.015);
        dotMatrix.makeTranslation(position.x, position.y, position.z);
        dots.setMatrixAt(index, dotMatrix);
      }
      dots.instanceMatrix.needsUpdate = true;
    } else {
      dots.visible = false;
    }


    camera.position.copy(shown.cameraPosition);
    camera.lookAt(shown.cameraTarget);
  }

  function resize() {
    const width = stageElement.clientWidth;
    const height = stageElement.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the scene clear of the cards: on wide screens the cards sit on the left,
    // so shift the picture right; on phones they sit at the bottom, so shift it up.
    const narrow = width < 760;
    camera.fov = narrow ? 62 : 32;
    if (narrow) camera.setViewOffset(width, height, 0, height * 0.17, width, height);
    else camera.setViewOffset(width, height, -width * 0.14, 0, width, height);
    camera.updateProjectionMatrix();
  }

  let previousTime = performance.now();
  function frame(now) {
    const elapsedSeconds = Math.min(0.1, (now - previousTime) / 1000);
    previousTime = now;
    const { stepIndex, progress } = currentStoryPosition();
    markActiveStep(stepIndex);
    const state = steps[Math.min(stepIndex, steps.length - 1)](progress);
    const damping = prefersReducedMotion.matches ? 1 : 1 - Math.exp(-elapsedSeconds * 9);
    applyState(state, damping);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  // Start from the first step's exact pose.
  applyState(steps[0](0), 1);
  requestAnimationFrame(frame);
}

// ---------- Scene pieces ----------

function buildTable(scene) {
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
  outline.holes.push(hole);
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

function buildSink(scene) {
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

function buildBowl(scene) {
  // A lathe profile gives a simple ceramic bowl with an orange glaze inside.
  const outline = [];
  for (let index = 0; index <= 16; index += 1) {
    const angle = (index / 16) * (Math.PI / 2);
    outline.push(new THREE.Vector2(0.03 + 0.055 * Math.sin(angle), 0.06 * (1 - Math.cos(angle))));
  }
  const outside = new THREE.Mesh(
    new THREE.LatheGeometry(outline, 48),
    new THREE.MeshStandardMaterial({ color: COLORS.bowl, roughness: 0.25, side: THREE.FrontSide }),
  );
  const inside = new THREE.Mesh(
    new THREE.LatheGeometry(outline.map((point) => new THREE.Vector2(point.x * 0.9, point.y + 0.004)), 48),
    new THREE.MeshStandardMaterial({ color: COLORS.bowlInside, roughness: 0.35, side: THREE.BackSide }),
  );
  // Close the bottom so the bowl doesn't show a hole from above.
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), inside.material);
  bottom.material = new THREE.MeshStandardMaterial({ color: COLORS.bowlInside, roughness: 0.35 });
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = 0.004;
  const group = new THREE.Group();
  group.add(outside, inside, bottom);
  outside.castShadow = true;
  group.position.copy(BOWL_START);
  scene.add(group);
  return group;
}

function buildArm(scene) {
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
  return parts;
}

// Place the arm so the gripper tip reaches the target, using two-link inverse kinematics.
function poseArm(arm, gripperTip, gripperOpen) {
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

function placeBetween(mesh, fromPoint, toPoint) {
  const direction = toPoint.clone().sub(fromPoint);
  mesh.position.copy(fromPoint).addScaledVector(direction, 0.5);
  mesh.scale.set(1, direction.length(), 1);
  mesh.quaternion.setFromUnitVectors(v(0, 1, 0), direction.normalize());
}

// ---------- Paths ----------

function makePath(points, markers) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const lastIndex = points.length - 1;
  return {
    points,
    curve,
    graspAt: markers.grasp !== undefined ? markers.grasp / lastIndex : null,
    releaseAt: markers.release !== undefined ? markers.release / lastIndex : null,
  };
}

function makeTube(scene, curve, color, radius, baseOpacity = 1) {
  const segments = 240;
  const radialSegments = 10;
  const geometry = new THREE.TubeGeometry(curve, segments, radius, radialSegments, false);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity: baseOpacity });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, material, baseOpacity, indicesPerSegment: radialSegments * 6, segments };
}

function setTubeDrawn(tube, amount) {
  const drawnSegments = Math.round(clamp01(amount) * tube.segments);
  tube.mesh.visible = drawnSegments > 0;
  tube.mesh.geometry.setDrawRange(0, drawnSegments * tube.indicesPerSegment);
}

// Where the bowl is while the gripper moves along a path: on the table before the grasp,
// in the gripper while carrying, and at the destination after the release.
function bowlAlong(path, motion, gripperTip, destination, restingHeight) {
  if (path.graspAt === null || motion < path.graspAt) return BOWL_START;
  if (motion < path.releaseAt) return gripperTip.clone().add(v(0, -0.055, 0));
  return v(destination.x, restingHeight, destination.z);
}

function gripOpenAlong(path, motion) {
  if (path.graspAt === null) return 1;
  if (motion < path.graspAt - 0.02) return 1;
  if (motion < path.releaseAt) return 0.25;
  return 1;
}

// ---------- Small helpers ----------

function v(x, y, z) { return new THREE.Vector3(x, y, z); }
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function clamp01(value) { return clamp(value, 0, 1); }
function ease(value) { return value * value * (3 - 2 * value); }
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
