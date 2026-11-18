// Scroll-driven 3D story for the demo diffusion update.
// Every frame is a pure function of (active step, progress through that step),
// so scrolling up and down scrubs the story in both directions.
import * as THREE from 'three';
import {
  COLORS, ARM_BASE, SHOULDER_HEIGHT, UPPER_ARM_LENGTH, FOREARM_LENGTH, GRIPPER_LENGTH,
  BOWL_START, BOWL_ROBOT_START, SINK_CENTER, HOME, SINK_DEPTH, SINK_HALF_WIDTH,
  SINK_HALF_DEPTH, BOWL_IN_SINK_HEIGHT, buildStudio, buildTable, buildSink, buildBowl,
  buildArm, buildPerson, posePerson, poseArm, makePath, makeTube,
  setTubeDrawn, bowlAlong, gripOpenAlong, seededRandom, v, clamp,
  clamp01, ease,
} from './scene-parts.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Limitations scene layout, on the same table.
const GOAL_BOWL = v(0.06, 0, 0.2);
const SMALL_BOWL_START = v(-0.36, 0, 0.1);
const ORANGE_SPOT = v(-0.14, 0.034, 0.36);
const SMALL_BOWL_NESTED_HEIGHT = 0.018;

// The post's page scrubs the story with scroll. The Updates list plays the main
// story on a timed loop as the post's preview.
const storyStage = document.querySelector('.story .stage');
if (storyStage) start(storyStage, 'scroll');
const previewStage = document.querySelector('[data-story-loop]');
if (previewStage) start(previewStage, 'loop');

