// The technical section's robot animations. Each figure is a function of time, so the
// same code runs in the page and in the checks. Nothing here touches the page itself.
import * as THREE from 'three';
import {
  COLORS, ARM_BASE, EXPLORE_BOWL, BLINDFOLD_LIFT,
  buildTable, buildBowl, buildArm, buildRobotCamera, buildGhostHand, setGhostOpen,
  poseArm, seededRandom, v, clamp, clamp01, ease,
} from './scene-parts.js';

export const BOWL = EXPLORE_BOWL.clone();
// Where the arm waits between tries.
const REST = v(-0.06, 0.34, -0.04);
// From the fingertips to the middle of the hand, the same for the arm and for a faint copy of the hand.
const HAND_REACH = 0.0715;
// A pinch on the bowl's rim: fingertips just inside the wall, low enough to hold it.
const PINCH_RADIUS = 0.081;
const PINCH_HEIGHT = 0.0435;
// A grasp that closes on nothing, beside the bowl.
const MISS_HEIGHT = 0.03;
const RED = 0xc9472b;

// ---------- Poses ----------
// A grasp is where the fingertips meet, the turn of the hand about the vertical, and,
// for a faint copy only, a lean away from vertical.
export function pose(tip, yaw, leanX = 0, leanZ = 0) { return { tip: tip.clone(), yaw, leanX, leanZ }; }

// The hand's turn when the arm reaches a point without being told how to turn it.
export function naturalYaw(tip) { return Math.atan2(tip.x - ARM_BASE.x, tip.z - ARM_BASE.z) + Math.PI; }

// A pinch on the rim of a bowl at `center`, at angle `side` around it, fingers closing across the wall.
export function rimPinch(center, side) {
  const outward = v(Math.cos(side), 0, Math.sin(side));
  return pose(center.clone().addScaledVector(outward, PINCH_RADIUS).setY(PINCH_HEIGHT), -side);
}

// A grasp beside the bowl that closes on nothing.
export function missAt(x, z) { const tip = v(x, MISS_HEIGHT, z); return pose(tip, naturalYaw(tip)); }

// The gripper looks the same after half a turn, so turn the short way round.
function blendYaw(from, to, amount) {
  let difference = (to - from) % Math.PI;
  if (difference > Math.PI / 2) difference -= Math.PI;
  if (difference < -Math.PI / 2) difference += Math.PI;
  return from + difference * amount;
}

export function blendPose(from, to, amount) {
  return {
    tip: from.tip.clone().lerp(to.tip, amount),
    yaw: blendYaw(from.yaw, to.yaw, amount),
    leanX: from.leanX + (to.leanX - from.leanX) * amount,
    leanZ: from.leanZ + (to.leanZ - from.leanZ) * amount,
  };
}

function poseQuaternion(grasp) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(grasp.leanX, grasp.yaw, grasp.leanZ, 'YXZ'));
}

export function placeGhost(ghost, grasp, open = 0.3) {
  const quaternion = poseQuaternion(grasp);
  ghost.group.quaternion.copy(quaternion);
  ghost.group.position.copy(grasp.tip).addScaledVector(v(0, 1, 0).applyQuaternion(quaternion), HAND_REACH);
  setGhostOpen(ghost, open);
}

export function placeArm(arm, grasp, open) {
  poseArm(arm, grasp.tip, open);
  arm.handGroup.rotation.set(0, grasp.yaw, 0);
  arm.handGroup.userData.target = grasp.tip;
}

// ---------- Timelines ----------
// Keys are { at, grasp, open, hold }. Between keys the pose eases; `hold` switches at a key.
export function track(rawKeys) {
  // Turn each key's hand the short way from the key before, so the hand never flips half a turn.
  const keys = rawKeys.map((key) => ({ ...key, grasp: { ...key.grasp } }));
  for (let index = 1; index < keys.length; index += 1) keys[index].grasp.yaw = blendYaw(keys[index - 1].grasp.yaw, keys[index].grasp.yaw, 1);
  const duration = keys[keys.length - 1].at;
  return {
    duration,
    at(time) {
      if (time <= keys[0].at) return { ...keys[0] };
      for (let index = 0; index < keys.length - 1; index += 1) {
        const from = keys[index], to = keys[index + 1];
        if (time < to.at) {
          const amount = ease((time - from.at) / (to.at - from.at));
          return { grasp: blendPose(from.grasp, to.grasp, amount), open: from.open + (to.open - from.open) * amount, hold: from.hold, holdFrom: from.holdFrom };
        }
      }
      return { ...keys[keys.length - 1] };
    },
  };
}

const lifted = (grasp, height) => ({ ...grasp, tip: grasp.tip.clone().add(v(0, height, 0)) });
export const restPose = () => pose(REST, naturalYaw(REST));

