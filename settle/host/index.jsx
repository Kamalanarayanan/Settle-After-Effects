/*
 * Settle - host layer
 * Crit Studio
 *
 * ExtendScript is ES3. No JSON, no Array.forEach, no let/const, no arrow
 * functions. Everything below is written to that floor deliberately so the
 * panel loads on After Effects CC 2019 as well as 2026.
 *
 * Every entry point returns a JSON string shaped { ok: bool, ... }. The client
 * never has to guess whether a call threw.
 */

// ---------------------------------------------------------------- serialising

function stEscape(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i);
        var code = s.charCodeAt(i);
        if (c === '"') out += '\\"';
        else if (c === '\\') out += '\\\\';
        else if (c === '\n') out += '\\n';
        else if (c === '\r') out += '\\r';
        else if (c === '\t') out += '\\t';
        else if (code < 32 || code > 126) {
            var h = code.toString(16);
            while (h.length < 4) h = '0' + h;
            out += '\\u' + h;
        } else out += c;
    }
    return out;
}

/*
 * Duck-typed rather than `instanceof Array`. After Effects hands back array
 * values that can originate outside this script's scope, and instanceof
 * compares constructors, so it can answer false for a real array. When that
 * happened during testing the decimator silently collapsed a 145 key bounce to
 * 2 keys and reported zero error, which is worse than crashing.
 */
function stIsArr(v) {
    return v !== null && v !== undefined &&
           typeof v === 'object' && typeof v.length === 'number';
}

function stJSON(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return '"' + stEscape(v) + '"';
    if (stIsArr(v)) {
        var a = [];
        for (var i = 0; i < v.length; i++) a.push(stJSON(v[i]));
        return '[' + a.join(',') + ']';
    }
    var o = [];
    for (var k in v) {
        if (v.hasOwnProperty(k)) o.push('"' + stEscape(k) + '":' + stJSON(v[k]));
    }
    return '{' + o.join(',') + '}';
}

function stFail(msg) {
    return stJSON({ ok: false, error: String(msg) });
}

function stRound(n, dp) {
    var f = Math.pow(10, dp || 2);
    return Math.round(n * f) / f;
}

// ------------------------------------------------------------------- helpers

function stActiveComp() {
    var it = app.project ? app.project.activeItem : null;
    if (!it || !(it instanceof CompItem)) return null;
    return it;
}

function stIsSimulatable(layer) {
    if (layer instanceof CameraLayer) return false;
    if (layer instanceof LightLayer) return false;
    return true;
}

function stTransform(layer) {
    return layer.property('ADBE Transform Group');
}

function stToArray(v) {
    if (stIsArr(v)) return v;
    return [v];
}

// --------------------------------------------------------------- comp facts
// Returns raw measurements only. Every derived number (world scale, gravity,
// substeps, strobe threshold) is computed client side so sliders stay instant.

function settleComp() {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition and select it in the Project or Timeline panel.');

        var sel = comp.selectedLayers;
        var markerCount = 0;
        try { markerCount = comp.markerProperty.numKeys; } catch (e) { markerCount = -1; }

        return stJSON({
            ok: true,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            pixelAspect: stRound(comp.pixelAspect, 4),
            frameRate: stRound(comp.frameRate, 4),
            frameDuration: comp.frameDuration,
            duration: stRound(comp.duration, 4),
            workAreaStart: stRound(comp.workAreaStart, 4),
            workAreaDuration: stRound(comp.workAreaDuration, 4),
            motionBlur: comp.motionBlur === true,
            shutterAngle: comp.shutterAngle,
            shutterPhase: comp.shutterPhase,
            layerCount: comp.numLayers,
            selectedCount: sel.length,
            markerCount: markerCount,
            aeVersion: app.version
        });
    } catch (err) {
        return stFail(err.toString());
    }
}

// -------------------------------------------------------------- layer audit
// scope: "selected" or "all". Reports the five things that reliably wreck a
// physics bake, in the order they bite you.