function start(stageElement, mode) {
  const canvas = stageElement.querySelector('canvas');
  const dimLayer = stageElement.querySelector('.stage-dim');
  const cardFlows = mode === 'scroll' ? [...document.querySelectorAll('.card-flow')] : [];
  let shownDim = -1;
  // While cards are on screen, blur and darken the animation so the cards stand out.
  // The dim builds as the first card slides in, is full only once that card is fully in,
  // holds while the cards pass, and lifts as the last card leaves.
  function dimForFlow(flow) {
    const cards = flow.querySelectorAll('.result-card');
    if (!cards.length) return 0;
    const viewportHeight = window.innerHeight;
    const firstBox = cards[0].getBoundingClientRect();
    const lastBox = cards[cards.length - 1].getBoundingClientRect();
    const comingIn = clamp01((viewportHeight - firstBox.top) / Math.min(firstBox.height, viewportHeight));
    const goingOut = clamp01(lastBox.bottom / (viewportHeight * 0.6));
    return Math.min(comingIn, goingOut);
  }
  // Hold each result card in the middle of the screen while it is the focus.
  const resultCards = cardFlows.flatMap((flow) => [...flow.querySelectorAll('.result-card')]);
  function centerResultCards() {
    const viewportHeight = window.innerHeight;
    resultCards.forEach((card) => {
      const top = `${Math.round(Math.max(viewportHeight * 0.06, (viewportHeight - card.offsetHeight) / 2))}px`;
      if (card.style.top !== top) card.style.top = top;
    });
  }
  function updateDim() {
    centerResultCards();
    if (!cardFlows.length || !dimLayer) return;
    const dim = Math.round(Math.max(...cardFlows.map(dimForFlow)) * 100) / 100;
    if (dim === shownDim) return;
    shownDim = dim;
    dimLayer.style.opacity = String(0.45 * dim);
    canvas.style.filter = dim > 0 ? `blur(${(10 * dim).toFixed(1)}px)` : '';
  }
  const stepElements = mode === 'scroll' ? [...document.querySelectorAll('.step')] : [];
  const stepCards = stepElements.map((element) => element.querySelector('.card'));
  // The flow of cards right after a step, if any. Its first card pushes that step's text away.
  const flowAfterStep = stepElements.map((element) => {
    const next = element.nextElementSibling;
    return next && next.classList.contains('card-flow') ? next.querySelector('.result-card') : null;
  });
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

  // Limitations scene: the goal is the orange in the bowl, but the demo nests a small bowl instead.
  const smallBowl = buildBowl(scene, { outsideColor: 0xb8432a, insideColor: 0x8f3220, size: 0.72 });
  smallBowl.visible = false;
  const orange = new THREE.Mesh(
    new THREE.SphereGeometry(0.034, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xf08a24, roughness: 0.6 }),
  );
  orange.castShadow = true;
  orange.position.copy(ORANGE_SPOT);
  orange.visible = false;
  scene.add(orange);
  // A see-through orange in the bowl marks where the orange should end up.
  const goalMaterial = new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.4, depthWrite: false });
  const goalOrange = new THREE.Mesh(new THREE.SphereGeometry(0.036, 32, 24), goalMaterial);
  goalOrange.position.set(GOAL_BOWL.x, 0.05, GOAL_BOWL.z);
  goalOrange.visible = false;
  scene.add(goalOrange);

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

  // The wrong demo: pick up the small bowl and nest it in the big bowl.
  const wrongDemoPath = makePath([
    HOME,
    v(SMALL_BOWL_START.x, 0.3, SMALL_BOWL_START.z),
    v(SMALL_BOWL_START.x, 0.065, SMALL_BOWL_START.z),
    v(SMALL_BOWL_START.x, 0.3, SMALL_BOWL_START.z),
    v(-0.15, 0.4, 0.16),
    v(GOAL_BOWL.x, 0.3, GOAL_BOWL.z),
    v(GOAL_BOWL.x, 0.085, GOAL_BOWL.z),
    v(GOAL_BOWL.x, 0.3, GOAL_BOWL.z),
  ], { grasp: 2, release: 6 });
  const wrongDemoTube = makeTube(scene, wrongDemoPath.curve, COLORS.accent, 0.0075);
  const wrongRobotTube = makeTube(scene, wrongDemoPath.curve, COLORS.ink, 0.006);
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
  const limitsShot = [v(-0.02, 1.3, 1.75), v(-0.05, 0.15, 0.1)];
  const limitsWideShot = [v(0.35, 1.75, 2.3), v(-0.05, 0.12, 0.1)];
  const limitsCloseShot = [v(-0.1, 0.95, 1.25), v(-0.06, 0.08, 0.22)];

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
    // Limitations 1. The camera settles on a new scene: a big bowl, a small bowl and an orange.
    (progress) => ({
      scene: 'limits',
      gripperTip: HOME,
      bowlPosition: GOAL_BOWL,
      snapBowl: true,
      limits: { smallBowlPosition: SMALL_BOWL_START, goal: 0 },
      camera: [limitsWideShot[0].clone().lerp(limitsShot[0], ease(progress)), limitsWideShot[1].clone().lerp(limitsShot[1], ease(progress))],
    }),
    // Limitations 2. What we ask for: the orange in the bowl. The goal fades in as a see-through orange.
    (progress) => ({
      scene: 'limits',
      gripperTip: HOME,
      bowlPosition: GOAL_BOWL,
      snapBowl: true,
      limits: { smallBowlPosition: SMALL_BOWL_START, goal: ease(clamp01(progress / 0.8)) },
      camera: limitsShot,
    }),
    // Limitations 3. The demo shows a different task: nesting the small bowl in the big one.
    (progress) => {
      const motion = ease(clamp01((progress - 0.05) / 0.8));
      const toolTip = wrongDemoPath.curve.getPoint(motion);
      return {
        scene: 'limits',
        gripperTip: HOME,
        hideRobot: true,
        person: { toolTip, toolOpen: gripOpenAlong(wrongDemoPath, motion) },
        bowlPosition: GOAL_BOWL,
        snapBowl: true,
        limits: { smallBowlPosition: bowlAlong(wrongDemoPath, motion, toolTip, GOAL_BOWL, SMALL_BOWL_NESTED_HEIGHT, SMALL_BOWL_START), goal: 0.6 },
        tubes: [[wrongDemoTube, motion]],
        camera: limitsShot,
      };
    },
    // Limitations 4. The robot follows the demo anyway: it nests the bowl and leaves the orange.
    (progress) => {
      const motion = ease(clamp01((progress - 0.05) / 0.65));
      const goingHome = ease(clamp01((progress - 0.72) / 0.2));
      const pathPoint = wrongDemoPath.curve.getPoint(motion);
      return {
        scene: 'limits',
        gripperTip: pathPoint.clone().lerp(HOME, goingHome),
        gripperOpen: gripOpenAlong(wrongDemoPath, motion),
        bowlPosition: GOAL_BOWL,
        snapBowl: true,
        limits: { smallBowlPosition: bowlAlong(wrongDemoPath, motion, pathPoint, GOAL_BOWL, SMALL_BOWL_NESTED_HEIGHT, SMALL_BOWL_START), goal: 0.6 + 0.4 * goingHome },
        tubes: [[wrongDemoTube, 1, 0.4], [wrongRobotTube, motion]],
        camera: limitsShot,
      };
    },
    // Limitations 5. The result: the bowls are stacked and the orange is still out. The camera moves in on it.
    (progress) => ({
      scene: 'limits',
      gripperTip: HOME,
      bowlPosition: GOAL_BOWL,
      snapBowl: true,
      limits: { smallBowlPosition: GOAL_BOWL.clone().setY(SMALL_BOWL_NESTED_HEIGHT), goal: 1 },
      tubes: [[wrongDemoTube, 1, 0.25], [wrongRobotTube, 1, 0.5]],
      camera: [limitsShot[0].clone().lerp(limitsCloseShot[0], ease(progress)), limitsShot[1].clone().lerp(limitsCloseShot[1], ease(progress))],
    }),
  ];


  const allTubes = [demoTube, robotTube, wrongDemoTube, wrongRobotTube];

  // A step plays while its card holds in place: near the top on wide screens,
  // near the bottom on phones, where the stage fills the top of the screen.
  function storyAnchor() {
    return window.innerHeight * (window.innerWidth < 760 ? 0.75 : 0.45);
  }

  function currentStoryPosition() {
    const anchor = storyAnchor();
    for (let index = 0; index < stepElements.length; index += 1) {
      const box = stepElements[index].getBoundingClientRect();
      if (box.bottom > anchor) {
        // While a panel still covers the screen, keep showing the step before it,
        // so the switch to the next scene happens out of sight.
        if (index > 0 && box.top > window.innerHeight) return { stepIndex: index - 1, progress: 1 };
        // A step right before a panel must finish before the panel starts covering the stage.
        const beforePanel = !stepElements[index].nextElementSibling?.classList.contains('step');
        const span = beforePanel ? box.height - (window.innerHeight - anchor) : box.height;
        const progress = clamp01((anchor - box.top) / span);
        return { stepIndex: index, progress };
      }
    }
    return { stepIndex: stepElements.length - 1, progress: 1 };
  }

  // Pacing: each step's animation plays first with no text on screen. Only when it has finished does
  // the text fade and slide in to explain it. As the next step's animation starts, that text fades out.
  const ANIMATION_SHARE = 0.55;
  const TEXT_IN_START = 0.6;
  const TEXT_IN_LENGTH = 0.15;
  const TEXT_OUT_LENGTH = 0.2;
  const TEXT_SLIDE_PIXELS = 24;
  function animationProgress(stepProgress) {
    return clamp01(stepProgress / ANIMATION_SHARE);
  }
  function updateStepText(position) {
    const viewportHeight = window.innerHeight;
    stepCards.forEach((card, index) => {
      if (!card) return;
      let shown = 0;
      let slide = TEXT_SLIDE_PIXELS;
      if (index === position.stepIndex) {
        shown = clamp01((position.progress - TEXT_IN_START) / TEXT_IN_LENGTH);
        slide = TEXT_SLIDE_PIXELS * (1 - shown);
      } else if (index === position.stepIndex - 1) {
        const leaving = clamp01(position.progress / TEXT_OUT_LENGTH);
        shown = 1 - leaving;
        slide = -TEXT_SLIDE_PIXELS * leaving;
      }
      const flowCard = flowAfterStep[index];
      if (flowCard && shown > 0) {
        // The first result card coming up from the bottom pushes this text out.
        const leaving = clamp01((viewportHeight - flowCard.getBoundingClientRect().top) / (viewportHeight * 0.35));
        if (leaving > 0) { shown *= 1 - leaving; slide = -TEXT_SLIDE_PIXELS * leaving; }
      }
      shown = Math.round(shown * 100) / 100;
      if (prefersReducedMotion.matches) slide = 0;
      card.style.opacity = String(shown);
      card.style.transform = `translateY(${slide.toFixed(1)}px)`;
      card.style.visibility = shown > 0 ? 'visible' : 'hidden';
    });
  }

  // Keep every step's text on one line: if a line is wider than the screen allows, shrink its type to fit.
  function fitStepText() {
    const availableWidth = Math.min(1080, window.innerWidth - 40);
    stepCards.forEach((card) => {
      const phrase = card && card.querySelector('.phrase');
      if (!phrase) return;
      phrase.style.fontSize = '';
      const baseSize = parseFloat(getComputedStyle(phrase).fontSize);
      const lineWidth = phrase.scrollWidth;
      if (lineWidth > availableWidth) phrase.style.fontSize = `${Math.floor(baseSize * availableWidth / lineWidth)}px`;
    });
  }

  let lastActiveIndex = -1;
  function markActiveStep(stepIndex) {
    if (stepIndex === lastActiveIndex) return;
    stepElements.forEach((element, index) => element.classList.toggle('is-active', index === stepIndex));
    lastActiveIndex = stepIndex;
  }

  let shownSceneName = null;
  function applyState(state, damping) {
    // Jumping between the main story and the limitations story happens behind a panel, so snap.
    const sceneName = state.scene ?? 'main';
    const switchingScene = sceneName !== shownSceneName;
    shownSceneName = sceneName;
    if (switchingScene) damping = 1;
    shown.gripperTip.lerp(state.gripperTip, damping);
    if (state.snapBowl) shown.bowlPosition.copy(state.bowlPosition);
    else shown.bowlPosition.lerp(state.bowlPosition, damping);
    shown.gripperOpen += ((state.gripperOpen ?? 1) - shown.gripperOpen) * damping;
    // Every shot is framed a little wider and higher than its raw numbers, so the raised elbow stays in view.
    const cameraTarget = state.camera[1].clone().add(v(0, 0.05, 0));
    const cameraPosition = cameraTarget.clone().addScaledVector(state.camera[0].clone().sub(state.camera[1]), 1.12 * framingDistanceScale);
    const cameraDamping = switchingScene ? 1 : damping * 0.6;
    shown.cameraPosition.lerp(cameraPosition, cameraDamping);
    shown.cameraTarget.lerp(cameraTarget, cameraDamping);

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
    smallBowl.visible = orange.visible = goalOrange.visible = Boolean(state.limits);
    if (state.limits) {
      smallBowl.position.copy(state.limits.smallBowlPosition);
      // The goal marker breathes gently so it reads as a target, not an object.
      const breathing = prefersReducedMotion.matches ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 420);
      goalMaterial.opacity = (0.22 + 0.28 * breathing) * state.limits.goal;
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

  // On narrow or portrait screens the camera pulls back so the whole scene
  // (person, arm, bowl and sink) always fits across the width.
  let framingDistanceScale = 1;
  const SCENE_HALF_WIDTH_TAN = 0.4;
  function resize() {
    const width = stageElement.clientWidth;
    const height = stageElement.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the scene clear of the cards: on wide screens the cards sit on the left,
    // so shift the picture right; on phones they sit at the bottom, so shift it up.
    const narrow = mode === 'scroll' && width < 760;
    camera.fov = narrow ? 46 : 32;
    const horizontalHalfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    framingDistanceScale = Math.max(1, SCENE_HALF_WIDTH_TAN / horizontalHalfTan);
    if (mode === 'loop') camera.clearViewOffset();
    else if (narrow) camera.setViewOffset(width, height, 0, height * 0.17, width, height);
    else camera.setViewOffset(width, height, -width * (camera.aspect >= 1.2 ? 0.14 : 0.06), 0, width, height);
    camera.updateProjectionMatrix();
  }

  // The timed loop: the person's demo, the bowl moves, noise, cleanup, the robot does it.
  // Each entry is [step index, seconds].
  const LOOP_STEPS = [[1, 4.2], [2, 2.2], [4, 1.8], [5, 2.4], [6, 4.2]];
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
    return { stepIndex: 6, progress: 1 };
  }

  let previousTime = performance.now();
  function frame(now) {
    const elapsedSeconds = Math.min(0.1, (now - previousTime) / 1000);
    previousTime = now;
    let position;
    if (mode === 'loop') {
      if (!previewVisible) { requestAnimationFrame(frame); return; }
      loopSeconds = (loopSeconds + elapsedSeconds) % LOOP_SECONDS;
      position = loopPosition();
      // Fade out at the end of the loop and back in at the start, so the restart isn't a jump.
      const edgeSeconds = Math.min(loopSeconds, LOOP_SECONDS - loopSeconds);
      canvas.style.opacity = String(clamp01(edgeSeconds / LOOP_FADE_SECONDS));
    } else {
      position = currentStoryPosition();
      markActiveStep(position.stepIndex);
      updateStepText(position);
      updateDim();
      position = { stepIndex: position.stepIndex, progress: animationProgress(position.progress) };
    }
    const state = steps[Math.min(position.stepIndex, steps.length - 1)](position.progress);
    const damping = prefersReducedMotion.matches ? 1 : 1 - Math.exp(-elapsedSeconds * 9);
    applyState(state, damping);
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
      // No looping motion: show one still frame of the robot putting the bowl in the sink.
      applyState(steps[6](0.5), 1);
      renderer.render(scene, camera);
      return;
    }
  }
  // Start from the first step's exact pose.
  applyState(steps[mode === 'loop' ? 1 : 0](0), 1);
  requestAnimationFrame(frame);
}