// One try from rest: reach above the grasp, go down, close, rise. If `lifts`, the bowl comes up,
// is held, and is set back down where it was; otherwise the hand opens on nothing and goes back.
export function tryKeys(target, { lifts = false, start = 0, pace = 1, closeTo = 0 } = {}) {
  const rest = restPose();
  const above = lifted(target, 0.14);
  const time = (seconds) => start + seconds * pace;
  const keys = [
    { at: time(0), grasp: rest, open: 1, hold: false },
    { at: time(1.0), grasp: above, open: 1, hold: false },
    { at: time(1.45), grasp: target, open: 1, hold: false },
    { at: time(1.75), grasp: target, open: closeTo, hold: lifts, holdFrom: target },
  ];
  if (lifts) {
    keys.push(
      { at: time(2.35), grasp: lifted(target, 0.13), open: closeTo, hold: true, holdFrom: target },
      { at: time(3.05), grasp: lifted(target, 0.13), open: closeTo, hold: true, holdFrom: target },
      { at: time(3.6), grasp: target, open: closeTo, hold: true, holdFrom: target },
      { at: time(3.85), grasp: target, open: 1, hold: false },
      { at: time(4.2), grasp: lifted(target, 0.1), open: 1, hold: false },
      { at: time(5.0), grasp: rest, open: 1, hold: false },
    );
  } else {
    keys.push(
      { at: time(2.3), grasp: lifted(target, 0.12), open: closeTo, hold: false },
      { at: time(2.55), grasp: lifted(target, 0.12), open: 1, hold: false },
      { at: time(3.4), grasp: rest, open: 1, hold: false },
    );
  }
  return keys;
}

// Several tries in a row, with a short pause after each.
function trySequence(targets, { pace = 1, gap = 0.3, lead = 0.4 } = {}) {
  const keys = [{ at: 0, grasp: restPose(), open: 1, hold: false }];
  const tries = [];
  let time = lead;
  for (const target of targets) {
    const tryKeyList = tryKeys(target.grasp, { lifts: target.lifts, start: time, pace });
    tries.push({ start: time, closeAt: tryKeyList[3].at, end: tryKeyList[tryKeyList.length - 1].at, ...target });
    keys.push(...tryKeyList.slice(1));
    time = tryKeyList[tryKeyList.length - 1].at + gap;
    keys.push({ at: time, grasp: restPose(), open: 1, hold: false });
  }
  return { motion: track(keys), tries, end: time };
}

// ---------- The scene ----------
// The same table, bowl, arm and robot camera as the rest of the post.
export function buildRobotScene(scene, { bowlAt = BOWL } = {}) {
  buildTable(scene, { withSinkHole: false });
  const bowl = buildBowl(scene);
  bowl.position.copy(bowlAt);
  const arm = buildArm(scene);
  const robotCamera = buildRobotCamera(scene);
  const markMaterial = new THREE.MeshBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0, depthWrite: false });
  return { scene, bowl, bowlHome: bowlAt.clone(), arm, robotCamera, markMaterial };
}

// Small dark discs on the table where a try closed on nothing.
function buildMarks(parts, count) {
  const geometry = new THREE.CircleGeometry(0.013, 28);
  const marks = [];
  for (let index = 0; index < count; index += 1) {
    const material = parts.markMaterial.clone();
    const mark = new THREE.Mesh(geometry, material);
    mark.rotation.x = -Math.PI / 2;
    mark.visible = false;
    parts.scene.add(mark);
    marks.push(mark);
  }
  return marks;
}
function showMark(mark, grasp, opacity) {
  mark.position.set(grasp.tip.x, 0.0015, grasp.tip.z);
  mark.material.opacity = 0.5 * clamp01(opacity);
  mark.visible = opacity > 0.01;
}

function buildGhosts(scene, count, color) {
  return Array.from({ length: count }, () => buildGhostHand(scene, color));
}
function showGhost(ghost, grasp, opacity, open = 0.3) {
  ghost.group.visible = opacity > 0.005;
  ghost.material.opacity = clamp01(opacity);
  if (ghost.group.visible) placeGhost(ghost, grasp, open);
}

// Put the arm and the bowl where a timeline says.
function applyMotion(parts, state) {
  placeArm(parts.arm, state.grasp, state.open);
  if (state.hold && state.holdFrom) {
    parts.bowl.position.copy(parts.bowlHome).add(state.grasp.tip.clone().sub(state.holdFrom.tip));
  } else {
    parts.bowl.position.copy(parts.bowlHome);
  }
}

// The box over the robot's camera: 0 is raised out of sight, 1 is down over the camera.
function setBlindfold(parts, amount) {
  const box = parts.robotCamera.blindfold;
  box.visible = amount > 0.001;
  box.position.y = BLINDFOLD_LIFT * (1 - ease(clamp01(amount)));
}

// A fade that rises over `rise` seconds from `from`, and falls over `fall` seconds before `to`.
export function window01(time, from, to, rise = 0.4, fall = 0.4) {
  if (time <= from || time >= to) return 0;
  return Math.min(ease(clamp01((time - from) / rise)), ease(clamp01((to - time) / fall)));
}

