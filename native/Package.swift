// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HelmDesk",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "HelmDesk", targets: ["HelmDesk"])
    ],
    targets: [
        .executableTarget(
            name: "HelmDesk",
            path: "macOS"
        ),
        .testTarget(name: "HelmDeskTests", dependencies: ["HelmDesk"], path: "Tests")
    ]
)
