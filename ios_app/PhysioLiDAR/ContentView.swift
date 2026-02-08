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

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "webapp") {
            print("[ContentView] Loading webapp from bundle: \(indexURL)")
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        } else {
            print("[ContentView] ERROR: webapp/index.html not found in bundle")
            webView.loadHTMLString("""
                <html><body style="background:#000;color:#fff;font-family:system-ui;display:flex;
                align-items:center;justify-content:center;height:100vh;margin:0">
                <p>webapp/index.html not found in app bundle.<br>Rebuild with xcodegen.</p>
                </body></html>
            """, baseURL: nil)
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

#Preview {
    ContentView()
}
