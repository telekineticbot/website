# Website analytics

GA4 property: Telekinetic (`478353384`), measurement ID `G-PV6WD20E5Q`.

`assets/analytics.js` handles pageviews and outreach attribution. `assets/behavior.js`
handles explicit interactions. Do not add a second GA4 pageview tag in GTM.
Review pages under `/preview` do not send analytics. Device/browser/OS and acquisition
information use GA4's automatic collection. GA4's automatic `form_submit` is not a
confirmed conversion; use `generate_lead` for that.

## Event map

| Event | Trigger | Parameters |
|---|---|---|
| outreach_click | Landing with nonempty `r` query | ref_id |
| signup_start | First nonempty input on this page | form_id |
| signup_attempt | Submit action, including invalid input | form_id, attempt_number |
| signup_error | Invalid email, rejected response, malformed JSON, or network failure | form_id, error_type, http_status, response_time_ms |
| generate_lead | Loops returns HTTP success and JSON `success: true` | form_id, response_time_ms |
| element_view | At least half of signup/price/specifications becomes visible, once per page | element_id |
| ui_click | Logo activation | element_id |
| scroll_depth | User scrolls 25/50/75/100% of scrollable distance, once per threshold | percent_scrolled |
| engaged_time | 10/30/60/120 foreground, focused seconds, once per threshold | seconds |
| site_error | First JS/resource/unhandled-promise failure of each category per page | error_type |
| page_performance | Navigation timing after load | dom_ready_ms, load_ms, ttfb_ms |

Short pages with no scrollable content do not emit scroll_depth. Performance timings
are navigation timings, not Core Web Vitals. A lead means the form endpoint accepted
the request, not that an email address has completed double opt-in or is a new contact.

## Reporting

Use a closed signup funnel: `page_view` → `signup_start` → `signup_attempt` →
`generate_lead`, segmented by device category, source/medium, and attributed referral.
Inspect `signup_error` by `error_type` alongside attempted signups. Mark `generate_lead`
as a GA4 key event. Do not count outreach_click or generic form_submit as a lead.

Custom dimensions: Outreach referral ID (Event/ref_id), Attributed referral ID
(User/ref_id), Interaction element (Event/element_id), Failure category (Event/error_type).
Optional custom metrics: response_time_ms, dom_ready_ms, load_ms, ttfb_ms (milliseconds),
seconds (seconds), percent_scrolled and attempt_number (standard).

Use arbitrary opaque referral IDs; keep recipient mappings outside analytics. No email
value, input content, response body, raw error message, or stack trace is added to the
explicit events. Preview traffic is excluded.

## Validation

`node --test tests/analytics.cjs` covers signup success, duplicate-submit prevention,
invalid input, server/malformed/network failures, tracking failure isolation, preview
suppression, and parameter allowlisting. Tests mock Loops and never send email.

After deployment, verify harmless interactions in GA4 Realtime. Allow standard reports
time to process new definitions. Historical untracked actions cannot be recovered.
