import AVFoundation
import UIKit
import WebKit

final class HybridCaptureManager: NSObject, ObservableObject {

    @Published private(set) var isRunning = false
    var exercise = "standing_knee_flexion"
    weak var webView: WKWebView?

    // MARK: - Capture state

    private let captureSession = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.gatormotion.capture.session")
    private let outputQueue = DispatchQueue(label: "com.gatormotion.capture.outputs")

    private let videoOutput = AVCaptureVideoDataOutput()
    private let depthOutput = AVCaptureDepthDataOutput()
    private var synchronizer: AVCaptureDataOutputSynchronizer?

    private var isConfigured = false
    private(set) var depthMode = "none"
    private(set) var isUsingLiDAR = false

    // MARK: - Frame pipeline

    private var nextFrameId = 0
    private var isFrameInFlight = false
    private var storedDepthBuffers: [Int: AVDepthData] = [:]
    private let depthBufferLock = NSLock()
    private let maxStoredDepth = 4
    private let jpegQuality: CGFloat = 0.7
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    // MARK: - WebSocket (for phoneServer broadcast)

    let socket: WebSocketClient

    override init() {
        self.socket = WebSocketClient(mode: .phoneServer, host: "0.0.0.0", port: 8765, path: "/skeleton")
        super.init()
    }

    // MARK: - Public

    func start() {
        sessionQueue.async { [weak self] in
            guard let self, !self.isRunning else { return }
            if !self.isConfigured {
                guard self.configureCapturePipeline() else { return }
                self.isConfigured = true
            }
            self.captureSession.startRunning()
            DispatchQueue.main.async { self.isRunning = true }
            self.socket.start()
            self.sendConfig()
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self, self.isRunning else { return }
            self.captureSession.stopRunning()
            self.socket.stop()
            self.depthBufferLock.lock()
            self.storedDepthBuffers.removeAll()
            self.depthBufferLock.unlock()
            DispatchQueue.main.async { self.isRunning = false }
        }
    }

    func broadcastPacket(json: String) {
        guard let data = json.data(using: .utf8) else { return }
        socket.broadcastRaw(data: data)
    }

    // MARK: - Depth sampling (called from NativeBridge)

    func sampleDepthForLandmarks(frameId: Int, landmarks: [[String: Any]]) {
        outputQueue.async { [weak self] in
            guard let self else { return }

            self.depthBufferLock.lock()
            let depthData = self.storedDepthBuffers[frameId]
            self.depthBufferLock.unlock()

            var results: [[String: Any]] = []

            if let depthData {
                let depthMap = depthData.depthDataMap
                CVPixelBufferLockBaseAddress(depthMap, .readOnly)
                defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

                for lm in landmarks {
                    guard let index = lm["index"] as? Int,
                          let x = lm["x"] as? Double,
                          let y = lm["y"] as? Double
                    else { continue }

                    let depth = self.sampleDepthMeters(
                        lockedDepthMap: depthMap,
                        normalizedX: CGFloat(x),
                        normalizedY: CGFloat(y)
                    )
                    if let depth {
                        results.append(["landmarkIndex": index, "depthMeters": depth])
                    } else {
                        results.append(["landmarkIndex": index, "depthMeters": NSNull()])
                    }
                }
            }

            // Clean up old depth buffers
            self.depthBufferLock.lock()
            self.storedDepthBuffers.removeValue(forKey: frameId)
            self.depthBufferLock.unlock()

            self.sendDepthResponse(frameId: frameId, depths: results)
            self.isFrameInFlight = false
        }
    }

    // MARK: - Camera setup (reused from ARBodyTrackingView)

    private func configureCapturePipeline() -> Bool {
        guard requestCameraPermission() else {
            sendStatus("Camera permission denied")
            return false
        }

        guard let device = selectDepthCapableRearDevice() else {
            sendStatus("No depth-enabled rear camera")
            return false
        }

        if #available(iOS 15.4, *) {
            isUsingLiDAR = device.deviceType == .builtInLiDARDepthCamera
        }
        depthMode = isUsingLiDAR ? "lidar_augmented_depth" : "stereo_depth"

