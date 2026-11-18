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

// Whether a faint hand's fingers go into the table or into the bowl.
function fingersHit(ghost) {
  ghost.group.updateMatrixWorld(true);
  return ghost.fingers.some((finger) => [-0.035, 0, 0.035].some((height) => {
    const point = v(0, height, 0).applyMatrix4(finger.matrixWorld);
    const fromBowl = Math.hypot(point.x - BOWL.x, point.z - BOWL.z);
    return point.y < 0.003 || (fromBowl < 0.088 && point.y < 0.062);
  }));
}

// 6. Without the state: the same twenty samples, with the camera covered, land on twenty grasps.
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


// ---------- More scene pieces ----------

// A see-through copy of the bowl, for states the model saw in training.
function buildFaintBowl(scene, center) {
  const faint = buildBowl(scene);
  faint.position.copy(center);
  faint.traverse((mesh) => {
    if (!mesh.material) return;
    mesh.material = mesh.material.clone();
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    mesh.material.depthWrite = false;
    mesh.castShadow = false;
  });
  return faint;
}
function setFaint(faint, opacity) {
  faint.visible = opacity > 0.005;
  faint.traverse((mesh) => { if (mesh.material) mesh.material.opacity = opacity; });
}

// A thin tube along a path of points, drawn from its start up to `amount` (0 to 1).
function buildTrail(scene, points, color, radius = 0.0035) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 6, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}
function showTrail(trail, amount, opacity) {
  const total = trail.geometry.index.count;
  const perStep = 6 * 6;
  trail.geometry.setDrawRange(0, Math.floor((total / perStep) * clamp01(amount)) * perStep);
  trail.material.opacity = clamp01(opacity);
  trail.visible = opacity > 0.005 && amount > 0.001;
}

// The path the fingertips take during a timeline, as points.
function tipPath(motion, from, to, count = 60) {
  return Array.from({ length: count }, (_, index) => motion.at(from + ((to - from) * index) / (count - 1)).grasp.tip.clone());
}

// A label pinned to a point in the scene; the page places it over the canvas.
const label = (text, at, opacity) => ({ text, at: at.clone(), opacity: clamp01(opacity) });

// Holding the bowl still in the air at a rim pinch: the pose for one frozen picture.
function holdingPose(center, side, height = 0.11) {
  return lifted(rimPinch(center, side), height);
}

// ---------- The seven figures ----------
// Every figure returns { duration, still, camera, update(time) -> overlay state }.
// Overlay state may hold: strip (a row of tries), size and unsafe (noise), strength (k),
// labels (text pinned to points in the scene), note (a line over the canvas), fade (0 to 1, the whole picture).

const HABIT = missAt(-0.27, 0.17);

// 1. Trying something different: the same miss three times, then a grasp from a new side lifts the bowl.
export function figureTryDifferent(makeScene) {
  const parts = buildRobotScene(makeScene());
  const newSide = rimPinch(BOWL, Math.PI * 0.35);
  const targets = [HABIT, HABIT, HABIT].map((grasp) => ({ grasp, lifts: false })).concat([{ grasp: newSide, lifts: true }]);
  const sequence = trySequence(targets, { pace: 0.6, gap: 0.15 });
  const marks = buildMarks(parts, 1);
  const duration = sequence.end + 1.2;
  return {
    duration, still: sequence.tries[3].start + 2.6 * 0.6, camera: DEFAULT_VIEW,
    update(time) {
      applyMotion(parts, sequence.motion.at(time));
      const fadeAll = 1 - clamp01((time - sequence.end - 0.1) / 0.9);
      showMark(marks[0], HABIT, time > sequence.tries[0].closeAt ? fadeAll : 0);
      return { strip: sequence.tries.map((tryInfo) => ({ done: time > tryInfo.closeAt ? fadeAll : 0, works: tryInfo.lifts, current: time >= tryInfo.start && time < tryInfo.end })) };
    },
  };
}

