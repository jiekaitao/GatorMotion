// Native <-> JS bridge abstraction
const NativeBridge = {
  _pendingDepthCallbacks: new Map(),
  _onFrame: null,
  config: null,

  init(onFrameCallback) {
    this._onFrame = onFrameCallback;

    window.onNativeFrame = (frameId, base64Jpeg, width, height) => {
      if (this._onFrame) {
        this._onFrame(frameId, base64Jpeg, width, height);
      }
    };

    window.onDepthResponse = (frameId, depths) => {
      const cb = this._pendingDepthCallbacks.get(frameId);
      if (cb) {
        this._pendingDepthCallbacks.delete(frameId);
        cb(depths);
      }
    };

    window.onNativeConfig = (cfg) => {
      NativeBridge.config = cfg;
      this.log('info', 'Config received: ' + JSON.stringify(cfg));
    };

    window.onNativeStatus = (message) => {
      const el = document.getElementById('statusBar');
      if (el) el.textContent = message;
    };
  },

  requestDepth(frameId, landmarks) {
    return new Promise((resolve) => {
      this._pendingDepthCallbacks.set(frameId, resolve);
      window.webkit.messageHandlers.depthRequest.postMessage({ frameId, landmarks });
      // Timeout to prevent stalls
      setTimeout(() => {
        if (this._pendingDepthCallbacks.has(frameId)) {
          this._pendingDepthCallbacks.delete(frameId);
          resolve([]);
        }
      }, 150);
    });
  },

  sendControl(action, value) {
    window.webkit.messageHandlers.control.postMessage({ action, value });
  },

  sendSkeletonPacket(json) {
    window.webkit.messageHandlers.skeletonPacket.postMessage(json);
  },

  log(level, message) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.log) {
      window.webkit.messageHandlers.log.postMessage({ level, message });
    }
    console.log('[' + level + '] ' + message);
  }
};