function settleAudit(scope) {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');

        var pool = [];
        var i;
        if (scope === 'selected' && comp.selectedLayers.length > 0) {
            var sl = comp.selectedLayers;
            for (i = 0; i < sl.length; i++) pool.push(sl[i]);
        } else {
            for (i = 1; i <= comp.numLayers; i++) pool.push(comp.layer(i));
        }

        var rows = [];
        var t = comp.time;

        for (i = 0; i < pool.length; i++) {
            var L = pool[i];
            var row = {
                index: L.index,
                name: L.name,
                kind: 'layer',
                enabled: L.enabled === true,
                blocked: null,
                width: null,
                height: null,
                anchorOffset: null,
                posKeys: 0,
                rotKeys: 0,
                hasExpression: false,
                separated: false,
                shapeGroups: null,
                charCount: null,
                note: null
            };

            if (!stIsSimulatable(L)) {
                row.kind = (L instanceof CameraLayer) ? 'camera' : 'light';
                row.blocked = 'Cameras and lights cannot be bodies.';
                rows.push(row);
                continue;
            }

            if (L.threeDLayer === true) {
                row.blocked = '3D layer. A 2D solver cannot use it. Switch off the 3D toggle.';
            }
            if (L.enabled !== true) {
                row.note = 'Video is off, so most solvers will skip this layer.';
            }

            // Bounds. sourceRectAtTime is the honest source of a body's size.
            try {
                var r = L.sourceRectAtTime(t, false);
                row.width = stRound(r.width, 2);
                row.height = stRound(r.height, 2);

                // Anchor point against the rect centroid. Physics rotates about
                // centre of mass; AE rotates about the anchor point. When those
                // disagree the sim looks wrong in a way nobody can diagnose.
                var ap = stTransform(L).property('ADBE Anchor Point').value;
                var cx = r.left + r.width / 2;
                var cy = r.top + r.height / 2;
                var dx = ap[0] - cx;
                var dy = ap[1] - cy;
                row.anchorOffset = stRound(Math.sqrt(dx * dx + dy * dy), 1);
            } catch (e1) {
                row.note = 'No measurable bounds at the current time.';
            }

            // Existing animation. A bake destroys this, so it gets flagged loud.
            try {
                var pos = stTransform(L).property('ADBE Position');
                row.posKeys = pos.numKeys;
                row.separated = pos.dimensionsSeparated === true;
                if (pos.expressionEnabled === true) row.hasExpression = true;
            } catch (e2) {}

            try {
                var rot = stTransform(L).property('ADBE Rotate Z');
                row.rotKeys = rot.numKeys;
                if (rot.expressionEnabled === true) row.hasExpression = true;
            } catch (e3) {}

            if (L instanceof ShapeLayer) {
                row.kind = 'shape';
                try {
                    row.shapeGroups = L.property('ADBE Root Vectors Group').numProperties;
                } catch (e4) {}
            } else if (L instanceof TextLayer) {
                row.kind = 'text';
                try {
                    var td = L.property('ADBE Text Properties').property('ADBE Text Document').value;
                    var txt = td.text.replace(/\s/g, '');
                    row.charCount = txt.length;
                } catch (e5) {}
            }

            rows.push(row);
        }

        return stJSON({ ok: true, scope: scope, rows: rows });
    } catch (err) {
        return stFail(err.toString());
    }
}

// --------------------------------------------------------------- decimation
// Generalised Ramer-Douglas-Peucker over (time, value) samples. Error is
// measured against straight-line interpolation and is guaranteed to stay at or
// under the tolerance the user set, in pixels or degrees.

function stLerp(a, b, u) {
    var out = [];
    for (var i = 0; i < a.length; i++) out.push(a[i] + (b[i] - a[i]) * u);
    return out;
}

function stDist(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
    return Math.sqrt(s);
}

