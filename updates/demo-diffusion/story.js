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
// Where the bowl sits when the robot tries, so it has to adapt the person's motion.
const BOWL_ROBOT_START = new THREE.Vector3(-0.27, 0, 0.25);
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
  // A faint ring where the bowl was during the demo, so the miss is easy to see.
  const oldSpot = new THREE.Mesh(
    new THREE.RingGeometry(0.085, 0.1, 48),
    new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  oldSpot.rotation.x = -Math.PI / 2;
  oldSpot.position.set(BOWL_START.x, 0.003, BOWL_START.z);
  oldSpot.visible = false;
  scene.add(oldSpot);
  const arm = buildArm(scene);

  const person = buildPerson(scene);

  // Paths
  // The person's demo: pick the bowl up from where it sits, carry it over, set it in the sink.
  const demoPath = makePath([
    HOME,
    v(BOWL_START.x, 0.3, BOWL_START.z),
    v(BOWL_START.x, 0.075, BOWL_START.z),
    v(BOWL_START.x, 0.32, BOWL_START.z),
    v(0.0, 0.44, 0.1),
    v(SINK_CENTER.x, 0.32, SINK_CENTER.z),
    v(SINK_CENTER.x, 0.075 - SINK_DEPTH * 0.6, SINK_CENTER.z),
    v(SINK_CENTER.x, 0.3, SINK_CENTER.z),
  ], { grasp: 2, release: 6 });

  // The robot's version: the same motion, bent to reach the bowl where it sits now.
  const bowlShift = BOWL_ROBOT_START.clone().sub(BOWL_START);
  const robotPath = makePath(demoPath.points.map((point, index) => {
    if (index >= 1 && index <= 3) return point.clone().add(bowlShift);
    if (index === 4) return point.clone().addScaledVector(bowlShift, 0.5);
    return point.clone();
  }), { grasp: 2, release: 6 });

  const demoTube = makeTube(scene, demoPath.curve, COLORS.accent, 0.0075);
  const robotTube = makeTube(scene, robotPath.curve, COLORS.ink, 0.006);
  // Noise dots: the demo with noise added. Each dot sits at a point along a path plus a random offset.
  const DOT_COUNT = 72;
  const dotGeometry = new THREE.SphereGeometry(0.009, 10, 8);
  const dotMaterial = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.5, transparent: true, opacity: 0.9 });
  const dots = new THREE.InstancedMesh(dotGeometry, dotMaterial, DOT_COUNT);
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dots.visible = false;
  scene.add(dots);
  const dotOffsets = [];
  const randomGenerator = seededRandom(7);
  for (let index = 0; index < DOT_COUNT; index += 1) {
    dotOffsets.push(v(randomGenerator() * 2 - 1, randomGenerator() * 2 - 1, randomGenerator() * 2 - 1).normalize().multiplyScalar(0.35 + randomGenerator() * 0.65));
  }
  const dotMatrix = new THREE.Matrix4();
  const NOISE_SPREAD = 0.08;

  // Smoothed values so jumps between steps become short motions.
  const shown = {
    gripperTip: HOME.clone(),
    bowlPosition: BOWL_START.clone(),
    gripperOpen: 1,
    cameraPosition: v(0.15, 1.25, 1.85),
    cameraTarget: v(0, 0.17, 0),
  };

  const wideShot = [v(0.05, 1.45, 2.05), v(0, 0.24, -0.05)];

  // Each step returns what the scene should look like at progress (0 to 1).
  const sideShot = [v(0.05, 1.35, 1.8), v(0, 0.2, 0)];
  const missEnd = demoPath.graspAt + 0.06;

  const steps = [
    // 0. The task: the robot puts the bowl in the sink on its own
    (progress) => ({
      gripperTip: HOME.clone().add(v(0, 0.02 * Math.sin(progress * Math.PI * 2), 0)),
      bowlPosition: BOWL_START,
      snapBowl: true,
      camera: [v(0.55 - progress * 0.4, 1.2, 1.85), v(0, 0.17, 0)],
    }),
    // 1. A person shows it once, with a handheld gripper, standing where the robot stands
    (progress) => {
      const motion = ease(clamp01((progress - 0.05) / 0.8));
      const toolTip = demoPath.curve.getPoint(motion);
      return {
        gripperTip: HOME,
        hideRobot: true,
        person: { toolTip, toolOpen: gripOpenAlong(demoPath, motion) },
        bowlPosition: bowlAlong(demoPath, motion, toolTip, SINK_CENTER, BOWL_IN_SINK_HEIGHT, BOWL_START),
        snapBowl: true,
        tubes: [[demoTube, motion]],
        camera: wideShot,
      };
    },
    // 2. Next time, the bowl starts somewhere slightly different: it slides to its new spot
    (progress) => ({
      gripperTip: HOME,
      bowlPosition: BOWL_START.clone().lerp(BOWL_ROBOT_START, ease(clamp01((progress - 0.15) / 0.55))),
      snapBowl: true,
      showOldSpot: progress > 0.15,
      tubes: [[demoTube, 1]],
      camera: sideShot,
    }),
    // 3. Copying the demo exactly: the gripper closes where the bowl used to be, and misses
    (progress) => {
      const motion = ease(clamp01(progress / 0.75)) * missEnd;
      return {
        gripperTip: demoPath.curve.getPoint(motion),
        gripperOpen: gripOpenAlong(demoPath, motion),
        bowlPosition: BOWL_ROBOT_START,
        snapBowl: true,
        showOldSpot: true,
        tubes: [[demoTube, 1]],
        camera: sideShot,
      };
    },
    // 4. We add noise to the demo: a shaken-up copy of the route appears
    (progress) => ({
      gripperTip: HOME,
      bowlPosition: BOWL_ROBOT_START,
      snapBowl: true,
      tubes: [[demoTube, 1, 1 - 0.65 * ease(progress)]],
      dots: { fromPath: demoPath, toPath: demoPath, spread: NOISE_SPREAD * ease(clamp01(progress / 0.8)), cleanup: 0 },
      camera: sideShot,
    }),
    // 5. The robot cleans it up into a smooth motion that bends to the bowl's new spot
    (progress) => {
      const cleanup = ease(clamp01((progress - 0.05) / 0.7));
      return {
        gripperTip: HOME,
        bowlPosition: BOWL_ROBOT_START,
        snapBowl: true,
        tubes: [[demoTube, 1, 0.35], [robotTube, cleanup > 0.6 ? ease((cleanup - 0.6) / 0.4) : 0]],
        dots: cleanup < 1 ? { fromPath: demoPath, toPath: robotPath, spread: NOISE_SPREAD, cleanup, fade: 1 - ease(clamp01((cleanup - 0.7) / 0.3)) } : null,
        camera: sideShot,
      };
    },
    // 6. The bowl goes in the sink, and the arm goes back to rest
    (progress) => {
      const motion = ease(clamp01((progress - 0.05) / 0.65));
      const goingHome = ease(clamp01((progress - 0.72) / 0.2));
      const pathPoint = robotPath.curve.getPoint(motion);
      return {
        gripperTip: pathPoint.clone().lerp(HOME, goingHome),
        bowlPosition: bowlAlong(robotPath, motion, pathPoint, SINK_CENTER, BOWL_IN_SINK_HEIGHT, BOWL_ROBOT_START),
        gripperOpen: gripOpenAlong(robotPath, motion),
        tubes: [[demoTube, 1, 0.4], [robotTube, 1]],
        camera: [v(0.2, 1.2, 1.7), v(0.02, 0.18, 0)],
      };
    },
  ];


  const allTubes = [demoTube, robotTube];

  function currentStoryPosition() {
    const viewportMiddle = window.innerHeight * 0.55;
    for (let index = 0; index < stepElements.length; index += 1) {
      const box = stepElements[index].getBoundingClientRect();
      if (box.bottom > viewportMiddle) {
        // The last step must finish while the stage is still on screen: the stage
        // starts scrolling away when that step's bottom reaches the bottom of the screen.
        const isLast = index === stepElements.length - 1;
        const span = isLast ? box.height - (window.innerHeight - viewportMiddle) : box.height;
        const progress = clamp01((viewportMiddle - box.top) / span);
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
    if (state.snapBowl) shown.bowlPosition.copy(state.bowlPosition);
    else shown.bowlPosition.lerp(state.bowlPosition, damping);
    shown.gripperOpen += ((state.gripperOpen ?? 1) - shown.gripperOpen) * damping;
    // Every shot is framed a little wider and higher than its raw numbers, so the raised elbow stays in view.
    const cameraTarget = state.camera[1].clone().add(v(0, 0.05, 0));
    const cameraPosition = cameraTarget.clone().addScaledVector(state.camera[0].clone().sub(state.camera[1]), 1.12);
    shown.cameraPosition.lerp(cameraPosition, damping * 0.6);
    shown.cameraTarget.lerp(cameraTarget, damping * 0.6);

    poseArm(arm, shown.gripperTip, shown.gripperOpen);
    arm.meshes.forEach((mesh) => { mesh.visible = !state.hideRobot; });
    arm.handGroup.visible = !state.hideRobot;
    bowl.position.copy(shown.bowlPosition);
    oldSpot.visible = Boolean(state.showOldSpot);
    // Dots start at the demo plus noise and, as cleanup goes to 1, settle onto the target path.
    dots.visible = Boolean(state.dots);
    if (state.dots) {
      dotMaterial.opacity = 0.9 * (state.dots.fade ?? 1);
      for (let index = 0; index < DOT_COUNT; index += 1) {
        const along = index / (DOT_COUNT - 1);
        const noisy = state.dots.fromPath.curve.getPoint(along).addScaledVector(dotOffsets[index], state.dots.spread);
        const position = noisy.lerp(state.dots.toPath.curve.getPoint(along), state.dots.cleanup);
        position.y = Math.max(position.y, 0.015);
        dotMatrix.makeTranslation(position.x, position.y, position.z);
        dots.setMatrixAt(index, dotMatrix);
      }
      dots.instanceMatrix.needsUpdate = true;
    }
    person.group.visible = Boolean(state.person);
    if (state.person) posePerson(person, state.person.toolTip, state.person.toolOpen);

    allTubes.forEach((tube) => { tube.mesh.visible = false; });
    for (const [tube, amount, opacity] of state.tubes ?? []) {
      setTubeDrawn(tube, amount);
      tube.material.opacity = (opacity ?? 1) * tube.baseOpacity;
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
  parts.meshes = [pedestal, parts.shoulder, parts.elbow, parts.wrist, parts.upperArm, parts.forearm];
  return parts;
}

// A simple person standing behind the counter, holding a handheld gripper.
function buildPerson(scene) {
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
function posePerson(person, toolTip, toolOpen) {
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
function bowlAlong(path, motion, gripperTip, destination, restingHeight, startPosition) {
  if (path.graspAt === null || motion < path.graspAt) return startPosition;
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

// Repeatable random numbers, so the noise looks the same on every visit.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function v(x, y, z) { return new THREE.Vector3(x, y, z); }
function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
function clamp01(value) { return clamp(value, 0, 1); }
function ease(value) { return value * value * (3 - 2 * value); }
