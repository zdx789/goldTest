/**
 * tools/cocos_effect_dumper.js
 *
 * Cocos Creator 2.4.11 — browser-console shader/effect configuration dumper
 *
 * Paste the entire file into DevTools console while the Cocos game is running.
 *
 * Public API registered on `window`:
 *   window.dumpEffects()              — dump every unique effect/shader in the scene
 *   window.dumpEffect("P_Coin")       — dump the effect on the named node
 *   window.getEffectData("P_Coin")    — return a plain-object dump (no console output)
 *
 * Output covers (for each effect / pass):
 *   - Technique names and pass indices
 *   - All _properties with values, types, and associated define names
 *   - All active _defines (shader feature flags)
 *   - GLSL vertex + fragment shader source (if accessible via _vertShader / _fragShader)
 *
 * The shader of interest in this project is "SH_PhongUSE_ColorGrading".
 * Techniques: basic, transparent, outline-simple, outline-fancy, glow
 */

(function (global) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Scene helpers                                                        */
    /* ------------------------------------------------------------------ */

    function getAllMeshRenderers() {
        var scene = cc.director.getScene();
        if (!scene) {
            console.error('[EffectDumper] No active scene.');
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
    /*  Effect / pass introspection                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Attempt to read the GLSL source from a pass object.
     * The internal property names vary across engine versions.
     * @param {object} pass
     * @returns {{ vert: string|null, frag: string|null }}
     */
    function readShaderSource(pass) {
        var vert = null;
        var frag = null;

        // Try common internal property paths
        var program = pass._program || pass._shader || pass._glProgram || null;
        if (program) {
            vert = program._vertShader && (program._vertShader._source || program._vertShader._code) || null;
            frag = program._fragShader && (program._fragShader._source || program._fragShader._code) || null;
        }

        // Direct on pass
        if (!vert) vert = pass._vertShader || pass._vertSource || null;
        if (!frag) frag = pass._fragShader || pass._fragSource || null;

        return { vert: vert, frag: frag };
    }

    /**
     * Serialize a raw property value to a JSON-safe representation.
     * @param {*} val
     * @returns {*}
     */
    function serializeValue(val) {
        if (val instanceof Float32Array || val instanceof Float64Array ||
            val instanceof Int32Array   || val instanceof Uint32Array) {
            return Array.from(val);
        }
        if (val && typeof val === 'object') {
            if (val._name || val.url) {
                return { _type: 'texture', name: val._name || null, url: val.url || null };
            }
            if (val.r !== undefined) {
                return { _type: 'cc.Color', r: val.r, g: val.g, b: val.b, a: val.a };
            }
        }
        return val;
    }

    /**
     * Dump the full configuration of a single effect object.
     * @param {object} effect   — mat._effect
     * @param {string} label    — display name
     * @returns {object}        — structured dump
     */
    function dumpEffectObject(effect, label) {
        var result = {
            label:      label,
            effectName: effect._name || effect.name || '(unnamed)',
            techniques:  []
        };

        // Techniques array (may not be present in runtime effect wrappers)
        var techniques = effect._techniques || [];

        // If no techniques array, treat each pass as if it belongs to a single unnamed technique
        if (!techniques.length && effect._passes) {
            techniques = [{ name: 'default', passes: effect._passes }];
        }

        for (var ti = 0; ti < techniques.length; ti++) {
            var tech       = techniques[ti];
            var techName   = tech.name || ('technique_' + ti);
            var passes     = tech.passes || tech._passes || [];

            var techDump   = { name: techName, passes: [] };

            for (var pi = 0; pi < passes.length; pi++) {
                var pass    = passes[pi];
                var rawProps  = pass._properties || {};
                var rawDefs   = pass._defines    || {};

                var propsDump = {};
                Object.keys(rawProps).forEach(function (key) {
                    var entry  = rawProps[key];
                    var rawVal = (entry && entry.value !== undefined) ? entry.value : entry;
                    propsDump[key] = {
                        value:   serializeValue(rawVal),
                        type:    (entry && entry.type  !== undefined) ? entry.type    : null,
                        defines: (entry && entry.defines)             ? entry.defines : []
                    };
                });

                var defsDump = {};
                Object.keys(rawDefs).forEach(function (k) {
                    defsDump[k] = rawDefs[k];
                });

                var shaderSrc = readShaderSource(pass);

                var passDump = {
                    passIndex:  pi,
                    properties: propsDump,
                    defines:    defsDump
                };

                if (shaderSrc.vert) passDump.vertShaderSource = shaderSrc.vert;
                if (shaderSrc.frag) passDump.fragShaderSource = shaderSrc.frag;

                techDump.passes.push(passDump);
            }

            result.techniques.push(techDump);
        }

        // Also capture any top-level _defines on the effect itself
        if (effect._defines && Object.keys(effect._defines).length > 0) {
            result.topLevelDefines = {};
            Object.keys(effect._defines).forEach(function (k) {
                result.topLevelDefines[k] = effect._defines[k];
            });
        }

        return result;
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Return a plain-object dump of the effect on the named node (no console output).
     * @param {string} nodeName
     * @returns {object|null}
     */
    function getEffectData(nodeName) {
        var renderers = getAllMeshRenderers();
        for (var i = 0; i < renderers.length; i++) {
            var r = renderers[i];
            if (!r.node || r.node.name !== nodeName) continue;

            var mat = (typeof r.getMaterial === 'function') ? r.getMaterial(0)
                    : (r._materials && r._materials[0]) || null;
            if (!mat || !mat._effect) return null;

            return dumpEffectObject(mat._effect, nodeName);
        }
        return null;
    }

    /**
     * Log the effect configuration for the named node.
     * @param {string} nodeName
     */
    function dumpEffect(nodeName) {
        var data = getEffectData(nodeName);
        if (!data) {
            console.warn('[EffectDumper] No effect found for node "' + nodeName + '"');
            return;
        }
        console.group('[EffectDumper] Effect on "' + nodeName + '" — ' + data.effectName);
        console.log(JSON.stringify(data, null, 2));
        console.groupEnd();
    }

    /**
     * Dump every unique effect encountered across all MeshRenderers.
     * De-duplicates by effect name so the same shader is only printed once.
     */
    function dumpEffects() {
        var renderers = getAllMeshRenderers();
        console.log('[EffectDumper] Scanning ' + renderers.length + ' renderer(s)…');

        var seenMatIds  = {};
        var count       = 0;

        for (var i = 0; i < renderers.length; i++) {
            var renderer = renderers[i];
            var mat      = (typeof renderer.getMaterial === 'function')
                           ? renderer.getMaterial(0)
                           : (renderer._materials && renderer._materials[0]) || null;
            if (!mat || !mat._effect) continue;

            var matId = mat._uuid || mat._id || String(mat);
            if (seenMatIds[matId]) continue;
            seenMatIds[matId] = true;

            var nodeName = renderer.node ? renderer.node.name : ('node_' + i);
            var data     = dumpEffectObject(mat._effect, nodeName);

            console.group('[EffectDumper] "' + data.effectName + '" (from node: ' + nodeName + ')');
            console.log(JSON.stringify(data, null, 2));
            console.groupEnd();
            count++;
        }

        console.log('[EffectDumper] Done — ' + count + ' unique effect(s) dumped.');
    }

    /* ------------------------------------------------------------------ */
    /*  Register on window                                                  */
    /* ------------------------------------------------------------------ */

    global.dumpEffects   = dumpEffects;
    global.dumpEffect    = dumpEffect;
    global.getEffectData = getEffectData;

    console.log('%c[EffectDumper] Ready!', 'color:#FF9800;font-weight:bold;');
    console.log('  window.dumpEffects()             — dump all unique effects');
    console.log('  window.dumpEffect("P_Coin")      — dump effect for a node');
    console.log('  window.getEffectData("P_Coin")   — return plain-object dump');

}(window));
