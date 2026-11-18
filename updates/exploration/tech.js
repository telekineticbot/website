// Runs the technical section's figures: the robot scenes from tech-figs.js, drawn by one
// shared WebGL renderer, and two flat diagrams drawn in SVG. Each figure loops while it is on screen.
import * as THREE from 'three';
import { buildStudio, seededRandom, clamp01, ease } from './scene-parts.js';
import { FIGURES, window01 } from './tech-figs.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgElement = (name, attributes = {}, parent) => {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (parent) parent.appendChild(element);
  return element;
};

// ---------- Robot scenes ----------
let renderer = null;
function sharedRenderer() {
  if (renderer) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (error) {
    document.documentElement.classList.add('no-webgl');
    return null;
  }
  return renderer;
}

function robotFigure(stage) {
  const build = FIGURES[stage.dataset.figure];
  const output = stage.querySelector('canvas');
  const context = output.getContext('2d');
  const overlays = stage.closest('.tech-figure').querySelectorAll('[data-overlay]');
  let figure = null, camera = null, scenes = [];
  return {
    element: stage,
    duration: () => figure.duration,
    still: () => figure.still,
    ready() {
      if (figure) return true;
      const shared = sharedRenderer();
      if (!shared) return false;
      const made = [];
      figure = build(() => { const scene = buildStudio(shared).scene; made.push(scene); return scene; });
      scenes = figure.panels ?? made.slice(0, 1);
      // The scenes are drawn at device pixels into each figure's own canvas, so the shared one works at a ratio of 1.
      shared.setPixelRatio(1);
      camera = new THREE.PerspectiveCamera(figure.camera.fov, 1, 0.05, 30);
      return true;
    },
    draw(time) {
      const state = figure.update(time) || {};
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(stage.clientWidth * pixelRatio));
      const height = Math.max(1, Math.round(stage.clientHeight * pixelRatio));
      if (output.width !== width || output.height !== height) { output.width = width; output.height = height; }
      // The shared canvas only grows, so figures of different sizes never make it resize back and forth.
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x < width || size.y < height) renderer.setSize(Math.max(size.x, width), Math.max(size.y, height), false);
      const canvasHeight = renderer.domElement.height;
      const gap = scenes.length > 1 ? Math.round(10 * pixelRatio) : 0;
      renderer.setScissorTest(true);
      renderer.setClearColor(0x000000, 0);
      scenes.forEach((scene, index) => {
        const left = Math.round((index * (width + gap)) / scenes.length);
        const panelWidth = Math.round(((index + 1) * (width + gap)) / scenes.length) - left - gap;
        renderer.setViewport(left, 0, panelWidth, height);
        renderer.setScissor(left, 0, panelWidth, height);
        renderer.clear();
        camera.aspect = panelWidth / height;
        // On a narrow screen the view widens a little so the robot and bowl stay in frame.
        camera.fov = figure.camera.fov * (camera.aspect < 1.2 ? 1.2 : 1);
        camera.position.copy(figure.camera.position);
        camera.lookAt(figure.camera.target);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
      });
      renderer.setScissorTest(false);
      context.clearRect(0, 0, width, height);
      context.drawImage(renderer.domElement, 0, canvasHeight - height, width, height, 0, 0, width, height);
      overlays.forEach((overlay) => drawOverlay(overlay, state));
    },
  };
}

// ---------- Overlays under a robot scene ----------
function drawOverlay(overlay, state) {
  const kind = overlay.dataset.overlay;
  if (kind === 'strip' && state.strip) drawStrip(overlay, state.strip);
  if (kind === 'samples' && state.count !== undefined) drawSamples(overlay, state);
  if (kind === 'steering' && state.noise !== undefined) drawSteering(overlay, state);
  if (kind === 'strength' && state.strength !== undefined) drawStrength(overlay, state);
  if (kind === 'noise' && state.size !== undefined) drawNoise(overlay, state);
}

