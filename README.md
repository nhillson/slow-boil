# Slow Boil 🐸

Pick two artists and get a playlist that drifts from one to the other so gradually you won't notice the water heating up.

A remake of Paul Lamere's 2013 [Boil the Frog](https://musicmachinery.com/2013/01/02/boil-the-frog-2/), which stopped working when The Echo Nest and Rdio shut down.

## How it works

- **Artist graph:** the public [Deezer API](https://developers.deezer.com/api), which needs no key. Each artist's "related artists" list is treated as its neighbors in the graph.
- **Path:** a bidirectional beam search runs from both ends at once. It prefers bridge artists whose fan counts fall between the two endpoints, so famous endpoints get famous bridges and obscure ones stay obscure.
- **Songs:** each artist gets one of their top tracks. The pick is the one whose popularity is closest to the previous song's, so the playlist doesn't lurch.
- **Playback:** 30-second previews play in the page and advance automatically. Each song links to Spotify, Deezer and YouTube for the full track.
- **Bypass** reroutes around an artist you don't want. Links can be shared (`?from=…&to=…&skip=…`).

The site is fully static (no build step and no server): `index.html` plus `engine.js`. Deezer sends no CORS headers, so the requests go through JSONP.

## Run locally

```
python3 -m http.server
```

Then open http://localhost:8000.
