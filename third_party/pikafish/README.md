# Pikafish WebAssembly build

The distributed `public/engine/pikafish.js` and `pikafish.wasm` were built from the official
Pikafish release `Pikafish-2026-01-02`, commit
`ce0679e00ee196f7ba17f6ec18941b9a5036f8cf`.

Upstream source: <https://github.com/official-pikafish/Pikafish>

Toolchain: Emscripten SDK `4.0.12`, commit
`f39e849effe1bd679aa9ef3cd1798d327c9619db`.

Apply `browser-bridge.patch` to the fixed upstream commit. The patch does not change search,
evaluation, strength, or protocol semantics. It exposes initialization and one-command dispatch
entry points because a browser Worker has no stdin loop.

Compile every upstream `.cpp` translation unit under `src` (excluding platform-specific amd64
assembly) and link with these effective flags:

```text
-std=c++17 -fno-exceptions -pthread -msimd128 -DUSE_POPCNT
-DUSE_SLOPPY_ATOMICS -DIS_64BIT -DNDEBUG -DGIT_SHA=ce0679e0
-DGIT_DATE=20260103 -DARCH=wasm32 -O3 -flto=full
-sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=3145728
-sMODULARIZE=1 -sEXPORT_NAME=Pikafish -sENVIRONMENT=worker
-sINVOKE_RUN=0 -sNO_EXIT_RUNTIME=1 -sPTHREAD_POOL_SIZE=2
-sEXPORTED_FUNCTIONS=_main,_pikafish_init,_pikafish_command
-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS
```

Expected artifacts:

- `pikafish.js`: SHA-256 `cfd068951ece16c621de8d52d530df6f765bffa3bba48b2b469694278fca727d`
- `pikafish.wasm`: SHA-256 `1233b07cbc741faac3e8251f91b8c74b048938a62bd3a01535bfd1d8b3907e12`
- `pikafish.nnue`: SHA-256 `c4026370d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77`

The matching network is extracted from the official `Pikafish.2026-01-02.7z` release asset
(SHA-256 `84257063905615919fb4ee6a70273a94843bb6ec04c45e3ac706098838bc1a49`) and is bundled because
the official release does not publish the matching network as a separate download. The sync script
and browser both verify its checksum. For static hosting, the sync script emits three ordered parts
of 20,971,520, 20,971,520, and 11,269,901 bytes. The Worker rejoins those bytes before verification;
the engine still receives the exact 53,212,941-byte release network.
