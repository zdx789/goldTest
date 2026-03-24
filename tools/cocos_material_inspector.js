/**
 * tools/cocos_material_inspector.js
 *
 * Cocos Creator 2.4.11 — browser-console material property inspector
 *
 * Paste the entire file into DevTools console while the Cocos game is running.
 *
 * Public API registered on `window`:
 *   window.inspectMaterials()          — log all unique materials in the scene
 *   window.inspectMaterial("P_Coin")   — log the material on the named node
 *   window.getMaterialData("P_Coin")   — return a plain-object summary
 *
 * Key 2.4.11 findings:
 *   mat._props                            — ALWAYS undefined in MaterialVariant
 *   mat._effect._passes[0]._properties   — the actual property dictionary ✓
 *   mat._effect._passes[0]._defines      — active shader feature flags ✓
 *
 * Property value types:
 *   Float32Array(4) → RGBA colour  (converted to #RRGGBBAA hex)
 *   Float32Array(2) → vec2         (e.g. tiling / offset / scroll)
 *   Float32Array(1) → scalar float
 *   number          → scalar float
 *   object w/ name  → texture      (name + url printed)
 *   other object    → JSON-stringified
 */

(function (global) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Scene helpers                                                        */
    /* ------------------------------------------------------------------ */

    function getAllMeshRenderers() {
        var scene = cc.director.getScene();
        if (!scene) {
            console.error('[MatInspector] No active scene.');
            return [];
        }
        return scene.getComponentsInChildren(cc.MeshRenderer) || [];
    }

    function getMaterialFromRenderer(renderer) {
        if (typeof renderer.getMaterial === 'function') {
            return renderer.getMaterial(0);
        }
        return (renderer._materials && renderer._materials[0]) || null;
    }

    /* ------------------------------------------------------------------ */
    /*  Value formatters                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Convert a 0-1 float to a two-digit hex string.
     * @param {number} f
     * @returns {string}
     */
    function floatToHex(f) {
        var byte = Math.round(Math.max(0, Math.min(1, f)) * 255);
        return ('0' + byte.toString(16)).slice(-2);
    }

    /**
     * Format a material property value into a human-readable string.
     * @param {string} key   property name
     * @param {*}      val   raw value from _properties
     * @returns {string}
     */
    function formatValue(key, val) {
        if (val instanceof Float32Array) {
            if (val.length === 4) {
                // RGBA colour — convert to hex
                var hex = '#' + floatToHex(val[0]) + floatToHex(val[1])
                               + floatToHex(val[2]) + floatToHex(val[3]);
                return 'color ' + hex + '  [' + Array.from(val).map(function (n) {
                    return n.toFixed(3);
                }).join(', ') + ']';
            }
            if (val.length === 2) {
                return 'vec2  [' + val[0].toFixed(4) + ', ' + val[1].toFixed(4) + ']';
            }
            if (val.length === 1) {
                return 'float ' + val[0].toFixed(6);
            }
            return 'Float32Array(' + val.length + ') [' + Array.from(val).join(', ') + ']';
        }

        if (typeof val === 'number') {
            // Label common scalar properties meaningfully
            var scalarLabel = {
                glossiness:         'glossiness (0=rough, 1=shiny)',
                roughness:          'roughness (0=shiny, 1=rough)',
                metallic:           'metallic',
                fresnelPower:       'fresnelPower',
                depthTintBorderStart: 'depthTintBorderStart',
                depthTintBorderEnd:   'depthTintBorderEnd',
                distanceFogStart:   'distanceFogStart',
                distanceFogEnd:     'distanceFogEnd'
            }[key] || 'float';
            return scalarLabel + ' = ' + val;
        }

        if (val && typeof val === 'object') {
            // Texture objects have a _name or url property
            if (val._name || val.url) {
                return 'texture "' + (val._name || val.url) + '"';
            }
            // cc.Color-like
            if (val.r !== undefined) {
                return 'cc.Color rgba(' + val.r + ', ' + val.g + ', ' + val.b + ', ' + val.a + ')';
            }
            try {
                return JSON.stringify(val);
            } catch (e) {
                return String(val);
            }
        }

        return String(val);
    }

    /* ------------------------------------------------------------------ */
    /*  Core inspector                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * Extract a plain-object summary of a material's properties and defines.
     * @param {object} mat     — MaterialVariant (from getMaterial(0))
     * @param {string} label   — display name
     * @returns {{ label, matId, properties, defines }|null}
     */
    function extractMaterialData(mat, label) {
        if (!mat) return null;

        var matId = mat._uuid || mat._id || String(mat);

        var passes = mat._effect && mat._effect._passes;
        if (!passes || passes.length === 0) {
            console.warn('[MatInspector] No _passes on material "' + label + '"');
            return null;
        }

        var pass       = passes[0];
        var rawProps   = pass._properties || {};
        var rawDefines = pass._defines    || {};

        var properties = {};
        Object.keys(rawProps).forEach(function (key) {
            var entry = rawProps[key];
            // Each entry may be { value, defines, name, type } or a raw value
            var rawVal = (entry && entry.value !== undefined) ? entry.value : entry;
            properties[key] = {
                formatted: formatValue(key, rawVal),
                raw:       rawVal
            };
        });

        var defines = {};
        Object.keys(rawDefines).forEach(function (k) {
            defines[k] = rawDefines[k];
        });

        return { label: label, matId: matId, properties: properties, defines: defines };
    }

    /**
     * Print a material summary to the DevTools console.
     * @param {{ label, matId, properties, defines }} data
     */
    function logMaterialData(data) {
        if (!data) return;

        console.group('[MatInspector] Material: ' + data.label + '  (' + data.matId + ')');

        var propKeys = Object.keys(data.properties);
        if (propKeys.length > 0) {
            console.group('Properties (' + propKeys.length + ')');
            propKeys.forEach(function (key) {
                console.log('  ' + key + ':  ' + data.properties[key].formatted);
            });
            console.groupEnd();
        } else {
            console.log('  (no properties found)');
        }

        var defKeys = Object.keys(data.defines);
        if (defKeys.length > 0) {
            console.group('Shader Defines (' + defKeys.length + ')');
            defKeys.forEach(function (key) {
                console.log('  ' + key + ': ' + data.defines[key]);
            });
            console.groupEnd();
        }

        console.groupEnd();
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Log all unique materials found across every MeshRenderer in the scene.
     */
    function inspectMaterials() {
        var renderers = getAllMeshRenderers();
        console.log('[MatInspector] Inspecting ' + renderers.length + ' renderer(s)…');

        var seen = {};
        var count = 0;

        for (var i = 0; i < renderers.length; i++) {
            var renderer = renderers[i];
            var mat      = getMaterialFromRenderer(renderer);
            if (!mat) continue;

            var matId = mat._uuid || mat._id || String(mat);
            if (seen[matId]) continue;
            seen[matId] = true;

            var nodeName = renderer.node ? renderer.node.name : ('node_' + i);
            var data     = extractMaterialData(mat, nodeName);
            logMaterialData(data);
            count++;
        }

        console.log('[MatInspector] Done — ' + count + ' unique material(s) logged.');
    }

    /**
     * Log material properties for the first MeshRenderer matching nodeName.
     * @param {string} nodeName
     */
    function inspectMaterial(nodeName) {
        var renderers = getAllMeshRenderers();
        for (var i = 0; i < renderers.length; i++) {
            var r = renderers[i];
            if (!r.node || r.node.name !== nodeName) continue;
            var mat = getMaterialFromRenderer(r);
            if (!mat) {
                console.warn('[MatInspector] Node "' + nodeName + '" has no material.');
                return;
            }
            logMaterialData(extractMaterialData(mat, nodeName));
            return;
        }
        console.warn('[MatInspector] No MeshRenderer found for node "' + nodeName + '"');
    }

    /**
     * Return a plain-object summary (no console output) for programmatic use.
     * @param {string} nodeName
     * @returns {object|null}
     */
    function getMaterialData(nodeName) {
        var renderers = getAllMeshRenderers();
        for (var i = 0; i < renderers.length; i++) {
            var r = renderers[i];
            if (!r.node || r.node.name !== nodeName) continue;
            var mat = getMaterialFromRenderer(r);
            return mat ? extractMaterialData(mat, nodeName) : null;
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Register on window                                                  */
    /* ------------------------------------------------------------------ */

    global.inspectMaterials = inspectMaterials;
    global.inspectMaterial  = inspectMaterial;
    global.getMaterialData  = getMaterialData;

    console.log('%c[MatInspector] Ready!', 'color:#2196F3;font-weight:bold;');
    console.log('  window.inspectMaterials()         — log all unique materials');
    console.log('  window.inspectMaterial("P_Coin")  — log material for a node');
    console.log('  window.getMaterialData("P_Coin")  — return plain-object summary');

}(window));
