/* Explicit, value-free interaction telemetry. Never send form values or error text. */
(function () {
  'use strict';
  var disabled = location.pathname.indexOf('/preview') === 0 ||
    !/^(www\.)?telekinetic\.bot$/.test(location.hostname);
  var allowed = {
    signup_start: ['form_id'], signup_attempt: ['form_id', 'attempt_number'],
    signup_error: ['form_id', 'error_type', 'http_status', 'response_time_ms'],
    generate_lead: ['form_id', 'response_time_ms'],
    element_view: ['element_id'], ui_click: ['element_id'],
    scroll_depth: ['percent_scrolled'], engaged_time: ['seconds'],
    site_error: ['error_type'], page_performance: ['dom_ready_ms', 'load_ms', 'ttfb_ms']
  };
  window.tkTrack = function (name, parameters) {
    if (disabled || !allowed[name]) return;
    try {
      var data = { send_to: 'G-PV6WD20E5Q', transport_type: 'beacon' };
      allowed[name].forEach(function (key) {
        if (parameters && parameters[key] !== undefined) data[key] = parameters[key];
      });
      window.gtag('event', name, data);
    } catch (_) { /* Analytics must never break the signup flow. */ }
    try { if (window.tkReplayEvent) window.tkReplayEvent(name); } catch (_) {}
  };
  if (disabled) return;
  var track = window.tkTrack;
  var errors = {};
  function error(type) {
    if (!errors[type]) { errors[type] = true; track('site_error', { error_type: type }); }
  }
  window.addEventListener('error', function (event) {
    error(event.target && event.target !== window ? 'resource_load' : 'javascript');
  }, true);
  window.addEventListener('unhandledrejection', function () { error('unhandled_promise'); });
  function ready() {
    var elements = { signup: '#tk-signup', price: '.purchase', specifications: '.specs' };
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            track('element_view', { element_id: entry.target.dataset.analyticsElement });
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });
      Object.keys(elements).forEach(function (id) {
        var element = document.querySelector(elements[id]);
        if (element) { element.dataset.analyticsElement = id; observer.observe(element); }
      });
    }
    var logo = document.querySelector('.brand-logo');
    if (logo) logo.addEventListener('click', function () { track('ui_click', { element_id: 'brand_logo' }); });
    var depths = {};
    window.addEventListener('scroll', function () {
      var distance = document.documentElement.scrollHeight - window.innerHeight;
      if (distance <= 0 || window.scrollY <= 0) return;
      var depth = Math.min(100, Math.round(window.scrollY / distance * 100));
      [25, 50, 75, 100].forEach(function (threshold) {
        if (depth >= threshold && !depths[threshold]) {
          depths[threshold] = true; track('scroll_depth', { percent_scrolled: threshold });
        }
      });
    }, { passive: true });
    var elapsed = 0, previous = performance.now(), milestones = {};
    function tick() {
      var now = performance.now();
      if (!document.hidden && document.hasFocus()) elapsed += Math.min(now - previous, 2000);
      previous = now;
      [10, 30, 60, 120].forEach(function (seconds) {
        if (elapsed >= seconds * 1000 && !milestones[seconds]) {
          milestones[seconds] = true; track('engaged_time', { seconds: seconds });
        }
      });
    }
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () { previous = performance.now(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.addEventListener('load', function () {
    setTimeout(function () {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) track('page_performance', {
        dom_ready_ms: Math.round(nav.domContentLoadedEventEnd),
        load_ms: Math.round(nav.loadEventEnd),
        ttfb_ms: Math.round(nav.responseStart - nav.requestStart)
      });
    }, 0);
  }, { once: true });
}());
