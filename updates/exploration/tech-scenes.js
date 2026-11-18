// Robot animations for the technical section: the same counter, arm, camera and bowl as the story
// at the top of the page. Each one loops, and only runs while it is on screen.
import * as THREE from 'three';
import {
  COLORS, HOME, buildStudio, buildTable, buildSink, buildBowl, buildArm, poseArm,
  makePath, makeTube, setTubeDrawn, seededRandom, v, clamp01, ease,
  EXPLORE_BOWL, GRASP_HEIGHT, GRIP_ON_BOWL, HAND_TURN, buildRobotCamera,
  buildGhostHand, setGhostOpen, rimGrasp, armGrasp, poseGhost,
} from './scene-parts.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const between = (time, start, length) => clamp01((time - start) / length);

// ---------- Moves ----------
// A reach that comes down at `spot` and closes there. With `lifts`, it closes on the bowl and lifts it;
// without, it closes on nothing and lifts away empty.
function reachPath(spot, approach, lifts) {
  return Object.assign(makePath([
    HOME,
    approach,
    v(spot.x, 0.27, spot.z),
    v(spot.x, GRASP_HEIGHT, spot.z),
    v(spot.x, lifts ? 0.34 : 0.3, spot.z),
  ], { grasp: 3, release: 4 }), { lifts });
}

// The hand along a reach at progress 0 to 1: it pauses where it closes, and a miss goes back to rest.
const PAUSE_LENGTH = 0.08;
function handAlong(path, progress) {
  const time = ease(clamp01(progress / 0.86)) * (1 + PAUSE_LENGTH);
  const stop = path.graspAt;
  const closedTo = path.lifts ? GRIP_ON_BOWL : 0;
  let motion = time;
  let open = 1;
  if (time > stop && time <= stop + PAUSE_LENGTH) {
    motion = stop;
    open = 1 + (closedTo - 1) * ease(clamp01((time - stop) / (PAUSE_LENGTH * 0.75)));
  } else if (time > stop + PAUSE_LENGTH) {
    motion = Math.min(1, time - PAUSE_LENGTH);
    open = closedTo;
  }
  const closed = time > stop + PAUSE_LENGTH * 0.75;
  const goingHome = path.lifts ? 0 : ease(clamp01((progress - 0.88) / 0.12));
  return {
    tip: path.curve.getPoint(motion).lerp(HOME, goingHome),
    open: open + (1 - open) * goingHome,
    held: path.lifts && closed,
    closed,
    motion,
  };
}

function gaussian(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function makeRing(scene, color, opacity) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.022, 0.029, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  return ring;
}

// ---------- 1. Every demo comes at the bowl the same way ----------
function demosScene({ scene, bowl }) {
  const bowlAt = EXPLORE_BOWL;
  const random = seededRandom(5);
  const jitter = (size) => (random() * 2 - 1) * size;
  const DEMO_COUNT = 7;
  const DEMO_SECONDS = 2.1;
  const HOLD_SECONDS = 1.6;
  const demos = [];
  for (let index = 0; index < DEMO_COUNT; index += 1) {
    // Every demo: in from the back right, down onto the bowl, lift it, set it back down, back to rest.
    const approach = v(bowlAt.x + 0.17 + jitter(0.035), 0.36 + jitter(0.03), bowlAt.z - 0.16 + jitter(0.035));
    const above = v(bowlAt.x + jitter(0.012), 0.27 + jitter(0.02), bowlAt.z + jitter(0.012));
    const grasp = v(bowlAt.x, GRASP_HEIGHT, bowlAt.z);
    const path = makePath([HOME, approach, above, grasp, v(bowlAt.x, 0.3, bowlAt.z), grasp, v(bowlAt.x, 0.26, bowlAt.z), HOME], { grasp: 3, release: 5 });
    const trail = makeTube(scene, makePath([HOME, approach, above, grasp], {}).curve, COLORS.ink, 0.0032, 0.45);
    demos.push({ path, trail });
  }
  const loop = DEMO_COUNT * DEMO_SECONDS + HOLD_SECONDS;
  return {
    loop,
    still: loop - 0.2,
    shot: [v(-0.45, 1.3, 1.85), v(-0.06, 0.24, -0.02)],
    draw(time) {
      const index = Math.min(DEMO_COUNT - 1, Math.floor(time / DEMO_SECONDS));
      const running = time < DEMO_COUNT * DEMO_SECONDS;
      const progress = running ? (time - index * DEMO_SECONDS) / DEMO_SECONDS : 1;
      const { path } = demos[index];
      const motion = ease(clamp01(progress));
      const tip = path.curve.getPoint(motion);
      const holding = motion > path.graspAt && motion < path.releaseAt;
      let open = 1;
      if (motion > path.graspAt - 0.03 && motion < path.releaseAt + 0.03) open = GRIP_ON_BOWL;
      bowl.position.copy(holding ? tip.clone().add(v(0, -GRASP_HEIGHT, 0)) : bowlAt);
      demos.forEach((demo, demoIndex) => {
        if (demoIndex < index) setTubeDrawn(demo.trail, 1);
        else if (demoIndex === index) setTubeDrawn(demo.trail, clamp01(motion / path.graspAt));
        else setTubeDrawn(demo.trail, 0);
      });
      return { tip, open, fade: 1 - between(time, loop - 0.35, 0.35) };
    },
  };
}

