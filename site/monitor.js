/* ניטור תקלות — כל שגיאה נשמרת ב-app_errors ומופיעה בהגדרות → "תקלות" (למנהל בלבד).
   ⚠️ נשלח רק: הודעה, stack, נתיב העמוד (בלי ? ו-#), דפדפן. לעולם לא שמות, טלפונים או תוכן.
   נטען ראשון, אחרי config.js, כדי לתפוס שגיאות מכל מה שבא אחריו. */
(function () {
  var APP = 'mechina';
  var cfg = window.APP_CONFIG || {};
  var sent = 0, seen = {};

  function report(msg, stack) {
    try {
      msg = String(msg || '').slice(0, 500);
      if (!msg || msg === 'Script error.' || sent >= 20 || seen[msg]) return;
      if (/extension:\/\//.test(String(stack || ''))) return; /* תוספי דפדפן — לא שלנו */
      if (!cfg.url || cfg.url.indexOf('YOUR-') !== -1) return;
      seen[msg] = 1; sent++;
      var args = {
        p_app: APP, p_message: msg,
        p_stack: String(stack || '').slice(0, 4000),
        p_page: location.origin + location.pathname,
        p_ua: navigator.userAgent
      };
      /* עם הלקוח של Supabase — כדי שיישמר גם מי המשתמש */
      if (window.sb && window.sb.rpc) {
        window.sb.rpc('log_error', args).then(function () {}, function () {});
        return;
      }
      fetch(cfg.url + '/rest/v1/rpc/log_error', {
        method: 'POST', keepalive: true,
        headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      }).catch(function () {});
    } catch (e) { /* הניטור לעולם לא מפיל את האפליקציה */ }
  }

  window.addEventListener('error', function (e) { report(e.message, e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    report((r && r.message) || r, r && r.stack);
  });
  /* לשימוש ידני: logIssue("שמירת נוכחות נכשלה: " + error.message) */
  window.logIssue = report;
})();
