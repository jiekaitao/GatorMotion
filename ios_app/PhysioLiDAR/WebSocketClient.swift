import Foundation
import Network

struct SkeletonPacket: Codable {
    let device: String
    let timestamp: Double
    let exercise: String
    let depthMode: String
    let joints: [String: [Float]]
    let allJoints: [String: [Float]]?
    let keypoints2D: [String: [Float]]?
    let pointDepthsM: [String: Float]?
    let cameraPosition: [Float]?
    let cameraIntrinsics: [Float]?
    let cameraWidth: Int?
    let cameraHeight: Int?
    let armHeadDistanceM: Float?
    let armHeadState: String?
    let armHeadQuality: Float?
    let armHeadSource: String?
    let videoFrameBase64: String?
    let videoWidth: Int?
    let videoHeight: Int?

    enum CodingKeys: String, CodingKey {
        case device
        case timestamp
        case exercise
        case depthMode = "depth_mode"
        case joints
        case allJoints = "all_joints"
        case keypoints2D = "keypoints_2d"
        case pointDepthsM = "point_depths_m"
        case cameraPosition = "camera_position"
        case cameraIntrinsics = "camera_intrinsics"
        case cameraWidth = "camera_width"
        case cameraHeight = "camera_height"
        case armHeadDistanceM = "arm_head_distance_m"
        case armHeadState = "arm_head_state"
        case armHeadQuality = "arm_head_quality"
        case armHeadSource = "arm_head_source"
        case videoFrameBase64 = "video_frame_base64"
        case videoWidth = "video_width"
        case videoHeight = "video_height"
    }
}

final class WebSocketClient: ObservableObject {
    enum Mode {
        case phoneServer
        case pythonServer
    }

    @Published private(set) var statusText: String = "Not connected"

    private let mode: Mode
    private let host: String
    private let port: UInt16
    private let path: String

    private let queue = DispatchQueue(label: "physio.websocket.queue")
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]

    private var urlSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?

    init(mode: Mode, host: String, port: UInt16, path: String) {
        self.mode = mode
        self.host = host
        self.port = port
        self.path = path
    }

    func start() {
        switch mode {
        case .phoneServer:
            startServer()
        case .pythonServer:
            startClient()
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil

        for (_, connection) in connections {
            connection.cancel()
        }
        connections.removeAll()

        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        urlSession = nil

        DispatchQueue.main.async {
            self.statusText = "Not connected"
        }
    }

    func send(packet: SkeletonPacket) {
        guard let data = try? JSONEncoder().encode(packet),
              let jsonString = String(data: data, encoding: .utf8)
        else {
            return
        }

        switch mode {
        case .phoneServer:
            broadcast(jsonString: jsonString)
        case .pythonServer:
            sendToPython(jsonString: jsonString)
        }
    }

    private func startServer() {
        if listener != nil {
            return
        }

        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true

        let parameters = NWParameters(tls: nil)
        parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            DispatchQueue.main.async {
                self.statusText = "Not connected"
            }
            return
        }

        do {
            let listener = try NWListener(using: parameters, on: nwPort)
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                if case .failed(let error) = state {
                    print("WebSocket listener failed: \(error.localizedDescription)")
                    DispatchQueue.main.async {
                        self.statusText = "Not connected"
                    }
                }
            }

            listener.newConnectionHandler = { [weak self] connection in
                self?.setup(connection: connection)
            }

            self.listener = listener
            listener.start(queue: queue)

            DispatchQueue.main.async {
                self.statusText = "Tracking..."
            }
        } catch {
            print("Could not start WebSocket listener: \(error.localizedDescription)")
            DispatchQueue.main.async {
                self.statusText = "Not connected"
            }
        }
    }

    private func setup(connection: NWConnection) {
        let id = UUID()
        connections[id] = connection

        connection.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                DispatchQueue.main.async {
                    self.statusText = "Tracking..."
                }
                self.receiveLoop(connection: connection, id: id)
            case .failed(let error):
                print("Connection failed: \(error.localizedDescription)")
                self.connections[id] = nil
                self.refreshServerStatus()
            case .cancelled:
                self.connections[id] = nil
                self.refreshServerStatus()
            default:
                break
            }
        }

        connection.start(queue: queue)
    }

    private func receiveLoop(connection: NWConnection, id: UUID) {
        connection.receiveMessage { [weak self] _, _, _, error in
            guard let self = self else { return }
            if error != nil {
                self.connections[id] = nil
                self.refreshServerStatus()
                return
            }

            self.receiveLoop(connection: connection, id: id)
        }
    }

    private func refreshServerStatus() {
        DispatchQueue.main.async {
            self.statusText = self.listener == nil ? "Not connected" : "Tracking..."
        }
    }

    private func broadcast(jsonString: String) {
        guard !connections.isEmpty,
              let data = jsonString.data(using: .utf8)
        else {
            return
        }

        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "skeleton", metadata: [metadata])

        for (_, connection) in connections {
            connection.send(
                content: data,
                contentContext: context,
                isComplete: true,
                completion: .idempotent
            )
        }
    }

    private func startClient() {
        if webSocketTask != nil {
            return
        }

        guard let url = buildClientWebSocketURL() else {
            DispatchQueue.main.async {
                self.statusText = "Not connected"
            }
            return
        }

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: url)
        self.urlSession = session
        self.webSocketTask = task
        task.resume()

        DispatchQueue.main.async {
            self.statusText = "Tracking..."
        }

        clientReceiveLoop()
    }

    private func buildClientWebSocketURL() -> URL? {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        let rawHost = host.trimmingCharacters(in: .whitespacesAndNewlines)

        if let parsed = URLComponents(string: rawHost), parsed.scheme != nil {
            var components = parsed
            let sourceScheme = (components.scheme ?? "").lowercased()
            switch sourceScheme {
            case "http", "ws":
                components.scheme = "ws"
            case "https", "wss":
                components.scheme = "wss"
            default:
                components.scheme = "ws"
            }
            if components.port == nil {
                components.port = Int(port)
            }
            if components.path.isEmpty || components.path == "/" {
                components.path = normalizedPath
            }
            return components.url
        }

        var hostPart = rawHost
        var pathPart = normalizedPath
        if let slash = hostPart.firstIndex(of: "/") {
            let suffix = hostPart[slash...]
            pathPart = suffix.hasPrefix("/") ? String(suffix) : "/\(suffix)"
            hostPart = String(hostPart[..<slash])
        }

        var components = URLComponents()
        components.scheme = "ws"
        components.host = hostPart
        components.port = Int(port)
        components.path = pathPart
        return components.url
    }

    private func clientReceiveLoop() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success:
                self.clientReceiveLoop()
            case .failure(let error):
                print("WebSocket receive error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.statusText = "Not connected"
                }
            }
        }
    }

    private func sendToPython(jsonString: String) {
        webSocketTask?.send(.string(jsonString)) { [weak self] error in
            if let error {
                print("WebSocket send error: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self?.statusText = "Not connected"
                }
            }
        }
    }
}
