import WebKit

final class NativeBridge: NSObject, WKScriptMessageHandler {

    weak var captureManager: HybridCaptureManager?

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        switch message.name {
        case "depthRequest":
            handleDepthRequest(message.body)
        case "control":
            handleControl(message.body)
        case "skeletonPacket":
            handleSkeletonPacket(message.body)
        case "log":
            handleLog(message.body)
        default:
            break
        }
    }

    // MARK: - Handlers

    private func handleDepthRequest(_ body: Any) {
        guard let dict = body as? [String: Any],
              let frameId = dict["frameId"] as? Int,
              let landmarks = dict["landmarks"] as? [[String: Any]]
        else { return }
        captureManager?.sampleDepthForLandmarks(frameId: frameId, landmarks: landmarks)
    }

    private func handleControl(_ body: Any) {
        guard let dict = body as? [String: Any],
              let action = dict["action"] as? String
        else { return }

        switch action {
        case "start":
            captureManager?.start()
        case "stop":
            captureManager?.stop()
        case "setExercise":
            if let value = dict["value"] as? String {
                captureManager?.exercise = value
            }
        default:
            break
        }
    }

    private func handleSkeletonPacket(_ body: Any) {
        guard let json = body as? String else { return }
        captureManager?.broadcastPacket(json: json)
    }

    private func handleLog(_ body: Any) {
        guard let dict = body as? [String: Any],
              let level = dict["level"] as? String,
              let msg = dict["message"] as? String
        else { return }
        print("[WebApp \(level)] \(msg)")
    }
}
