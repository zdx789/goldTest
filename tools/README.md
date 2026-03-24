# tools/

Browser-console debug tools for the **Cocos Creator 2.4.11** gold-stack/cover/board
ad game (`SH_PhongUSE_ColorGrading` Phong shader).

Paste any script file into the browser DevTools console while the game is running.
No build step required.

---

## Files

| File | Purpose |
|------|---------|
| [`cocos_mesh_exporter.js`](cocos_mesh_exporter.js) | Export 3-D meshes to OBJ format |
| [`cocos_material_inspector.js`](cocos_material_inspector.js) | Read and display material properties |
| [`cocos_light_debugger.js`](cocos_light_debugger.js) | Visualise directional light direction (HTML overlay) |
| [`cocos_effect_dumper.js`](cocos_effect_dumper.js) | Dump full shader/effect configuration |

---

## Quick start

Open the game in Chrome/Firefox, open **DevTools → Console**, paste the file
contents and press Enter.

```js
// Mesh export
window.exportMesh("Table_plane");   // export one mesh by node name
window.exportAllMeshes();           // export every unique mesh
window.getMeshOBJ("Table_plane");   // return OBJ string

// Material inspection
window.inspectMaterials();          // log all unique materials
window.inspectMaterial("P_Coin");   // log material for one node
window.getMaterialData("P_Coin");   // return plain-object summary

// Light direction overlay
window.startLightDebug();           // start HTML canvas overlay
window.stopLightDebug();            // remove overlay

// Shader / effect dump
window.dumpEffects();               // dump all unique effects
window.dumpEffect("P_Coin");        // dump effect for one node
window.getEffectData("P_Coin");     // return plain-object dump
```

---

## Tool details

### cocos_mesh_exporter.js

Extracts raw mesh geometry from `mesh._buffer` (an `ArrayBuffer`) using the
confirmed Cocos Creator 2.4.11 mesh API:

```
mesh._buffer            — raw ArrayBuffer (vertex + index data packed together)
mesh._vertexBundles[]   — vertex layout descriptors
  bundle.view.offset / .length / .stride / .count
  bundle.attributes[]   — [{name, format, offset}, …]
mesh._primitives[]      — primitive descriptors
  primitive.indexView   — {offset, length, count, stride}
```

The script supports both `bundle.view` and `bundle.data` patterns, and
`bundle.vertexStride` as a fallback when `view.stride` is absent.

**Attribute names** searched in `bundle.attributes`:

| Attribute | Semantic |
|-----------|----------|
| `a_position` | vertex position (vec3, Float32 × 3) |
| `a_normal`   | vertex normal  (vec3, Float32 × 3) |
| `a_uv0`      | UV set 0       (vec2, Float32 × 2) |

**Download alternatives** (Blob + anchor is blocked in MRAID ad containers):

1. `console.log()` — OBJ text printed to console; select-all and copy in DevTools
2. `navigator.clipboard.writeText()` — silently copies to clipboard (may need permission)
3. `window.open('data:text/plain,…')` — opens OBJ in a new tab

---

### cocos_material_inspector.js

Reads material properties via the correct 2.4.11 path:

```
mat._effect._passes[0]._properties   ← actual property values  ✓
mat._effect._passes[0]._defines      ← active shader defines   ✓
mat._props                            ← ALWAYS undefined in MaterialVariant  ✗
```

Property value formatting:

| Type | Output |
|------|--------|
| `Float32Array(4)` | RGBA colour → `#RRGGBBAA  [r, g, b, a]` |
| `Float32Array(2)` | vec2 → `[x, y]` (tiling / offset / scroll) |
| `Float32Array(1)` or `number` | labelled scalar (glossiness, roughness, …) |
| texture object | `texture "name"` |

---

### cocos_light_debugger.js

Creates a native HTML5 `<canvas>` overlay fixed in the top-left corner of the
browser window.  Runs its own `requestAnimationFrame` loop — **independent of
the Cocos render loop** — so it survives node destruction between frames
(the previous `cc.Graphics` approach broke every frame).