function stSimplify(times, values, tol) {
    var n = times.length;
    if (n < 3) {
        var all = [];
        for (var z = 0; z < n; z++) all.push(z);
        return all;
    }

    var keep = {};
    keep[0] = true;
    keep[n - 1] = true;

    var stack = [[0, n - 1]];
    while (stack.length > 0) {
        var seg = stack.pop();
        var i = seg[0], j = seg[1];
        if (j - i < 2) continue;

        var t0 = times[i], span = times[j] - t0;
        var worst = -1, worstIdx = -1;
        for (var k = i + 1; k < j; k++) {
            var u = (span === 0) ? 0 : (times[k] - t0) / span;
            var d = stDist(values[k], stLerp(values[i], values[j], u));
            if (d > worst) { worst = d; worstIdx = k; }
        }

        if (worst > tol && worstIdx > -1) {
            keep[worstIdx] = true;
            stack.push([i, worstIdx]);
            stack.push([worstIdx, j]);
        }
    }

    var out = [];
    for (var m = 0; m < n; m++) if (keep[m]) out.push(m);
    return out;
}

function stMaxError(times, values, kept) {
    var maxE = 0;
    for (var s = 0; s < kept.length - 1; s++) {
        var i = kept[s], j = kept[s + 1];
        var t0 = times[i], span = times[j] - t0;
        for (var k = i + 1; k < j; k++) {
            var u = (span === 0) ? 0 : (times[k] - t0) / span;
            var d = stDist(values[k], stLerp(values[i], values[j], u));
            if (d > maxE) maxE = d;
        }
    }
    return maxE;
}

function stReduceProperty(prop, comp, tol, smooth) {
    var result = { before: 0, after: 0, error: 0, skipped: null };

    if (!prop || !prop.canVaryOverTime) { result.skipped = 'not animatable'; return result; }
    if (prop.expressionEnabled === true) { result.skipped = 'has an expression'; return result; }
    if (prop.dimensionsSeparated === true) { result.skipped = 'dimensions are separated'; return result; }

    var n = prop.numKeys;
    result.before = n;
    if (n < 4) { result.skipped = 'fewer than 4 keys'; result.after = n; return result; }

    var t0 = prop.keyTime(1);
    var t1 = prop.keyTime(n);
    var fd = comp.frameDuration;
    var frames = Math.round((t1 - t0) / fd);
    if (frames < 3) { result.skipped = 'shorter than 3 frames'; result.after = n; return result; }

    // Sample on frame centres across the animated range.
    var times = [], values = [], f, tv;
    var isArray = stIsArr(prop.value);
    for (f = 0; f <= frames; f++) {
        tv = t0 + f * fd;
        if (tv > t1) tv = t1;
        times.push(tv);
        values.push(stToArray(prop.valueAtTime(tv, false)));
    }

    var kept = stSimplify(times, values, tol);
    result.error = stRound(stMaxError(times, values, kept), 3);
    result.after = kept.length;

    if (kept.length >= n) { result.skipped = 'already at or below the tolerance'; return result; }

    var newTimes = [], newVals = [], q;
    for (q = 0; q < kept.length; q++) {
        newTimes.push(times[kept[q]]);
        newVals.push(isArray ? values[kept[q]] : values[kept[q]][0]);
    }

    // Clear then rewrite. Remove backwards so indices stay valid.
    for (var d = prop.numKeys; d >= 1; d--) prop.removeKey(d);
    prop.setValuesAtTimes(newTimes, newVals);

    var kt = smooth ? KeyframeInterpolationType.BEZIER : KeyframeInterpolationType.LINEAR;
    for (var m = 1; m <= prop.numKeys; m++) {
        try {
            prop.setInterpolationTypeAtKey(m, kt, kt);
            if (smooth) prop.setTemporalAutoBezierAtKey(m, true);
        } catch (e) {}
    }

    return result;
}

