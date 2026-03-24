/**
 * tools/cocos_light_debugger.js
 *
 * Cocos Creator 2.4.11 — browser-console light direction visualizer
 *
 * Paste the entire file into DevTools console while the Cocos game is running.
 *
 * Creates a native HTML5 canvas overlay on top of the Cocos game canvas and
 * draws a real-time diagram showing the directional light's forward vector.
 *
 * The light node in this project is named "Shadow" (it carries both a
 * cc.Light component and a MeshRenderer for the shadow decal).
 *
 * Public API:
 *   window.startLightDebug()   — start the overlay (called automatically on load)
 *   window.stopLightDebug()    — remove the overlay and cancel the animation loop
 *
 * How it works:
 *   1. Finds the node with a cc.Light component.
 *   2. Each frame: reads lightNode.getWorldRotation(quat), then transforms
 *      the canonical forward vector (0, 0, -1) by the quaternion to get the
 *      world-space light direction.
 *   3. Projects the 3-D direction onto the XZ plane for the overhead view
 *      and onto the XY plane for the side elevation view.
 *   4. Draws both views on an HTML canvas positioned over the game.
 */

(function (global) {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Constants                                                           */
    /* ------------------------------------------------------------------ */

    var CANVAS_W  = 320;
    var CANVAS_H  = 200;
    var PANEL_GAP = 10;   // px gap between the two mini-views
    var VIEW_R    = 70;   // radius of each compass/elevation circle

    /* ------------------------------------------------------------------ */
    /*  State                                                               */
    /* ------------------------------------------------------------------ */

    var _overlayCanvas  = null;
    var _animFrameId    = null;
    var _lightNode      = null;

    /* ------------------------------------------------------------------ */
    /*  Find light node                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Walk the scene tree and return the first node that has a cc.Light component.
     * @returns {cc.Node|null}
     */
    function findLightNode() {
        var scene = cc.director.getScene();
        if (!scene) return null;

        // Try the known node name first for speed
        var byName = scene.getChildByName('World');
        if (byName) {
            var board = byName.getChildByName('P_Board');
            if (board) {
                var holder = board.getChildByName('Holder');
                if (holder) {
                    var shadow = holder.getChildByName('Shadow');
                    if (shadow && shadow.getComponent(cc.Light)) {
                        return shadow;
                    }
                }
            }
        }

        // Fallback: search all nodes for the cc.Light component
        var lights = scene.getComponentsInChildren(cc.Light);
        if (lights && lights.length > 0) {
            return lights[0].node;
        }

        return null;
    }

    /* ------------------------------------------------------------------ */
    /*  Quaternion → forward vector                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Transform the forward vector (0, 0, -1) by a world-space quaternion.
     * Returns { x, y, z } (unit vector pointing in the light's forward direction).
     * @param {cc.Quat} q
     * @returns {{ x: number, y: number, z: number }}
     */
    function quatToForward(q) {
        // Rodrigues' rotation: v' = q * (0,0,-1) * q^-1
        // Expanded for v = (0, 0, -1):
        //   x =  2*(qx*qz - qw*qy) * -1  ... simplified below
        var qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        // Standard formula: forward = rotate( (0,0,-1), q )
        var fx = 2 * (qx * qz + qw * qy);        // note: sign for -Z forward
        var fy = 2 * (qy * qz - qw * qx);
        var fz = 1 - 2 * (qx * qx + qy * qy);
        // Negate because we want -Z direction
        fx = -fx; fy = -fy; fz = -fz;

        var len = Math.sqrt(fx * fx + fy * fy + fz * fz);
        if (len > 0.0001) { fx /= len; fy /= len; fz /= len; }
        return { x: fx, y: fy, z: fz };
    }

    /* ------------------------------------------------------------------ */
    /*  Drawing helpers                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * Draw one compass-style view (top-down XZ) or elevation view (XY).
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx        centre x on the canvas
     * @param {number} cy        centre y on the canvas
     * @param {number} r         radius
     * @param {number} dx        direction component mapped to +X on canvas
     * @param {number} dy        direction component mapped to -Y on canvas (up)
     * @param {string} labelText view label drawn below the circle
     */
    function drawCompass(ctx, cx, cy, r, dx, dy, labelText) {
        // Circle background
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Crosshair
        ctx.strokeStyle = '#3399FF';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
        ctx.stroke();

        // Light ray line (world origin → direction)
        var ex = cx + dx * r * 0.9;
        var ey = cy - dy * r * 0.9; // canvas Y is inverted

        ctx.strokeStyle = '#FF4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Arrowhead
        var angle = Math.atan2(ey - cy, ex - cx);
        var aLen  = 10;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - aLen * Math.cos(angle - 0.4), ey - aLen * Math.sin(angle - 0.4));
        ctx.lineTo(ex - aLen * Math.cos(angle + 0.4), ey - aLen * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = '#FF4444';
        ctx.fill();

        // Sun circle (light source is considered at the opposite end)
        var sx = cx - dx * r * 0.7;
        var sy = cy + dy * r * 0.7;
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD700';
        ctx.fill();

        // Label
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labelText, cx, cy + r + 14);
    }

    /* ------------------------------------------------------------------ */
    /*  Overlay canvas                                                       */
    /* ------------------------------------------------------------------ */

    function createOverlay() {
        var canvas = document.createElement('canvas');
        canvas.id     = '__lightDebugOverlay__';
        canvas.width  = CANVAS_W;
        canvas.height = CANVAS_H;

        Object.assign(canvas.style, {
            position:      'fixed',
            top:           '10px',
            left:          '10px',
            zIndex:        '99999',
            pointerEvents: 'none',
            borderRadius:  '6px',
            border:        '1px solid #444'
        });

        document.body.appendChild(canvas);
        return canvas;
    }

    function drawFrame() {
        if (!_overlayCanvas) return;
        var ctx = _overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // Header background
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, CANVAS_W, 20);
        ctx.fillStyle = '#FFEE58';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('光源方向调试  Light Direction Debug', 6, 14);

        if (!_lightNode || !_lightNode.isValid) {
            _lightNode = findLightNode();
            if (!_lightNode) {
                ctx.fillStyle = '#FF6666';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('未找到光源节点 (cc.Light)', CANVAS_W / 2, CANVAS_H / 2);
                return;
            }
        }

        // Get world-space forward direction
        var quat = _lightNode.getWorldRotation ? _lightNode.getWorldRotation(new cc.Quat())
                                               : _lightNode.getWorldQuat(new cc.Quat());
        var fwd  = quatToForward(quat);

        // Euler angles for display
        var ea = _lightNode.eulerAngles || { x: 0, y: 0, z: 0 };

        // --- Top-down view (XZ plane, Y is "into screen") ---
        // Map: world X → canvas X,  world -Z → canvas Y (up)
        var topDownCenterX = PANEL_GAP + VIEW_R + 5;
        var topDownCenterY = 30 + VIEW_R;
        drawCompass(ctx, topDownCenterX, topDownCenterY, VIEW_R, fwd.x, -fwd.z, '俯视图 (XZ)');

        // --- Elevation view (XY plane, Z ignored) ---
        var elevationCenterX = PANEL_GAP * 2 + VIEW_R * 2 + VIEW_R + 15;
        var elevationCenterY = 30 + VIEW_R;
        drawCompass(ctx, elevationCenterX, elevationCenterY, VIEW_R, fwd.x, fwd.y, '侧视图 (XY)');

        // Numeric readout
        var readY = CANVAS_H - 30;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, readY - 14, CANVAS_W, 40);

        ctx.fillStyle = '#CCCCCC';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(
            'Dir  X:' + fwd.x.toFixed(3) +
            '  Y:' + fwd.y.toFixed(3) +
            '  Z:' + fwd.z.toFixed(3),
            6, readY
        );
        ctx.fillText(
            'Euler X:' + ea.x.toFixed(1) +
            '°  Y:' + ea.y.toFixed(1) +
            '°  Z:' + ea.z.toFixed(1) + '°',
            6, readY + 14
        );
    }

    function loop() {
        drawFrame();
        _animFrameId = requestAnimationFrame(loop);
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                          */
    /* ------------------------------------------------------------------ */

    function startLightDebug() {
        // Remove any previous instance
        stopLightDebug();

        _lightNode = findLightNode();
        if (!_lightNode) {
            console.warn('[LightDebug] cc.Light node not found — will retry each frame.');
        }

        _overlayCanvas = createOverlay();
        loop();
        console.log('%c[LightDebug] Overlay started. Call window.stopLightDebug() to remove it.',
            'color:#FFEE58;font-weight:bold;');
    }

    function stopLightDebug() {
        if (_animFrameId !== null) {
            cancelAnimationFrame(_animFrameId);
            _animFrameId = null;
        }
        if (_overlayCanvas && _overlayCanvas.parentNode) {
            _overlayCanvas.parentNode.removeChild(_overlayCanvas);
        }
        _overlayCanvas = null;
        console.log('[LightDebug] Overlay removed.');
    }

    /* ------------------------------------------------------------------ */
    /*  Register on window and auto-start                                   */
    /* ------------------------------------------------------------------ */

    global.startLightDebug = startLightDebug;
    global.stopLightDebug  = stopLightDebug;

    startLightDebug();

}(window));
