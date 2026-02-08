// Canvas-based skeleton overlay (ports PoseDepthOverlay from ContentView.swift)
class SkeletonRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Same MediaPipe connections as ContentView.swift
    this.connections = [
      [0,1],[1,2],[2,3],[3,7],
      [0,4],[4,5],[5,6],[6,8],
      [9,10],
      [11,12],
      [11,13],[13,15],
      [15,17],[17,19],[19,15],[15,21],
      [12,14],[14,16],
      [16,18],[18,20],[20,16],[16,22],
      [11,23],[12,24],[23,24],
      [23,25],[24,26],
      [25,27],[26,28],
      [27,29],[29,31],
      [28,30],[30,32],
      [27,31],[28,32]
    ];
  }

  render(bodyParts, frameWidth, frameHeight) {
    const { canvas, ctx } = this;
    canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
    canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!bodyParts || bodyParts.length === 0) return;

    const partsById = new Map();
    bodyParts.forEach(bp => partsById.set(bp.landmark_id, bp));

    // Draw connections
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
    ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
    ctx.beginPath();
    for (const [s, e] of this.connections) {
      const sp = this._mapToView(partsById.get(s), frameWidth, frameHeight);
      const ep = this._mapToView(partsById.get(e), frameWidth, frameHeight);
      if (!sp || !ep) continue;
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(ep.x, ep.y);
    }
    ctx.stroke();

    // Draw joints
    const r = 3.5 * (window.devicePixelRatio || 1);
    ctx.fillStyle = 'yellow';
    for (const bp of bodyParts) {
      const p = this._mapToView(bp, frameWidth, frameHeight);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw depth labels
    const fontSize = 9 * (window.devicePixelRatio || 1);
    ctx.font = fontSize + 'px monospace';
    for (const bp of bodyParts) {
      const p = this._mapToView(bp, frameWidth, frameHeight);
      if (!p) continue;
      const label = this._depthLabel(bp);
      const m = ctx.measureText(label);
      const lx = Math.min(Math.max(p.x + 30, 40), canvas.width - m.width - 10);
      const ly = Math.min(Math.max(p.y - 8, fontSize + 2), canvas.height - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(lx - 2, ly - fontSize, m.width + 6, fontSize + 4);
      ctx.fillStyle = '#000';
      ctx.fillText(label, lx + 1, ly);
    }
  }

  _mapToView(bp, fw, fh) {
    if (!bp || fw <= 1 || fh <= 1) return null;
    const cw = this.canvas.width, ch = this.canvas.height;
    const scale = Math.max(cw / fw, ch / fh);
    const ox = (cw - fw * scale) * 0.5;
    const oy = (ch - fh * scale) * 0.5;
    return { x: bp.x * scale + ox, y: bp.y * scale + oy };
  }

  _depthLabel(bp) {
    const dist = bp.distance_cm >= 0 ? bp.distance_cm.toFixed(0) + 'cm' : '--cm';
    return bp.name + ' z:' + bp.depth.toFixed(2) + ' ' + dist;
  }
}