// ---------- A stand-in for the action data ----------
// Grasps of the kind a large dataset holds: all over the table, at many heights and turns,
// and a few on the rim of a bowl. The action model below learns only these.
export function actionData() {
  const random = seededRandom(17);
  const grasps = [];
  for (let side = 0; side < 6; side += 1) grasps.push(rimPinch(BOWL, Math.PI + side * (Math.PI / 3)));
  let tries = 0;
  while (grasps.length < 70 && tries < 5000) {
    tries += 1;
    const x = -0.48 + random() * 0.78;
    const z = -0.1 + random() * 0.46;
    if (Math.hypot(x - BOWL.x, z - BOWL.z) < 0.125) continue;
    if (Math.hypot(x - ARM_BASE.x, z - ARM_BASE.z) < 0.32) continue;
    if (Math.hypot(x - ARM_BASE.x, z - ARM_BASE.z) > 0.8) continue;
    if (grasps.some((grasp) => Math.hypot(grasp.tip.x - x, grasp.tip.z - z) < 0.05)) continue;
    grasps.push(pose(v(x, 0.022 + random() * 0.05, z), random() * Math.PI));
  }
  return grasps;
}

// The action model works on a few numbers per grasp: where the fingertips are, scaled,
// and the turn of the hand, written so that half a turn gives the same numbers.
const CENTER = v(-0.08, 0.12, 0.12);
const SPREAD = 0.2, HEIGHT_SPREAD = 0.05, TURN_WEIGHT = 0.6;
export function encode(grasp) {
  return [
    (grasp.tip.x - CENTER.x) / SPREAD,
    (grasp.tip.y - CENTER.y) / HEIGHT_SPREAD,
    (grasp.tip.z - CENTER.z) / SPREAD,
    TURN_WEIGHT * Math.cos(2 * grasp.yaw),
    TURN_WEIGHT * Math.sin(2 * grasp.yaw),
  ];
}
export function decode(numbers) {
  return pose(
    v(CENTER.x + numbers[0] * SPREAD, Math.max(0.02, CENTER.y + numbers[1] * HEIGHT_SPREAD), CENTER.z + numbers[2] * SPREAD),
    Math.atan2(numbers[4], numbers[3]) / 2,
  );
}

export function normalNoise(random) {
  const noise = [];
  for (let index = 0; index < 5; index += 1) {
    const first = Math.max(1e-9, random()), second = random();
    noise.push(Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second));
  }
  return noise;
}

// Follow the flow of a model whose best fit is the data's own spread: x_t = t * noise + (1 - t) * action,
// and the best velocity is (x_t - E[action | x_t]) / t. Start at time `startTime` from `start`,
// run to time 0, and keep snapshots along the way so the path can be drawn.
export function followFlow(start, data, startTime = 1, steps = 240) {
  const encoded = data.map(encode);
  let current = start.slice();
  const snapshots = [{ time: startTime, numbers: current.slice() }];
  const endTime = 0.002;
  for (let step = 1; step <= steps; step += 1) {
    const time = startTime + (endTime - startTime) * ((step - 1) / steps);
    const nextTime = startTime + (endTime - startTime) * (step / steps);
    const logs = encoded.map((action) => {
      let distance = 0;
      for (let index = 0; index < 5; index += 1) distance += (current[index] - (1 - time) * action[index]) ** 2;
      return -distance / (2 * time * time);
    });
    const largest = Math.max(...logs);
    const weights = logs.map((value) => Math.exp(value - largest));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const expected = [0, 0, 0, 0, 0];
    encoded.forEach((action, actionIndex) => {
      for (let index = 0; index < 5; index += 1) expected[index] += (weights[actionIndex] / total) * action[index];
    });
    current = current.map((value, index) => value + ((value - expected[index]) / time) * (nextTime - time));
    if (step % 6 === 0 || step === steps) snapshots.push({ time: nextTime, numbers: current.slice() });
  }
  let landing = 0, closest = Infinity;
  encoded.forEach((action, index) => {
    const distance = action.reduce((sum, value, part) => sum + (value - current[part]) ** 2, 0);
    if (distance < closest) { closest = distance; landing = index; }
  });
  return { snapshots, landing, end: data[landing] };
}

// Where a flow path is when `amount` (0 to 1) of it has been followed.
function alongFlow(flow, amount) {
  const position = clamp01(amount) * (flow.snapshots.length - 1);
  const index = Math.min(flow.snapshots.length - 2, Math.floor(position));
  const fraction = position - index;
  const numbers = flow.snapshots[index].numbers.map((value, part) => value + (flow.snapshots[index + 1].numbers[part] - value) * fraction);
  return decode(numbers);
}

// Noise for a faint copy of the hand also leans it at random; the lean fades as the noise is removed.
function noisePose(numbers, lean, remaining) {
  const grasp = decode(numbers);
  grasp.leanX = lean[0] * remaining;
  grasp.leanZ = lean[1] * remaining;
  return grasp;
}