- **Top-down view (XZ)** — overhead compass showing horizontal light direction
- **Side-elevation view (XY)** — side view showing pitch
- **Yellow circle** — approximate sun position (opposite of forward vector)
- **Red arrow** — light forward direction
- **Blue crosshairs** — world origin
- Labels in Chinese for the art/TA team (俯视图 / 侧视图)
- Euler angle readout (°) updated each frame

Finds the light node by searching for a `cc.Light` component.  Tries the known
path `World/P_Board/Holder/Shadow` first, then falls back to
`scene.getComponentsInChildren(cc.Light)`.

---

### cocos_effect_dumper.js

Walks `mat._effect._techniques[]._passes[]` and serialises:

- `_properties` — all shader uniforms with `value`, `type`, and `defines` keys
- `_defines` — all active feature flags per pass
- `vertShaderSource` / `fragShaderSource` — GLSL source if accessible via
  `pass._program._vertShader._source` (may be `null` in release builds)

Output is pretty-printed JSON that can be shared with the art/TA team.

---

## Known limitations of Cocos Creator 2.4.11

| Issue | Workaround |
|-------|------------|
| `mesh.readAttribute()` does not exist | Read `mesh._buffer` directly with `DataView` |
| `mesh._struct` is `undefined` | Use `mesh._vertexBundles` and `mesh._primitives` |
| `bundle.view.offset` was wrong | Both `bundle.view` and `bundle.data` patterns checked |
| `mat._props` is always `undefined` | Read from `mat._effect._passes[0]._properties` |
| Blob + anchor download blocked in MRAID | Use console.log / clipboard / data: URI |
| `cc.Graphics` debug nodes destroyed between frames | Use an HTML `<canvas>` overlay instead |

---

## Scene hierarchy

```
Scene
  └── World
       └── P_Board
            └── Holder  (22 children)
                 ├── P_Stack  ×8  (each: Holder → P_CoinBase → Holder → P_Coin)
                 ├── P_Cover  ×11
                 ├── Table_plane  (M_Table_02)
                 ├── Shadow       (M_Shadow_02)  ← also the cc.Light node
                 └── Table        (M_Board_02)
```

## Materials found (43 MeshRenderers)

| Node name | Material | Count |
|-----------|----------|-------|
| Table_plane | M_Table_02 | 1 |
| Shadow | M_Shadow_02 | 1 |
| Table | M_Board_02 | 1 |
| CoinBase Main2 | M_Container_02 | 7 |
| P_Coin | M_Bronze | 10 |
| P_Coin | M_Silver | 8 |
| Cover | M_Cover_02 | 11 |

## Shader: SH_PhongUSE_ColorGrading

Techniques: `basic`, `transparent`, `outline-simple`, `outline-fancy`, `glow`

Selected shader defines:

| Define | Meaning |
|--------|---------|
| `USE_EMISSIVE` | Emissive colour / scroll enabled |
| `USE_SPECULAR` | Specular highlight enabled |
| `USE_FRESNEL` | Fresnel rim effect enabled |
| `USE_DEPTH_TINT` | Depth-based colour tint |
| `USE_DISTANCE_FOG` | Distance fog blend |
| `CC_USE_SHADOW_MAP` | Shadow map sampling |
| `CC_USE_ATTRIBUTE_UV0` | UV0 vertex attribute present |

## Sample material properties (M_Board_02)

```json
{
  "diffuseColor":         [0, 0, 0, 1],
  "diffuseTiling":        [2, 2],
  "glossiness":           0.05,
  "emissiveColor":        [0.208, 0.208, 0.208, 1],
  "emissiveScroll":       [0.2, 0],
  "fresnelColorFrom":     [0.302, 0.318, 0.333, 1],
  "depthTintBorderStart": -5,
  "depthTintBorderEnd":   5,
  "distanceFogStart":     14,
  "distanceFogEnd":       54
}
```

## Light node (node: "Shadow")

Euler angles: **X: −45.14°  Y: 6.76°  Z: −3.50°**

Approximate world-space forward direction: `(0.116, -0.704, -0.701)`