function settleReduce(optsJson) {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');

        var sel = comp.selectedLayers;
        if (sel.length === 0) return stFail('Select the layers you want to reduce.');

        // eval is the ES3-friendly way in; the payload is written by this panel.
        var opts = eval('(' + optsJson + ')');
        var tol = Number(opts.tolerance) || 1;
        var smooth = opts.smooth === true;

        var targets = [];
        if (opts.position !== false) targets.push('ADBE Position');
        if (opts.rotation !== false) targets.push('ADBE Rotate Z');
        if (opts.scale === true) targets.push('ADBE Scale');
        if (targets.length === 0) return stFail('Choose at least one property to reduce.');

        var report = [];
        var totalBefore = 0, totalAfter = 0, worstError = 0;

        app.beginUndoGroup('Settle: reduce keyframes');
        try {
            for (var i = 0; i < sel.length; i++) {
                var L = sel[i];
                if (!stIsSimulatable(L)) continue;

                for (var p = 0; p < targets.length; p++) {
                    var prop = null;
                    try { prop = stTransform(L).property(targets[p]); } catch (e) { prop = null; }
                    if (!prop) continue;
                    if (prop.numKeys === 0) continue;

                    var r = stReduceProperty(prop, comp, tol, smooth);
                    totalBefore += r.before;
                    totalAfter += r.after;
                    if (r.error > worstError) worstError = r.error;

                    report.push({
                        layer: L.name,
                        property: targets[p] === 'ADBE Position' ? 'Position'
                                : targets[p] === 'ADBE Rotate Z' ? 'Rotation' : 'Scale',
                        before: r.before,
                        after: r.after,
                        error: r.error,
                        skipped: r.skipped
                    });
                }
            }
        } finally {
            app.endUndoGroup();
        }

        return stJSON({
            ok: true,
            report: report,
            totalBefore: totalBefore,
            totalAfter: totalAfter,
            worstError: stRound(worstError, 3),
            smooth: smooth
        });
    } catch (err) {
        // The inner finally already closed the group in the normal path. If we
        // land here before it opened, closing again throws and buries the real
        // error, which is the one worth reporting.
        try { app.endUndoGroup(); } catch (e) {}
        return stFail(err.toString());
    }
}

// ------------------------------------------------------- persist to the comp
// The settings live in a comp marker at time 0, so they survive a save, travel
// with the .aep, and cost the project nothing visible.

function settleSaveSetup(jsonStr) {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');

        app.beginUndoGroup('Settle: save setup to comp');
        try {
            var mp = comp.markerProperty;
            for (var i = mp.numKeys; i >= 1; i--) {
                if (mp.keyValue(i).comment.indexOf('SETTLE:') === 0) mp.removeKey(i);
            }
            var mv = new MarkerValue('SETTLE:' + jsonStr);
            mv.duration = 0;
            mp.setValueAtTime(0, mv);
        } finally {
            app.endUndoGroup();
        }
        return stJSON({ ok: true });
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return stFail(err.toString());
    }
}

function settleLoadSetup() {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');
        var mp = comp.markerProperty;
        for (var i = 1; i <= mp.numKeys; i++) {
            var c = mp.keyValue(i).comment;
            if (c.indexOf('SETTLE:') === 0) {
                return stJSON({ ok: true, found: true, payload: c.substring(7) });
            }
        }
        return stJSON({ ok: true, found: false });
    } catch (err) {
        return stFail(err.toString());
    }
}

// ----------------------------------------------------------- physics bodies
// Body settings live in the layer comment between explicit sentinels. This is
// project-local, survives a save, and preserves any unrelated comment text.

var ST_BODY_OPEN = '[SETTLE_BODY]';
var ST_BODY_CLOSE = '[/SETTLE_BODY]';

function stParseJSON(text) {
    return eval('(' + text + ')');
}

function stGetBodyConfig(layer) {
    try {
        var comment = String(layer.comment || '');
        var start = comment.indexOf(ST_BODY_OPEN);
        if (start < 0) return null;
        var valueStart = start + ST_BODY_OPEN.length;
        var end = comment.indexOf(ST_BODY_CLOSE, valueStart);
        if (end < 0) return null;
        return stParseJSON(comment.substring(valueStart, end));
    } catch (e) {
        return null;
    }
}

function stStripBodyConfig(comment) {
    var text = String(comment || '');
    var start = text.indexOf(ST_BODY_OPEN);
    while (start >= 0) {
        var end = text.indexOf(ST_BODY_CLOSE, start + ST_BODY_OPEN.length);
        if (end < 0) {
            text = text.substring(0, start);
            break;
        }
        text = text.substring(0, start) + text.substring(end + ST_BODY_CLOSE.length);
        start = text.indexOf(ST_BODY_OPEN);
    }
    return text.replace(/^\s+|\s+$/g, '');
}

