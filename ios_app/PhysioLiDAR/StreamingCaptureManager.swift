import AVFoundation
import UIKit

final class StreamingCaptureManager: NSObject, ObservableObject {

    // MARK: - Published state

    @Published var serverURL = "wss://gatormotion.com/ws/lidar/skeleton"
    @Published private(set) var isStreaming = false
    @Published private(set) var statusText = "Ready"
    @Published private(set) var frameCount = 0

    // MARK: - Capture

    private let captureSession = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.gatormotion.session")
    private let outputQueue = DispatchQueue(label: "com.gatormotion.output")

    private let videoOutput = AVCaptureVideoDataOutput()
    private let depthOutput = AVCaptureDepthDataOutput()
    private var synchronizer: AVCaptureDataOutputSynchronizer?

    private var isConfigured = false
    private var depthMode = "none"
    private var isUsingLiDAR = false
    private var exercise = "standing_knee_flexion"

    // MARK: - Frame pipeline

    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let jpegQuality: CGFloat = 0.6
    private var isBusy = false
    private let depthGridCols = 40
    private let depthGridRows = 30

    // MARK: - WebSocket

    private var urlSession: URLSession?
    private var wsTask: URLSessionWebSocketTask?

    // MARK: - Public

    func start() {
        sessionQueue.async { [weak self] in
            guard let self, !self.isStreaming else { return }

            if !self.isConfigured {
                guard self.configurePipeline() else { return }
                self.isConfigured = true
            }

            self.connectWebSocket()
            self.captureSession.startRunning()
            DispatchQueue.main.async {
                self.isStreaming = true
                self.statusText = "Streaming (\(self.depthMode))"
            }
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self, self.isStreaming else { return }
            self.captureSession.stopRunning()
            self.wsTask?.cancel(with: .normalClosure, reason: nil)
            self.wsTask = nil
            self.urlSession = nil
            DispatchQueue.main.async {
                self.isStreaming = false
                self.statusText = "Stopped"
            }
        }
    }

    // MARK: - WebSocket

    private func connectWebSocket() {
        let urlString = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: urlString) else {
            DispatchQueue.main.async { self.statusText = "Invalid URL" }
            return
        }

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: url)
        self.urlSession = session
        self.wsTask = task
        task.resume()

        receiveLoop()
        print("[Stream] WebSocket connecting to \(url)")
    }

    private func receiveLoop() {
        wsTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                self.receiveLoop()
            case .failure(let error):
                print("[Stream] WS receive error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.statusText = "Disconnected, reconnecting..."
                }
                DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) { [weak self] in
                    guard let self, self.isStreaming else { return }
                    self.connectWebSocket()
                }
            }
        }
    }

    private func sendJSON(_ json: String) {
        guard let task = wsTask, task.state == .running else { return }
        task.send(.string(json)) { error in
            if let error {
                print("[Stream] WS send error: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Camera setup

    private func configurePipeline() -> Bool {
        guard requestCameraPermission() else {
            DispatchQueue.main.async { self.statusText = "Camera permission denied" }
            return false
        }

        guard let device = selectDepthDevice() else {
            DispatchQueue.main.async { self.statusText = "No depth camera found" }
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

            guard captureSession.canAddInput(input) else { captureSession.commitConfiguration(); return false }
            captureSession.addInput(input)

            configureDepthFormats(device: device)

            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)]
            guard captureSession.canAddOutput(videoOutput) else { captureSession.commitConfiguration(); return false }
            captureSession.addOutput(videoOutput)

            depthOutput.isFilteringEnabled = true
            depthOutput.alwaysDiscardsLateDepthData = true
            guard captureSession.canAddOutput(depthOutput) else { captureSession.commitConfiguration(); return false }
            captureSession.addOutput(depthOutput)

            if let conn = videoOutput.connection(with: .video), conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
            }
            if let conn = depthOutput.connection(with: .depthData), conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
            }

            synchronizer = AVCaptureDataOutputSynchronizer(dataOutputs: [videoOutput, depthOutput])
            synchronizer?.setDelegate(self, queue: outputQueue)

            captureSession.commitConfiguration()
        } catch {
            captureSession.commitConfiguration()
            DispatchQueue.main.async { self.statusText = "Camera setup failed" }
            return false
        }

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

    private func selectDepthDevice() -> AVCaptureDevice? {
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

    // MARK: - Depth grid sampling

    private func sampleDepthGrid(depthMap: CVPixelBuffer) -> [Float] {
        let w = CVPixelBufferGetWidth(depthMap)
        let h = CVPixelBufferGetHeight(depthMap)
        guard w > 0, h > 0 else { return [] }

        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return [] }
        let bpr = CVPixelBufferGetBytesPerRow(depthMap)

        var grid = [Float](repeating: -1, count: depthGridCols * depthGridRows)
        for row in 0..<depthGridRows {
            let sy = Int(Float(row) / Float(depthGridRows) * Float(h - 1))
            let ptr = base.advanced(by: sy * bpr).assumingMemoryBound(to: Float32.self)
            for col in 0..<depthGridCols {
                let sx = Int(Float(col) / Float(depthGridCols) * Float(w - 1))
                let v = ptr[sx]
                grid[row * depthGridCols + col] = v.isFinite && v > 0 ? v : -1
            }
        }
        return grid
    }
}

// MARK: - AVCaptureDataOutputSynchronizerDelegate

extension StreamingCaptureManager: AVCaptureDataOutputSynchronizerDelegate {
    func dataOutputSynchronizer(
        _ synchronizer: AVCaptureDataOutputSynchronizer,
        didOutput collection: AVCaptureSynchronizedDataCollection
    ) {
        guard isStreaming, !isBusy else { return }

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

        isBusy = true

        // JPEG encode
        let ciImage = CIImage(cvPixelBuffer: imageBuffer)
        guard let cgImage = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
            isBusy = false; return
        }
        guard let jpegData = UIImage(cgImage: cgImage).jpegData(compressionQuality: jpegQuality) else {
            isBusy = false; return
        }
        let base64 = jpegData.base64EncodedString()

        // Depth grid
        let converted = depthData.depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let depthGrid = sampleDepthGrid(depthMap: converted.depthDataMap)
        let depthW = CVPixelBufferGetWidth(converted.depthDataMap)
        let depthH = CVPixelBufferGetHeight(converted.depthDataMap)

        // Build JSON payload
        let payload: [String: Any] = [
            "device": isUsingLiDAR ? "ios_lidar" : "ios_stereo",
            "timestamp": Date().timeIntervalSince1970,
            "exercise": exercise,
            "depth_mode": depthMode,
            "camera_width": width,
            "camera_height": height,
            "video_frame_base64": base64,
            "video_width": width,
            "video_height": height,
            "depth_grid": depthGrid,
            "depth_grid_cols": depthGridCols,
            "depth_grid_rows": depthGridRows,
            "depth_map_width": depthW,
            "depth_map_height": depthH,
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: jsonData, encoding: .utf8) else {
            isBusy = false; return
        }

        sendJSON(json)

        DispatchQueue.main.async { self.frameCount += 1 }
        isBusy = false
    }
}
