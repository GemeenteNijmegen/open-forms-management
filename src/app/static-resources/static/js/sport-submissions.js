/**
 * Browsergedrag voor de Sport-aanmeldingenlijst op /sport: initiële load, Vernieuwen, Meer tonen en
 * loadingstatus. Authorization, cachelogica, filtering en HTML-rendering blijven backendverantwoordelijkheid;
 * dit script doet alleen fetch/DOM en meldt eigen fouten best-effort aan /sport/client-errors.
 */
(function () {
  var container = document.getElementById('sport-submissions');
  if (!container) {
    return;
  }

  var refreshButton = document.getElementById('sport-refresh-button');
  var statusEl = document.getElementById('sport-refresh-status');
  var SAME_ORIGIN_HEADER = 'X-Sport-Same-Origin';
  var POLL_INTERVAL_MS = 1500;
  var reportedEvents = {};

  // The backend checks this fixed header for its same-origin protection; see `isSameOriginRequest` server-side.
  function sameOriginHeaders(extra) {
    var headers = extra || {};
    headers[SAME_ORIGIN_HEADER] = '1';
    return headers;
  }

  function setBusy(isBusy, statusText) {
    container.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    if (refreshButton) {
      refreshButton.disabled = isBusy;
    }
    if (statusEl) {
      statusEl.hidden = !(isBusy && statusText);
      statusEl.textContent = statusText || '';
    }
  }

  function reportClientError(event, relatedCorrelationId) {
    if (!event || reportedEvents[event]) {
      return;
    }
    reportedEvents[event] = true;
    fetch('/sport/client-errors', {
      method: 'POST',
      credentials: 'same-origin',
      headers: sameOriginHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ event: event, relatedCorrelationId: relatedCorrelationId || undefined }),
    }).catch(function () {
      // Telemetry mag zelf nooit opnieuw telemetry starten; console is hier de enige fallback.
      console.error('Sport client-error report failed to send');
    });
  }

  function isAuthRedirect(response) {
    return response.status === 401 || response.status === 403 || (response.redirected && response.url.indexOf('/login') !== -1);
  }

  function showError(message, event, relatedCorrelationId) {
    container.innerHTML = '<div class="utrecht-alert utrecht-alert--error" role="alert"><div class="utrecht-alert__content">'
      + '<p class="utrecht-alert__message">' + message + '</p></div></div>';
    setBusy(false);
    reportClientError(event, relatedCorrelationId);
  }

  function currentFilterQuery() {
    var params = new URLSearchParams(window.location.search);
    params.delete('cursor');
    return params;
  }

  function submissionsUrl(cursor) {
    var params = currentFilterQuery();
    if (cursor) {
      params.set('cursor', cursor);
    }
    var query = params.toString();
    return '/sport/submissions' + (query ? '?' + query : '');
  }

  function wireLoadMoreButtons() {
    var buttons = container.querySelectorAll('[data-sport-load-more]');
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener('click', onLoadMoreClick);
    }
  }

  function onLoadMoreClick(clickEvent) {
    var button = clickEvent.currentTarget;
    var cursor = button.getAttribute('data-cursor');
    button.disabled = true;
    fetch(submissionsUrl(cursor), { credentials: 'same-origin' })
      .then(function (response) {
        if (isAuthRedirect(response)) {
          window.location.href = '/login';
          return;
        }
        if (!response.ok) {
          reportClientError('LOAD_MORE_FAILED', response.headers.get('X-Correlation-Id'));
          button.disabled = false;
          return;
        }
        return response.text().then(function (html) {
          button.parentNode.removeChild(button);
          var wrapper = document.createElement('div');
          wrapper.innerHTML = html;
          while (wrapper.firstChild) {
            container.appendChild(wrapper.firstChild);
          }
          wireLoadMoreButtons();
        });
      })
      .catch(function () {
        reportClientError('LOAD_MORE_FAILED');
        button.disabled = false;
      });
  }

  function pollSubmissions(isInitial, relatedCorrelationId) {
    fetch(submissionsUrl(), { credentials: 'same-origin' })
      .then(function (response) {
        if (isAuthRedirect(response)) {
          window.location.href = '/login';
          return;
        }
        var correlationId = response.headers.get('X-Correlation-Id') || relatedCorrelationId;
        if (response.status === 202) {
          window.setTimeout(function () { pollSubmissions(isInitial, correlationId); }, POLL_INTERVAL_MS);
          return;
        }
        if (!response.ok) {
          showError('Aanmeldingen laden is niet gelukt.', isInitial ? 'INITIAL_LOAD_FAILED' : 'REFRESH_FAILED', correlationId);
          return;
        }
        return response.text().then(function (html) {
          container.innerHTML = html;
          setBusy(false);
          wireLoadMoreButtons();
        });
      })
      .catch(function () {
        showError('Aanmeldingen laden is niet gelukt.', isInitial ? 'INITIAL_LOAD_FAILED' : 'REFRESH_FAILED', relatedCorrelationId);
      });
  }

  function startRefresh(isInitial) {
    setBusy(true, isInitial ? undefined : 'Bezig met vernieuwen…');
    fetch('/sport/submissions/refresh', { method: 'POST', credentials: 'same-origin', headers: sameOriginHeaders() })
      .then(function (response) {
        if (isAuthRedirect(response)) {
          window.location.href = '/login';
          return;
        }
        var correlationId = response.headers.get('X-Correlation-Id');
        if (!response.ok) {
          showError('Vernieuwen is niet gelukt.', isInitial ? 'INITIAL_LOAD_FAILED' : 'REFRESH_FAILED', correlationId);
          return;
        }
        pollSubmissions(isInitial, correlationId);
      })
      .catch(function () {
        showError('Vernieuwen is niet gelukt.', isInitial ? 'INITIAL_LOAD_FAILED' : 'REFRESH_FAILED');
      });
  }

  function init() {
    if (refreshButton) {
      refreshButton.addEventListener('click', function () { startRefresh(false); });
    }
    window.addEventListener('unhandledrejection', function () {
      reportClientError('UNHANDLED_PROMISE_REJECTION');
    });
    window.addEventListener('error', function () {
      reportClientError('UNEXPECTED_JAVASCRIPT_ERROR');
    });
    startRefresh(true);
  }

  init();
})();
