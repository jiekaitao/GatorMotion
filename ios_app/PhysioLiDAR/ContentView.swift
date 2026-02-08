import SwiftUI

struct ContentView: View {
    @StateObject private var manager = StreamingCaptureManager()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 20) {
                Spacer()

                Text("GatorMotion")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .foregroundColor(.white)

                Text(manager.statusText)
                    .font(.headline)
                    .foregroundColor(manager.isStreaming ? .green : .gray)
                    .padding(.horizontal)
                    .multilineTextAlignment(.center)

                Text("Frames: \(manager.frameCount)")
                    .font(.caption)
                    .foregroundColor(.gray)

                Spacer()

                VStack(spacing: 12) {
                    TextField("Server URL", text: $manager.serverURL)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .padding(.horizontal, 40)

                    Button(action: {
                        if manager.isStreaming {
                            manager.stop()
                        } else {
                            manager.start()
                        }
                    }) {
                        Text(manager.isStreaming ? "Stop Streaming" : "Start Streaming")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(manager.isStreaming ? Color.red : Color.green)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal, 40)
                }

                Spacer().frame(height: 60)
            }
        }
    }
}
