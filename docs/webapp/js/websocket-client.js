// WebSocket transport — supports both phoneServer (via native broadcast) and pythonServer (direct)
class WebSocketTransport {
  constructor(config) {
    this.config = config || {};
    this.socket = null;
  }

  start() {
    const mode = this.config.streamMode || 'phoneServer';

    if (mode === 'pythonServer') {
      const host = this.config.host || '192.168.1.100';
      const port = this.config.port || 8765;
      const path = this.config.path || '/skeleton';
      const url = 'ws://' + host + ':' + port + path;

      NativeBridge.log('info', 'WS connecting to ' + url);
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        NativeBridge.log('info', 'WS connected to Python backend');
      };

      this.socket.onerror = (e) => {
        NativeBridge.log('error', 'WS error');
      };

      this.socket.onclose = () => {
        NativeBridge.log('info', 'WS closed, reconnecting in 1s...');
        setTimeout(() => this.start(), 1000);
      };
    }
    // phoneServer mode: native handles broadcast, nothing to connect here
  }

  send(packet) {
    const json = JSON.stringify(packet);
    const mode = this.config.streamMode || 'phoneServer';

    if (mode === 'pythonServer' && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(json);
    } else {
      // Forward to native for NWListener broadcast
      NativeBridge.sendSkeletonPacket(json);
    }
  }

  stop() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
