import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = ARTrackingViewModel(
        streamMode: .phoneServer,
        host: "0.0.0.0",
        port: 8765,
        path: "/skeleton",
        exercise: "standing_knee_flexion"
    )

    var body: some View {
        ZStack(alignment: .bottom) {
            ARBodyTrackingView(viewModel: viewModel)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Text(viewModel.statusText)
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.55))
                    .clipShape(Capsule())

                Button(action: viewModel.toggle) {
                    Text(viewModel.isRunning ? "Stop Tracking" : "Start Tracking")
                        .font(.headline)
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)
                        .background(viewModel.isRunning ? Color.red : Color.green)
                        .clipShape(Capsule())
                }
            }
            .padding(.bottom, 24)
        }
    }
}

#Preview {
    ContentView()
}
