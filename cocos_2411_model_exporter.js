/**
 * cocos_2411_model_exporter.js
 *
 * Cocos Creator 2.4.11 — browser console OBJ exporter
 *
 * Usage (paste into browser DevTools console while the game is running):
 *
 *   window.exportAllOBJ()          — export every unique mesh, log OBJ to console
 *   window.exportOBJ('P_Coin')     — export the mesh on the named node
 *   window.getOBJ('P_Coin')        — return the OBJ string (for programmatic use)
 *   window.inspectMaterials()      — log material properties from _effect._passes[0]._properties
 *
 * Confirmed working API for Cocos Creator 2.4.11:
 *   mesh._buffer          — ArrayBuffer containing all packed vertex/index data
 *   mesh._vertexBundles   — array of vertex bundle descriptors (NOT under _struct)
 *   mesh._primitives      — array of primitive descriptors  (NOT under _struct)
 *
 *   bundle.view.offset / .length / .stride / .count
 *   bundle.attributes[]  — {name, format, offset, ...}  (attribute names: a_position, a_normal, a_uv0)
 *   primitive.indexView  — {offset, length, count, stride}
 *
 *   mat._effect._passes[0]._properties   — material property values
 */

(function (global) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Internal helpers                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Collect every MeshRenderer in the current scene.
     * @returns {cc.MeshRenderer[]}
     */
    function getAllMeshRenderers() {
        var scene = cc.director.getScene();
        if (!scene) {
            console.error('[OBJExporter] No active scene found.');
            return [];
        }
        var renderers = scene.getComponentsInChildren(cc.MeshRenderer);
        if (!renderers || renderers.length === 0) {
            console.warn('[OBJExporter] No MeshRenderer components found in scene.');
            return [];
        }
        return renderers;
    }

    /**
     * Retrieve the cc.Mesh asset from a MeshRenderer.
     * @param {cc.MeshRenderer} renderer
     * @returns {cc.Mesh|null}
     */
    function getMesh(renderer) {
        // Cocos Creator 2.4.x stores the mesh on .mesh property
        var mesh = renderer.mesh || renderer._mesh || null;
        return mesh;
    }

    /**
     * Build an OBJ-format string from a cc.Mesh asset.
     * @param {cc.Mesh}  mesh      — the mesh asset
     * @param {string}   meshName  — name used for the "o" / "g" OBJ token
     * @returns {string|null}      — OBJ text, or null on failure
     */
    function meshToOBJ(mesh, meshName) {
        if (!mesh) {
            console.warn('[OBJExporter] meshToOBJ: null mesh for "' + meshName + '"');
            return null;
        }

        var buffer = mesh._buffer;
        if (!(buffer instanceof ArrayBuffer)) {
            console.warn('[OBJExporter] mesh._buffer is not an ArrayBuffer for "' + meshName + '"', buffer);
            return null;
        }

        var bundles    = mesh._vertexBundles;
        var primitives = mesh._primitives;

        if (!bundles || bundles.length === 0) {
            console.warn('[OBJExporter] mesh._vertexBundles missing for "' + meshName + '"');
            return null;
        }
        if (!primitives || primitives.length === 0) {
            console.warn('[OBJExporter] mesh._primitives missing for "' + meshName + '"');
            return null;
        }

        var dataView = new DataView(buffer);
        var lines    = [];

        lines.push('# Exported by cocos_2411_model_exporter.js');
        lines.push('# Mesh: ' + meshName);
        lines.push('o ' + meshName);

        var globalVertexOffset = 0; // OBJ indices are 1-based and global across sub-meshes

        for (var pi = 0; pi < primitives.length; pi++) {
            var primitive = primitives[pi];

            // Determine which vertex bundle this primitive uses.
            // Cocos Creator 2.4.x stores the bundle index in primitive.vertexBundelIndices[0].
            // Note: the engine property name contains a typo ('Bundel' instead of 'Bundle');
            // both spellings are checked here for forward-compatibility.
            var bundleIndex = 0;
            var bundelIndices = primitive.vertexBundelIndices || primitive.vertexBundleIndices;
            if (bundelIndices && bundelIndices.length > 0) {
                bundleIndex = bundelIndices[0];
            }

            var bundle = bundles[bundleIndex];
            if (!bundle || !bundle.view) {
                console.warn('[OBJExporter] Missing bundle or bundle.view for primitive ' + pi + ' of "' + meshName + '"');
                continue;
            }

            var view   = bundle.view;
            var stride = view.stride;
            var vbOff  = view.offset;
            var vbLen  = view.length;
            var count  = view.count != null ? view.count : Math.floor(vbLen / stride);

            // Find attribute byte-offsets within a single vertex
            var posOffset  = -1;
            var normOffset = -1;
            var uvOffset   = -1;

            var attrs = bundle.attributes || [];
            for (var ai = 0; ai < attrs.length; ai++) {
                var attr = attrs[ai];
                var attrOff = (attr.offset != null) ? attr.offset : 0;
                if (attr.name === 'a_position') posOffset  = attrOff;
                if (attr.name === 'a_normal')   normOffset = attrOff;
                if (attr.name === 'a_uv0')      uvOffset   = attrOff;
            }

            if (posOffset < 0) {
                console.warn('[OBJExporter] No a_position attribute in bundle ' + bundleIndex + ' of "' + meshName + '"');
                continue;
            }

            // --- Vertex positions ---
            for (var vi = 0; vi < count; vi++) {
                var base = vbOff + vi * stride + posOffset;
                var x = dataView.getFloat32(base,     true);
                var y = dataView.getFloat32(base + 4, true);
                var z = dataView.getFloat32(base + 8, true);
                lines.push('v ' + x.toFixed(6) + ' ' + y.toFixed(6) + ' ' + z.toFixed(6));
            }

            // --- Vertex normals ---
            if (normOffset >= 0) {
                for (var vi2 = 0; vi2 < count; vi2++) {
                    var nBase = vbOff + vi2 * stride + normOffset;
                    var nx = dataView.getFloat32(nBase,     true);
                    var ny = dataView.getFloat32(nBase + 4, true);
                    var nz = dataView.getFloat32(nBase + 8, true);
                    lines.push('vn ' + nx.toFixed(6) + ' ' + ny.toFixed(6) + ' ' + nz.toFixed(6));
                }
            }

            // --- Texture coordinates ---
            if (uvOffset >= 0) {
                for (var vi3 = 0; vi3 < count; vi3++) {
                    var uvBase = vbOff + vi3 * stride + uvOffset;
                    var u = dataView.getFloat32(uvBase,     true);
                    var v = dataView.getFloat32(uvBase + 4, true);
                    lines.push('vt ' + u.toFixed(6) + ' ' + v.toFixed(6));
                }
            }

            // --- Index / face data ---
            var indexView = primitive.indexView;
            if (!indexView) {
                console.warn('[OBJExporter] No indexView for primitive ' + pi + ' of "' + meshName + '"');
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
                    // Default: 16-bit indices
                    i0 = dataView.getUint16(ibOffset + (fi + 0) * 2, true);
                    i1 = dataView.getUint16(ibOffset + (fi + 1) * 2, true);
                    i2 = dataView.getUint16(ibOffset + (fi + 2) * 2, true);
                }

                // OBJ indices are 1-based; add the running global vertex offset
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
     * Attempt to trigger a browser download of a text file.
     * This may be blocked in ad-container (MRAID) environments — that is expected.
     * @param {string} filename
     * @param {string} text
     */
    function tryDownload(filename, text) {
        try {
            var blob = new Blob([text], { type: 'text/plain' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href     = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            console.log('[OBJExporter] Download triggered for ' + filename);
        } catch (e) {
            console.warn('[OBJExporter] Blob download failed (expected in MRAID):', e.message);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Internal mesh cache                                                 */
    /* ------------------------------------------------------------------ */

    /**
     * Build a map of { meshUUID -> { mesh, nodeName, renderer } } de-duplicating
     * instances that share the same mesh asset.
     * @returns {Object}
     */
    function buildMeshMap() {
        var renderers = getAllMeshRenderers();
        var meshMap   = {};    // keyed by mesh UUID (or fallback to node name)
        var nodeMap   = {};    // keyed by node name  -> meshUUID

        for (var i = 0; i < renderers.length; i++) {
            var renderer = renderers[i];
            var mesh     = getMesh(renderer);
            if (!mesh) continue;

            // Use the asset UUID if available, else a stringified reference
            var uuid = (mesh._uuid || mesh._id || String(mesh)) || ('mesh_' + i);

            if (!meshMap[uuid]) {
                meshMap[uuid] = {
                    mesh:      mesh,
                    nodeName:  renderer.node ? renderer.node.name : ('mesh_' + i),
                    renderer:  renderer,
                    uuid:      uuid
                };
            }

            var nodeName = renderer.node ? renderer.node.name : ('node_' + i);
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
     * Export every unique mesh in the scene to OBJ, logging each to the console
     * and attempting a Blob download as a secondary method.
     */
    function exportAllOBJ() {
        var data    = buildMeshMap();
        var uuids   = Object.keys(data.meshMap);
        var count   = 0;

        console.log('[OBJExporter] Found ' + uuids.length + ' unique mesh(es). Exporting…');

        for (var i = 0; i < uuids.length; i++) {
            var entry    = data.meshMap[uuids[i]];
            var objText  = meshToOBJ(entry.mesh, entry.nodeName);
            if (!objText) continue;

            count++;
            var filename = entry.nodeName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.obj';

            console.group('[OBJExporter] ' + filename + ' (' + objText.length + ' chars)');
            console.log(objText);
            console.groupEnd();

            tryDownload(filename, objText);
        }

        console.log('[OBJExporter] Done. Exported ' + count + ' mesh(es).');
    }

    /**
     * Export the mesh belonging to the first MeshRenderer whose node name matches.
     * @param {string} nodeName
     */
    function exportOBJ(nodeName) {
        var objText = getOBJ(nodeName);
        if (!objText) return;

        var filename = nodeName.replace(/[^a-zA-Z0-9_\-]/g, '_') + '.obj';

        console.group('[OBJExporter] ' + filename + ' (' + objText.length + ' chars)');
        console.log(objText);
        console.groupEnd();

        tryDownload(filename, objText);
    }

    /**
     * Return the OBJ string for the mesh on the named node (for programmatic use).
     * @param {string} nodeName
     * @returns {string|null}
     */
    function getOBJ(nodeName) {
        var renderers = getAllMeshRenderers();
        for (var i = 0; i < renderers.length; i++) {
            var renderer = renderers[i];
            if (!renderer.node || renderer.node.name !== nodeName) continue;

            var mesh = getMesh(renderer);
            if (!mesh) {
                console.warn('[OBJExporter] Node "' + nodeName + '" has no mesh.');
                return null;
            }
            return meshToOBJ(mesh, nodeName);
        }
        console.warn('[OBJExporter] No MeshRenderer found for node name "' + nodeName + '"');
        return null;
    }

    /**
     * Inspect and log material properties for every MeshRenderer in the scene.
     * Reads from mat._effect._passes[0]._properties (the confirmed 2.4.11 path).
     */
    function inspectMaterials() {
        var renderers = getAllMeshRenderers();
        console.log('[OBJExporter] Inspecting materials on ' + renderers.length + ' renderer(s)…');

        var seen = {};

        for (var i = 0; i < renderers.length; i++) {
            var renderer = renderers[i];
            var mat;

            if (typeof renderer.getMaterial === 'function') {
                mat = renderer.getMaterial(0);
            } else if (renderer._materials && renderer._materials.length > 0) {
                mat = renderer._materials[0];
            }

            if (!mat) continue;

            // De-duplicate by material UUID
            var matId = mat._uuid || mat._id || String(mat);
            if (seen[matId]) continue;
            seen[matId] = true;

            var matName = (renderer.node ? renderer.node.name : 'unknown') + '_mat';

            try {
                var passes = mat._effect && mat._effect._passes;
                if (!passes || passes.length === 0) {
                    console.warn('[OBJExporter] No _passes for material on "' + matName + '"');
                    continue;
                }

                var props = passes[0]._properties;
                console.group('[OBJExporter] Material: ' + matName + ' (' + matId + ')');
                if (props) {
                    var propKeys = Object.keys(props);
                    for (var pi = 0; pi < propKeys.length; pi++) {
                        var key = propKeys[pi];
                        var val = props[key];
                        // Pretty-print Float32Array / cc.Color / plain value
                        if (val instanceof Float32Array) {
                            console.log('  ' + key + ':', Array.from(val));
                        } else if (val && typeof val === 'object' && val.r !== undefined) {
                            console.log('  ' + key + ': rgba(' + val.r + ',' + val.g + ',' + val.b + ',' + val.a + ')');
                        } else {
                            console.log('  ' + key + ':', val);
                        }
                    }
                } else {
                    console.warn('  _properties not found on pass[0]');
                }
                console.groupEnd();
            } catch (e) {
                console.warn('[OBJExporter] Error inspecting material on "' + matName + '":', e.message);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Register on window                                                  */
    /* ------------------------------------------------------------------ */

    global.exportAllOBJ    = exportAllOBJ;
    global.exportOBJ       = exportOBJ;
    global.getOBJ          = getOBJ;
    global.inspectMaterials = inspectMaterials;

    console.log('%c[OBJExporter] Loaded! Available commands:', 'color:#4CAF50;font-weight:bold;');
    console.log('  window.exportAllOBJ()          — export all unique meshes');
    console.log('  window.exportOBJ("NodeName")   — export mesh by node name');
    console.log('  window.getOBJ("NodeName")      — return OBJ string');
    console.log('  window.inspectMaterials()      — log material properties');

}(window));