// 2. Noise on the action: the miss sits a fixed gap (the bias) from the rim. Noise grows around the miss;
// small noise stays at the miss, large noise drives copies into the table and the bowl, and almost none reach the rim.
export function figureNoise(makeScene) {
  const parts = buildRobotScene(makeScene());
  const target = rimPinch(BOWL, Math.PI);
  const random = seededRandom(33);
  const copies = Array.from({ length: 28 }, () => ({ noise: normalNoise(random), lean: normalNoise(random) }));
  const ghosts = buildGhosts(parts.scene, copies.length, COLORS.noise);
  const habitGhost = buildGhostHand(parts.scene, COLORS.ink);
  const targetGhost = buildGhostHand(parts.scene, COLORS.accent);
  const gap = buildTrail(parts.scene, [HABIT.tip.clone(), HABIT.tip.clone().lerp(target.tip, 0.5), target.tip.clone()], COLORS.accent, 0.003);
  const sizes = [0.015, 0.045, 0.17];
  const duration = 11;
  const stops = [[2.4, 0], [3.2, sizes[0]], [4.8, sizes[0]], [5.5, sizes[1]], [7.1, sizes[1]], [7.8, sizes[2]], [9.9, sizes[2]], [10.6, 0]];
  const sizeAt = (time) => {
    for (let index = 0; index < stops.length - 1; index += 1) {
      const [from, low] = stops[index], [to, high] = stops[index + 1];
      if (time < to) return time < from ? (index === 0 ? 0 : low) : low + (high - low) * ease((time - from) / (to - from));
    }
    return 0;
  };
  return {
    duration, still: 8.8, camera: DEFAULT_VIEW,
    update(time) {
      // The arm makes its usual miss first, then waits while the copies show where noise would send it.
      const reach = time < 2.2 ? blendPose(restPose(), HABIT, ease(clamp01((time - 0.3) / 1.4))) : blendPose(HABIT, restPose(), ease(clamp01((time - 2.2) / 0.9)));
      const open = time < 1.7 ? 1 : time < 2.2 ? 1 - clamp01((time - 1.7) / 0.3) : clamp01((time - 2.2) / 0.3);
      applyMotion(parts, { grasp: reach, open, hold: false });
      const shown = window01(time, 1.6, duration - 0.1, 0.5, 0.6);
      showGhost(habitGhost, HABIT, 0.6 * shown, 0);
      showGhost(targetGhost, target, 0.55 * shown, 0);
      showTrail(gap, ease(clamp01((time - 1.8) / 0.7)), 0.9 * shown);
      const size = sizeAt(time);
      let unsafe = 0;
      copies.forEach((copy, index) => {
        const tip = HABIT.tip.clone().add(v(copy.noise[0], copy.noise[1] * 0.6, copy.noise[2]).multiplyScalar(size));
        const grasp = pose(tip, HABIT.yaw + copy.noise[3] * size * 9, copy.lean[0] * size * 3, copy.lean[1] * size * 3);
        showGhost(ghosts[index], grasp, 1, 0);
        const bad = fingersHit(ghosts[index]);
        const reached = !bad && tip.distanceTo(target.tip) < 0.025;
        if (bad && size > 0.001) unsafe += 1;
        ghosts[index].material.color.setHex(bad ? RED : reached ? COLORS.accent : COLORS.noise);
        showGhost(ghosts[index], grasp, shown * clamp01(size / 0.012) * (bad || reached ? 0.6 : 0.3), 0);
      });
      const middle = HABIT.tip.clone().lerp(target.tip, 0.5).add(v(0, 0.05, 0));
      return { size, unsafe, labels: [label('bias', middle, shown * clamp01((time - 2.2) / 0.5))] };
    },
  };
}