// ---------- The figures ----------
// Every figure returns { duration, still, camera, update(time) -> overlay state }.
// `makeScene()` gives an empty lit scene.

const DEFAULT_VIEW = { position: v(0.42, 0.92, 1.32), target: v(-0.16, 0.15, -0.02), fov: 30 };
// A wider view for figures whose grasps spread over the whole table.
const WIDE_VIEW = { position: v(0.44, 1.02, 1.5), target: v(-0.14, 0.13, -0.02), fov: 31 };

// 1. One success starts learning: misses, one lift, then every try lifts.
export function figureOneSuccess(makeScene) {
  const parts = buildRobotScene(makeScene());
  const found = rimPinch(BOWL, Math.PI * 1.25);
  const misses = [missAt(-0.29, 0.13), missAt(0.1, 0.12), missAt(-0.16, 0.38), missAt(-0.3, 0.3)];
  const targets = [
    ...misses.map((grasp) => ({ grasp, lifts: false })),
    { grasp: found, lifts: true },
    ...[0, 1].map(() => ({ grasp: found, lifts: true })),
  ];
  const sequence = trySequence(targets, { pace: 0.55, gap: 0.12 });
  const marks = buildMarks(parts, misses.length);
  const duration = sequence.end + 1.4;
  return {
    duration, still: sequence.tries[misses.length].start + 2.6 * 0.55, camera: DEFAULT_VIEW,
    update(time) {
      applyMotion(parts, sequence.motion.at(time));
      const fadeAll = 1 - clamp01((time - sequence.end - 0.2) / 0.9);
      sequence.tries.slice(0, misses.length).forEach((tryInfo, index) => showMark(marks[index], tryInfo.grasp, time > tryInfo.closeAt ? fadeAll : 0));
      return { strip: sequence.tries.map((tryInfo) => ({ done: time > tryInfo.closeAt ? fadeAll : 0, works: tryInfo.lifts, current: time >= tryInfo.start && time < tryInfo.end })) };
    },
  };
}

// 2. Tries must be new and safe: three panels side by side.
export function figureThreeTries(makeScene) {
  const view = { position: v(0.06, 0.55, 0.86), target: v(-0.06, 0.08, 0.15), fov: 36 };
  const habit = missAt(-0.27, 0.17);
  // Panel 1: the same miss again, on top of its old mark.
  const same = buildRobotScene(makeScene());
  const sameMark = buildMarks(same, 1)[0];
  const sameMotion = track(tryKeys(habit, { start: 0.6 }));
  // Panel 2: a fast, random swing that ends by sweeping through the bowl and knocking it away.
  const random = buildRobotScene(makeScene());
  const jitter = seededRandom(5);
  const swing = [restPose()];
  for (let index = 0; index < 5; index += 1) {
    swing.push(pose(v(-0.42 + jitter() * 0.6, 0.06 + jitter() * 0.3, -0.05 + jitter() * 0.4), jitter() * Math.PI));
  }
  const sweepStart = pose(v(-0.32, 0.035, 0.21), 0.3);
  const sweepEnd = pose(v(0.06, 0.035, 0.19), 0.3);
  const swingKeys = [{ at: 0, grasp: restPose(), open: 1, hold: false }];
  let time = 0.6;
  for (const grasp of swing.slice(1)) { time += 0.32; swingKeys.push({ at: time, grasp, open: jitter(), hold: false }); }
  swingKeys.push({ at: time + 0.4, grasp: sweepStart, open: 0.6, hold: false });
  swingKeys.push({ at: time + 0.75, grasp: sweepEnd, open: 0.6, hold: false });
  swingKeys.push({ at: time + 1.9, grasp: restPose(), open: 1, hold: false });
  const swingMotion = track(swingKeys);
  const contactTime = time + 0.4 + 0.35 * 0.35;
  const sweepEndTime = time + 0.75;
  // Panel 3: a new, realistic grasp: a pinch on the far side of the rim, lifted and set down.
  const fresh = buildRobotScene(makeScene());
  const freshMotion = track(tryKeys(rimPinch(BOWL, Math.PI * 0.35), { lifts: true, start: 0.6 }));
  const duration = 7.2;
  return {
    duration, still: 2.7, camera: view,
    panels: [same.scene, random.scene, fresh.scene],
    update(clock) {
      applyMotion(same, sameMotion.at(clock));
      showMark(sameMark, habit, 1);
      const swingState = swingMotion.at(clock);
      applyMotion(random, swingState);
      // The bowl is pushed along while the hand sweeps through it, then slides back for the next try.
      const pushed = clamp01((clock - contactTime) / (sweepEndTime - contactTime));
      const back = ease(clamp01((clock - (duration - 1.6)) / 1.2));
      const shove = ease(pushed) * (1 - back);
      random.bowl.position.copy(BOWL).add(v(0.2 * shove, 0, -0.03 * shove));
      random.bowl.rotation.set(0, 0, -0.5 * Math.sin(Math.PI * clamp01(pushed * 1.2)) * (1 - back));
      applyMotion(fresh, freshMotion.at(clock));
      return { flash: clock > contactTime && clock < contactTime + 0.8 ? 1 : 0 };
    },
  };
}

