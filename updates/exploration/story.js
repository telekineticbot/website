// Scroll-driven 3D story for the exploration update, built on the same stage,
// pacing and scene pieces as the DemoDiffusion post.
// Every frame is a pure function of (active step, progress through that step),
// so scrolling up and down scrubs the story in both directions.
import * as THREE from 'three';
import {
  COLORS, HOME, buildStudio, buildTable, buildSink, buildBowl, buildArm,
  poseArm, makePath, makeTube, setTubeDrawn, seededRandom, v, clamp01, ease,
  EXPLORE_BOWL as BOWL, GRASP_HEIGHT, GRIP_ON_BOWL, HAND_TURN, BLINDFOLD_LIFT,
  buildRobotCamera, buildGhostHand, rimGrasp, poseGhost,
} from './scene-parts.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Layout on the same counter as the DemoDiffusion post. The task: pick up the bowl.
// The robot's own move comes down beside the bowl, to its left, and closes on nothing.
const HABIT_GRASP = v(BOWL.x - 0.2, 0, BOWL.z);
// The faint copies of the gripper in the exploring step.
const GHOST_OPACITY = 0.3;

const storyStage = document.querySelector('.story .stage');
if (storyStage) start(storyStage, 'scroll');
const previewStage = document.querySelector('[data-story-loop="exploration"]');
if (previewStage) start(previewStage, 'loop');