// 3. Image models learn variety: one prompt, four different pictures that all fit it.
// Each picture holds still; the next fades in with the bowl, the grasp and the view all changed.
// A view from around the table: `turn` swings the camera about the table from the usual view, `rise` lifts it.
function orbitView(turn, rise, target) {
  const base = DEFAULT_VIEW.position.clone().sub(DEFAULT_VIEW.target);
  const flat = Math.hypot(base.x, base.z);
  const angle = Math.atan2(base.x, base.z) + turn;
  return { position: target.clone().add(v(flat * Math.sin(angle), base.y + rise, flat * Math.cos(angle))), target: target.clone(), fov: 30 };
}
const PICTURES = [
  { bowl: v(-0.08, 0, 0.2), side: Math.PI * 0.35, view: orbitView(0, 0, v(-0.14, 0.15, 0.0)) },
  { bowl: v(0.1, 0, 0.12), side: Math.PI * 1.05, view: orbitView(-0.55, 0.1, v(-0.06, 0.15, -0.02)) },
  { bowl: v(-0.26, 0, 0.12), side: Math.PI * 0.55, view: orbitView(0.45, -0.15, v(-0.16, 0.15, -0.04)) },
  { bowl: v(-0.02, 0, 0.3), side: Math.PI * 1.45, view: orbitView(-0.2, 0.35, v(-0.1, 0.12, 0.04)) },
];
export function figureImageModel(makeScene) {
  const parts = buildRobotScene(makeScene());
  const hold = 2.6, fadeTime = 0.45;
  const duration = PICTURES.length * hold;
  const camera = { position: PICTURES[0].view.position.clone(), target: PICTURES[0].view.target.clone(), fov: PICTURES[0].view.fov };
  return {
    duration, still: 0.5 * hold, camera,
    update(time) {
      const index = Math.min(PICTURES.length - 1, Math.floor(time / hold));
      const local = time - index * hold;
      const picture = PICTURES[index];
      parts.bowlHome = picture.bowl.clone();
      const grasp = holdingPose(picture.bowl, picture.side);
      applyMotion(parts, { grasp, open: 0, hold: true, holdFrom: rimPinch(picture.bowl, picture.side) });
      // A slow drift keeps each picture alive without moving anything in it.
      const drift = (local / hold - 0.5) * 0.04;
      camera.position.copy(picture.view.position).add(v(drift, 0, -drift));
      camera.target.copy(picture.view.target);
      camera.fov = picture.view.fov;
      const fade = Math.min(ease(clamp01(local / fadeTime)), ease(clamp01((hold - local) / fadeTime)));
      return { fade, note: `picture ${index + 1} of many` };
    },
  };
}

// 4. Policies don't have to: camera pictures that are nearly the same, the bowl a little off each time,
// and each with exactly one grasp, the same kind every time. Earlier states stay faint.
const NEAR_STATES = [v(-0.08, 0, 0.2), v(-0.062, 0, 0.214), v(-0.097, 0, 0.188), v(-0.068, 0, 0.18), v(-0.091, 0, 0.219)];
export function figurePolicyImages(makeScene) {
  const parts = buildRobotScene(makeScene());
  const side = Math.PI * 1.25;
  const pace = 0.62;
  const runs = NEAR_STATES.map((center, index) => {
    const target = rimPinch(center, side + (index - 2) * 0.03);
    const motion = track(tryKeys(target, { lifts: true, pace }));
    return { center, target, motion, trail: null, faint: buildFaintBowl(parts.scene, center) };
  });
  const each = runs[0].motion.duration + 0.25;
  runs.forEach((run) => { run.trail = buildTrail(parts.scene, tipPath(run.motion, 0.6 * pace, 2.35 * pace), COLORS.ink, 0.0045); });
  const duration = runs.length * each + 1.0;
  return {
    duration, still: 2 * each + 1.9 * pace, camera: DEFAULT_VIEW,
    update(time) {
      const index = Math.min(runs.length - 1, Math.floor(time / each));
      const local = time - index * each;
      const fadeAll = 1 - clamp01((time - runs.length * each) / 0.8);
      const run = runs[index];
      // The bowl slides the few millimeters to this state while the arm is at rest.
      const previous = runs[(index + runs.length - 1) % runs.length].center;
      parts.bowlHome = previous.clone().lerp(run.center, ease(clamp01(local / 0.4)));
      applyMotion(parts, time < runs.length * each ? run.motion.at(local) : { grasp: restPose(), open: 1, hold: false });
      runs.forEach((other, otherIndex) => {
        const drawn = otherIndex < index ? 1 : otherIndex === index ? clamp01((local - 0.6 * pace) / (1.75 * pace)) : 0;
        showTrail(other.trail, drawn, (otherIndex === index ? 0.85 : 0.3) * fadeAll);
        setFaint(other.faint, otherIndex < index ? 0.16 * fadeAll : 0);
      });
      return { note: `picture ${index + 1}: one action` };
    },
  };
}