// The twenty noise samples shared by figures 4 and 10, picked so that, run through the action
// model, they land on twenty different grasps.
let sharedNoise = null;
function twentyNoises(data) {
  if (sharedNoise) return sharedNoise;
  const random = seededRandom(91);
  const picked = [], used = new Set();
  for (let attempt = 0; attempt < 600 && picked.length < 20; attempt += 1) {
    const noise = normalNoise(random);
    const start = decode(noise);
    if (start.tip.y < 0.05) continue;
    const flow = followFlow(noise, data);
    if (used.has(flow.landing)) continue;
    used.add(flow.landing);
    picked.push({ noise, flow, lean: [(random() - 0.5) * 1.6, (random() - 0.5) * 1.6] });
  }
  sharedNoise = picked;
  return picked;
}

// 4. One action per state: twenty samples flow straight to the one recorded grasp.
export function figureOneAction(makeScene) {
  const parts = buildRobotScene(makeScene());
  const data = actionData();
  const samples = twentyNoises(data);
  const recorded = rimPinch(BOWL, Math.PI * 1.25);
  const ghosts = buildGhosts(parts.scene, samples.length, COLORS.ink);
  const duration = 7.6;
  return {
    duration, still: 4.6, camera: DEFAULT_VIEW,
    update(time) {
      applyMotion(parts, { grasp: restPose(), open: 1, hold: false });
      const flowAmount = ease(clamp01((time - 1.4) / 2.6));
      const fade = window01(time, 0.2, duration - 0.3, 0.9, 1.1);
      samples.forEach((sample, index) => {
        const noise = noisePose(sample.noise, sample.lean, 1);
        const grasp = blendPose(noise, recorded, flowAmount);
        const opacity = fade * (0.22 + 0.3 * flowAmount);
        showGhost(ghosts[index], grasp, opacity, 0.3 + 0.0 * index);
        ghosts[index].material.color.setHex(COLORS.ink);
      });
      return { label: flowAmount };
    },
  };
}

// 5. Off the data: two seen states blend into one grasp that misses the real bowl, every try.
export function figureBlend(makeScene) {
  const seenLeft = v(-0.3, 0, 0.04), seenRight = v(0.14, 0, 0.04);
  const parts = buildRobotScene(makeScene());
  const faintBowls = [seenLeft, seenRight].map((center) => {
    const faint = buildBowl(parts.scene);
    faint.position.copy(center);
    faint.traverse((mesh) => {
      if (mesh.material) { mesh.material = mesh.material.clone(); mesh.material.transparent = true; mesh.material.opacity = 0; mesh.material.depthWrite = false; mesh.castShadow = false; }
    });
    return faint;
  });
  const leftGrasp = rimPinch(seenLeft, Math.PI), rightGrasp = rimPinch(seenRight, Math.PI);
  const blended = blendPose(leftGrasp, rightGrasp, 0.5);
  const [leftGhost, rightGhost] = buildGhosts(parts.scene, 2, COLORS.ink);
  const marks = buildMarks(parts, 1);
  const sequence = trySequence([0, 1, 2].map(() => ({ grasp: blended, lifts: false })), { pace: 0.7, gap: 0.2, lead: 3.2 });
  const duration = sequence.end + 1.2;
  return {
    duration, still: sequence.tries[0].closeAt + 0.1, camera: DEFAULT_VIEW,
    update(time) {
      const fadeAll = 1 - clamp01((time - sequence.end) / 0.9);
      const seen = window01(time, 0.1, duration - 0.2, 0.7, 0.9);
      faintBowls.forEach((faint) => faint.traverse((mesh) => { if (mesh.material) mesh.material.opacity = 0.32 * seen; }));
      const together = ease(clamp01((time - 1.2) / 1.6));
      showGhost(leftGhost, blendPose(leftGrasp, blended, together), 0.4 * seen);
      showGhost(rightGhost, blendPose(rightGrasp, blended, together), 0.4 * seen);
      applyMotion(parts, sequence.motion.at(time));
      showMark(marks[0], blended, time > sequence.tries[0].closeAt ? fadeAll : 0);
      return { strip: sequence.tries.map((tryInfo) => ({ done: time > tryInfo.closeAt ? fadeAll : 0, works: false, current: time >= tryInfo.start && time < tryInfo.end })) };
    },
  };
}

