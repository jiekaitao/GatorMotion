import ARKit
import Combine
import CoreImage
import SceneKit
import SwiftUI
import UIKit

final class ARTrackingViewModel: ObservableObject {
    @Published var isRunning: Bool = false
    @Published var statusText: String = "Not connected"
    @Published var exercise: String

    let socket: WebSocketClient

    private var cancellables = Set<AnyCancellable>()

    init(
        streamMode: WebSocketClient.Mode = .phoneServer,
        host: String = "0.0.0.0",
        port: UInt16 = 8765,
        path: String = "/skeleton",
        exercise: String = "standing_knee_flexion"
    ) {
        self.exercise = exercise
        self.socket = WebSocketClient(mode: streamMode, host: host, port: port, path: path)

        socket.$statusText
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                self?.statusText = status
            }
            .store(in: &cancellables)
    }

    func toggle() {
        isRunning ? stop() : start()
    }

    func start() {
        guard !isRunning else { return }
        socket.start()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        socket.stop()
        isRunning = false
    }
}

struct ARBodyTrackingView: UIViewRepresentable {
    @ObservedObject var viewModel: ARTrackingViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeUIView(context: Context) -> ARSCNView {
        let sceneView = ARSCNView(frame: .zero)
        sceneView.automaticallyUpdatesLighting = true
        sceneView.scene = SCNScene()
        sceneView.session.delegate = context.coordinator
        context.coordinator.attach(sceneView: sceneView)
        return sceneView
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        if viewModel.isRunning {
            context.coordinator.startIfNeeded()
        } else {
            context.coordinator.stopIfNeeded()
        }
    }

    final class Coordinator: NSObject, ARSessionDelegate {
        private weak var sceneView: ARSCNView?
        private let viewModel: ARTrackingViewModel
        private var sessionRunning = false
        private var depthMode: String = "none"
        private let ciContext = CIContext()
        private var streamFrameCounter = 0
        // Keep video frequent but avoid saturating socket bandwidth and stalling LiDAR updates.
        private let videoFrameStride = 2
        private let videoMaxWidth: CGFloat = 480
        private let jpegCompression: CGFloat = 0.45
        private let packetMaxFPS: Double = 15.0
        private var lastPacketSentAt: TimeInterval = 0.0
        private var packetCounter = 0
        private let includeAllJointsEveryNPackets = 15
        private let includeAllJoints = false
        private let includeVideoFrames = true

        private let jointMap: [String: String] = [
            "root": "root",
            "left_upLeg_joint": "left_hip",
            "left_leg_joint": "left_knee",
            "left_foot_joint": "left_ankle",
            "right_upLeg_joint": "right_hip",
            "right_leg_joint": "right_knee",
            "right_foot_joint": "right_ankle",
            "left_shoulder_1_joint": "left_shoulder",
            "left_arm_joint": "left_elbow",
            "left_forearm_joint": "left_wrist",
            "right_shoulder_1_joint": "right_shoulder",
            "right_arm_joint": "right_elbow",
            "right_forearm_joint": "right_wrist"
        ]

        init(viewModel: ARTrackingViewModel) {
            self.viewModel = viewModel
        }

        func attach(sceneView: ARSCNView) {
            self.sceneView = sceneView
        }

        func startIfNeeded() {
            guard let sceneView else { return }
            guard !sessionRunning else { return }
            guard ARBodyTrackingConfiguration.isSupported else {
                DispatchQueue.main.async {
                    self.viewModel.statusText = "Not connected"
                }
                return
            }

            let configuration = ARBodyTrackingConfiguration()
            if ARBodyTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
                configuration.frameSemantics.insert(.smoothedSceneDepth)
                depthMode = "smoothed_depth"
            } else if ARBodyTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                configuration.frameSemantics.insert(.sceneDepth)
                depthMode = "scene_depth"
            } else {
                depthMode = "body_only"
            }

            sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
            sessionRunning = true
            DispatchQueue.main.async {
                self.viewModel.statusText = self.depthMode == "body_only"
                    ? "Tracking... (no LiDAR depth)"
                    : (self.includeVideoFrames ? "Tracking... (LiDAR + video stream)" : "Tracking... (LiDAR joints)")
            }
        }

        func stopIfNeeded() {
            guard sessionRunning else { return }
            sceneView?.session.pause()
            sessionRunning = false
            depthMode = "none"
        }

        func session(_ session: ARSession, didUpdate frame: ARFrame) {
            guard viewModel.isRunning else { return }
            let now = Date().timeIntervalSinceReferenceDate
            let minPacketInterval = 1.0 / packetMaxFPS
            if (now - lastPacketSentAt) < minPacketInterval {
                return
            }
            lastPacketSentAt = now

            let bodyAnchor = frame.anchors.compactMap { $0 as? ARBodyAnchor }.first
            let jointWorldPoints = bodyAnchor.map { mapJointWorldPoints(bodyAnchor: $0) } ?? [:]
            let joints = mapJoints(worldPoints: jointWorldPoints)
            let cameraMappedPoints = mapPointsToCameraAndSampleDepth(
                jointWorldPoints: jointWorldPoints,
                frame: frame
            )
            let cameraParams = cameraParameters(frame)
            let allJoints: [String: [Float]]?
            if includeAllJoints, let bodyAnchor {
                packetCounter += 1
                if packetCounter % includeAllJointsEveryNPackets == 0 {
                    allJoints = mapAllJoints(bodyAnchor: bodyAnchor)
                } else {
                    allJoints = nil
                }
            } else {
                allJoints = nil
            }
            let encodedFrame = includeVideoFrames ? encodeCurrentFrame(frame) : nil

            let packet = SkeletonPacket(
                device: "ios_lidar",
                timestamp: Date().timeIntervalSince1970,
                exercise: viewModel.exercise,
                depthMode: depthMode,
                joints: joints,
                allJoints: allJoints,
                keypoints2D: cameraMappedPoints?.keypoints2D,
                pointDepthsM: cameraMappedPoints?.pointDepthsM,
                cameraIntrinsics: cameraParams.intrinsics,
                cameraWidth: cameraParams.width,
                cameraHeight: cameraParams.height,
                videoFrameBase64: encodedFrame?.0,
                videoWidth: encodedFrame?.1,
                videoHeight: encodedFrame?.2
            )
            viewModel.socket.send(packet: packet)
        }

        private func mapJointWorldPoints(bodyAnchor: ARBodyAnchor) -> [String: SIMD3<Float>] {
            var points: [String: SIMD3<Float>] = [:]
            let skeleton = bodyAnchor.skeleton

            for (arkitJointName, outputJointName) in jointMap {
                let jointName = ARSkeleton.JointName(rawValue: arkitJointName)
                let index = skeleton.definition.index(for: jointName)
                guard index >= 0, index < skeleton.jointModelTransforms.count else {
                    continue
                }

                let jointModelTransform = skeleton.jointModelTransforms[index]
                let worldTransform = simd_mul(bodyAnchor.transform, jointModelTransform)
                points[outputJointName] = SIMD3<Float>(
                    worldTransform.columns.3.x,
                    worldTransform.columns.3.y,
                    worldTransform.columns.3.z
                )
            }

            return points
        }

        private func mapJoints(worldPoints: [String: SIMD3<Float>]) -> [String: [Float]] {
            var joints: [String: [Float]] = [:]
            for (jointName, worldPoint) in worldPoints {
                joints[jointName] = [worldPoint.x, worldPoint.y, worldPoint.z]
            }
            return joints
        }

        private func mapAllJoints(bodyAnchor: ARBodyAnchor) -> [String: [Float]] {
            var output: [String: [Float]] = [:]
            let skeleton = bodyAnchor.skeleton
            let jointNames = skeleton.definition.jointNames

            for (index, jointName) in jointNames.enumerated() {
                guard index < skeleton.jointModelTransforms.count else { continue }
                let jointModelTransform = skeleton.jointModelTransforms[index]
                let worldTransform = simd_mul(bodyAnchor.transform, jointModelTransform)
                output[jointName] = [
                    worldTransform.columns.3.x,
                    worldTransform.columns.3.y,
                    worldTransform.columns.3.z,
                ]
            }

            return output
        }

        private func encodeCurrentFrame(_ frame: ARFrame?) -> (String, Int, Int)? {
            guard let frame else { return nil }

            streamFrameCounter += 1
            if streamFrameCounter % videoFrameStride != 0 {
                return nil
            }

            let ciImage = CIImage(cvPixelBuffer: frame.capturedImage)
            let width = max(ciImage.extent.width, 1)
            let scale = min(1.0, videoMaxWidth / width)
            let scaledImage: CIImage
            if scale < 1.0 {
                scaledImage = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            } else {
                scaledImage = ciImage
            }

            guard let cgImage = ciContext.createCGImage(scaledImage, from: scaledImage.extent) else {
                return nil
            }
            let image = UIImage(cgImage: cgImage)
            guard let jpegData = image.jpegData(compressionQuality: jpegCompression) else {
                return nil
            }

            return (
                jpegData.base64EncodedString(),
                Int(scaledImage.extent.width),
                Int(scaledImage.extent.height)
            )
        }

        private func mapPointsToCameraAndSampleDepth(
            jointWorldPoints: [String: SIMD3<Float>],
            frame: ARFrame
        ) -> (keypoints2D: [String: [Float]], pointDepthsM: [String: Float])? {
            guard let sceneView else { return nil }
            guard !jointWorldPoints.isEmpty else { return nil }

            let viewportSize = sceneView.bounds.size
            guard viewportSize.width > 0.0, viewportSize.height > 0.0 else { return nil }

            let orientation = currentInterfaceOrientation()
            let displayTransform = frame.displayTransform(
                for: orientation,
                viewportSize: viewportSize
            )
            let inverseDisplayTransform = displayTransform.inverted()

            let capturedImage = frame.capturedImage
            let capturedWidth = CVPixelBufferGetWidth(capturedImage)
            let capturedHeight = CVPixelBufferGetHeight(capturedImage)
            guard capturedWidth > 0, capturedHeight > 0 else { return nil }

            var keypoints2D: [String: [Float]] = [:]
            let depthData = frame.smoothedSceneDepth ?? frame.sceneDepth
            let depthBuffer = depthData?.depthMap
            if let depthBuffer {
                CVPixelBufferLockBaseAddress(depthBuffer, .readOnly)
            }
            defer {
                if let depthBuffer {
                    CVPixelBufferUnlockBaseAddress(depthBuffer, .readOnly)
                }
            }
            var pointDepthsM: [String: Float] = [:]

            for (jointName, worldPoint) in jointWorldPoints {
                let projected = frame.camera.projectPoint(
                    worldPoint,
                    orientation: orientation,
                    viewportSize: viewportSize
                )
                let viewportX = CGFloat(projected.x) / viewportSize.width
                let viewportY = CGFloat(projected.y) / viewportSize.height
                guard viewportX.isFinite, viewportY.isFinite else { continue }

                let imagePoint = CGPoint(x: viewportX, y: viewportY)
                    .applying(inverseDisplayTransform)
                guard imagePoint.x.isFinite, imagePoint.y.isFinite else { continue }
                guard imagePoint.x >= 0.0, imagePoint.x <= 1.0,
                      imagePoint.y >= 0.0, imagePoint.y <= 1.0 else {
                    continue
                }

                keypoints2D[jointName] = [Float(imagePoint.x), Float(imagePoint.y)]

                if let depthBuffer,
                   let depthMeters = sampleDepthMeters(
                    depthBuffer: depthBuffer,
                    imagePoint: imagePoint
                   ) {
                    pointDepthsM[jointName] = depthMeters
                }
            }

            return (
                keypoints2D: keypoints2D,
                pointDepthsM: pointDepthsM
            )
        }

        private func sampleDepthMeters(
            depthBuffer: CVPixelBuffer,
            imagePoint: CGPoint
        ) -> Float? {
            let depthWidth = CVPixelBufferGetWidth(depthBuffer)
            let depthHeight = CVPixelBufferGetHeight(depthBuffer)
            guard depthWidth > 0, depthHeight > 0 else { return nil }
            guard let baseAddress = CVPixelBufferGetBaseAddress(depthBuffer) else { return nil }
            let bytesPerRow = CVPixelBufferGetBytesPerRow(depthBuffer)

            let clampedX = min(max(imagePoint.x, 0.0), 1.0)
            let clampedY = min(max(imagePoint.y, 0.0), 1.0)
            let depthX = min(max(Int(round(clampedX * CGFloat(depthWidth - 1))), 0), depthWidth - 1)
            let depthY = min(max(Int(round(clampedY * CGFloat(depthHeight - 1))), 0), depthHeight - 1)

            let pixelFormat = CVPixelBufferGetPixelFormatType(depthBuffer)
            switch pixelFormat {
            case kCVPixelFormatType_DepthFloat32, kCVPixelFormatType_DisparityFloat32:
                let patchRadii = [2, 4]
                for patchRadius in patchRadii {
                    let minX = max(depthX - patchRadius, 0)
                    let maxX = min(depthX + patchRadius, depthWidth - 1)
                    let minY = max(depthY - patchRadius, 0)
                    let maxY = min(depthY + patchRadius, depthHeight - 1)
                    var samples: [Float] = []
                    samples.reserveCapacity((maxX - minX + 1) * (maxY - minY + 1))

                    for y in minY...maxY {
                        let rowPointer = baseAddress
                            .advanced(by: y * bytesPerRow)
                            .assumingMemoryBound(to: Float32.self)
                        for x in minX...maxX {
                            let value = rowPointer[x]
                            if value.isFinite && value > 0.0 {
                                samples.append(value)
                            }
                        }
                    }

                    if !samples.isEmpty {
                        samples.sort()
                        return samples[samples.count / 2]
                    }
                }
                return nil
            default:
                return nil
            }
        }

        private func cameraParameters(_ frame: ARFrame) -> (intrinsics: [Float], width: Int, height: Int) {
            let intrinsics = frame.camera.intrinsics
            let capturedImage = frame.capturedImage
            return (
                intrinsics: [
                    intrinsics.columns.0.x,
                    intrinsics.columns.1.y,
                    intrinsics.columns.2.x,
                    intrinsics.columns.2.y,
                ],
                width: CVPixelBufferGetWidth(capturedImage),
                height: CVPixelBufferGetHeight(capturedImage)
            )
        }

        private func currentInterfaceOrientation() -> UIInterfaceOrientation {
            guard let windowScene = sceneView?.window?.windowScene else {
                return .portrait
            }
            return windowScene.interfaceOrientation
        }
    }
}
