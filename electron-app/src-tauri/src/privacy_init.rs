//! Fingerprint-noise init script (anonymity hardening, Phase C).
//!
//! Injected ONLY into PRIVATE-profile webviews (see core::create_tab_webview).
//! Goal: break stable JS fingerprinting (canvas / WebGL / AudioContext /
//! ClientRects / hardware concurrence) while keeping the identity STABLE for
//! the whole profile lifetime — one seeded PRNG per session, deterministic
//! per input, never per-navigation rotation (profiles.rs philosophy).
//!
//! Honest limits (documented in privacy.rs): JS-level spoofing is
//! distinguishable by advanced detectors (Function.toString checks are
//! mitigated below, engine-level JA3/TLS is out of reach on WebView2).

/// Build the init script for a PRIVATE-profile session.
/// `seed` — per-webview random 64-bit value; noise is deterministic given
/// the seed, so re-rendering the same content yields the same fingerprint
/// WITHIN the session (rotation only happens on app restart / new identity).
pub fn script(seed: u64, timezone: Option<&str>, locale: Option<&str>) -> String {
    let tz = serde_json::to_string(&timezone).unwrap_or_else(|_| "null".into());
    let loc = serde_json::to_string(&locale).unwrap_or_else(|_| "null".into());
    TEMPLATE
        .replace("__HD_SEED__", &seed.to_string())
        .replace("__HD_TZ__", &tz)
        .replace("__HD_LOCALE__", &loc)
}

