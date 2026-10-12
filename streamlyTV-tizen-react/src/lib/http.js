/**
 * Small XHR-based HTTP client. XHR (not fetch) because it is native on every
 * Tizen engine, supports timeouts, and gives the status for every response.
 *
 *   request(method, url, opts) -> Promise<{ status, data, text }>
 *     opts: { body, token, timeout, headers, json }
 *     - body FormData is sent as-is; a plain object is sent as JSON.
 *     - data is the parsed JSON body or null.
 *     - rejects with an Error whose .kind is 'network' | 'timeout'.
 */
export function request(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    const xhr = new XMLHttpRequest();
    let finished = false;

    function fail(kind) {
      if (finished) return;
      finished = true;
      const err = new Error(kind === 'timeout' ? 'Request timed out' : 'Network error');
      err.kind = kind;
      err.url = url;
      reject(err);
    }

    try {
      xhr.open(method, url, true);
    } catch (e) {
      fail('network');
      return;
    }

    xhr.timeout = opts.timeout || 15000;
    xhr.setRequestHeader('Accept', 'application/json');
    if (opts.token) xhr.setRequestHeader('Authorization', 'Bearer ' + opts.token);

    let payload = null;
    const body = opts.body;
    if (body !== undefined && body !== null) {
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        payload = body;
      } else if (typeof body === 'string') {
        payload = body;
      } else {
        payload = JSON.stringify(body);
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
    }
    const headers = opts.headers || {};
    Object.keys(headers).forEach(function (name) {
      xhr.setRequestHeader(name, headers[name]);
    });

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || finished) return;
      // Status 0 = failed at network level; onerror/ontimeout report it.
      if (xhr.status === 0) return;
      finished = true;
      const text = xhr.responseText || '';
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = null;
        }
      }
      resolve({ status: xhr.status, data: data, text: text });
    };
    xhr.onerror = function () {
      fail('network');
    };
    xhr.ontimeout = function () {
      fail('timeout');
    };

    try {
      xhr.send(payload);
    } catch (e) {
      fail('network');
    }
  });
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Login-style request (same rules as the current app's fetchWithRetry):
 * - HTTP 429 is retried with exponential backoff.
 * - An empty / non-JSON body on HTTP 479 (device limit) or 410 (subscription
 *   expired) still yields { response_code, success:false } so those flows run.
 * - Any other unreadable body rejects with a user-friendly message.
 * Resolves with the parsed JSON object.
 */
export function requestWithRetry(method, url, opts, retries, waitMs) {
  retries = retries === undefined ? 3 : retries;
  waitMs = waitMs || 1000;
  return request(method, url, opts).then(function (res) {
    if (res.status === 429 && retries > 0) {
      return delay(waitMs).then(function () {
        return requestWithRetry(method, url, opts, retries - 1, waitMs * 2);
      });
    }
    let data = res.data;
    if (data === null) {
      if (res.status === 479 || res.status === 410) {
        data = { response_code: res.status, success: false };
      } else {
        throw new Error("We couldn't process the server's response. Please try again.");
      }
    } else if ((res.status === 479 || res.status === 410) && !data.response_code) {
      data.response_code = res.status;
    }
    return data;
  });
}

export function formData(fields) {
  const fd = new FormData();
  Object.keys(fields).forEach(function (key) {
    const value = fields[key];
    fd.append(key, value === undefined || value === null ? '' : String(value));
  });
  return fd;
}

// The OTP / verification endpoints don't consistently return success: true;
// some use status: "success" or only response_code: 200.
export function isApiSuccess(data) {
  if (!data) return false;
  if (data.success === true || data.success === 1 || data.success === '1') return true;
  if (data.status === true || data.status === 'success') return true;
  return data.success !== false && Number(data.response_code) === 200;
}

// Internal exception text from the backend must never reach the user.
export function friendlyMessage(message, fallback) {
  if (!message || /cannot read propert|undefined|is not a function|TypeError|ReferenceError/i.test(message)) {
    return fallback;
  }
  return message;
}