function start(stageElement, mode) {
  const canvas = stageElement.querySelector('canvas');
  const storyElement = stageElement.closest('.story');
  const stepElements = mode === 'scroll' ? [...document.querySelectorAll('.step')] : [];
  const stepCards = stepElements.map((element) => element.querySelector('.card'));
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    document.documentElement.classList.add('no-webgl');
    return;
  }
  if (mode === 'scroll') document.documentElement.classList.add('paced');
  const { scene, camera } = buildStudio(renderer);

  buildTable(scene);
  buildSink(scene);
  const bowl = buildBowl(scene);
  bowl.position.copy(BOWL);
  const arm = buildArm(scene);

  // The robot's camera, and the box that goes over it as a blindfold.
  const robotCamera = buildRobotCamera(scene);

  // Small rings on the table where earlier tries closed on nothing.
  const RING_COUNT = 16;
  const ringMaterial = new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.42, depthWrite: false });
  const ringGeometry = new THREE.RingGeometry(0.022, 0.029, 40);
  const rings = [];
  for (let index = 0; index < RING_COUNT; index += 1) {
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    rings.push(ring);
  }

  // ---------- Paths ----------
  // The hard part is the grasp. A try that misses comes down beside the bowl, closes on nothing and
  // lifts away empty. The try that works closes on the bowl and lifts it off the table.
  function missPath(spot, approach) {
    return Object.assign(makePath([
      HOME,
      approach,
      v(spot.x, 0.27, spot.z),
      v(spot.x, GRASP_HEIGHT, spot.z),
      v(spot.x, 0.3, spot.z),
    ], { grasp: 3, release: 4 }), { lifts: false, closeSpot: v(spot.x, 0, spot.z) });
  }
  function graspPath(approach) {
    return Object.assign(makePath([
      HOME,
      approach,
      v(BOWL.x, 0.27, BOWL.z),
      v(BOWL.x, GRASP_HEIGHT, BOWL.z),
      v(BOWL.x, 0.34, BOWL.z),
    ], { grasp: 3, release: 4 }), { lifts: true, closeSpot: v(BOWL.x, 0, BOWL.z) });
  }

  // What the robot does on its own: a tidy move that comes down beside the bowl and closes on nothing.
  const habitPath = missPath(HABIT_GRASP, v(-0.2, 0.36, 0.02));

  // Wiggles: the same move with small random jitter added on the way down, so each try closes
  // a little off, but always near the same wrong spot.
  const WIGGLE_COUNT = 8;
  const SAMPLES = 84;
  const CLOSE_SAMPLE = 63;
  const wiggleRandom = seededRandom(11);
  const centered = () => wiggleRandom() + wiggleRandom() + wiggleRandom() - 1.5;
  const wigglePaths = [];
  for (let wiggle = 0; wiggle < WIGGLE_COUNT; wiggle += 1) {
    // Never closer to the bowl than the robot's own move, so no wiggle touches it.
    const shift = v(Math.min(0.005, centered() * 0.04), 0, centered() * 0.06);
    const jitter = [];
    for (let index = 0; index <= SAMPLES; index += 1) jitter.push(v(centered(), centered() * 0.7, centered()).multiplyScalar(0.02));
    const points = [];
    for (let index = 0; index <= SAMPLES; index += 1) {
      const point = habitPath.curve.getPoint(index / SAMPLES);
      const along = clamp01(index / CLOSE_SAMPLE);
      point.addScaledVector(shift, ease(along));
      // Jitter only on the way down, and none at the start or where the fingers close.
      if (index > 0 && index < CLOSE_SAMPLE) {
        const neighbors = jitter[index - 1].clone().add(jitter[index]).add(jitter[index + 1]).multiplyScalar(1 / 3);
        point.addScaledVector(neighbors, Math.sin(Math.PI * along));
      }
      points.push(point);
    }
    wigglePaths.push(Object.assign(makePath(points, { grasp: CLOSE_SAMPLE, release: SAMPLES }), {
      lifts: false,
      closeSpot: HABIT_GRASP.clone().add(shift).setY(0),
    }));
  }

  // Blindfolded plans: realistic moves that come at the bowl from genuinely different sides.
  // Four still miss the grasp; the fifth closes on the bowl and lifts it.
  const plans = [
    missPath(v(BOWL.x + 0.01, 0, BOWL.z - 0.2), v(BOWL.x + 0.04, 0.38, BOWL.z - 0.26)),
    missPath(v(BOWL.x + 0.2, 0, BOWL.z), v(BOWL.x + 0.24, 0.36, BOWL.z - 0.08)),
    missPath(v(BOWL.x + 0.14, 0, BOWL.z + 0.15), v(BOWL.x + 0.16, 0.36, BOWL.z + 0.06)),
    missPath(v(BOWL.x - 0.13, 0, BOWL.z + 0.15), v(BOWL.x - 0.16, 0.36, BOWL.z + 0.04)),
    graspPath(v(BOWL.x + 0.1, 0.4, BOWL.z - 0.1)),
  ];
  const SUCCESS_PLAN = plans.length - 1;

  const habitTube = makeTube(scene, habitPath.curve, COLORS.ink, 0.006);
  const wiggleTubes = wigglePaths.map((path) => makeTube(scene, path.curve, COLORS.ink, 0.0035, 0.55));
  const planTubes = plans.map((path) => makeTube(scene, path.curve, COLORS.ink, 0.0055));
  // Ways it could go: faint copies of the gripper, each closing on the bowl's rim from a different side.
  // [side of the bowl, lean away from straight down], in radians.
  const GHOST_GRASPS = [[Math.PI * 0.8, 0.6], [Math.PI * 0.42, 0.3], [Math.PI * 0.05, 0.7], [-Math.PI * 0.35, 0.15]];
  const ghostHands = GHOST_GRASPS.map(([side, tilt]) => ({ ...buildGhostHand(scene), grasp: rimGrasp(BOWL, side, tilt) }));
  const allTubes = [habitTube, ...wiggleTubes, ...planTubes];
  const inkColor = new THREE.Color(COLORS.ink);
  const accentColor = new THREE.Color(COLORS.accent);

  // The rough plan: dots scattered around the robot's own move. As the blindfolded model fills in
  // motion, each dot settles onto one of the new plans.
  const DOTS_PER_PLAN = 24;
  const DOT_COUNT = DOTS_PER_PLAN * plans.length;
  const dotGeometry = new THREE.SphereGeometry(0.009, 10, 8);
  const dotMaterial = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.5, transparent: true, opacity: 0.9 });
  const dots = new THREE.InstancedMesh(dotGeometry, dotMaterial, DOT_COUNT);
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dots.visible = false;
  scene.add(dots);
  const dotOffsets = [];
  const dotRandom = seededRandom(7);
  for (let index = 0; index < DOT_COUNT; index += 1) {
    dotOffsets.push(v(dotRandom() * 2 - 1, (dotRandom() * 2 - 1) * 0.6, dotRandom() * 2 - 1).normalize().multiplyScalar(0.3 + dotRandom() * 0.7));
  }
  const dotMatrix = new THREE.Matrix4();
  // Heavy noise: the plan is scattered across most of the table before the model cleans it up.
  const ROUGH_SPREAD = 0.34;

  // ---------- One try ----------
  // The hand pauses where it closes, so the fingers visibly close before it lifts.
  const PAUSE_LENGTH = 0.08;
  function pacedMotion(path, raw) {
    const stop = path.graspAt;
    const closedTo = path.lifts ? GRIP_ON_BOWL : 0;
    const time = raw * (1 + PAUSE_LENGTH);
    if (time <= stop) return { motion: time, gripperOpen: 1, closed: false };
    if (time <= stop + PAUSE_LENGTH) {
      const closing = ease(clamp01((time - stop) / (PAUSE_LENGTH * 0.75)));
      return { motion: stop, gripperOpen: 1 + (closedTo - 1) * closing, closed: time > stop + PAUSE_LENGTH * 0.75 };
    }
    return { motion: Math.min(1, time - PAUSE_LENGTH), gripperOpen: closedTo, closed: true };
  }
  // A try, at progress 0 to 1. A miss runs the path and goes back to rest; the bowl stays put.
  // The grasp that works lifts the bowl and holds it up.
  function tryAlong(path, progress) {
    const { motion, gripperOpen, closed } = pacedMotion(path, ease(clamp01(progress / 0.86)));
    const goingHome = path.lifts ? 0 : ease(clamp01((progress - 0.88) / 0.12));
    const gripperTip = path.curve.getPoint(motion).lerp(HOME, goingHome);
    const bowlHeld = path.lifts && closed;
    return {
      gripperTip,
      gripperOpen: gripperOpen + (1 - gripperOpen) * goingHome,
      bowlHeld,
      motion,
      lifted: bowlHeld && motion > path.graspAt + 0.02,
      missed: closed && !path.lifts,
    };
  }
  // A run of tries one after another inside a single step. Returns the try under way and the spots
  // where earlier tries closed on nothing.
  function tryRun(pathList, progress) {
    const count = pathList.length;
    const index = Math.min(count - 1, Math.floor(progress * count));
    const current = tryAlong(pathList[index], progress * count - index);
    const misses = pathList.slice(0, index).filter((path) => !path.lifts).map((path) => path.closeSpot);
    if (current.missed) misses.push(pathList[index].closeSpot);
    return { index, current, misses };
  }

  // ---------- Shots ----------
  const introShot = (progress) => [v(0.42 - progress * 0.4, 1.25, 1.9), v(-0.14, 0.17, 0)];
  const mainShot = [v(0.02, 1.32, 1.82), v(-0.14, 0.17, 0.02)];
  // Close on the bowl, so the copies of the gripper on its rim are easy to read.
  const ghostShot = [v(-0.02, 1.02, 1.42), v(-0.08, 0.14, 0.08)];
  // Close on the bowl and the wrong spot beside it.
  const clusterShot = [v(-0.12, 0.98, 1.42), v(-0.2, 0.06, 0.2)];
  // Close on the robot's camera, so the blindfold going on is easy to see.
  const blindShot = [v(-0.4, 0.54, 0.1), v(-0.58, 0.33, -0.3)];
  const planShot = [v(-0.06, 1.42, 1.95), v(-0.16, 0.2, 0.04)];
  const lerpShot = (from, to, amount) => [from[0].clone().lerp(to[0], amount), from[1].clone().lerp(to[1], amount)];

  // ---------- Steps ----------
  // The traces of the wiggles so far: earlier ones in full, the current one as far as the hand has gone.
  const wiggleTubesUpTo = (done, motion) => wiggleTubes.slice(0, done + 1).map((tube, index) => [tube, index < done ? 1 : motion, 0.85]);
  const FIRST_WIGGLES = 2;
  const habitMiss = [habitPath.closeSpot];
  const wiggleMisses = wigglePaths.map((path) => path.closeSpot);

  const steps = [
    // 0. We want robots that improve themselves: the scene, with the robot at rest.
    (progress) => ({
      gripperTip: HOME.clone().add(v(0, 0.02 * Math.sin(progress * Math.PI * 2), 0)),
      camera: introShot(progress),
    }),
    // 1. Give it a task it can't solve yet: the robot reaches for the bowl, and its fingers close beside it.
    (progress) => {
      const attempt = tryAlong(habitPath, clamp01((progress - 0.1) / 0.9));
      return {
        ...attempt,
        rings: attempt.missed ? habitMiss : [],
        tubes: [[habitTube, attempt.motion]],
        camera: mainShot,
      };
    },
    // 2. It has to explore to find a way: the hand stops, and faint copies of the gripper appear one
    // after another, each trying the bowl's rim from a different side. The camera pulls back a little.
    (progress) => ({
      gripperTip: HOME.clone().add(v(0.05 * Math.sin(progress * Math.PI * 2), 0.015 * Math.sin(progress * Math.PI * 4), 0)),
      rings: habitMiss,
      ringFade: 1 - ease(clamp01(progress / 0.15)),
      ghosts: ghostHands.map((ghost, index) => ease(clamp01((progress - 0.12 - index * 0.16) / 0.22))),
      tubes: [[habitTube, 1, 1 - 0.65 * ease(clamp01(progress / 0.3))]],
      camera: lerpShot(mainShot, ghostShot, ease(clamp01(progress / 0.5))),
    }),
    // 3. Most methods wiggle around: the same move, with a little random jitter, twice.
    (progress) => {
      const run = tryRun(wigglePaths.slice(0, FIRST_WIGGLES), progress);
      return {
        ...run.current,
        rings: run.misses,
        ghosts: ghostHands.map(() => 1 - ease(clamp01(progress / 0.12))),
        tubes: [[habitTube, 1, 0.35], ...wiggleTubesUpTo(run.index, run.current.motion)],
        camera: lerpShot(ghostShot, mainShot, ease(clamp01(progress / 0.3))),
      };
    },
    // 4. Wiggling rarely finds anything new: the rest of the wiggles, faster, all closing on nothing
    // in the same place. Then the camera moves in on the cluster beside the untouched bowl.
    (progress) => {
      const run = tryRun(wigglePaths.slice(FIRST_WIGGLES), clamp01(progress / 0.78));
      return {
        ...run.current,
        rings: [...wiggleMisses.slice(0, FIRST_WIGGLES), ...run.misses],
        tubes: [[habitTube, 1, 0.35], ...wiggleTubesUpTo(run.index + FIRST_WIGGLES, run.current.motion)],
        camera: lerpShot(mainShot, clusterShot, ease(clamp01((progress - 0.55) / 0.45))),
      };
    },
    // 5. Ours: blindfold it and give it the rough plan. The wiggles clear away. The camera moves in on
    // the robot's camera, and a box is lowered over it. Then, back on the table, the robot's own move
    // breaks up into a rough cloud.
    (progress) => {
      const clearing = ease(clamp01(progress / 0.25));
      const blind = ease(clamp01((progress - 0.25) / 0.3));
      const roughness = ease(clamp01((progress - 0.66) / 0.3));
      const toCamera = ease(clamp01(progress / 0.3));
      const backToTable = ease(clamp01((progress - 0.58) / 0.3));
      return {
        gripperTip: HOME,
        rings: clearing < 1 ? wiggleMisses : [],
        ringFade: 1 - clearing,
        blind,
        tubes: [
          [habitTube, 1, 0.35 * (1 - 0.85 * roughness)],
          ...wiggleTubes.map((tube) => [tube, 1, 0.85 * (1 - clearing)]),
        ],
        dots: roughness > 0 ? { spread: ROUGH_SPREAD * roughness, settle: 0, fade: clamp01(roughness * 3) } : null,
        camera: backToTable > 0 ? lerpShot(blindShot, planShot, backToTable) : lerpShot(clusterShot, blindShot, toCamera),
      };
    },
    // 6. It fills in realistic motion on its own: the cloud settles into several clean, different moves.
    (progress) => {
      const settle = ease(clamp01((progress - 0.05) / 0.7));
      const drawPlans = ease(clamp01((settle - 0.55) / 0.45));
      return {
        gripperTip: HOME,
        blind: 1,
        tubes: [[habitTube, 1, 0.05 * (1 - settle)], ...planTubes.map((tube) => [tube, drawPlans, 0.7])],
        dots: settle < 1 ? { spread: ROUGH_SPREAD, settle, fade: 1 - ease(clamp01((settle - 0.7) / 0.3)) } : null,
        camera: planShot,
      };
    },
    // 7. Many new tries, one works: the robot runs the plans quickly, one after another.
    // Four close on nothing in new places; the fifth closes on the bowl and lifts it.
    (progress) => {
      const run = tryRun(plans, clamp01(progress / 0.94));
      const success = run.index === SUCCESS_PLAN && run.current.lifted;
      return {
        ...run.current,
        blind: 1,
        rings: run.misses,
        successGlow: success ? 1 : 0,
        tubes: planTubes.map((tube, index) => {
          if (index === run.index) return [tube, 1, 1];
          return [tube, 1, index < run.index ? 0.3 : 0.55];
        }),
        camera: planShot,
      };
    },
  ];

  // A step plays while its text holds in place: near the top on wide screens,
  // near the bottom on phones, where the stage fills the top of the screen.
  function storyAnchor() {
    return window.innerHeight * (window.innerWidth < 760 ? 0.75 : 0.45);
  }

  function currentStoryPosition() {
    const anchor = storyAnchor();
    for (let index = 0; index < stepElements.length; index += 1) {
      const box = stepElements[index].getBoundingClientRect();
      if (box.bottom > anchor) {
        // The last step must finish before the stage starts to scroll away.
        const last = !stepElements[index].nextElementSibling?.classList.contains('step');
        const span = last ? box.height - (window.innerHeight - anchor) : box.height;
        const progress = clamp01((anchor - box.top) / span);
        return { stepIndex: index, progress };
      }
    }
    return { stepIndex: stepElements.length - 1, progress: 1 };
  }

  // Pacing, as in the DemoDiffusion post: each step's animation plays first with no text on screen.
  // Only when it has finished does the text fade and slide in to anchor it. As the next step's
  // animation starts, that text fades out.
  const ANIMATION_SHARE = 0.62;
  const TEXT_IN_START = 0.66;
  const TEXT_IN_LENGTH = 0.12;
  const TEXT_OUT_LENGTH = 0.15;
  const TEXT_SLIDE_PIXELS = 24;
  function animationProgress(stepProgress) {
    return clamp01(stepProgress / ANIMATION_SHARE);
  }
  function updateStepText(position) {
    const viewportHeight = window.innerHeight;
    // The last line fades as the story scrolls away, so it never sits over the citations.
    const storyBottom = storyElement ? storyElement.getBoundingClientRect().bottom : viewportHeight;
    const leavingStory = clamp01((viewportHeight - storyBottom) / (viewportHeight * 0.3));
    stepCards.forEach((card, index) => {
      if (!card) return;
      let shown = 0;
      let slide = TEXT_SLIDE_PIXELS;
      if (index === position.stepIndex) {
        shown = clamp01((position.progress - TEXT_IN_START) / TEXT_IN_LENGTH);
        slide = TEXT_SLIDE_PIXELS * (1 - shown);
        if (leavingStory > 0) { shown *= 1 - leavingStory; slide = -TEXT_SLIDE_PIXELS * leavingStory; }
      } else if (index === position.stepIndex - 1) {
        const leaving = clamp01(position.progress / TEXT_OUT_LENGTH);
        shown = 1 - leaving;
        slide = -TEXT_SLIDE_PIXELS * leaving;
      }
      shown = Math.round(shown * 100) / 100;
      if (prefersReducedMotion.matches) slide = 0;
      card.style.opacity = String(shown);
      card.style.transform = `translateY(${slide.toFixed(1)}px)`;
      card.style.visibility = shown > 0 ? 'visible' : 'hidden';
    });
  }

  // Keep each step's text on one line on wide screens, and at most two lines on phones:
  // if a line would need more room than that, shrink its type until it fits.
  function fitStepText() {
    const narrow = window.innerWidth < 760;
    const availableWidth = Math.min(1080, window.innerWidth - 40) * (narrow ? 1.9 : 1);
    stepCards.forEach((card) => {
      const phrase = card && card.querySelector('.phrase');
      if (!phrase) return;
      phrase.style.fontSize = '';
      phrase.style.whiteSpace = 'nowrap';
      const baseSize = parseFloat(getComputedStyle(phrase).fontSize);
      const lineWidth = phrase.scrollWidth;
      phrase.style.whiteSpace = '';
      if (lineWidth > availableWidth) phrase.style.fontSize = `${Math.floor(baseSize * availableWidth / lineWidth)}px`;
    });
  }

  let lastActiveIndex = -1;
  function markActiveStep(stepIndex) {
    if (stepIndex === lastActiveIndex) return;
    stepElements.forEach((element, index) => element.classList.toggle('is-active', index === stepIndex));
    lastActiveIndex = stepIndex;
  }

  // The camera eases toward each shot. Poses are exact for a given progress; progress itself is eased,
  // so the hand, its fingers and the bowl always move as one.
  const shown = {
    cameraPosition: v(0.15, 1.25, 1.85),
    cameraTarget: v(0, 0.17, 0),
    stepIndex: -1,
    progress: 0,
  };
  function applyState(state, damping) {
    const cameraTarget = state.camera[1].clone().add(v(0, 0.05, 0));
    const cameraPosition = cameraTarget.clone().addScaledVector(state.camera[0].clone().sub(state.camera[1]), 1.12 * framingDistanceScale);
    shown.cameraPosition.lerp(cameraPosition, damping * 0.6);
    shown.cameraTarget.lerp(cameraTarget, damping * 0.6);

    poseArm(arm, state.gripperTip, state.gripperOpen ?? 1);
    arm.handGroup.rotation.y += HAND_TURN;
    if (state.bowlHeld) bowl.position.copy(state.gripperTip).add(v(0, -GRASP_HEIGHT, 0));
    else bowl.position.copy(BOWL);

    const landings = state.rings ?? [];
    ringMaterial.opacity = 0.42 * (state.ringFade ?? 1);
    rings.forEach((ring, index) => {
      ring.visible = index < landings.length;
      if (ring.visible) ring.position.set(landings[index].x, 0.003, landings[index].z);
    });

    const ghostAmounts = state.ghosts ?? [];
    ghostHands.forEach((ghost, index) => {
      const amount = ghostAmounts[index] ?? 0;
      ghost.group.visible = amount > 0.01;
      ghost.material.opacity = GHOST_OPACITY * amount;
      // Each copy slides the last few centimetres in onto the rim as it appears.
      poseGhost(ghost, ghost.grasp, 0.08 * (1 - amount));
    });

    const blind = state.blind ?? 0;
    robotCamera.blindfold.visible = blind > 0;
    robotCamera.blindfold.position.y = BLINDFOLD_LIFT * (1 - blind);

    dots.visible = Boolean(state.dots);
    if (state.dots) {
      dotMaterial.opacity = 0.9 * (state.dots.fade ?? 1);
      for (let index = 0; index < DOT_COUNT; index += 1) {
        const plan = plans[index % plans.length];
        const along = Math.floor(index / plans.length) / (DOTS_PER_PLAN - 1);
        const rough = habitPath.curve.getPoint(along).addScaledVector(dotOffsets[index], state.dots.spread);
        const position = rough.lerp(plan.curve.getPoint(along), state.dots.settle);
        position.y = Math.max(position.y, 0.015);
        dotMatrix.makeTranslation(position.x, position.y, position.z);
        dots.setMatrixAt(index, dotMatrix);
      }
      dots.instanceMatrix.needsUpdate = true;
    }

    allTubes.forEach((tube) => { tube.mesh.visible = false; });
    for (const [tube, amount, opacity] of state.tubes ?? []) {
      setTubeDrawn(tube, amount);
      tube.material.opacity = clamp01(opacity ?? 1) * tube.baseOpacity;
    }
    planTubes[SUCCESS_PLAN].material.color.copy(inkColor).lerp(accentColor, state.successGlow ?? 0);

    camera.position.copy(shown.cameraPosition);
    camera.lookAt(shown.cameraTarget);
  }

  // On narrow or portrait screens the camera pulls back so the whole table always fits across the width.
  let framingDistanceScale = 1;
  const SCENE_HALF_WIDTH_TAN = 0.4;
  function resize() {
    if (mode === 'scroll') {
      // The stage starts below the sticky header; tell the page how tall the header is.
      const header = document.querySelector('.site-header');
      if (header) document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
    }
    const width = stageElement.clientWidth;
    const height = stageElement.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the scene clear of the text: on wide screens the text sits at the top left,
    // so shift the picture right; on phones it sits at the bottom, so shift it up.
    const narrow = mode === 'scroll' && width < 760;
    camera.fov = narrow ? 46 : 32;
    const horizontalHalfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    framingDistanceScale = 1.08 * Math.max(1, SCENE_HALF_WIDTH_TAN / horizontalHalfTan);
    if (mode === 'loop') camera.clearViewOffset();
    else if (narrow) camera.setViewOffset(width, height, 0, height * 0.17, width, height);
    else camera.setViewOffset(width, height, -width * (camera.aspect >= 1.2 ? 0.14 : 0.06), 0, width, height);
    camera.updateProjectionMatrix();
  }

  // The timed loop for the Updates list: wiggles, the blindfold, the new plans, the tries.
  // Each entry is [step index, seconds].
  const LOOP_STEPS = [[3, 5.4], [4, 5.0], [5, 4.2], [6, 3.6], [7, 9.0]];
  const LOOP_SECONDS = LOOP_STEPS.reduce((total, [, seconds]) => total + seconds, 0);
  const LOOP_FADE_SECONDS = 0.45;
  let loopSeconds = 0;
  let previewVisible = true;
  function loopPosition() {
    let remaining = loopSeconds;
    for (const [stepIndex, seconds] of LOOP_STEPS) {
      if (remaining < seconds) return { stepIndex, progress: remaining / seconds };
      remaining -= seconds;
    }
    return { stepIndex: 7, progress: 1 };
  }

  let previousTime = performance.now();
  function frame(now) {
    const elapsedSeconds = Math.min(0.1, (now - previousTime) / 1000);
    previousTime = now;
    const damping = prefersReducedMotion.matches ? 1 : 1 - Math.exp(-elapsedSeconds * 9);
    let position;
    if (mode === 'loop') {
      if (!previewVisible) { requestAnimationFrame(frame); return; }
      loopSeconds = (loopSeconds + elapsedSeconds) % LOOP_SECONDS;
      position = loopPosition();
      // Fade out at the end of the loop and back in at the start, so the restart isn't a jump.
      const edgeSeconds = Math.min(loopSeconds, LOOP_SECONDS - loopSeconds);
      canvas.style.opacity = String(clamp01(edgeSeconds / LOOP_FADE_SECONDS));
      shown.stepIndex = position.stepIndex;
      shown.progress = position.progress;
    } else {
      position = currentStoryPosition();
      markActiveStep(position.stepIndex);
      updateStepText(position);
      const target = animationProgress(position.progress);
      const stepIndex = Math.min(position.stepIndex, steps.length - 1);
      // Entering a step going down starts its animation from the beginning; going up, from the end.
      if (stepIndex !== shown.stepIndex) {
        shown.progress = shown.stepIndex === -1 ? target : (stepIndex > shown.stepIndex ? 0 : 1);
        shown.stepIndex = stepIndex;
      }
      shown.progress += (target - shown.progress) * damping;
      if (Math.abs(target - shown.progress) < 0.0005) shown.progress = target;
    }
    applyState(steps[Math.min(shown.stepIndex, steps.length - 1)](shown.progress), damping);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  if (mode === 'scroll') {
    fitStepText();
    window.addEventListener('resize', fitStepText);
    if (document.fonts) document.fonts.ready.then(fitStepText);
  }
  if (mode === 'loop') {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => { previewVisible = entries[0].isIntersecting; }).observe(stageElement);
    }
    if (prefersReducedMotion.matches) {
      // No looping motion: show one still frame of the robot lifting the bowl.
      applyState(steps[7](0.93), 1);
      renderer.render(scene, camera);
      return;
    }
  }
  // Start from the first step's exact pose.
  const first = mode === 'loop' ? LOOP_STEPS[0][0] : 0;
  shown.cameraPosition.copy(steps[first](0).camera[0]);
  applyState(steps[first](0), 1);
  requestAnimationFrame(frame);
}