// 7. Gaussian action noise: random copies of the missed grasp, small, medium and large.
export function figureGaussian(makeScene) {
  const parts = buildRobotScene(makeScene());
  const miss = missAt(-0.27, 0.17);
  const random = seededRandom(33);
  const copies = Array.from({ length: 28 }, () => ({ noise: normalNoise(random), lean: normalNoise(random) }));
  const ghosts = buildGhosts(parts.scene, copies.length, COLORS.noise);
  const missGhost = buildGhostHand(parts.scene, COLORS.ink);
  const marks = buildMarks(parts, 1);
  const sizes = [0.015, 0.04, 0.17];
  const duration = 9.6;
  const sizeAt = (time) => {
    // Hold each size for a while, easing from one to the next, and back to nothing at the end.
    const stops = [[0.8, 0], [1.6, sizes[0]], [3.2, sizes[0]], [3.9, sizes[1]], [5.5, sizes[1]], [6.2, sizes[2]], [8.4, sizes[2]], [9.2, 0]];
    for (let index = 0; index < stops.length - 1; index += 1) {
      const [from, low] = stops[index], [to, high] = stops[index + 1];
      if (time < to) return time < from ? (index === 0 ? 0 : low) : low + (high - low) * ease((time - from) / (to - from));
    }
    return 0;
  };
  return {
    duration, still: 7.2, camera: DEFAULT_VIEW,
    update(time) {
      applyMotion(parts, { grasp: restPose(), open: 1, hold: false });
      const size = sizeAt(time);
      const shown = window01(time, 0.1, duration - 0.1, 0.6, 0.6);
      showGhost(missGhost, miss, 0.55 * shown, 0);
      showMark(marks[0], miss, shown);
      let unsafe = 0;
      copies.forEach((copy, index) => {
        const tip = miss.tip.clone().add(v(copy.noise[0], copy.noise[1] * 0.6, copy.noise[2]).multiplyScalar(size));
        const grasp = pose(tip, miss.yaw + copy.noise[3] * size * 9, copy.lean[0] * size * 3, copy.lean[1] * size * 3);
        // Copies that drive into the table or into the bowl turn red.
        showGhost(ghosts[index], grasp, 1, 0);
        const bad = fingersHit(ghosts[index]);
        if (bad && size > 0.001) unsafe += 1;
        ghosts[index].material.color.setHex(bad ? RED : COLORS.noise);
        showGhost(ghosts[index], grasp, shown * clamp01(size / 0.012) * (bad ? 0.6 : 0.32), 0);
      });
      return { size, unsafe };
    },
  };
}

// Whether a faint hand's fingers go into the table or into the bowl.
function fingersHit(ghost) {
  ghost.group.updateMatrixWorld(true);
  return ghost.fingers.some((finger) => [-0.035, 0, 0.035].some((height) => {
    const point = v(0, height, 0).applyMatrix4(finger.matrixWorld);
    const fromBowl = Math.hypot(point.x - BOWL.x, point.z - BOWL.z);
    return point.y < 0.003 || (fromBowl < 0.088 && point.y < 0.062);
  }));
}

// 8. Steering the input noise: the noise sweeps its whole range, the grasp barely moves.
export function figureSteering(makeScene) {
  const parts = buildRobotScene(makeScene());
  const miss = missAt(-0.27, 0.17);
  const hover = lifted(miss, 0.025);
  const duration = 8;
  return {
    duration, still: 2, camera: DEFAULT_VIEW,
    update(time) {
      const settle = window01(time, 0, duration, 1.4, 1.4);
      const sweep = Math.sin((2 * Math.PI * time) / duration);
      // The grasp moves about 3 millimeters while the noise goes from one end of its range to the other.
      const grasp = blendPose(restPose(), { ...hover, tip: hover.tip.clone().add(v(0.003 * sweep, 0, 0.002 * Math.cos((2 * Math.PI * time) / duration))) }, settle);
      applyMotion(parts, { grasp, open: 1, hold: false });
      return { noise: sweep * settle, grasp: 0.03 * sweep * settle };
    },
  };
}

// 9. Sampling many and picking the best: sixteen samples arrive on one spot; the pick is the miss.
export function figureBestOf(makeScene) {
  const parts = buildRobotScene(makeScene());
  const miss = missAt(-0.27, 0.17);
  const random = seededRandom(71);
  const offsets = Array.from({ length: 16 }, () => v((random() - 0.5) * 0.006, 0, (random() - 0.5) * 0.006));
  const ghosts = buildGhosts(parts.scene, 16, COLORS.ink);
  const marks = buildMarks(parts, 1);
  const pickStart = 0.5 + 16 * 0.22 + 0.5;
  const motion = track(tryKeys(miss, { start: pickStart + 0.9, pace: 0.8 }));
  const duration = motion.duration + 1.2;
  return {
    duration, still: pickStart + 0.6, camera: DEFAULT_VIEW,
    update(time) {
      const fadeAll = 1 - clamp01((time - motion.duration) / 0.9);
      let arrived = 0;
      offsets.forEach((offset, index) => {
        const arrive = clamp01((time - 0.5 - index * 0.22) / 0.35);
        if (arrive > 0) arrived = index + 1;
        const grasp = { ...miss, tip: miss.tip.clone().add(offset).add(v(0, 0.08 * (1 - ease(arrive)), 0)) };
        const picked = index === 9 && time > pickStart;
        showGhost(ghosts[index], grasp, (picked ? 0.85 : 0.12) * ease(arrive) * fadeAll * (picked ? 1 : 1 - clamp01((time - pickStart - 0.6) / 0.6) * 0.7));
      });
      applyMotion(parts, motion.at(time));
      showMark(marks[0], miss, time > pickStart + 0.9 + 1.75 * 0.8 ? fadeAll : 0);
      return { count: arrived, picked: time > pickStart && fadeAll > 0.5 };
    },
  };
}

