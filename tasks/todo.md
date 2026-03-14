# Todo

- [x] Add shared runtime terrain primitive types and geometry compiler
- [x] Migrate server collision and projectile checks from `Wall[]` to compiled geometry
- [x] Migrate in-game world rendering from expanded river rectangles to render shapes
- [x] Verify builds and key runtime paths after the geometry migration
- [x] Audit repo documentation for map runtime geometry and flag behavior drift
- [x] Update README and docs to reflect compiled runtime geometry, curved river elbows, and explicit flag placement
- [x] Review doc diffs for coverage gaps and record documentation results

# Review

- Added `TerrainShape` / `RuntimeMapGeometry` and `compileMapGeometry()` in shared runtime code
- Server rooms now keep raw `MapData` plus compiled `geometry`, so collision no longer depends on expanded river-elbow rectangles
- Client room init compiles geometry once and reuses it for world, minimap, title background, and room thumbnails
- Verified with `npm run build -w shared`, `npm run build -w server`, and `npm run build -w client`
- Verified with `tasks/verify_geometry_runtime.ts` that river elbows compile as `ringSector`, server collision hits them, room creation preserves prefab objects, and client world rendering issues `arc()` calls for curved terrain
- Rewrote `README.md`, `docs/INDEX.md`, `docs/ARCHITECTURE.md`, `docs/domain/maps.md`, `docs/domain/network.md`, `docs/domain/ui.md`, and `docs/test/README.md` in Japanese to match the current runtime geometry and flag behavior
- Confirmed the old `flagPositions` fallback and `expandMapObjects()`-as-authoritative descriptions no longer remain in those updated docs
