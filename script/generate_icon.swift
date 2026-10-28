#!/usr/bin/env swift
// One vector scene produces both the web SVG and every macOS icon representation.
// Run: swift script/generate_icon.swift <output-directory>
import AppKit

struct Ink {
    let hex: String
    var alpha: CGFloat = 1
    var color: CGColor {
        let value = UInt32(hex.dropFirst(), radix: 16)!
        return CGColor(srgbRed: CGFloat((value >> 16) & 255) / 255,
                       green: CGFloat((value >> 8) & 255) / 255,
                       blue: CGFloat(value & 255) / 255, alpha: alpha)
    }
}

struct Ramp {
    let id: String
    let from: CGPoint
    let to: CGPoint
    let colors: [Ink]
}

struct Layer {
    let path: CGPath
    var ink: Ink? = nil
    var ramp: Ramp? = nil
    var stroke: Ink? = nil
    var width: CGFloat = 1
}

func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
func circle(_ x: CGFloat, _ y: CGFloat, _ radius: CGFloat) -> CGPath {
    CGPath(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2), transform: nil)
}
func polygon(_ points: [CGPoint]) -> CGPath {
    let path = CGMutablePath()
    path.addLines(between: points)
    path.closeSubpath()
    return path
}

let tile = CGPath(roundedRect: CGRect(x: 96, y: 96, width: 832, height: 832),
                  cornerWidth: 186, cornerHeight: 186, transform: nil)
let orbit = CGMutablePath()
orbit.move(to: point(512, 268))
orbit.addCurve(to: point(756, 512), control1: point(647, 268), control2: point(756, 377))
orbit.addCurve(to: point(512, 756), control1: point(756, 647), control2: point(647, 756))
orbit.addCurve(to: point(268, 512), control1: point(377, 756), control2: point(268, 647))
orbit.addCurve(to: point(512, 268), control1: point(268, 377), control2: point(377, 268))

let layers: [Layer] = [
    Layer(path: tile, ramp: Ramp(id: "sea", from: point(220, 96), to: point(820, 928),
                               colors: [Ink(hex: "#23485B"), Ink(hex: "#0B1E2D"), Ink(hex: "#081521")])),
    Layer(path: tile, stroke: Ink(hex: "#C9E9F2", alpha: 0.18), width: 2),
    Layer(path: orbit, stroke: Ink(hex: "#A9DAE5", alpha: 0.24), width: 20),
    // Three waypoints stand for independently scoped collaborators around one helm.
    Layer(path: circle(512, 268, 19), ink: Ink(hex: "#D1EBF0")),
    Layer(path: circle(756, 512, 19), ink: Ink(hex: "#83CDC8")),
    Layer(path: circle(301, 634, 19), ink: Ink(hex: "#6992A8")),
    // A broad, faceted needle remains readable at Dock and browser-tab sizes.
    Layer(path: polygon([point(704, 320), point(566, 566), point(320, 704), point(458, 458)]),
          ramp: Ramp(id: "needle", from: point(400, 704), to: point(624, 320),
                     colors: [Ink(hex: "#7799AE"), Ink(hex: "#D5EAF1")])),
    Layer(path: polygon([point(704, 320), point(512, 512), point(458, 458)]),
          ramp: Ramp(id: "lit", from: point(458, 512), to: point(704, 320),
                     colors: [Ink(hex: "#BCF8E5"), Ink(hex: "#F0FFF6")])),
    Layer(path: polygon([point(704, 320), point(566, 566), point(512, 512)]),
          ramp: Ramp(id: "mint", from: point(512, 566), to: point(704, 320),
                     colors: [Ink(hex: "#3DCAB4"), Ink(hex: "#B0FFE6")])),
    Layer(path: polygon([point(320, 704), point(512, 512), point(566, 566)]),
          ink: Ink(hex: "#4A718B")),
    Layer(path: circle(512, 512, 17), ink: Ink(hex: "#163545"),
          stroke: Ink(hex: "#E7FFF8", alpha: 0.85), width: 5)
]