// How big the noise is now, among the three sizes shown, and how many copies would hit something.
const NOISE_SIZES = [['small', 0.015], ['medium', 0.04], ['large', 0.17]];
function drawNoise(overlay, state) {
  if (!overlay.firstChild) {
    overlay.setAttribute('viewBox', '0 0 600 40');
    svgElement('text', { x: 0, y: 16, class: 'svg-label' }, overlay).textContent = 'noise';
    svgElement('line', { x1: 120, y1: 12, x2: 420, y2: 12, class: 'grid' }, overlay);
    NOISE_SIZES.forEach(([label], index) => {
      svgElement('text', { x: 120 + index * 150, y: 36, class: 'svg-label', 'text-anchor': 'middle' }, overlay).textContent = label;
    });
    svgElement('circle', { cx: 120, cy: 12, r: 7, class: 'knob ink' }, overlay);
    svgElement('text', { x: 600, y: 16, class: 'svg-label', 'text-anchor': 'end' }, overlay);
  }
  // Place the knob between the labels by where the size sits between the three sizes.
  const size = state.size;
  let position = 0;
  if (size > NOISE_SIZES[0][1]) position = size >= NOISE_SIZES[1][1] ? 1 + (size - NOISE_SIZES[1][1]) / (NOISE_SIZES[2][1] - NOISE_SIZES[1][1]) : (size - NOISE_SIZES[0][1]) / (NOISE_SIZES[1][1] - NOISE_SIZES[0][1]);
  else position = 0;
  overlay.querySelector('.knob').setAttribute('cx', 120 + 150 * Math.min(2, position));
  overlay.querySelector('.knob').style.opacity = size > 0.001 ? 1 : 0.3;
  const count = overlay.querySelectorAll('text')[4];
  count.textContent = `${state.unsafe} of 28 would hit`;
  count.setAttribute('class', state.unsafe > 0 ? 'svg-label accent' : 'svg-label');
}

// A row of dots, one per try: hollow until the try is made, dark for a miss, orange for one that works.
function drawStrip(overlay, tries) {
  if (!overlay.firstChild) {
    overlay.setAttribute('viewBox', `0 0 ${tries.length * 26} 22`);
    tries.forEach((tryInfo, index) => {
      svgElement('circle', { cx: 13 + index * 26, cy: 11, r: 6.5, class: 'strip-ring' }, overlay);
      svgElement('circle', { cx: 13 + index * 26, cy: 11, r: 6.5, class: tryInfo.works ? 'strip-dot works' : 'strip-dot' }, overlay);
    });
  }
  const dots = overlay.querySelectorAll('.strip-dot');
  const rings = overlay.querySelectorAll('.strip-ring');
  tries.forEach((tryInfo, index) => {
    dots[index].style.opacity = tryInfo.done;
    rings[index].classList.toggle('current', tryInfo.current);
  });
}

function drawSamples(overlay, state) {
  if (!overlay.firstChild) {
    overlay.setAttribute('viewBox', '0 0 416 22');
    for (let index = 0; index < 16; index += 1) {
      svgElement('circle', { cx: 13 + index * 26, cy: 11, r: 6.5, class: 'strip-ring' }, overlay);
      svgElement('circle', { cx: 13 + index * 26, cy: 11, r: 6.5, class: index === 9 ? 'strip-dot picked' : 'strip-dot' }, overlay);
    }
  }
  overlay.querySelectorAll('.strip-dot').forEach((dot, index) => { dot.style.opacity = index < state.count ? (index === 9 && state.picked ? 1 : 0.35) : 0; });
}

// Two tracks: the input noise, which sweeps end to end, and the grasp, which barely moves.
function drawSteering(overlay, state) {
  if (!overlay.firstChild) {
    overlay.setAttribute('viewBox', '0 0 600 64');
    [['input noise', 16], ['grasp', 48]].forEach(([label, y]) => {
      svgElement('text', { x: 0, y: y + 4, class: 'svg-label' }, overlay).textContent = label;
      svgElement('line', { x1: 120, y1: y, x2: 590, y2: y, class: 'grid' }, overlay);
      svgElement('circle', { cx: 355, cy: y, r: 7, class: label === 'grasp' ? 'knob ink' : 'knob' }, overlay);
    });
  }
  const [noiseKnob, graspKnob] = overlay.querySelectorAll('.knob');
  noiseKnob.setAttribute('cx', 355 + 228 * state.noise);
  graspKnob.setAttribute('cx', 355 + 228 * state.grasp);
}