// 5. The information theory, in the scene: in a training state, twenty samples fly straight to the one recorded grasp.
// Then the bowl moves to a state between two training states, and all twenty land on one blended grasp beside it.
const SEEN_LEFT = v(-0.3, 0, 0.04), SEEN_RIGHT = v(0.14, 0, 0.04);
export function figureCollapse(makeScene) {
  const parts = buildRobotScene(makeScene(), { bowlAt: SEEN_LEFT });
  const data = actionData();
  const samples = twentyNoises(data);
  const recorded = rimPinch(SEEN_LEFT, Math.PI);
  const blended = blendPose(rimPinch(SEEN_LEFT, Math.PI), rimPinch(SEEN_RIGHT, Math.PI), 0.5);
  const ghosts = buildGhosts(parts.scene, samples.length, COLORS.ink);
  const faintLeft = buildFaintBowl(parts.scene, SEEN_LEFT), faintRight = buildFaintBowl(parts.scene, SEEN_RIGHT);
  const marks = buildMarks(parts, 1);
  const secondStart = 6.4;
  const motion = track(tryKeys(blended, { start: secondStart + 4.4, pace: 0.7 }));
  const duration = motion.duration + 1.0;
  const flyTo = (time, start, grasp) => {
    const amount = ease(clamp01((time - start - 0.9) / 2.2));
    const shown = window01(time, start, start + 5.2, 0.6, 0.7);
    samples.forEach((sample, index) => showGhost(ghosts[index], blendPose(noisePose(sample.noise, sample.lean, 1), grasp, amount), shown * (0.2 + 0.32 * amount)));
    return amount;
  };
  return {
    duration, still: secondStart + 3.4, camera: DEFAULT_VIEW,
    update(time) {
      const fadeAll = 1 - clamp01((time - motion.duration) / 0.9);
      // The bowl slides from the training state to the new one between the two seen states.
      const slide = ease(clamp01((time - (secondStart - 1.0)) / 1.2)) * (1 - ease(clamp01((time - (duration - 1.0)) / 0.9)));
      parts.bowlHome = SEEN_LEFT.clone().lerp(BOWL, slide);
      if (time < secondStart) flyTo(time, 0.2, recorded);
      else flyTo(time, secondStart, blended);
      const seen = window01(time, secondStart - 0.6, duration - 0.2, 0.7, 0.8);
      setFaint(faintLeft, 0.3 * seen);
      setFaint(faintRight, 0.3 * seen);
      applyMotion(parts, motion.at(time));
      showMark(marks[0], blended, time > motion.duration - 1.6 ? fadeAll : 0);
      const labels = [];
      if (time < secondStart) labels.push(label('training state', SEEN_LEFT.clone().add(v(0, 0.13, 0)), window01(time, 0.3, secondStart - 1.1, 0.5, 0.4)));
      else {
        labels.push(label('seen', SEEN_LEFT.clone().add(v(0, 0.11, 0)), seen), label('seen', SEEN_RIGHT.clone().add(v(0, 0.11, 0)), seen));
        labels.push(label('new state', BOWL.clone().add(v(0, 0.13, 0)), seen));
      }
      return { labels };
    },
  };
}