// ---------- 3. In each scene, the policy closes at the same wrong spot ----------
function biasScene({ scene, bowl }) {
  const layouts = [
    { bowl: v(-0.08, 0, 0.2), gap: v(-0.2, 0, 0) },
    { bowl: v(-0.3, 0, 0.02), gap: v(0.12, 0, 0.16) },
    { bowl: v(0.06, 0, 0.3), gap: v(0, 0, -0.2) },
  ];
  const right = buildGhostHand(scene, COLORS.accent);
  setGhostOpen(right, GRIP_ON_BOWL);
  const ring = makeRing(scene, COLORS.ink, 0.5);
  const gapLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([v(0, 0, 0), v(1, 0, 0)]),
    new THREE.LineDashedMaterial({ color: COLORS.ink, dashSize: 0.018, gapSize: 0.012, transparent: true }),
  );
  scene.add(gapLine);
  for (const layout of layouts) {
    layout.spot = layout.bowl.clone().add(layout.gap);
    const toward = layout.spot.clone().lerp(HOME, 0.45);
    layout.path = reachPath(layout.spot, v(toward.x, 0.36, toward.z), false);
  }
  const SCENE_SECONDS = 5.4;
  const loop = SCENE_SECONDS * layouts.length;
  return {
    loop,
    still: 4.4,
    shot: [v(-0.06, 1.22, 1.58), v(-0.1, 0.1, 0.12)],
    draw(time) {
      const layout = layouts[Math.floor(time / SCENE_SECONDS) % layouts.length];
      const local = time % SCENE_SECONDS;
      bowl.position.copy(layout.bowl);
      // The grasp that works, on the bowl.
      const showRight = ease(between(local, 0.25, 0.5));
      right.group.visible = showRight > 0.01;
      right.material.opacity = 0.55 * showRight;
      poseGhost(right, armGrasp(v(layout.bowl.x, GRASP_HEIGHT, layout.bowl.z)), 0.06 * (1 - showRight));
      // The policy, twice: the same move, closing at the same spot.
      const firstTry = between(local, 0.7, 1.9);
      const secondTry = between(local, 2.7, 1.9);
      const hand = local < 2.65 ? handAlong(layout.path, firstTry) : handAlong(layout.path, secondTry);
      const landed = local > 0.7 + 1.9 * 0.5;
      ring.visible = landed;
      ring.position.set(layout.spot.x, 0.003, layout.spot.z);
      const showGap = ease(between(local, 0.7 + 1.9 * 0.55, 0.4));
      gapLine.visible = showGap > 0.01;
      gapLine.material.opacity = showGap;
      gapLine.geometry.setFromPoints([v(layout.spot.x, 0.004, layout.spot.z), v(layout.bowl.x, 0.004, layout.bowl.z)]);
      gapLine.computeLineDistances();
      const fade = Math.min(between(local, 0, 0.3), 1 - between(local, SCENE_SECONDS - 0.35, 0.35));
      return { tip: hand.tip, open: hand.open, fade };
    },
  };
}

