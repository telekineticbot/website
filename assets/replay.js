/* Clarity loads only after a visitor chooses to allow session replay. */
(function () {
  'use strict';
  if (location.pathname.indexOf('/preview') === 0 ||
      !/^(www\.)?telekinetic\.bot$/.test(location.hostname)) return;
  var key = 'telekinetic.replay-consent';
  var enabled = false;
  var loaded = false;
  var decision;
  try { decision = localStorage.getItem(key); } catch (_) {}
  var restricted = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
  function allow() {
    if (restricted) return;
    enabled = true;
    if (loaded) return;
    loaded = true;
    window.clarity = window.clarity || function () {
      (window.clarity.q = window.clarity.q || []).push(arguments);
    };
    window.clarity('consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' });
    window.clarity('set', 'site', 'telekinetic');
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.clarity.ms/tag/ywrpm8qywl';
    document.head.appendChild(script);
  }
  window.tkReplayEvent = function (name) {
    if (!enabled || !/^(signup_start|signup_attempt|signup_error|generate_lead|site_error)$/.test(name)) return;
    try { window.clarity('event', name); } catch (_) {}
  };
  if (decision === 'allow') allow();
  function ready() {
    var style = document.createElement('style');
    style.textContent = '.replay-panel{position:fixed;z-index:1000;bottom:44px;left:16px;right:16px;max-width:420px;padding:18px;background:#faf9f6;color:#14140f;border:1px solid #b7b7ad;border-radius:12px;box-shadow:0 4px 24px #0002;font:13px/1.5 system-ui,sans-serif}.replay-panel[hidden]{display:none}.replay-panel p{margin:0 0 12px}.replay-panel button{font:inherit;padding:8px 12px;margin:0 8px 0 0;border:1px solid #777;border-radius:6px;background:#fff;color:#14140f;cursor:pointer}.replay-panel a{color:inherit}.replay-settings{position:fixed;z-index:999;left:16px;bottom:12px;font:11px system-ui,sans-serif;border:1px solid #777;background:#faf9f6;color:#14140f;border-radius:4px;padding:4px 7px;cursor:pointer}';
    document.head.appendChild(style);
    var panel = document.createElement('section');
    panel.className = 'replay-panel'; panel.setAttribute('aria-label', 'Session replay preferences');
    panel.innerHTML = '<p><strong>Help us improve this site?</strong><br>Allow Microsoft Clarity to record clicks, scrolling, and page layout. Form inputs are masked. Google Analytics measures visits separately. <a href="/privacy.html">Privacy details</a></p><button type="button" data-choice="allow">Allow replay</button><button type="button" data-choice="deny">No thanks</button>';
    var settings = document.createElement('button');
    settings.type = 'button'; settings.className = 'replay-settings'; settings.textContent = 'Replay privacy';
    panel.hidden = !!decision || restricted;
    if (restricted) {
      panel.querySelector('p').textContent = 'Session replay is off because your browser sends a privacy preference. Google Analytics measures visits separately.';
      panel.querySelector('[data-choice="allow"]').hidden = true;
    }
    settings.addEventListener('click', function () { panel.hidden = !panel.hidden; });
    panel.addEventListener('click', function (event) {
      var choice = event.target.getAttribute('data-choice');
      if (choice !== 'allow' && choice !== 'deny') return;
      try { localStorage.setItem(key, choice); } catch (_) {}
      panel.hidden = true;
      if (choice === 'allow') allow();
      else if (loaded) {
        enabled = false;
        window.clarity('consentv2', { analytics_Storage: 'denied', ad_Storage: 'denied' });
        // Reload without the recorder to stop all further recording on this page.
        // Remove its first-party cookies, including parent-domain variants.
        ['_clck', '_clsk'].forEach(function (name) {
          ['', '; domain=' + location.hostname, '; domain=telekinetic.bot'].forEach(function (domain) {
            document.cookie = name + '=; Max-Age=0; path=/' + domain;
          });
        });
        location.reload();
      }
      settings.focus();
    });
    document.body.appendChild(panel); document.body.appendChild(settings);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}());
