import AVFoundation
import AppKit

// Extrait une frame d'une video a un instant donne (defaut : la derniere).
let args = CommandLine.arguments
guard args.count >= 3 else { fputs("usage: lastframe <video> <sortie.jpg> [secondes]\n", stderr); exit(2) }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let duration = asset.duration
let target: CMTime
if args.count >= 4, let s = Double(args[3]) {
  target = CMTime(seconds: s, preferredTimescale: duration.timescale)
} else {
  // Un poil avant la fin : la toute derniere PTS n'est pas toujours decodable.
  let step = Int64(duration.timescale) / 20
  target = CMTime(value: max(0, duration.value - step), timescale: duration.timescale)
}
do {
  let cg = try generator.copyCGImage(at: target, actualTime: nil)
  let rep = NSBitmapImageRep(cgImage: cg)
  guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.95]) else {
    fputs("encodage impossible\n", stderr); exit(1)
  }
  try data.write(to: URL(fileURLWithPath: args[2]))
  print("frame extraite a \(CMTimeGetSeconds(target))s -> \(args[2])")
} catch {
  fputs("echec: \(error)\n", stderr); exit(1)
}