// The strength k on a track from 0 to 1.
function drawStrength(overlay, state) {
  if (!overlay.firstChild) {
    overlay.setAttribute('viewBox', '0 0 600 46');
    svgElement('line', { x1: 40, y1: 16, x2: 580, y2: 16, class: 'grid' }, overlay);
    [0, 0.5, 1].forEach((value) => {
      svgElement('line', { x1: 40 + 540 * value, y1: 11, x2: 40 + 540 * value, y2: 21, class: 'grid' }, overlay);
      svgElement('text', { x: 40 + 540 * value, y: 40, class: 'svg-label', 'text-anchor': 'middle' }, overlay).textContent = String(value);
    });
    svgElement('text', { x: 0, y: 20, class: 'svg-label italic' }, overlay).textContent = 'k';
    svgElement('circle', { cx: 40, cy: 16, r: 7, class: 'knob accent' }, overlay);
  }
  overlay.querySelector('.knob').setAttribute('cx', 40 + 540 * state.strength);
}

// ---------- Flat diagrams ----------

// 3. Every state happens once: states arrive as dots, each with one action; a close-up shows them apart.
function statesFigure(svg) {
  const random = seededRandom(23);
  const dots = [];
  for (let index = 0; index < 64; index += 1) {
    dots.push({ x: 30 + random() * 320, y: 40 + random() * 270, angle: random() * Math.PI * 2 });
  }
  // A small crowd that looks like one spot from afar.
  const spot = { x: 196, y: 186 };
  const crowd = [[-7, -4], [5, -8], [9, 5], [-3, 8], [-10, 6], [1, 0]].map(([dx, dy]) => ({ x: spot.x + dx * 1.6, y: spot.y + dy * 1.6, angle: random() * Math.PI * 2 }));
  const all = [...dots, ...crowd];
  const field = svgElement('g', {}, svg);
  const marks = all.map((dot) => {
    const group = svgElement('g', { opacity: 0 }, field);
    svgElement('line', { x1: dot.x, y1: dot.y, x2: dot.x + 14 * Math.cos(dot.angle), y2: dot.y + 14 * Math.sin(dot.angle), class: 'line-faint thin' }, group);
    svgElement('circle', { cx: dot.x, cy: dot.y, r: 3.2, class: 'dot-ink' }, group);
    return group;
  });
  svgElement('text', { x: 30, y: 352, class: 'svg-label' }, svg).textContent = 'states in the data';
  // The close-up.
  const zoom = { x: 470, y: 180, r: 112, scale: 5 };
  const lens = svgElement('g', { opacity: 0 }, svg);
  svgElement('circle', { cx: spot.x, cy: spot.y, r: 22, class: 'line-ink thin' }, lens);
  svgElement('line', { x1: spot.x + 22 * 0.8, y1: spot.y - 22 * 0.6, x2: zoom.x - zoom.r * 0.8, y2: zoom.y - zoom.r * 0.6, class: 'line-faint thin dashed' }, lens);
  svgElement('line', { x1: spot.x + 22 * 0.8, y1: spot.y + 22 * 0.6, x2: zoom.x - zoom.r * 0.8, y2: zoom.y + zoom.r * 0.6, class: 'line-faint thin dashed' }, lens);
  svgElement('circle', { cx: zoom.x, cy: zoom.y, r: zoom.r, class: 'lens' }, lens);
  const closeUps = crowd.map((dot) => {
    const x = zoom.x + (dot.x - spot.x) * zoom.scale, y = zoom.y + (dot.y - spot.y) * zoom.scale;
    const group = svgElement('g', { opacity: 0 }, lens);
    svgElement('line', { x1: x, y1: y, x2: x + 30 * Math.cos(dot.angle), y2: y + 30 * Math.sin(dot.angle), class: 'line-ink' }, group);
    svgElement('circle', { cx: x, cy: y, r: 6, class: 'dot-ink' }, group);
    return group;
  });
  svgElement('text', { x: zoom.x, y: 352, class: 'svg-label', 'text-anchor': 'middle' }, lens).textContent = 'up close: one action each';
  const duration = 10;
  return {
    element: svg, duration: () => duration, still: () => 7, ready: () => true,
    draw(time) {
      const fade = window01(time, 0, duration - 0.2, 0.01, 0.9);
      marks.forEach((mark, index) => mark.setAttribute('opacity', fade * ease(clamp01((time - 0.3 - index * 0.045) / 0.3))));
      const lensIn = window01(time, 4, duration - 0.2, 0.8, 0.9);
      lens.setAttribute('opacity', lensIn);
      closeUps.forEach((group, index) => group.setAttribute('opacity', window01(time, 4.8 + index * 0.25, duration - 0.2, 0.4, 0.9)));
    },
  };
}