// ---------- 4. Random wiggles stay around the policy's move ----------
// The arm tries the policy's grasp again and again with a little random noise added. Each try
// leaves a faint copy behind. They all stay around the same wrong spot, and none reaches the bowl.
function wiggleScene({ scene, bowl }) {
  bowl.position.copy(EXPLORE_BOWL);
  const right = buildGhostHand(scene, COLORS.accent);
  setGhostOpen(right, GRIP_ON_BOWL);
  right.group.visible = true;
  right.material.opacity = 0.55;
  poseGhost(right, armGrasp(v(EXPLORE_BOWL.x, GRASP_HEIGHT, EXPLORE_BOWL.z)));
  const policySpot = v(EXPLORE_BOWL.x - 0.2, GRASP_HEIGHT + 0.02, EXPLORE_BOWL.z);
  const random = seededRandom(23);
  const WIGGLE_COUNT = 10;
  const wiggles = [];
  for (let index = 0; index < WIGGLE_COUNT; index += 1) {
    const ghost = buildGhostHand(scene, COLORS.ink);
    setGhostOpen(ghost, 0.6);
    // Never closer to the bowl than the policy's own move, so no copy touches it.
    const tip = policySpot.clone().add(v(Math.min(0.01, gaussian(random) * 0.03), gaussian(random) * 0.012, gaussian(random) * 0.04));
    poseGhost(ghost, armGrasp(tip));
    wiggles.push({ ghost, tip });
  }
  const SPACING = 0.55;
  const loop = WIGGLE_COUNT * SPACING + 2.4;
  return {
    loop,
    still: loop - 0.5,
    shot: [v(-0.26, 0.98, 1.32), v(-0.16, 0.1, 0.12)],
    draw(time) {
      const step = Math.min(WIGGLE_COUNT - 1, Math.floor(Math.max(0, time - 0.4) / SPACING));
      const local = clamp01((time - 0.4 - step * SPACING) / SPACING);
      const from = step === 0 ? policySpot.clone().add(v(0, 0.12, 0)) : wiggles[step - 1].tip;
      const arrive = ease(clamp01(local / 0.6));
      const tip = from.clone().lerp(wiggles[step].tip, arrive).add(v(0, 0.04 * Math.sin(Math.PI * arrive), 0));
      wiggles.forEach(({ ghost }, index) => {
        const shown = index < step || (index === step && local > 0.6) ? 1 : 0;
        ghost.group.visible = shown > 0;
        ghost.material.opacity = 0.16;
      });
      const done = time > 0.4 + WIGGLE_COUNT * SPACING;
      return {
        tip: done ? wiggles[WIGGLE_COUNT - 1].tip.clone().lerp(HOME, ease(between(time, 0.4 + WIGGLE_COUNT * SPACING, 1.2))) : tip,
        open: 0.6,
        fade: Math.min(between(time, 0, 0.3), 1 - between(time, loop - 0.35, 0.35)),
      };
    },
  };
}