// 10. Without the state: the same twenty samples, with the camera covered, land on twenty grasps.
export function figureSpread(makeScene) {
  const parts = buildRobotScene(makeScene());
  const data = actionData();
  const samples = twentyNoises(data);
  const ghosts = buildGhosts(parts.scene, samples.length, COLORS.accent);
  const duration = 8.4;
  return {
    duration, still: 5.4, camera: WIDE_VIEW,
    update(time) {
      applyMotion(parts, { grasp: restPose(), open: 1, hold: false });
      setBlindfold(parts, window01(time, 0.1, duration - 0.1, 1.0, 0.8));
      const flowAmount = ease(clamp01((time - 1.8) / 2.8));
      const fade = window01(time, 0.9, duration - 0.4, 0.9, 1.0);
      samples.forEach((sample, index) => {
        const grasp = alongFlow(sample.flow, flowAmount);
        const remaining = 1 - flowAmount;
        grasp.leanX = sample.lean[0] * remaining;
        grasp.leanZ = sample.lean[1] * remaining;
        showGhost(ghosts[index], grasp, fade * (0.25 + 0.4 * flowAmount));
        ghosts[index].material.color.setHex(COLORS.noise).lerp(new THREE.Color(COLORS.accent), flowAmount);
      });
      return {};
    },
  };
}

// Noise the plan at strength k: x_k = (1 - k) * plan + k * noise, then follow the action model from time k.
export function blindfoldTry(plan, noise, strength, data) {
  const planNumbers = encode(plan);
  const start = planNumbers.map((value, index) => (1 - strength) * value + strength * noise[index]);
  return followFlow(start, data, strength);
}

// Find noise that, from the plan, lands on each wanted grasp (by its index in the data).
function noiseLandingOn(plan, strength, data, wanted, seed, avoid = new Set()) {
  const random = seededRandom(seed);
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const noise = normalNoise(random);
    const flow = blindfoldTry(plan, noise, strength, data);
    if ((wanted === null ? !avoid.has(flow.landing) : flow.landing === wanted)) return { noise, flow };
  }
  return null;
}

export const PLAN = missAt(-0.27, 0.17);
const BLINDFOLD_STRENGTH = 0.35;

// 11. The blindfold: the plan is blurred with noise, then settles onto a real grasp on the rim.
export function figureBlindfold(makeScene) {
  const parts = buildRobotScene(makeScene());
  const data = actionData();
  const leftRim = 0; // the first grasp in the data is the pinch on the bowl's left side
  const found = noiseLandingOn(PLAN, BLINDFOLD_STRENGTH, data, leftRim, 3);
  const random = seededRandom(12);
  const blurCopies = Array.from({ length: 14 }, () => normalNoise(random));
  const planGhost = buildGhostHand(parts.scene, COLORS.ink);
  const blurGhosts = buildGhosts(parts.scene, blurCopies.length, COLORS.noise);
  const resultGhost = buildGhostHand(parts.scene, COLORS.accent);
  const result = found.flow.end;
  const motion = track(tryKeys(result, { start: 6.0, pace: 0.8, lifts: true }));
  const duration = motion.duration + 0.8;
  const noisy = (numbers) => decode(numbers.map((value, index) => (1 - BLINDFOLD_STRENGTH) * encode(PLAN)[index] + BLINDFOLD_STRENGTH * value));
  return {
    duration, still: 5.2, camera: DEFAULT_VIEW,
    update(time) {
      setBlindfold(parts, window01(time, 0.1, duration - 0.1, 0.9, 0.7));
      const planShown = window01(time, 0.9, duration - 0.3, 0.6, 0.8);
      showGhost(planGhost, PLAN, 0.5 * planShown * (1 - 0.6 * clamp01((time - 2.2) / 0.6)));
      // Blur: copies of the plan spread out with noise, then gather as the action model removes it.
      const blur = window01(time, 2.0, 5.1, 0.7, 0.6);
      blurCopies.forEach((noise, index) => showGhost(blurGhosts[index], blendPose(PLAN, noisy(noise), ease(clamp01((time - 2.0) / 0.8))), 0.22 * blur));
      const settle = ease(clamp01((time - 3.4) / 1.8));
      const resultShown = window01(time, 3.2, duration - 0.3, 0.5, 0.8);
      showGhost(resultGhost, alongFlow(found.flow, settle), 0.6 * resultShown, 0.3);
      applyMotion(parts, motion.at(time));
      return {};
    },
  };
}

