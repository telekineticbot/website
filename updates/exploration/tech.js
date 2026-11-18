// Runs the technical section's animations: robot scenes from tech-figs.js, all on the same table,
// drawn by one shared WebGL renderer into each figure's own canvas. Each one loops while it is on screen.
import * as THREE from 'three';
import { buildStudio } from './scene-parts.js';
import { FIGURES } from './tech-figs.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgElement = (name, attributes = {}, parent) => {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (parent) parent.appendChild(element);
  return element;
};

// ---------- The shared renderer ----------
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
  const note = stage.querySelector('.stage-note');
  const labelLayer = stage.querySelector('.stage-labels');
  const labelElements = [];
  let figure = null, camera = null, scene = null;
  return {
    element: stage,
    duration: () => figure.duration,
    still: () => figure.still,
    ready() {
      if (figure) return true;
      const shared = sharedRenderer();
      if (!shared || !build) return false;
      figure = build(() => { scene = buildStudio(shared).scene; return scene; });
      // Each scene is drawn at device pixels into the figure's own canvas, so the shared one works at a ratio of 1.
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
      renderer.setScissorTest(true);
      renderer.setClearColor(0x000000, 0);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
      renderer.clear();
      camera.aspect = width / height;
      // On a narrow screen the view widens a little so the robot and bowl stay in frame.
      camera.fov = figure.camera.fov * (camera.aspect < 1.2 ? 1.2 : 1);
      camera.position.copy(figure.camera.position);
      camera.lookAt(figure.camera.target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      renderer.setScissorTest(false);
      context.clearRect(0, 0, width, height);
      context.globalAlpha = state.fade ?? 1;
      context.drawImage(renderer.domElement, 0, renderer.domElement.height - height, width, height, 0, 0, width, height);
      context.globalAlpha = 1;
      if (note) {
        note.textContent = state.note ?? '';
        note.style.opacity = state.note ? (state.fade ?? 1) : 0;
      }
      if (labelLayer) drawLabels(labelLayer, labelElements, state.labels ?? [], camera, state.fade ?? 1);
      overlays.forEach((overlay) => drawOverlay(overlay, state));
    },
  };
}

// Text pinned to points in the scene, placed over the canvas where the camera sees each point.
function drawLabels(layer, elements, labels, camera, fade) {
  while (elements.length < labels.length) {
    const element = document.createElement('span');
    element.className = 'stage-label';
    layer.appendChild(element);
    elements.push(element);
  }
  elements.forEach((element, index) => {
    const label = labels[index];
    if (!label || label.opacity < 0.01) { element.style.opacity = 0; return; }
    const point = label.at.clone().project(camera);
    element.textContent = label.text;
    element.style.left = `${((point.x + 1) / 2) * 100}%`;
    element.style.top = `${((1 - point.y) / 2) * 100}%`;
    element.style.opacity = label.opacity * fade;
  });
}

// ---------- Overlays under a scene ----------
function drawOverlay(overlay, state) {
  const kind = overlay.dataset.overlay;
  if (kind === 'strip' && state.strip) drawStrip(overlay, state.strip);
  if (kind === 'strength' && state.strength !== undefined) drawStrength(overlay, state);
  if (kind === 'noise' && state.size !== undefined) drawNoise(overlay, state);
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

// How big the noise is, among the three sizes shown, and how many copies would hit the table or the bowl.
const NOISE_SIZES = [['small', 0.015], ['medium', 0.045], ['large', 0.17]];
function drawNoise(overlay, state) {
  if (!overlay.firstChild) {
    overlay.setAttribute('viewBox', '0 0 600 40');
    svgElement('text', { x: 0, y: 16, class: 'svg-label' }, overlay).textContent = 'noise';
    svgElement('line', { x1: 120, y1: 12, x2: 420, y2: 12, class: 'grid' }, overlay);
    NOISE_SIZES.forEach(([name], index) => {
      svgElement('text', { x: 120 + index * 150, y: 36, class: 'svg-label', 'text-anchor': 'middle' }, overlay).textContent = name;
    });
    svgElement('circle', { cx: 120, cy: 12, r: 7, class: 'knob ink' }, overlay);
    svgElement('text', { x: 600, y: 16, class: 'svg-label count', 'text-anchor': 'end' }, overlay);
  }
  const size = state.size;
  let position = 0;
  if (size > NOISE_SIZES[1][1]) position = 1 + (size - NOISE_SIZES[1][1]) / (NOISE_SIZES[2][1] - NOISE_SIZES[1][1]);
  else if (size > NOISE_SIZES[0][1]) position = (size - NOISE_SIZES[0][1]) / (NOISE_SIZES[1][1] - NOISE_SIZES[0][1]);
  const knob = overlay.querySelector('.knob');
  knob.setAttribute('cx', 120 + 150 * Math.min(2, position));
  knob.style.opacity = size > 0.001 ? 1 : 0.3;
  const count = overlay.querySelector('.count');
  count.textContent = size > 0.001 ? `${state.unsafe} of 28 would hit` : '';
  count.setAttribute('class', state.unsafe > 0 ? 'svg-label count accent' : 'svg-label count');
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
  const knob = overlay.querySelector('.knob');
  const from = Number(knob.dataset.shown ?? state.strength);
  // The knob glides to each new k rather than jumping.
  const shown = from + (state.strength - from) * 0.12;
  knob.dataset.shown = shown;
  knob.setAttribute('cx', 40 + 540 * shown);
}

// ---------- The loop ----------
const figures = [];
document.querySelectorAll('.tech-stage[data-figure]').forEach((stage) => figures.push(robotFigure(stage)));

const visible = new Map();
figures.forEach((figure) => {
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
});

function frame(now) {
  if (!reduceMotion.matches) {
    // Every figure starts from its beginning when it comes into view, then loops.
    for (const [figure, startedAt] of visible) figure.draw(((now - startedAt) / 1000) % figure.duration());
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => { if (reduceMotion.matches) for (const figure of visible.keys()) figure.draw(figure.still()); });

// Exported only so the overlays can be checked outside a browser.
export { drawOverlay };