function stSetBodyConfig(layer, config) {
    var original = stStripBodyConfig(layer.comment);
    var encoded = ST_BODY_OPEN + stJSON(config) + ST_BODY_CLOSE;
    layer.comment = original ? original + '\n' + encoded : encoded;
}

function stClearBodyConfig(layer) {
    layer.comment = stStripBodyConfig(layer.comment);
}

function stNormaliseBodyConfig(raw) {
    var type = String(raw.bodyType || 'dynamic');
    if (type !== 'static' && type !== 'kinematic') type = 'dynamic';
    var shape = raw.shape === 'circle' ? 'circle' : 'box';
    return {
        bodyType: type,
        preset: String(raw.preset || (type === 'static' ? 'Passive surface' : 'Custom')),
        color: String(raw.color || '#78dec4'),
        shape: shape,
        density: Math.max(0.01, Number(raw.density) || 1),
        bounce: Math.max(0, Math.min(1, Number(raw.bounce) || 0)),
        friction: Math.max(0, Math.min(1, Number(raw.friction) || 0)),
        frictionStatic: Math.max(0, Number(raw.frictionStatic) || 0.5),
        airDrag: Math.max(0, Math.min(0.25, Number(raw.airDrag) || 0)),
        gravityScale: isFinite(Number(raw.gravityScale)) ? Number(raw.gravityScale) : 1,
        velocityX: Number(raw.velocityX) || 0,
        velocityY: Number(raw.velocityY) || 0,
        angularVelocity: Number(raw.angularVelocity) || 0,
        fixedRotation: raw.fixedRotation === true,
        naturalMotion: Math.max(0, Math.min(1, Number(raw.naturalMotion) || 0)),
        turbulence: Math.max(0, Number(raw.turbulence) || 0),
        liftVariation: Math.max(0, Number(raw.liftVariation) || 0),
        wobble: Math.max(0, Number(raw.wobble) || 0),
        seed: Math.max(1, Math.floor(Number(raw.seed) || 1337))
    };
}

function settleApplyBody(configJson) {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');
        var selected = comp.selectedLayers;
        if (selected.length === 0) return stFail('Select one or more layers first.');

        var config = stNormaliseBodyConfig(stParseJSON(configJson));
        var count = 0;
        var baseSeed = config.seed;
        var skipped = [];
        app.beginUndoGroup('Settle: configure physics bodies');
        try {
            for (var i = 0; i < selected.length; i++) {
                var layer = selected[i];
                if (!stIsSimulatable(layer)) {
                    skipped.push(layer.name);
                    continue;
                }
                if (layer.threeDLayer === true) {
                    skipped.push(layer.name + ' (3D)');
                    continue;
                }
                var layerConfig = stNormaliseBodyConfig(config);
                layerConfig.seed = Math.abs((baseSeed + layer.index * 1009) % 999999) || 1;
                stSetBodyConfig(layer, layerConfig);
                count++;
            }
        } finally {
            app.endUndoGroup();
        }

        if (count === 0) return stFail('No compatible 2D layers were selected.');
        return stJSON({ ok: true, count: count, skipped: skipped });
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return stFail(err.toString());
    }
}

function settleRemoveBody() {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');
        var selected = comp.selectedLayers;
        if (selected.length === 0) return stFail('Select one or more layers first.');

        var count = 0;
        app.beginUndoGroup('Settle: remove physics settings');
        try {
            for (var i = 0; i < selected.length; i++) {
                if (stGetBodyConfig(selected[i])) {
                    stClearBodyConfig(selected[i]);
                    count++;
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return stJSON({ ok: true, count: count });
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return stFail(err.toString());
    }
}

function settleBodyList() {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');
        var rows = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var config = stGetBodyConfig(layer);
            if (!config) continue;
            rows.push({
                index: layer.index,
                name: layer.name,
                bodyType: config.bodyType,
                preset: config.preset,
                color: config.color
            });
        }
        return stJSON({ ok: true, rows: rows });
    } catch (err) {
        return stFail(err.toString());
    }
}

