# Web KaTrain browser engine notice

The browser-native KataGo-style neural-network evaluator and MCTS search under
`src/vendor/web-katago` are vendored from
[Sir-Teo/web-katrain](https://github.com/Sir-Teo/web-katrain) commit
`7a0a4876ed0577bac3e511df4938ba5223446e6a`.

The upstream implementation is MIT licensed. The complete license text is in
`LICENSE` beside this file. Local integration code lives under
`src/games/go/ai`; the vendored search implementation itself is kept separate
from the Xiangqi engines and workers.

The default strong network is
`kata1-b18c384nbt-s9996604416-d4316597426.bin.gz`, fetched through the site's
same-origin model route. `public/models/katago-small.bin.gz` is the upstream
small test network and is used only as an automatic compatibility fallback.
