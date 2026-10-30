package io.campuscore.restfulapi.identity;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The login page the SAS chain redirects to when an authorize request arrives
 * without an authenticated principal (identity.oidc.login-page). It reuses
 * the existing login authority end-to-end — credentials go only to
 * /api/v1/auth/login and /api/v1/auth/two-factor/verify over fetch, exactly
 * like the first-party frontend; this controller adds no new credential
 * path and no new grant type. The page is deliberately self-contained so the
 * id host does not depend on a deployed SPA bundle.
 */
@RestController
@ConditionalOnProperty(prefix = "identity.oidc", name = "enabled", havingValue = "true")
public class IdentityLoginPageController {

    private final String page;

    public IdentityLoginPageController(
            @Value("${security.csrf-cookie:cc_csrf}") String csrfCookie,
            @Value("${security.csrf-header:X-CSRF-Token}") String csrfHeader) {
        this.page = PAGE
                .replace("__CSRF_COOKIE__", csrfCookie)
                .replace("__CSRF_HEADER__", csrfHeader);
    }

    private static final String PAGE = """
            <!doctype html>
            <html lang="vi"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>CampusUTE — Đăng nhập</title>
            <style>
              body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;
                   align-items:center;justify-content:center;background:#f4f5f7;margin:0}
              form{background:#fff;padding:2rem;border-radius:8px;width:320px;
                   box-shadow:0 1px 4px rgba(0,0,0,.12)}
              h1{font-size:1.1rem;margin:0 0 1rem}
              label{display:block;font-size:.85rem;margin:.6rem 0 .2rem}
              input{width:100%;padding:.5rem;border:1px solid #ccc;border-radius:4px;
                    box-sizing:border-box}
              button{width:100%;margin-top:1rem;padding:.55rem;border:0;border-radius:4px;
                     background:#1d4ed8;color:#fff;font-size:.95rem;cursor:pointer}
              #err{color:#b91c1c;font-size:.85rem;min-height:1.2em;margin-top:.7rem}
            </style></head><body>
            <form id="f">
              <h1>Đăng nhập CampusUTE</h1>
              <label for="email">Email</label>
              <input id="email" type="email" autocomplete="username" required>
              <label for="pw">Mật khẩu</label>
              <input id="pw" type="password" autocomplete="current-password" required>
              <div id="otpWrap" style="display:none">
                <label for="otp">Mã xác thực (email)</label>
                <input id="otp" inputmode="numeric" autocomplete="one-time-code">
              </div>
              <button type="submit">Tiếp tục</button>
              <div id="err" role="alert"></div>
            </form>
            <script>
            (function () {
              // The authorize URL is same-origin by construction — SAS only
              // sends browsers here from its own chain. Anything else is
              // refused: never build an open-redirect out of the login page.
              var ret = new URLSearchParams(location.search).get('return') || '';
              function returnTarget() {
                if (ret.indexOf('/oauth2/authorize') === 0
                    || ret.indexOf('/session/login') === 0) { return ret; }
                return '/';
              }
              var challengeId = null;
              var form = document.getElementById('f');
              var err = document.getElementById('err');
              var otpWrap = document.getElementById('otpWrap');
              // Cookie-authenticated POSTs must echo the readable
              // double-submit hint — a revisit carrying the central auth
              // cookies (or a refresh-only jar) is CSRF-checked too.
              function readCookie(name) {
                var parts = document.cookie.split(';');
                for (var i = 0; i < parts.length; i++) {
                  var part = parts[i].trim();
                  if (part.indexOf(name + '=') === 0) {
                    return part.substring(name.length + 1);
                  }
                }
                return null;
              }
              function jsonHeaders() {
                var headers = {'Content-Type': 'application/json'};
                var csrf = readCookie('__CSRF_COOKIE__');
                if (csrf !== null && csrf !== '') {
                  headers['__CSRF_HEADER__'] = decodeURIComponent(csrf);
                }
                return headers;
              }
              form.addEventListener('submit', function (e) {
                e.preventDefault();
                err.textContent = '';
                if (challengeId === null) {
                  fetch('/api/v1/auth/login', {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify({
                      email: document.getElementById('email').value,
                      password: document.getElementById('pw').value
                    })
                  }).then(function (r) {
                    if (r.status === 429) { err.textContent = 'Quá nhiều lần thử. Thử lại sau.'; return null; }
                    if (!r.ok) { err.textContent = 'Email hoặc mật khẩu không đúng.'; return null; }
                    return r.json();
                  }).then(function (body) {
                    if (!body) { return; }
                    if (body.twoFactorRequired) {
                      challengeId = body.challengeId;
                      otpWrap.style.display = 'block';
                      document.getElementById('otp').focus();
                      return;
                    }
                    location.replace(returnTarget());
                  }).catch(function () { err.textContent = 'Lỗi kết nối.'; });
                } else {
                  fetch('/api/v1/auth/two-factor/verify', {
                    method: 'POST',
                    headers: jsonHeaders(),
                    body: JSON.stringify({
                      challengeId: challengeId,
                      code: document.getElementById('otp').value
                    })
                  }).then(function (r) {
                    if (!r.ok) { err.textContent = 'Mã không đúng hoặc đã hết hạn.'; return null; }
                    return r.json();
                  }).then(function (body) {
                    if (body) { location.replace(returnTarget()); }
                  }).catch(function () { err.textContent = 'Lỗi kết nối.'; });
                }
              });
            })();
            </script></body></html>
            """;

    @GetMapping("/login")
    public ResponseEntity<String> loginPage() {
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(HttpHeaders.CONTENT_TYPE, "text/html;charset=UTF-8")
                // Contract §7: never framed. The inline style/script blocks
                // are the whole page, so the policy stays minimal but
                // explicit rather than relying on X-Frame-Options alone.
                // connect-src 'self' is required — the page drives the
                // login authority over same-origin fetch and default-src
                // 'none' would silently block it.
                .header("Content-Security-Policy",
                        "default-src 'none'; script-src 'unsafe-inline';"
                        + " style-src 'unsafe-inline'; connect-src 'self';"
                        + " base-uri 'none'; frame-ancestors 'none'")
                .body(page);
    }
}