function stRotateVector(x, y, degreesValue) {
    var angle = degreesValue * Math.PI / 180;
    return [
        x * Math.cos(angle) - y * Math.sin(angle),
        x * Math.sin(angle) + y * Math.cos(angle)
    ];
}

function stLayerSceneState(layer, time) {
    var transform = stTransform(layer);
    var position = transform.property('ADBE Position').valueAtTime(time, false);
    var rotation = transform.property('ADBE Rotate Z').valueAtTime(time, false);
    var scale = transform.property('ADBE Scale').valueAtTime(time, false);
    var anchor = transform.property('ADBE Anchor Point').valueAtTime(time, false);
    var rect = layer.sourceRectAtTime(time, false);
    var sx = Math.abs(scale[0]) / 100;
    var sy = Math.abs(scale[1]) / 100;
    var offsetX = (rect.left + rect.width / 2 - anchor[0]) * sx;
    var offsetY = (rect.top + rect.height / 2 - anchor[1]) * sy;
    var rotated = stRotateVector(offsetX, offsetY, rotation);
    return {
        x: position[0] + rotated[0],
        y: position[1] + rotated[1],
        angle: rotation,
        width: Math.max(2, rect.width * sx),
        height: Math.max(2, rect.height * sy),
        offsetX: offsetX,
        offsetY: offsetY
    };
}

function settlePhysicsScene(optionsJson) {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open a composition first.');
        var options = stParseJSON(optionsJson);

        var start = comp.workAreaStart;
        var end = comp.workAreaStart + comp.workAreaDuration;
        if (options.durationMode === 'remaining') start = Math.max(start, comp.time);
        if (end <= start) return stFail('The composition work area is empty.');

        var duration = end - start;
        var frameCount = Math.round(duration / comp.frameDuration);
        if (frameCount > 3600) return stFail('The work area is longer than 3600 frames. Shorten it before previewing.');

        var bodies = [];
        var problems = [];
        var dynamicCount = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var config = stGetBodyConfig(layer);
            if (!config) continue;

            if (!stIsSimulatable(layer) || layer.threeDLayer === true) {
                problems.push(layer.name + ': only 2D visual layers can be simulated');
                continue;
            }
            if (layer.parent !== null && layer.parent !== undefined) {
                problems.push(layer.name + ': parented layers are not supported yet');
                continue;
            }

            var transform = stTransform(layer);
            var position = transform.property('ADBE Position');
            var rotation = transform.property('ADBE Rotate Z');
            if (config.bodyType === 'dynamic') {
                if (position.expressionEnabled === true || rotation.expressionEnabled === true) {
                    problems.push(layer.name + ': remove transform expressions before baking');
                    continue;
                }
                if (position.dimensionsSeparated === true) {
                    problems.push(layer.name + ': rejoin separated Position dimensions');
                    continue;
                }
                dynamicCount++;
            }

            var state;
            try {
                state = stLayerSceneState(layer, start);
            } catch (measureError) {
                problems.push(layer.name + ': could not measure its visible bounds');
                continue;
            }

            var body = {
                index: layer.index,
                name: layer.name,
                bodyType: config.bodyType,
                preset: config.preset,
                color: config.color,
                shape: config.shape,
                density: config.density,
                bounce: config.bounce,
                friction: config.friction,
                frictionStatic: config.frictionStatic,
                airDrag: config.airDrag,
                gravityScale: config.gravityScale,
                velocityX: config.velocityX,
                velocityY: config.velocityY,
                angularVelocity: config.angularVelocity,
                fixedRotation: config.fixedRotation,
                naturalMotion: config.naturalMotion,
                turbulence: config.turbulence,
                liftVariation: config.liftVariation,
                wobble: config.wobble,
                seed: config.seed,
                x: state.x,
                y: state.y,
                angle: state.angle,
                width: state.width,
                height: state.height,
                offsetX: state.offsetX,
                offsetY: state.offsetY,
                path: null
            };

            if (config.bodyType === 'kinematic') {
                body.path = [];
                for (var frame = 0; frame <= frameCount; frame++) {
                    var sampleTime = start + frame * comp.frameDuration;
                    if (sampleTime > end) sampleTime = end;
                    var pathState = stLayerSceneState(layer, sampleTime);
                    body.path.push({
                        x: pathState.x,
                        y: pathState.y,
                        angle: pathState.angle
                    });
                }
            }
            bodies.push(body);
        }

        if (problems.length > 0) return stFail(problems.join(' | '));
        if (bodies.length === 0) return stFail('Configure layers in the Bodies tab first.');
        if (dynamicCount === 0) return stFail('At least one configured layer must be Dynamic.');

        return stJSON({
            ok: true,
            scene: {
                name: comp.name,
                width: comp.width,
                height: comp.height,
                fps: comp.frameRate,
                start: start,
                duration: duration,
                gravity: isFinite(Number(options.gravity)) ? Number(options.gravity) : 981,
                gravityX: Number(options.gravityX) || 0,
                gravityY: isFinite(Number(options.gravityY)) ? Number(options.gravityY) : 1,
                wind: Number(options.wind) || 0,
                substeps: Number(options.substeps) || 4,
                walls: String(options.walls || 'none'),
                positionIterations: Number(options.positionIterations) || 8,
                velocityIterations: Number(options.velocityIterations) || 6,
                sleeping: false,
                bodies: bodies
            }
        });
    } catch (err) {
        return stFail(err.toString());
    }
}

