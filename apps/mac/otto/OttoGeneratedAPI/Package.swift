// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "OttoGeneratedAPI",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "OttoGeneratedAPI", targets: ["OttoGeneratedAPI"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.12.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.11.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0")
    ],
    targets: [
        .target(
            name: "OttoGeneratedAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession")
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")
            ]
        )
    ]
)