        do {
            let input = try AVCaptureDeviceInput(device: device)
            captureSession.beginConfiguration()
            captureSession.sessionPreset = .vga640x480

            guard captureSession.canAddInput(input) else {
                captureSession.commitConfiguration()
                return false
            }
            captureSession.addInput(input)

            configureDepthFormats(device: device)

            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
            ]
            guard captureSession.canAddOutput(videoOutput) else {
                captureSession.commitConfiguration()
                return false
            }
            captureSession.addOutput(videoOutput)

            depthOutput.isFilteringEnabled = true
            depthOutput.alwaysDiscardsLateDepthData = true
            guard captureSession.canAddOutput(depthOutput) else {
                captureSession.commitConfiguration()
                return false
            }
            captureSession.addOutput(depthOutput)

            if let conn = videoOutput.connection(with: .video) {
                if conn.isVideoOrientationSupported { conn.videoOrientation = .portrait }
            }
            if let conn = depthOutput.connection(with: .depthData), conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
            }

            synchronizer = AVCaptureDataOutputSynchronizer(dataOutputs: [videoOutput, depthOutput])
            synchronizer?.setDelegate(self, queue: outputQueue)

            captureSession.commitConfiguration()
        } catch {
            captureSession.commitConfiguration()
            sendStatus("Capture setup failed: \(error.localizedDescription)")
            return false
        }

        sendStatus("Tracking... (\(depthMode))")
        return true
    }

    private func requestCameraPermission() -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined:
            let sem = DispatchSemaphore(value: 0)
            var granted = false
            AVCaptureDevice.requestAccess(for: .video) { allow in granted = allow; sem.signal() }
            sem.wait()
            return granted
        default: return false
        }
    }

    private func selectDepthCapableRearDevice() -> AVCaptureDevice? {
        var types: [AVCaptureDevice.DeviceType] = []
        if #available(iOS 15.4, *) { types.append(.builtInLiDARDepthCamera) }
        types.append(contentsOf: [.builtInDualWideCamera, .builtInDualCamera, .builtInTripleCamera])
        for type in types {
            let session = AVCaptureDevice.DiscoverySession(deviceTypes: [type], mediaType: .video, position: .back)
            if let device = session.devices.first { return device }
        }
        return nil
    }

    private func configureDepthFormats(device: AVCaptureDevice) {
        var bestVideo: AVCaptureDevice.Format?
        var bestDepth: AVCaptureDevice.Format?
        var bestPixels = 0
        for vf in device.formats {
            for df in vf.supportedDepthDataFormats {
                let mt = CMFormatDescriptionGetMediaSubType(df.formatDescription)
                guard mt == kCVPixelFormatType_DepthFloat32 || mt == kCVPixelFormatType_DisparityFloat32 else { continue }
                let dims = CMVideoFormatDescriptionGetDimensions(df.formatDescription)
                let px = Int(dims.width) * Int(dims.height)
                if px > bestPixels { bestPixels = px; bestVideo = vf; bestDepth = df }
            }
        }
        guard let bv = bestVideo, let bd = bestDepth else { return }
        do {
            try device.lockForConfiguration()
            device.activeFormat = bv
            device.activeDepthDataFormat = bd
            device.unlockForConfiguration()
        } catch {}
    }

    // MARK: - Depth sampling (5x5 median patch, identical to ARBodyTrackingView)

    private func sampleDepthMeters(
        lockedDepthMap: CVPixelBuffer,
        normalizedX: CGFloat,
        normalizedY: CGFloat
    ) -> Float? {
        let w = CVPixelBufferGetWidth(lockedDepthMap)
        let h = CVPixelBufferGetHeight(lockedDepthMap)
        guard w > 0, h > 0, let base = CVPixelBufferGetBaseAddress(lockedDepthMap) else { return nil }

        let bpr = CVPixelBufferGetBytesPerRow(lockedDepthMap)
        let cx = min(max(Int(round(min(max(normalizedX, 0), 1) * CGFloat(w - 1))), 0), w - 1)
        let cy = min(max(Int(round(min(max(normalizedY, 0), 1) * CGFloat(h - 1))), 0), h - 1)
        let r = 2
        let minX = max(cx - r, 0), maxX = min(cx + r, w - 1)
        let minY = max(cy - r, 0), maxY = min(cy + r, h - 1)

        var samples: [Float] = []
        samples.reserveCapacity((maxX - minX + 1) * (maxY - minY + 1))
        for row in minY...maxY {
            let ptr = base.advanced(by: row * bpr).assumingMemoryBound(to: Float32.self)
            for col in minX...maxX {
                let v = ptr[col]
                if v.isFinite, v > 0 { samples.append(v) }
            }
        }
        guard !samples.isEmpty else { return nil }
        samples.sort()
        return samples[samples.count / 2]
    }

    // MARK: - WebView JS calls

    private func sendConfig() {
        let config: [String: Any] = [
            "depthMode": depthMode,
            "isUsingLiDAR": isUsingLiDAR,
            "exercise": exercise,
            "streamMode": "phoneServer",
            "host": "0.0.0.0",
            "port": 8765,
            "path": "/skeleton",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: config),
              let json = String(data: data, encoding: .utf8) else { return }
        callJS("window.onNativeConfig(\(json))")
    }

    private func sendStatus(_ message: String) {
        let escaped = message.replacingOccurrences(of: "'", with: "\\'")
        callJS("window.onNativeStatus && window.onNativeStatus('\(escaped)')")
    }

    private func sendDepthResponse(frameId: Int, depths: [[String: Any]]) {
        guard let data = try? JSONSerialization.data(withJSONObject: depths),
              let json = String(data: data, encoding: .utf8) else { return }
        callJS("window.onDepthResponse(\(frameId), \(json))")
    }

    private func callJS(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    // MARK: - Depth buffer storage

    private func storeDepthBuffer(frameId: Int, data: AVDepthData) {
        depthBufferLock.lock()
        storedDepthBuffers[frameId] = data
        if storedDepthBuffers.count > maxStoredDepth, let oldest = storedDepthBuffers.keys.min() {
            storedDepthBuffers.removeValue(forKey: oldest)
        }
        depthBufferLock.unlock()
    }
}