// 6. Base and fine-tuned alike: twenty samples from each policy, seen from above, gather in one spot.
function policiesFigure(svg) {
  const random = seededRandom(61);
  const panels = [{ x: 0, label: 'π0.5-DROID', spot: [-58, 6] }, { x: 310, label: 'fine-tuned', spot: [-52, -14] }];
  const samples = [];
  panels.forEach((panel) => {
    const group = svgElement('g', { transform: `translate(${panel.x} 0)` }, svg);
    svgElement('rect', { x: 0, y: 0, width: 290, height: 230, rx: 6, class: 'table-top' }, group);
    svgElement('circle', { cx: 160, cy: 230, r: 26, class: 'robot-base' }, group);
    svgElement('circle', { cx: 160, cy: 105, r: 38, class: 'bowl' }, group);
    svgElement('circle', { cx: 160, cy: 105, r: 30, class: 'bowl-inside' }, group);
    svgElement('text', { x: 145, y: 262, class: 'svg-label', 'text-anchor': 'middle' }, group).textContent = panel.label;
    const count = svgElement('text', { x: 10, y: 22, class: 'svg-label' }, group);
    const marks = [];
    for (let index = 0; index < 20; index += 1) {
      const from = [10 + random() * 270, 10 + random() * 210];
      const to = [160 + panel.spot[0] + (random() - 0.5) * 10, 105 + panel.spot[1] + (random() - 0.5) * 10];
      const dot = svgElement('circle', { r: 4.5, class: 'dot-ink sample', opacity: 0 }, group);
      marks.push({ dot, from, to, at: 0.6 + index * 0.24 });
    }
    samples.push({ marks, count });
  });
  const duration = 9;
  return {
    element: svg, duration: () => duration, still: () => 6.4, ready: () => true,
    draw(time) {
      const fade = window01(time, 0, duration - 0.2, 0.01, 0.9);
      samples.forEach(({ marks, count }) => {
        let arrived = 0;
        marks.forEach(({ dot, from, to, at }) => {
          const travel = ease(clamp01((time - at) / 0.7));
          if (travel >= 1) arrived += 1;
          dot.setAttribute('cx', from[0] + (to[0] - from[0]) * travel);
          dot.setAttribute('cy', from[1] + (to[1] - from[1]) * travel);
          dot.setAttribute('opacity', fade * clamp01((time - at) / 0.2) * (0.25 + 0.3 * travel));
        });
        count.textContent = `${arrived} of 20 samples`;
        count.setAttribute('opacity', fade);
      });
    },
  };
}

// ---------- The loop ----------
const figures = [];
document.querySelectorAll('.tech-stage[data-figure]').forEach((stage) => figures.push(robotFigure(stage)));
const states = document.querySelector('svg[data-diagram="states"]');
if (states) figures.push(statesFigure(states));
const policies = document.querySelector('svg[data-diagram="policies"]');
if (policies) figures.push(policiesFigure(policies));

const visible = new Map();
function startWhenSeen(figure) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !visible.has(figure)) {
        if (!figure.ready()) return;
        visible.set(figure, performance.now());
        if (reduceMotion.matches) figure.draw(figure.still());
      } else if (!entry.isIntersecting) {
        visible.delete(figure);
      }
    }
  }, { threshold: 0.15 });
  observer.observe(figure.element);
}
figures.forEach(startWhenSeen);

function frame(now) {
  if (!reduceMotion.matches) {
    for (const [figure, startedAt] of visible) {
      // Every figure starts from its beginning when it comes into view, then loops.
      figure.draw(((now - startedAt) / 1000) % figure.duration());
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => { if (reduceMotion.matches) for (const figure of visible.keys()) figure.draw(figure.still()); });

// Exported only so the overlays can be checked outside a browser.
export { drawOverlay };
