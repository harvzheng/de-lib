# Demo media

Sample footage for the demo pages. **Demo-only** — none of it is part of what you
would ship, and no effect depends on this particular clip. `film-grain-video`
takes any video, which is the point of it.

## What lives here

| File | Tracked | Used by |
| --- | --- | --- |
| `shot-a.jpg`, `shot-b.jpg`, `shot-c.jpg` | yes | Burn and leak transitions, burn overlay, dissolve, scribble trace, gallery card art |
| `sample-poster.jpg` | yes | `film-grain-video` poster, gallery card art |
| `sample-1920.mp4`, `sample-1280.mp4` | **no** | `film-grain-video` demo, `comic-print` demo |

The two `.mp4` files are gitignored: together they are about 3.5 MB of binary and
they dominated the diff. The stills are a few hundred kilobytes and stay tracked
because the gallery and most demos break visibly without them.

## Without the clips

The demos degrade rather than break. `film-grain-video` holds its poster frame,
and its demo has a file picker that loads any local video through
`URL.createObjectURL`, so you can point it at something of your own.

## Regenerating them

The originals came from a 6.7-second silent stock clip, 4096x2160 at 30 fps.
Any similar clip works; substitute your own path for `SOURCE`.

```sh
SOURCE=your-clip.mp4

# Delivery sizes. yuv420p and +faststart so they decode and stream everywhere.
ffmpeg -y -i "$SOURCE" -an -vf "scale=1920:-2" -c:v libx264 -preset slow \
  -crf 21 -pix_fmt yuv420p -movflags +faststart public/media/sample-1920.mp4
ffmpeg -y -i "$SOURCE" -an -vf "scale=1280:-2" -c:v libx264 -preset slow \
  -crf 23 -pix_fmt yuv420p -movflags +faststart public/media/sample-1280.mp4

# Poster frame.
ffmpeg -y -ss 1.5 -i public/media/sample-1920.mp4 -frames:v 1 -q:v 4 \
  public/media/sample-poster.jpg
```

The three stills are single frames pulled at different timestamps, so the
transition demos have visibly different shots to cut between:

```sh
ffmpeg -y -ss 0.6 -i "$SOURCE" -frames:v 1 -vf "scale=1920:-2" -q:v 3 public/media/shot-a.jpg
ffmpeg -y -ss 3.2 -i "$SOURCE" -frames:v 1 -vf "scale=1920:-2" -q:v 3 public/media/shot-b.jpg
ffmpeg -y -ss 5.9 -i "$SOURCE" -frames:v 1 -vf "scale=1920:-2" -q:v 3 public/media/shot-c.jpg
```

All six are 1.896:1, which is what the demo layouts assume via `aspect-ratio`.