// MARK: - AVCaptureDataOutputSynchronizerDelegate

extension HybridCaptureManager: AVCaptureDataOutputSynchronizerDelegate {
    func dataOutputSynchronizer(
        _ synchronizer: AVCaptureDataOutputSynchronizer,
        didOutput collection: AVCaptureSynchronizedDataCollection
    ) {
        guard isRunning, !isFrameInFlight else { return }

        guard let videoData = collection.synchronizedData(for: videoOutput)
                as? AVCaptureSynchronizedSampleBufferData,
              !videoData.sampleBufferWasDropped,
              let depthData = collection.synchronizedData(for: depthOutput)
                as? AVCaptureSynchronizedDepthData,
              !depthData.depthDataWasDropped
        else { return }

        guard let imageBuffer = CMSampleBufferGetImageBuffer(videoData.sampleBuffer) else { return }
        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)

        // JPEG encode
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else { return }
        guard let jpegData = UIImage(cgImage: cgImage).jpegData(compressionQuality: jpegQuality) else { return }
        let base64 = jpegData.base64EncodedString()

        let frameId = nextFrameId
        nextFrameId += 1
        isFrameInFlight = true

        let depth = depthData.depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        storeDepthBuffer(frameId: frameId, data: depth)

        callJS("window.onNativeFrame(\(frameId), '\(base64)', \(width), \(height))")
    }
}
