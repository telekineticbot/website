/* Direct GA4 for the Telekinetic web stream.
 * Keep GA4 pageview tags out of GTM to avoid duplicate pageviews.
 */
(function () {
  'use strict';
  // Review pages must not inflate production traffic or outreach conversions.
  if (window.location.pathname.indexOf('/preview') === 0) return;
  var measurementId = 'G-PV6WD20E5Q';

  var referral = new URL(window.location.href).searchParams.get('r');
  var refId = referral;
  try {
    if (referral) localStorage.setItem('telekinetic.ref_id', referral);
    else refId = localStorage.getItem('telekinetic.ref_id');
  } catch (_) {
    // Tracking this visit still works when browser storage is unavailable.
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // Set attribution before config emits the initial page_view.
  if (refId) window.gtag('set', 'user_properties', { ref_id: refId });
  window.gtag('config', measurementId, { page_location: window.location.href });
  if (referral) {
    window.gtag('event', 'outreach_click', {
      send_to: measurementId,
      ref_id: referral,
      page_location: window.location.href
    });
  }

  var tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
  document.head.appendChild(tag);
}());