function stRemoveKeysInRange(prop, start, end) {
    var epsilon = 0.00001;
    for (var i = prop.numKeys; i >= 1; i--) {
        var time = prop.keyTime(i);
        if (time >= start - epsilon && time <= end + epsilon) prop.removeKey(i);
    }
}

function stSetLinearKeys(prop) {
    for (var i = 1; i <= prop.numKeys; i++) {
        try {
            prop.setInterpolationTypeAtKey(i,
                KeyframeInterpolationType.LINEAR,
                KeyframeInterpolationType.LINEAR);
        } catch (e) {}
    }
}

function settleBake(payloadJson) {
    try {
        var comp = stActiveComp();
        if (!comp) return stFail('Open the same composition used for the preview.');
        var payload = stParseJSON(payloadJson);
        if (!payload.bodies || payload.bodies.length === 0) return stFail('The preview contains no Dynamic bodies to bake.');

        var start = Number(payload.start) || 0;
        var frameDuration = Number(payload.frameDuration) || comp.frameDuration;
        var totalKeys = 0;
        var layerCount = 0;

        app.beginUndoGroup('Settle: bake physics');
        try {
            for (var b = 0; b < payload.bodies.length; b++) {
                var data = payload.bodies[b];
                var layer = comp.layer(Number(data.index));
                if (!layer || layer.name !== data.name) {
                    throw new Error('Layer order changed after preview. Preview again before baking.');
                }

                var transform = stTransform(layer);
                var position = transform.property('ADBE Position');
                var rotation = transform.property('ADBE Rotate Z');
                if (position.expressionEnabled === true || rotation.expressionEnabled === true) {
                    throw new Error(layer.name + ' has a transform expression.');
                }
                if (position.dimensionsSeparated === true) {
                    throw new Error(layer.name + ' has separated Position dimensions.');
                }

                var times = [];
                for (var f = 0; f < data.positions.length; f++) {
                    times.push(start + f * frameDuration);
                }
                var end = times[times.length - 1];
                stRemoveKeysInRange(position, start, end);
                stRemoveKeysInRange(rotation, start, end);
                position.setValuesAtTimes(times, data.positions);
                rotation.setValuesAtTimes(times, data.rotations);
                stSetLinearKeys(position);
                stSetLinearKeys(rotation);

                if (payload.motionBlur === true) {
                    try { layer.motionBlur = true; } catch (blurError) {}
                }
                totalKeys += times.length * 2;
                layerCount++;
            }
            if (payload.motionBlur === true) comp.motionBlur = true;
        } finally {
            app.endUndoGroup();
        }

        return stJSON({ ok: true, layers: layerCount, keys: totalKeys });
    } catch (err) {
        try { app.endUndoGroup(); } catch (e) {}
        return stFail(err.toString());
    }
}