const TEMPLATE: &str = r#"(function () {
  'use strict';
  if (window.__hdPrivacyNoise) return;
  window.__hdPrivacyNoise = true;
  var SEED = __HD_SEED__;
  var TZ_NAME = __HD_TZ__;
  var LOCALE = __HD_LOCALE__;

  // Deterministic PRNG (mulberry32) seeded per session.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash() {
    var h = SEED >>> 0;
    for (var i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ arguments[i], 2654435761) >>> 0;
      h = (h + (h << 13)) >>> 0;
    }
    return h;
  }

  // Make patched functions report [native code] — via a GLOBAL toString
  // hook (WeakMap is invisible to JS), replacing the earlier per-function
  // own-property disguise: `Function.prototype.toString.call(patched)` no
  // longer leaks the real source, and the hook disguises ITSELF.
  var NAMES = new WeakMap();
  function disguise(fn, name) {
    try { NAMES.set(fn, name); } catch (e) {}
  }
  var origToString = Function.prototype.toString;
  var hookedToString = function toString() {
    try {
      var name = NAMES.get(this);
      if (name !== undefined) return 'function ' + name + '() { [native code] }';
    } catch (e) {}
    return origToString.call(this);
  };
  disguise(hookedToString, 'toString'); // the hook itself passes the probe
  Function.prototype.toString = hookedToString;

  // ---- Canvas: sub-visible per-pixel noise on readback/serialization ----
  var STRIDE = 97;
  function farble(data, w, h) {
    var r = rng(hash(w, h, data.length));
    for (var i = 0; i < data.length; i += 4 * STRIDE) {
      data[i] = (data[i] + ((r() * 3) | 0) - 1) & 0xff;
    }
  }
  try {
    var origGID = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
      var img = origGID.call(this, x, y, w, h);
      try { farble(img.data, w, h); } catch (e) {}
      return img;
    };
    disguise(CanvasRenderingContext2D.prototype.getImageData, 'getImageData');

    var origTDU = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      try {
        var w = this.width, h = this.height;
        if (w > 0 && h > 0) {
          // Farble a SCRATCH copy — the original canvas is never mutated,
          // so repeated reads of the same content stay deterministic
          // (two probes comparing consecutive toDataURL()s must agree).
          var scratch = document.createElement('canvas');
          scratch.width = w; scratch.height = h;
          var sctx = scratch.getContext('2d');
          sctx.drawImage(this, 0, 0);
          var img = origGID.call(sctx, 0, 0, w, h);
          farble(img.data, w, h);
          sctx.putImageData(img, 0, 0);
          return origTDU.apply(scratch, arguments);
        }
      } catch (e) {}
      return origTDU.apply(this, arguments);
    };
    disguise(HTMLCanvasElement.prototype.toDataURL, 'toDataURL');
  } catch (e) {}

  // ---- AudioContext: tiny noise on frequency/buffer readouts ----
  try {
    var audioCalls = 0;
    if (window.AnalyserNode) {
      var origFFD = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function (arr) {
        origFFD.call(this, arr);
        var r = rng(hash(arr.length, ++audioCalls));
        for (var i = 0; i < arr.length; i++) arr[i] += (r() - 0.5) * 0.02;
      };
      disguise(AnalyserNode.prototype.getFloatFrequencyData, 'getFloatFrequencyData');
    }
    if (window.AudioBuffer) {
      var origGCD = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function (ch) {
        var arr = origGCD.call(this, ch);
        var r = rng(hash(arr.length, ch, ++audioCalls));
        for (var i = 0; i < arr.length; i += 512) arr[i] += (r() - 0.5) * 1e-7;
        return arr;
      };
      disguise(AudioBuffer.prototype.getChannelData, 'getChannelData');
    }
  } catch (e) {}

  // ---- ClientRects: sub-pixel jitter (hash-stable per coordinates) ----
  try {
    var origGBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      var rect = origGBCR.apply(this, arguments);
      var r = rng(hash(
        Math.round(rect.left * 10), Math.round(rect.top * 10),
        Math.round(rect.width * 10), Math.round(rect.height * 10)
      ));
      var j = function () { return (r() - 0.5) * 0.002; };
      return new DOMRect(rect.x + j(), rect.y + j(), rect.width + j(), rect.height + j());
    };
    disguise(Element.prototype.getBoundingClientRect, 'getBoundingClientRect');
  } catch (e) {}

  // ---- WebGL: generic vendor/renderer instead of the real GPU ----
  function patchGL(Cls) {
    if (!Cls || !Cls.prototype || !Cls.prototype.getParameter) return;
    var orig = Cls.prototype.getParameter;
    Cls.prototype.getParameter = function (p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return orig.call(this, p);
    };
    disguise(Cls.prototype.getParameter, 'getParameter');
  }
  try { patchGL(window.WebGLRenderingContext); patchGL(window.WebGL2RenderingContext); } catch (e) {}

  // ---- navigator hardware normalization ----
  try {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: function () { return 8; }, configurable: true
    });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: function () { return 8; }, configurable: true
    });
  } catch (e) {}

  // ---- Locale override ----
  if (LOCALE) {
    try {
      Object.defineProperty(Navigator.prototype, 'language', {
        get: function () { return LOCALE; }, configurable: true
      });
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: function () { return [LOCALE]; }, configurable: true
      });
    } catch (e) {}
  }

  // ---- Timezone override (Date + Intl.resolvedOptions) ----
  if (TZ_NAME) {
    try {
      function tzOffsetMinutes(name) {
        var now = new Date();
        // Both wall clocks are parsed in the HOST timezone, so the host's
        // own offset cancels out — the difference is the target's offset.
        var loc = new Date(now.toLocaleString('en-US', { timeZone: name }));
        var utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        if (isNaN(loc.getTime()) || isNaN(utc.getTime())) return null;
        return Math.round((loc.getTime() - utc.getTime()) / 60000);
      }
      var off = tzOffsetMinutes(TZ_NAME); // minutes EAST of UTC
      if (off !== null) {
        Date.prototype.getTimezoneOffset = function () { return -off; }; // JS: minutes WEST
        disguise(Date.prototype.getTimezoneOffset, 'getTimezoneOffset');

        // Date.prototype.toString / toUTCString carry the HOST zone mark
        // ("GMT+0300 (Moscow Standard Time)") — rewrite both the offset and
        // the zone name to the claimed identity.
        var claimedGmt = (function () {
          var sign = off >= 0 ? '+' : '-';
          var a = Math.abs(off);
          var hh = ('0' + Math.floor(a / 60)).slice(-2);
          var mm = ('0' + (a % 60)).slice(-2);
          return 'GMT' + sign + hh + mm;
        })();
        var origDTS = Date.prototype.toString;
        Date.prototype.toString = function () {
          return origDTS.call(this)
            .replace(/GMT[+-]\d{4}/, claimedGmt)
            .replace(/\s*\([^)]*\)\s*$/, ' (' + TZ_NAME + ')');
        };
        disguise(Date.prototype.toString, 'toString');

        // Intl.DateTimeFormat: patch the CONSTRUCTOR so format()/formatToParts()/
        // resolvedOptions() all evaluate in the CLAIMED zone (patching only
        // resolvedOptions leaks: format() still used the host zone).
        var OrigDTF = Intl.DateTimeFormat;
        var patchedDTF = function (locales, options) {
          var opts = (options && typeof options === 'object') ? Object.assign({}, options) : {};
          if (!opts.timeZone) opts.timeZone = TZ_NAME;
          var loc = (locales === undefined && LOCALE) ? LOCALE : locales;
          // new OrigDTF(undefined, opts) === new OrigDTF(opts) per spec.
          return new (Function.prototype.bind.apply(OrigDTF, [null, loc, opts]))();
        };
        patchedDTF.prototype = OrigDTF.prototype;
        try {
          Object.defineProperty(patchedDTF, 'name', { value: 'DateTimeFormat', configurable: true });
          Object.defineProperty(patchedDTF, 'length', { value: OrigDTF.length, configurable: true });
          patchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf;
        } catch (e) {}
        disguise(patchedDTF, 'DateTimeFormat');
        Intl.DateTimeFormat = patchedDTF;

        // resolvedOptions stays patched as defense in depth (direct
        // prototype calls with a foreign this still report the claim).
        var origRO = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function () {
          var o = origRO.apply(this, arguments);
          try {
            if (!o.timeZone || o.timeZone !== TZ_NAME) {
              Object.defineProperty(o, 'timeZone', {
                value: TZ_NAME, configurable: true, writable: true, enumerable: true
              });
            }
          } catch (e) {}
          return o;
        };
        disguise(Intl.DateTimeFormat.prototype.resolvedOptions, 'resolvedOptions');
      }
    } catch (e) {}
  }

  // ---- Locale in Intl resolved options (NumberFormat/Collator too) ----
  if (LOCALE) {
    ['DateTimeFormat', 'NumberFormat', 'Collator'].forEach(function (cls) {
      try {
        var C = Intl[cls];
        if (!C || !C.prototype || typeof C.prototype.resolvedOptions !== 'function') return;
        var origRO = C.prototype.resolvedOptions;
        C.prototype.resolvedOptions = function () {
          var o = origRO.apply(this, arguments);
          try {
            Object.defineProperty(o, 'locale', {
              value: LOCALE, configurable: true, writable: true, enumerable: true
            });
          } catch (e) {}
          return o;
        };
        disguise(C.prototype.resolvedOptions, 'resolvedOptions');
      } catch (e) {}
    });
  }
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_contains_seed_and_optional_overrides() {
        let s = script(42, Some("Europe/Amsterdam"), Some("en-US"));
        assert!(s.contains("__hdPrivacyNoise"));
        assert!(s.contains("var SEED = 42;"));
        assert!(s.contains("Europe/Amsterdam"));
        assert!(s.contains("en-US"));
        assert!(s.contains("37445")); // WebGL vendor param patched
        assert!(s.contains("getTimezoneOffset"));
        // Deep-spoofing mitigations (r10): global toString hook + Intl/Date
        // consistency surfaces.
        assert!(s.contains("NAMES = new WeakMap()"));
        assert!(s.contains("Intl.DateTimeFormat = patchedDTF"));
        assert!(s.contains("claimedGmt"));
        assert!(s.contains("'NumberFormat', 'Collator'"));
    }

    #[test]
    fn script_without_overrides_skips_them() {
        let s = script(7, None, None);
        assert!(s.contains("var SEED = 7;"));
        assert!(s.contains("var TZ_NAME = null;"));
        assert!(s.contains("var LOCALE = null;"));
    }

    #[test]
    fn timezone_strings_are_json_escaped() {
        let s = script(1, Some("Europe/\"Weird\""), None);
        assert!(s.contains("\"Europe/\\\"Weird\\\"\""));
    }
}
