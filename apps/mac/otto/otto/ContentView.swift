import SwiftUI

struct ContentView: View {
    @State private var model = AppModel()

    var body: some View {
        OttoShellView(model: model)
    }
}

#Preview {
    ContentView()
}
