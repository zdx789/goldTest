/**
 * tools/cocos_mesh_exporter.js
 *
 * Cocos Creator 2.4.11 — browser-console OBJ mesh exporter
 *
 * Paste the entire file into DevTools console while the Cocos game is running.
 *
 * Public API registered on `window`:
 *   window.exportMesh("Table_plane")  — export one mesh by node name
 *   window.exportAllMeshes()          — export every unique mesh in the scene
 *   window.getMeshOBJ("Table_plane")  — return the OBJ string (programmatic use)
 *
 * Download alternatives (Blob+anchor is blocked in MRAID ad containers):
 *   1. console.log() — OBJ text is printed; select-all and copy in DevTools
 *   2. navigator.clipboard.writeText() — silently copies to clipboard
 *   3. window.open('data:text/plain,...') — opens OBJ in a new tab
 *
 * Confirmed 2.4.11 mesh API:
 *   mesh._buffer            — ArrayBuffer (all packed vertex + index data)
 *   mesh._vertexBundles[]   — vertex buffer descriptors
 *     bundle.view.offset / .length / .stride / .count
 *     bundle.attributes[]   — [{name, format, offset}, …]
 *       attribute names: a_position, a_normal, a_uv0
 *   mesh._primitives[]      — primitive / index buffer descriptors
 *     primitive.indexView   — {offset, length, count, stride}
 *     primitive.vertexBundelIndices[] — (note: engine typo 'Bundel')
 */

