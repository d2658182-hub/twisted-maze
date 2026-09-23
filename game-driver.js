// Neutral offline driver for the game (Cocos Creator build).
// - blocks every outbound telemetry/ads request (XHR + fetch) with a benign reply
// - swallows child -> parent portal messages (no portal to answer)
// - provides window.GameDriver surface + guarded recovery hook
(function () {
    'use strict';

    // same-origin test: relative URLs and same-origin absolutes pass through;
    // only true cross-origin requests (ads/telemetry) get a benign fake reply
    function isExternal(u) {
        if (!/^https?:\/\//i.test(u)) return false;
        try {
            var a = new URL(u, location.href);
            return a.origin !== location.origin;
        } catch (e) { return true; }
    }

    // ---- 1. telemetry / ad-network neutralization ----
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this.__gdUrl = String(url || '');
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
        var u = this.__gdUrl || '';
        if (isExternal(u)) {
            var self = this;
            Object.defineProperty(this, 'readyState', { get: function () { return 4; } });
            Object.defineProperty(this, 'status', { get: function () { return 200; } });
            Object.defineProperty(this, 'responseText', { get: function () { return '{}'; } });
            Object.defineProperty(this, 'response', { get: function () { return '{}'; } });
            setTimeout(function () {
                try { self.onreadystatechange && self.onreadystatechange(); } catch (e) {}
                try { self.onload && self.onload(); } catch (e) {}
            }, 0);
            return;
        }
        return origSend.apply(this, arguments);
    };

    var origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input) {
            var u = typeof input === 'string' ? input : (input && input.url) || '';
            if (isExternal(u)) {
                return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
            return origFetch.apply(this, arguments);
        };
    }

    // ---- 2. portal bridge surface ----
    // main.js defines window.SG whose emitMessage() posts {methon, data} to
    // window.parent. Standalone: swallow those posts so nothing escapes or hangs.
    var listeners = {};
    window.GameDriver = {
        onMessage: function (name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        emit: function (name, data) {
            var arr = listeners[name] || [];
            for (var i = 0; i < arr.length; i++) {
                try { arr[i]({ methon: name, data: data }); } catch (e) {}
            }
        }
    };
    var origPostMessage = window.postMessage.bind(window);
    window.postMessage = function (msg, target, transfer) {
        try {
            if (msg && typeof msg === 'object' && msg.methon) {
                return undefined; // portal protocol message: absorb
            }
        } catch (e) {}
        return origPostMessage(msg, target, transfer);
    };

    // ---- 3. guarded recovery ----
    var lastReload = 0;
    window.addEventListener('error', function () {
        var now = Date.now();
        if (now - lastReload > 30000) lastReload = now; // cooldown bookkeeping, no auto-loop
    });

    console.log('[GameDriver] offline mode active');
})();