// 12. The strength k: from close to the plan to anywhere on the table.
export function figureStrength(makeScene) {
  const parts = buildRobotScene(makeScene());
  const data = actionData();
  const strengths = [0.1, 0.3, 0.5, 0.7, 0.9];
  const random = seededRandom(44);
  const noises = Array.from({ length: 9 }, () => normalNoise(random));
  const results = strengths.map((strength) => noises.map((noise) => blindfoldTry(PLAN, noise, strength, data).end));
  const ghostSets = strengths.map(() => buildGhosts(parts.scene, noises.length, COLORS.accent));
  const planGhost = buildGhostHand(parts.scene, COLORS.ink);
  const hold = 1.9;
  const duration = 0.8 + strengths.length * hold + 0.8;
  return {
    duration, still: 0.8 + 3.5 * hold, camera: WIDE_VIEW,
    update(time) {
      setBlindfold(parts, window01(time, 0.05, duration - 0.05, 0.6, 0.6));
      applyMotion(parts, { grasp: restPose(), open: 1, hold: false });
      showGhost(planGhost, PLAN, 0.55 * window01(time, 0.2, duration - 0.2, 0.5, 0.5));
      let shownStrength = strengths[0];
      strengths.forEach((strength, level) => {
        const from = 0.8 + level * hold;
        const shown = window01(time, from, from + hold + 0.25, 0.35, 0.35);
        if (time >= from) shownStrength = strength;
        results[level].forEach((grasp, index) => showGhost(ghostSets[level][index], grasp, 0.5 * shown));
      });
      const knobFrom = (time - 0.8) / hold;
      const level = clamp(knobFrom, 0, strengths.length - 1);
      const lower = Math.floor(level), upper = Math.min(strengths.length - 1, lower + 1);
      const strengthNow = strengths[lower] + (strengths[upper] - strengths[lower]) * ease(clamp01((level - lower) * 3 - 1.8));
      const back = ease(clamp01((time - (duration - 0.8)) / 0.7));
      return { strength: strengthNow * (1 - back) + strengths[0] * back, shownStrength };
    },
  };
}

// 13. Many new tries, one works: each try comes from the blindfold, most close on nothing, one lifts.
export function figureManyTries(makeScene) {
  const parts = buildRobotScene(makeScene());
  const data = actionData();
  const used = new Set([0, 1, 2, 3, 4, 5]);
  const picks = [];
  for (let index = 0; index < 4; index += 1) {
    const near = new Set(data.map((grasp, dataIndex) => (grasp.tip.distanceTo(PLAN.tip) > 0.16 ? dataIndex : -1)).filter((dataIndex) => dataIndex >= 0));
    const found = noiseLandingOn(PLAN, BLINDFOLD_STRENGTH, data, null, 100 + index * 13, new Set([...used, ...near]));
    used.add(found.flow.landing);
    picks.push({ grasp: found.flow.end, lifts: false });
  }
  picks.push({ grasp: noiseLandingOn(PLAN, BLINDFOLD_STRENGTH, data, 0, 3).flow.end, lifts: true });
  const sequence = trySequence(picks, { pace: 0.66, gap: 0.2, lead: 1.4 });
  const previews = buildGhosts(parts.scene, picks.length, COLORS.accent);
  const planGhost = buildGhostHand(parts.scene, COLORS.ink);
  const marks = buildMarks(parts, picks.length);
  const duration = sequence.end + 1.6;
  return {
    duration, still: sequence.tries[4].start + 2.6 * 0.66, camera: DEFAULT_VIEW,
    update(time) {
      setBlindfold(parts, window01(time, 0.05, duration - 0.1, 0.9, 0.8));
      const fadeAll = 1 - clamp01((time - sequence.end - 0.2) / 0.9);
      showGhost(planGhost, PLAN, 0.4 * window01(time, 0.5, duration - 0.3, 0.6, 0.8));
      sequence.tries.forEach((tryInfo, index) => {
        // Each new grasp shows faintly just before the arm makes it.
        showGhost(previews[index], tryInfo.grasp, 0.55 * window01(time, tryInfo.start - 0.4, tryInfo.closeAt + 0.2, 0.4, 0.3));
        showMark(marks[index], tryInfo.grasp, !tryInfo.lifts && time > tryInfo.closeAt ? fadeAll : 0);
      });
      applyMotion(parts, sequence.motion.at(time));
      return { strip: sequence.tries.map((tryInfo) => ({ done: time > tryInfo.closeAt ? fadeAll : 0, works: tryInfo.lifts, current: time >= tryInfo.start && time < tryInfo.end })) };
    },
  };
}

export const FIGURES = {
  'one-success': figureOneSuccess,
  'three-tries': figureThreeTries,
  'one-action': figureOneAction,
  'blend': figureBlend,
  'gaussian': figureGaussian,
  'steering': figureSteering,
  'best-of': figureBestOf,
  'spread': figureSpread,
  'blindfold': figureBlindfold,
  'strength': figureStrength,
  'many-tries': figureManyTries,
};