(function (global) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Scene helpers                                                        */
    /* ------------------------------------------------------------------ */

    function getAllMeshRenderers() {
        var scene = cc.director.getScene();
        if (!scene) {
            console.error('[MeshExporter] No active scene.');
            return [];
        }
        var renderers = scene.getComponentsInChildren(cc.MeshRenderer);
        if (!renderers || renderers.length === 0) {
            console.warn('[MeshExporter] No MeshRenderer components found.');
        }
        return renderers || [];
    }

    function getMeshFromRenderer(renderer) {
        return renderer.mesh || renderer._mesh || null;
    }

    /* ------------------------------------------------------------------ */
    /*  OBJ builder                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Convert a cc.Mesh asset to an OBJ-format string.
     * @param {cc.Mesh}  mesh
     * @param {string}   meshName  used for the 'o' and 'g' tokens
     * @returns {string|null}
     */
    function meshToOBJ(mesh, meshName) {
        if (!mesh) {
            console.warn('[MeshExporter] meshToOBJ: null mesh for "' + meshName + '"');
            return null;
        }

        var buffer = mesh._buffer;
        if (!(buffer instanceof ArrayBuffer)) {
            console.warn('[MeshExporter] mesh._buffer is not an ArrayBuffer for "' + meshName + '"', buffer);
            return null;
        }

        var bundles    = mesh._vertexBundles;
        var primitives = mesh._primitives;

        if (!bundles || bundles.length === 0) {
            console.warn('[MeshExporter] mesh._vertexBundles missing for "' + meshName + '"');
            return null;
        }
        if (!primitives || primitives.length === 0) {
            console.warn('[MeshExporter] mesh._primitives missing for "' + meshName + '"');
            return null;
        }

        var dataView = new DataView(buffer);
        var lines    = [];

        lines.push('# Exported by tools/cocos_mesh_exporter.js');
        lines.push('# Cocos Creator 2.4.11');
        lines.push('# Mesh: ' + meshName);
        lines.push('o ' + meshName);

        var globalVertexOffset = 0; // OBJ indices are 1-based and accumulate across sub-meshes

        for (var pi = 0; pi < primitives.length; pi++) {
            var primitive = primitives[pi];

            // Resolve vertex bundle for this primitive.
            // The engine uses a typo property name 'vertexBundelIndices'; both spellings checked.
            var bundleIndex = 0;
            var bundelIndices = primitive.vertexBundelIndices || primitive.vertexBundleIndices;
            if (bundelIndices && bundelIndices.length > 0) {
                bundleIndex = bundelIndices[0];
            }

            var bundle = bundles[bundleIndex];

            // Support both bundle.view (standard) and bundle.data patterns
            var view = bundle && (bundle.view || bundle.data);
            if (!bundle || !view) {
                console.warn('[MeshExporter] Missing bundle or bundle.view for primitive ' + pi + ' of "' + meshName + '"');
                continue;
            }

            var stride = view.stride;
            var vbOff  = view.offset;
            var vbLen  = view.length;
            var count  = (view.count != null) ? view.count : Math.floor(vbLen / stride);

            // Support vertexStride at the bundle level as a fallback for stride
            if (!stride && bundle.vertexStride) {
                stride = bundle.vertexStride;
            }

            // Locate per-attribute byte offsets within a single vertex record
            var posOffset  = -1;
            var normOffset = -1;
            var uvOffset   = -1;
            var runningOff = 0; // used when attribute.offset is absent

            var attrs = bundle.attributes || [];
            for (var ai = 0; ai < attrs.length; ai++) {
                var attr    = attrs[ai];
                var attrOff = (attr.offset != null) ? attr.offset : runningOff;

                if (attr.name === 'a_position') posOffset  = attrOff;
                if (attr.name === 'a_normal')   normOffset = attrOff;
                if (attr.name === 'a_uv0')      uvOffset   = attrOff;

                // Advance runningOff by the size of this attribute's format
                runningOff += formatByteSize(attr.format);
            }

            if (posOffset < 0) {
                console.warn('[MeshExporter] No a_position in bundle ' + bundleIndex + ' of "' + meshName + '"');
                continue;
            }

            // --- Vertex positions (v) ---
            for (var vi = 0; vi < count; vi++) {
                var base = vbOff + vi * stride + posOffset;
                var x = dataView.getFloat32(base,     true);
                var y = dataView.getFloat32(base + 4, true);
                var z = dataView.getFloat32(base + 8, true);
                lines.push('v ' + x.toFixed(6) + ' ' + y.toFixed(6) + ' ' + z.toFixed(6));
            }

            // --- Vertex normals (vn) ---
            if (normOffset >= 0) {
                for (var vi2 = 0; vi2 < count; vi2++) {
                    var nBase = vbOff + vi2 * stride + normOffset;
                    var nx = dataView.getFloat32(nBase,     true);
                    var ny = dataView.getFloat32(nBase + 4, true);
                    var nz = dataView.getFloat32(nBase + 8, true);
                    lines.push('vn ' + nx.toFixed(6) + ' ' + ny.toFixed(6) + ' ' + nz.toFixed(6));
                }
            }

            // --- Texture coordinates (vt) ---
            if (uvOffset >= 0) {
                for (var vi3 = 0; vi3 < count; vi3++) {
                    var uvBase = vbOff + vi3 * stride + uvOffset;
                    var u = dataView.getFloat32(uvBase,     true);
                    var v = dataView.getFloat32(uvBase + 4, true);
                    lines.push('vt ' + u.toFixed(6) + ' ' + v.toFixed(6));
                }
            }

            // --- Index / face data (f) ---
            var indexView = primitive.indexView;
            if (!indexView) {
                console.warn('[MeshExporter] No indexView for primitive ' + pi + ' of "' + meshName + '"');
                globalVertexOffset += count;
                continue;
            }

            var ibOffset = indexView.offset;
            var ibCount  = indexView.count;
            var ibStride = indexView.stride; // 2 = Uint16, 4 = Uint32

            lines.push('g ' + meshName + '_prim' + pi);

            var hasNormals = (normOffset >= 0);
            var hasUVs     = (uvOffset   >= 0);

            for (var fi = 0; fi < ibCount; fi += 3) {
                var i0, i1, i2;
                if (ibStride === 4) {
                    i0 = dataView.getUint32(ibOffset + (fi + 0) * 4, true);
                    i1 = dataView.getUint32(ibOffset + (fi + 1) * 4, true);
                    i2 = dataView.getUint32(ibOffset + (fi + 2) * 4, true);
                } else {
                    i0 = dataView.getUint16(ibOffset + (fi + 0) * 2, true);
                    i1 = dataView.getUint16(ibOffset + (fi + 1) * 2, true);
                    i2 = dataView.getUint16(ibOffset + (fi + 2) * 2, true);
                }

                // OBJ indices are 1-based; add running offset for multi-primitive meshes
                var v0 = i0 + globalVertexOffset + 1;
                var v1 = i1 + globalVertexOffset + 1;
                var v2 = i2 + globalVertexOffset + 1;

                if (hasNormals && hasUVs) {
                    lines.push('f ' + v0 + '/' + v0 + '/' + v0 + ' '
                                    + v1 + '/' + v1 + '/' + v1 + ' '
                                    + v2 + '/' + v2 + '/' + v2);
                } else if (hasUVs) {
                    lines.push('f ' + v0 + '/' + v0 + ' '
                                    + v1 + '/' + v1 + ' '
                                    + v2 + '/' + v2);
                } else if (hasNormals) {
                    lines.push('f ' + v0 + '//' + v0 + ' '
                                    + v1 + '//' + v1 + ' '
                                    + v2 + '//' + v2);
                } else {
                    lines.push('f ' + v0 + ' ' + v1 + ' ' + v2);
                }
            }

            globalVertexOffset += count;
        }

        return lines.join('\n');
    }

    /**
     * Return the byte size of a GFX vertex attribute format value.
     * Covers the common formats used in Cocos Creator 2.4 meshes.
     * @param {number} fmt  — cc.GFXFormat enum value (or undefined)
     * @returns {number}
     */
    function formatByteSize(fmt) {
        if (fmt == null) return 0;
        // cc.GFXFormat values used in 2.4.x meshes:
        //   RGB32F  = 35  → 12 bytes
        //   RGBA32F = 44  → 16 bytes
        //   RG32F   = 26  → 8 bytes
        //   RGB8    = 4   → 3 bytes
        //   RGBA8   = 8   → 4 bytes
        var sizes = {
            4: 3, 8: 4, 26: 8, 35: 12, 44: 16
        };
        return sizes[fmt] || 0;
    }

    /* ------------------------------------------------------------------ */
    /*  Download / output helpers                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Output OBJ text via three fallback methods:
     *   1. console.log  (always works — copy from DevTools)
     *   2. navigator.clipboard.writeText  (async; may require permission)
     *   3. window.open with data: URI  (works if pop-ups are allowed)
     * Blob+anchor download is intentionally skipped — it is blocked in
     * MRAID ad containers.
     * @param {string} filename
     * @param {string} text
     */
    function outputOBJ(filename, text) {
        // 1. Console log (always available)
        console.group('[MeshExporter] ' + filename + ' (' + text.length + ' chars) — copy text below:');
        console.log(text);
        console.groupEnd();

        // 2. Clipboard (async, may be blocked by permissions policy)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function () {
                    console.log('[MeshExporter] Copied "' + filename + '" to clipboard.');
                })
                .catch(function (err) {
                    console.warn('[MeshExporter] Clipboard copy failed:', err.message);
                });
        }

        // 3. data: URI in a new tab (fallback when clipboard API is unavailable)
        try {
            var dataURI = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
            var win = window.open(dataURI, '_blank');
            if (!win) {
                console.warn('[MeshExporter] window.open blocked (pop-up). Use the console output above.');
            }
        } catch (e) {
            console.warn('[MeshExporter] data: URI fallback failed:', e.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Mesh cache / de-duplication                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Build a map keyed by mesh UUID, de-duplicating shared mesh assets.
     * @returns {{ meshMap: Object, nodeMap: Object }}
     */
    function buildMeshMap() {
        var renderers = getAllMeshRenderers();
        var meshMap   = {};
        var nodeMap   = {};

        for (var i = 0; i < renderers.length; i++) {
            var renderer = renderers[i];
            var mesh     = getMeshFromRenderer(renderer);
            if (!mesh) continue;

            var uuid     = mesh._uuid || mesh._id || ('mesh_' + i);
            var nodeName = renderer.node ? renderer.node.name : ('node_' + i);

            if (!meshMap[uuid]) {
                meshMap[uuid] = { mesh: mesh, nodeName: nodeName, uuid: uuid };
            }
            if (!nodeMap[nodeName]) {
                nodeMap[nodeName] = uuid;
            }
        }

        return { meshMap: meshMap, nodeMap: nodeMap };
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Export all unique meshes in the scene.
     * OBJ text is printed to console and additional output alternatives are tried.
     */
    function exportAllMeshes() {
        var data   = buildMeshMap();
        var uuids  = Object.keys(data.meshMap);
        var done   = 0;

        console.log('[MeshExporter] ' + uuids.length + ' unique mesh(es) found. Exporting…');

        for (var i = 0; i < uuids.length; i++) {
            var entry   = data.meshMap[uuids[i]];
            var objText = meshToOBJ(entry.mesh, entry.nodeName);
            if (!objText) continue;

            done++;
            var filename = entry.nodeName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.obj';
            outputOBJ(filename, objText);
        }

        console.log('[MeshExporter] Done — exported ' + done + ' mesh(es).');
    }

    /**
     * Export the mesh on the first MeshRenderer whose node name matches.
     * @param {string} nodeName
     */
    function exportMesh(nodeName) {
        var objText = getMeshOBJ(nodeName);
        if (!objText) return;

        var filename = nodeName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.obj';
        outputOBJ(filename, objText);
    }

    /**
     * Return the OBJ string for the named node's mesh (programmatic use).
     * @param {string} nodeName
     * @returns {string|null}
     */
    function getMeshOBJ(nodeName) {
        var renderers = getAllMeshRenderers();
        for (var i = 0; i < renderers.length; i++) {
            var r = renderers[i];
            if (!r.node || r.node.name !== nodeName) continue;
            var mesh = getMeshFromRenderer(r);
            if (!mesh) {
                console.warn('[MeshExporter] Node "' + nodeName + '" has no mesh.');
                return null;
            }
            return meshToOBJ(mesh, nodeName);
        }
        console.warn('[MeshExporter] No MeshRenderer found for node "' + nodeName + '"');
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Register on window                                                  */
    /* ------------------------------------------------------------------ */

    global.exportMesh     = exportMesh;
    global.exportAllMeshes = exportAllMeshes;
    global.getMeshOBJ     = getMeshOBJ;

    console.log('%c[MeshExporter] Ready!', 'color:#4CAF50;font-weight:bold;');
    console.log('  window.exportMesh("Table_plane")  — export one mesh by node name');
    console.log('  window.exportAllMeshes()           — export all unique meshes');
    console.log('  window.getMeshOBJ("Table_plane")  — return OBJ string');

}(window));
