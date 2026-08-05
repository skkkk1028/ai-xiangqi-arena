# Pikafish 2025 WebAssembly build

The distributed `public/engine/pikafish-2025.js` and `pikafish-2025.wasm` were built from the
official release `Pikafish-2025-06-23`, commit
`2b6cf79d55d9d168604cf42ce61b517653d6f2fc`.

Upstream source: <https://github.com/official-pikafish/Pikafish>

Toolchain: Emscripten SDK `4.0.12`. Apply `browser-bridge.patch` to the fixed upstream commit.
The bridge exposes initialization and one-command dispatch entry points for a browser Worker; it
does not modify search, evaluation, strength, move selection, or UCI semantics.

Compile all upstream `.cpp` translation units under `src` with:

```text
-std=c++17 -fno-exceptions -pthread -msimd128 -DUSE_POPCNT
-DUSE_SLOPPY_ATOMICS -DIS_64BIT -DNDEBUG -DGIT_SHA=2b6cf79
-DGIT_DATE=20250623 -DARCH=wasm32 -O3 -flto=full
-sINITIAL_MEMORY=67108864 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=3145728
-sMODULARIZE=1 -sEXPORT_NAME=Pikafish2025 -sENVIRONMENT=worker
-sINVOKE_RUN=0 -sNO_EXIT_RUNTIME=1 -sPTHREAD_POOL_SIZE=2
-sEXPORTED_FUNCTIONS=_main,_pikafish_init,_pikafish_command
-sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS
```

Expected artifacts:

- `pikafish-2025.js`: SHA-256 `79c05ed94c56ec4e4607afaf0bcca9807bf07240c19c69b6b94408def9990a8b`
- `pikafish-2025.wasm`: SHA-256 `f69321101d5dc8f8228f1ddc51abee0838f5f59d632fe4672623cc41538d282c`
- `pikafish-2025.nnue`: SHA-256 `9b2ce59b760c26f284b9fcadd091fa789d9fd4e8c1dd71ffbd42212503a13e95`

The network is the exact 44,880,002-byte `pikafish.nnue` from official release asset
`Pikafish.2025-06-23.7z` (SHA-256
`0bcca441327c547772475665fe3763fda826064411f23ad042511785c11a36b5`). The build sync emits
three ordered static-hosting parts of 20,971,520, 20,971,520, and 2,936,962 bytes; the Worker
reassembles and verifies the original network before initialization.
