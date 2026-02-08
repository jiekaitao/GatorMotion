import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var manager = HybridCaptureManager()

    var body: some View {
        HybridWebView(manager: manager)
            .ignoresSafeArea()
    }
}

struct HybridWebView: UIViewRepresentable {
    @ObservedObject var manager: HybridCaptureManager

    /// The remote URL where the web app is hosted.
    /// Change this to your own domain or GitHub Pages URL.
    private let webAppURL = "https://jiekaitao.github.io/GatorMotion/webapp/index.html"

    func makeCoordinator() -> NativeBridge {
        let bridge = NativeBridge()
        bridge.captureManager = manager
        return bridge
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let uc = config.userContentController
        uc.add(context.coordinator, name: "depthRequest")
        uc.add(context.coordinator, name: "control")
        uc.add(context.coordinator, name: "skeletonPacket")
        uc.add(context.coordinator, name: "log")

        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false

        manager.webView = webView

        if let url = URL(string: webAppURL) {
            print("[ContentView] Loading web app from: \(url)")
            webView.load(URLRequest(url: url))
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

#Preview {
    ContentView()
}
