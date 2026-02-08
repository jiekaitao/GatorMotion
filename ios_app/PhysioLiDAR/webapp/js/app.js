// Main entry point — wires everything together
(async function main() {
  const videoCanvas = document.getElementById('videoCanvas');
  const skeletonCanvas = document.getElementById('skeletonCanvas');
  const toggleBtn = document.getElementById('toggleBtn');
  const statusBar = document.getElementById('statusBar');

  const mediapipe = new MediaPipeRunner();
  const renderer = new SkeletonRenderer(skeletonCanvas);
  let transport = null;
  let pipeline = null;
  let isRunning = false;

  // Initialize MediaPipe WASM
  try {
    await mediapipe.init();
    statusBar.textContent = 'Ready';
  } catch (e) {
    statusBar.textContent = 'MediaPipe failed to load';
    NativeBridge.log('error', 'MediaPipe init failed: ' + e.message);
    return;
  }

  // Set up native bridge — receives frames from HybridCaptureManager
  NativeBridge.init((frameId, base64Jpeg, width, height) => {
    if (pipeline && isRunning) {
      pipeline.processFrame(frameId, base64Jpeg, width, height);
    }
  });

  toggleBtn.addEventListener('click', () => {
    if (isRunning) {
      // Stop
      NativeBridge.sendControl('stop');
      if (transport) transport.stop();
      isRunning = false;
      toggleBtn.textContent = 'Start Tracking';
      toggleBtn.classList.remove('running');
      statusBar.textContent = 'Stopped';
    } else {
      // Start
      const config = NativeBridge.config || {};
      transport = new WebSocketTransport(config);
      transport.start();
      pipeline = new FramePipeline(mediapipe, renderer, transport, videoCanvas);
      NativeBridge.sendControl('start');
      isRunning = true;
      toggleBtn.textContent = 'Stop Tracking';
      toggleBtn.classList.add('running');
      statusBar.textContent = 'Tracking...';
    }
  });
})();