// ---------- 5. The blindfolded model turns a noisy plan into new, realistic grasps ----------
// The policy's grasp is broken up into heavy noise. The blindfolded model, which sees no image,
// cleans the noise up into grasps that come at the bowl from many sides.
function blindfoldScene({ scene, bowl, robotCamera }) {
  bowl.position.copy(EXPLORE_BOWL);
  robotCamera.blindfold.visible = true;
  robotCamera.blindfold.position.y = 0;
  const policy = buildGhostHand(scene, COLORS.ink);
  setGhostOpen(policy, 0.6);
  const policyGrasp = armGrasp(v(EXPLORE_BOWL.x - 0.2, GRASP_HEIGHT, EXPLORE_BOWL.z));
  poseGhost(policy, policyGrasp);
  // Points along a grasp: from between the finger tips up through the wrist.
  const alongGrasp = (grasp, amount) => grasp.tip.clone().addScaledVector(grasp.up, amount * (grasp.reach + 0.14));
  // New grasps on the bowl's rim, each from a different side and at a different angle:
  // [side of the bowl, lean away from straight down], in radians.
  const GRASPS = [[Math.PI * 0.85, 0.6], [Math.PI * 0.45, 0.3], [Math.PI * 0.05, 0.7], [-Math.PI * 0.35, 0.15], [-Math.PI * 0.72, 0.45]];
  const tries = GRASPS.map(([side, tilt]) => {
    const grasp = rimGrasp(EXPLORE_BOWL, side, tilt);
    const ghost = buildGhostHand(scene, COLORS.ink);
    poseGhost(ghost, grasp);
    return { ghost, grasp };
  });
  const POINTS_PER_TRY = 18;
  const dotCount = POINTS_PER_TRY * tries.length;
  const dots = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.008, 10, 8),
    new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.5, transparent: true }),
    dotCount,
  );
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(dots);
  const random = seededRandom(31);
  const scatter = Array.from({ length: dotCount }, () => v(gaussian(random), gaussian(random) * 0.5, gaussian(random)).multiplyScalar(0.15));
  const matrix = new THREE.Matrix4();
  const loop = 8;
  return {
    loop,
    still: 6.6,
    shot: [v(-0.32, 1.02, 1.36), v(-0.18, 0.13, 0.02)],
    draw(time) {
      const showPolicy = ease(between(time, 0.3, 0.5));
      const noise = ease(between(time, 1.4, 0.9));
      const settle = ease(between(time, 2.9, 1.5));
      policy.group.visible = showPolicy > 0.01;
      policy.material.opacity = 0.4 * showPolicy * (1 - 0.75 * noise);
      dots.visible = noise > 0;
      dots.material.opacity = 0.9 * (1 - ease(between(time, 4.5, 0.7)));
      for (let index = 0; index < dotCount; index += 1) {
        const along = Math.floor(index / tries.length) / (POINTS_PER_TRY - 1);
        const position = alongGrasp(policyGrasp, along).addScaledVector(scatter[index], noise)
          .lerp(alongGrasp(tries[index % tries.length].grasp, along), settle);
        position.y = Math.max(position.y, 0.012);
        matrix.makeTranslation(position.x, position.y, position.z);
        dots.setMatrixAt(index, matrix);
      }
      dots.instanceMatrix.needsUpdate = true;
      tries.forEach((attempt, index) => {
        const appear = ease(between(time, 4.1 + index * 0.15, 0.5));
        attempt.ghost.group.visible = appear > 0.01;
        attempt.ghost.material.opacity = 0.34 * appear;
      });
      return { tip: HOME.clone().add(v(0.01 * Math.sin(time * 1.3), 0, 0)), open: 1, fade: Math.min(between(time, 0, 0.3), 1 - between(time, loop - 0.35, 0.35)) };
    },
  };
}

const SCENES = { demos: demosScene, bias: biasScene, wiggles: wiggleScene, blindfold: blindfoldScene };

function mount(stage) {
  const build = SCENES[stage.dataset.techScene];
  const canvas = stage.querySelector('canvas');
  if (!build || !canvas) return;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    stage.classList.add('no-webgl');
    return;
  }
  const { scene, camera } = buildStudio(renderer);
  buildTable(scene);
  buildSink(scene);
  const bowl = buildBowl(scene);
  bowl.position.copy(EXPLORE_BOWL);
  const arm = buildArm(scene);
  const robotCamera = buildRobotCamera(scene);
  const play = build({ scene, bowl, arm, robotCamera });

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = 30;
    camera.updateProjectionMatrix();
  }
  function render(time) {
    const state = play.draw(time);
    poseArm(arm, state.tip, state.open);
    arm.handGroup.rotation.y += HAND_TURN;
    canvas.style.opacity = String(Math.round(clamp01(state.fade ?? 1) * 100) / 100);
    camera.position.copy(play.shot[0]);
    camera.lookAt(play.shot[1]);
    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener('resize', () => { resize(); if (!running) render(prefersReducedMotion.matches ? play.still : lastTime); });
  let running = false;
  let startedAt = 0;
  let lastTime = play.still;
  function frame(now) {
    if (!running) return;
    lastTime = ((now - startedAt) / 1000) % play.loop;
    render(lastTime);
    requestAnimationFrame(frame);
  }
  render(play.still);
  new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    if (visible && !running && !prefersReducedMotion.matches) {
      running = true;
      startedAt = performance.now();
      requestAnimationFrame(frame);
    } else if (!visible) {
      running = false;
    }
  }, { threshold: 0.15 }).observe(stage);
}

document.querySelectorAll('[data-tech-scene]').forEach(mount);