func number(_ value: CGFloat) -> String { String(format: "%.3f", Double(value)) }
func svgPath(_ path: CGPath) -> String {
    var commands = [String]()
    path.applyWithBlock { item in
        let element = item.pointee
        let p = element.points
        func xy(_ i: Int) -> String { "\(number(p[i].x)) \(number(p[i].y))" }
        switch element.type {
        case .moveToPoint: commands.append("M\(xy(0))")
        case .addLineToPoint: commands.append("L\(xy(0))")
        case .addQuadCurveToPoint: commands.append("Q\(xy(0)) \(xy(1))")
        case .addCurveToPoint: commands.append("C\(xy(0)) \(xy(1)) \(xy(2))")
        case .closeSubpath: commands.append("Z")
        @unknown default: fatalError("Unsupported path operation")
        }
    }
    return commands.joined(separator: " ")
}

func svg() -> String {
    let ramps = layers.compactMap(\.ramp).map { ramp in
        let stops = ramp.colors.enumerated().map { index, ink in
            "<stop offset=\"\(number(CGFloat(index) / CGFloat(ramp.colors.count - 1)))\" stop-color=\"\(ink.hex)\" stop-opacity=\"\(number(ink.alpha))\"/>"
        }.joined()
        return "<linearGradient id=\"\(ramp.id)\" gradientUnits=\"userSpaceOnUse\" x1=\"\(number(ramp.from.x))\" y1=\"\(number(ramp.from.y))\" x2=\"\(number(ramp.to.x))\" y2=\"\(number(ramp.to.y))\">\(stops)</linearGradient>"
    }.joined(separator: "\n")
    let paths = layers.map { layer in
        let fill = layer.ramp.map { "url(#\($0.id))" } ?? layer.ink?.hex ?? "none"
        var attributes = "fill=\"\(fill)\""
        if let ink = layer.ink { attributes += " fill-opacity=\"\(number(ink.alpha))\"" }
        if let stroke = layer.stroke {
            attributes += " stroke=\"\(stroke.hex)\" stroke-opacity=\"\(number(stroke.alpha))\" stroke-width=\"\(number(layer.width))\" stroke-linejoin=\"round\""
        }
        return "<path d=\"\(svgPath(layer.path))\" \(attributes)/>"
    }.joined(separator: "\n")
    return """
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <title>领航台 · HelmDesk</title>
    <defs>
    \(ramps)
    </defs>
    \(paths)
    </svg>

    """
}

func png(size: Int) throws -> Data {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                            bytesPerRow: size * 4, space: space,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: CGFloat(size) / 1024, y: -CGFloat(size) / 1024)
    context.setLineJoin(.round)
    for layer in layers {
        if let ramp = layer.ramp {
            context.saveGState()
            context.addPath(layer.path)
            context.clip()
            let gradient = CGGradient(colorsSpace: space, colors: ramp.colors.map(\.color) as CFArray, locations: nil)!
            context.drawLinearGradient(gradient, start: ramp.from, end: ramp.to,
                                       options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            context.restoreGState()
        } else if let ink = layer.ink {
            context.setFillColor(ink.color)
            context.addPath(layer.path)
            context.fillPath()
        }
        if let stroke = layer.stroke {
            context.setStrokeColor(stroke.color)
            context.setLineWidth(layer.width)
            context.addPath(layer.path)
            context.strokePath()
        }
    }
    let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw CocoaError(.fileWriteUnknown)
    }
    return data
}

guard CommandLine.arguments.count == 2 else {
    fputs("usage: swift script/generate_icon.swift <output-directory>\n", stderr)
    exit(2)
}
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let iconset = destination.appendingPathComponent("HelmDesk.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
try svg().write(to: destination.appendingPathComponent("HelmDesk.svg"), atomically: true, encoding: .utf8)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        try png(size: points * scale).write(to: iconset.appendingPathComponent("icon_\(points)x\(points)\(suffix).png"))
    }
}
print("Generated HelmDesk.svg and the 10 macOS icon representations.")