// 7. The dial: the blindfold noises the plan by k and the action model settles it onto a valid grasp;
// larger k lands further away. Then a run of new tries near the plan, until one lifts the bowl.
export function figureDial(makeScene) {
  const parts = buildRobotScene(makeScene());
  const data = actionData();
  const strengths = [0.1, 0.3, 0.5, 0.7, 0.9];
  const random = seededRandom(44);
  const noises = Array.from({ length: 9 }, () => normalNoise(random));
  const levels = strengths.map((strength) => noises.map((noise) => blindfoldTry(PLAN, noise, strength, data)));
  const ghostSets = strengths.map(() => buildGhosts(parts.scene, noises.length, COLORS.accent));
  const planGhost = buildGhostHand(parts.scene, COLORS.ink);
  const blurGhosts = buildGhosts(parts.scene, noises.length, COLORS.noise);
  const hold = 2.0;
  const dialEnd = 1.0 + strengths.length * hold;
  // The tries: four near the plan that close on nothing, then one on the rim that lifts.
  const used = new Set([0, 1, 2, 3, 4, 5]);
  const picks = [];
  for (let index = 0; index < 4; index += 1) {
    const far = new Set(data.map((grasp, dataIndex) => (grasp.tip.distanceTo(PLAN.tip) > 0.16 ? dataIndex : -1)).filter((dataIndex) => dataIndex >= 0));
    const found = noiseLandingOn(PLAN, BLINDFOLD_STRENGTH, data, null, 100 + index * 13, new Set([...used, ...far]));
    used.add(found.flow.landing);
    picks.push({ grasp: found.flow.end, lifts: false });
  }
  picks.push({ grasp: noiseLandingOn(PLAN, BLINDFOLD_STRENGTH, data, 0, 3).flow.end, lifts: true });
  const pace = 0.62;
  const tries = trySequence(picks, { pace, gap: 0.15, lead: dialEnd + 0.6 });
  const previews = buildGhosts(parts.scene, picks.length, COLORS.accent);
  const marks = buildMarks(parts, picks.length);
  const duration = tries.end + 1.4;
  const noisyPlan = (noise, strength) => decode(encode(PLAN).map((value, index) => (1 - strength) * value + strength * noise[index]));
  return {
    duration, still: 1.0 + 2.7 * hold, camera: WIDE_VIEW,
    update(time) {
      setBlindfold(parts, window01(time, 0.05, duration - 0.1, 0.8, 0.8));
      const fadeAll = 1 - clamp01((time - tries.end - 0.2) / 0.9);
      showGhost(planGhost, PLAN, 0.5 * window01(time, 0.3, duration - 0.3, 0.6, 0.8));
      const level = clamp(Math.floor((time - 1.0) / hold), 0, strengths.length - 1);
      const local = time - 1.0 - level * hold;
      const inDial = time > 1.0 && time < dialEnd;
      // Within each step: the plan blurs by k, then each blurred copy follows the action model to a valid grasp.
      const blur = inDial ? window01(local, 0, 1.3, 0.3, 0.35) : 0;
      const settle = ease(clamp01((local - 0.6) / 0.9));
      noises.forEach((noise, index) => showGhost(blurGhosts[index], blendPose(PLAN, noisyPlan(noise, strengths[level]), ease(clamp01(local / 0.75))), 0.2 * blur));
      strengths.forEach((strength, levelIndex) => {
        const shown = inDial && levelIndex === level ? window01(local, 0.55, hold + 0.05, 0.3, 0.3) : 0;
        levels[levelIndex].forEach((flow, index) => showGhost(ghostSets[levelIndex][index], alongFlow(flow, settle), 0.5 * shown));
      });
      tries.tries.forEach((tryInfo, index) => {
        showGhost(previews[index], tryInfo.grasp, 0.55 * window01(time, tryInfo.start - 0.4, tryInfo.closeAt + 0.2, 0.4, 0.3));
        showMark(marks[index], tryInfo.grasp, !tryInfo.lifts && time > tryInfo.closeAt ? fadeAll : 0);
      });
      applyMotion(parts, tries.motion.at(time));
      const strength = time < 1.0 ? strengths[0] : time < dialEnd ? strengths[level] : BLINDFOLD_STRENGTH;
      return {
        strength,
        strip: tries.tries.map((tryInfo) => ({ done: time > tryInfo.closeAt ? fadeAll : 0, works: tryInfo.lifts, current: time >= tryInfo.start && time < tryInfo.end })),
        labels: [label('plan', PLAN.tip.clone().add(v(0, 0.16, 0)), window01(time, 0.6, dialEnd, 0.5, 0.5))],
      };
    },
  };
}

export const FIGURES = {
  'try-different': figureTryDifferent,
  'noise': figureNoise,
  'image-model': figureImageModel,
  'policy-images': figurePolicyImages,
  'collapse': figureCollapse,
  'spread': figureSpread,
  'dial': figureDial,
};
