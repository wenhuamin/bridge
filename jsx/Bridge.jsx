/**
 * Bridge.jsx — ExtendScript Engine
 * Called from the CEP HTML panel via csInterface.evalScript()
 * Entry point: runExtraction(forceMode) → JSON string {output, modeUsed} or {error}
 */

// ExtendScript (ES3) has no JSON object — provide a minimal serialiser.
function jsonStr(obj) {
    if (obj === null || obj === undefined) return 'null';
    var t = typeof obj;
    if (t === 'boolean') return obj ? 'true' : 'false';
    if (t === 'number') return isFinite(obj) ? String(obj) : 'null';
    if (t === 'string') {
        return '"' + obj
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t') + '"';
    }
    if (obj instanceof Array) {
        var parts = [];
        for (var i = 0; i < obj.length; i++) parts.push(jsonStr(obj[i]));
        return '[' + parts.join(',') + ']';
    }
    // plain object
    var pairs = [];
    for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
            pairs.push(jsonStr(k) + ':' + jsonStr(obj[k]));
        }
    }
    return '{' + pairs.join(',') + '}';
}

function runExtraction(forceMode) {
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
        return jsonStr({ error: "No active composition found." });
    }

    app.beginUndoGroup("Bridge: Extract Specs");

    try {
        var waStart = comp.workAreaStart;
        var waEnd = comp.workAreaStart + comp.workAreaDuration;

        // ── Helpers ──────────────────────────────────────────────────

        function round2(n) {
            return Math.round(n * 100) / 100;
        }

        function toHex(color) {
            function ch(v) {
                var h = Math.round(v * 255).toString(16);
                return h.length < 2 ? "0" + h : h;
            }
            return ("#" + ch(color[0]) + ch(color[1]) + ch(color[2])).toUpperCase();
        }

        function hasValueChange(v1, v2) {
            if (v1 instanceof Array) {
                for (var i = 0; i < v1.length; i++) {
                    if (Math.abs(v1[i] - v2[i]) > 0.001) return true;
                }
                return false;
            }
            return Math.abs(v1 - v2) > 0.001;
        }

        // ── Cubic bezier ─────────────────────────────────────────────

        function computeCubic(prop, k, t1, t2, v1, v2) {
            try {
                var inType = prop.keyOutInterpolationType(k);
                var outType = prop.keyInInterpolationType(k + 1);
                if (inType === KeyframeInterpolationType.LINEAR &&
                    outType === KeyframeInterpolationType.LINEAR) {
                    return "0.00, 0.00, 1.00, 1.00";
                }
                if (inType === KeyframeInterpolationType.HOLD ||
                    outType === KeyframeInterpolationType.HOLD) {
                    return "hold";
                }
                var dt = t2 - t1;
                if (dt <= 0) return "0.00, 0.00, 1.00, 1.00";
                var outEase = prop.keyOutTemporalEase(k);
                var inEase = prop.keyInTemporalEase(k + 1);
                var x1 = Math.max(0, Math.min(1, outEase[0].influence / 100));
                var x2 = Math.max(0, Math.min(1, 1 - inEase[0].influence / 100));

                // Check if expression is active — if so, valueAtTime is distorted
                var hasExpr = false;
                try { hasExpr = prop.expressionEnabled && prop.expression !== ""; } catch (e) { }

                var y1, y2;

                if (hasExpr) {
                    // Compute y1/y2 from keyframe speed metadata (ignores expression)
                    // Bezier tangent at start: slope = y1/x1 = normalizedSpeedOut
                    // Bezier tangent at end:   slope = (1-y2)/(1-x2) = normalizedSpeedIn
                    var range = 0;
                    if (v1 instanceof Array) {
                        for (var i = 0; i < v1.length; i++) range += (v2[i] - v1[i]) * (v2[i] - v1[i]);
                        range = Math.sqrt(range);
                    } else {
                        range = Math.abs(v2 - v1);
                    }
                    if (range < 1e-6) {
                        y1 = 0; y2 = 1;
                    } else {
                        var normSpeedOut = (outEase[0].speed * dt) / range;
                        var normSpeedIn = (inEase[0].speed * dt) / range;
                        y1 = normSpeedOut * x1;
                        y2 = 1 - normSpeedIn * (1 - x2);
                    }
                } else {
                    // No expression — sample with valueAtTime for accurate least-squares fit
                    function normVal(v) {
                        if (v1 instanceof Array) {
                            var num = 0, den = 0;
                            for (var i = 0; i < v1.length; i++) {
                                num += (v[i] - v1[i]) * (v2[i] - v1[i]);
                                den += (v2[i] - v1[i]) * (v2[i] - v1[i]);
                            }
                            return den < 1e-6 ? 0 : num / den;
                        }
                        var d = v2 - v1;
                        return Math.abs(d) < 1e-6 ? 0 : (v - v1) / d;
                    }
                    function xBez(t) {
                        return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
                    }
                    function findT(s) {
                        if (s <= 0) return 0;
                        if (s >= 1) return 1;
                        var lo = 0, hi = 1, mid;
                        for (var it = 0; it < 20; it++) {
                            mid = (lo + hi) * 0.5;
                            if (xBez(mid) < s) lo = mid; else hi = mid;
                        }
                        return (lo + hi) * 0.5;
                    }
                    var N = 7, lsA = 0, lsB = 0, lsC = 0, lsD = 0, lsE = 0, cnt = 0;
                    for (var i = 1; i <= N; i++) {
                        var s = i / (N + 1);
                        var vSamp;
                        try { vSamp = prop.valueAtTime(t1 + s * dt, false); } catch (e2) { continue; }
                        var ys = normVal(vSamp);
                        var tb = findT(s);
                        var ai = 3 * tb * (1 - tb) * (1 - tb);
                        var bi = 3 * tb * tb * (1 - tb);
                        var ci = ys - tb * tb * tb;
                        lsA += ai * ai; lsB += ai * bi; lsC += bi * bi; lsD += ai * ci; lsE += bi * ci;
                        cnt++;
                    }
                    if (cnt < 2) {
                        y1 = 0; y2 = 1;
                    } else {
                        var det = lsA * lsC - lsB * lsB;
                        if (Math.abs(det) < 1e-10) { y1 = 0; y2 = 1; }
                        else { y1 = (lsD * lsC - lsE * lsB) / det; y2 = (lsA * lsE - lsB * lsD) / det; }
                    }
                }

                return round2(x1).toFixed(2) + ", " + round2(y1).toFixed(2) + ", " +
                    round2(x2).toFixed(2) + ", " + round2(y2).toFixed(2);
            } catch (e) {
                return "0.00, 0.00, 1.00, 1.00";
            }
        }

        // ── Property type & formatting ────────────────────────────────

        function getPropertyType(prop) {
            var pt = prop.propertyValueType;
            if (pt === PropertyValueType.COLOR) return "color";
            if (pt === PropertyValueType.TwoD_SPATIAL || pt === PropertyValueType.ThreeD_SPATIAL) return "spatial";
            if (pt === PropertyValueType.TwoD || pt === PropertyValueType.ThreeD) return "multi";
            return "scalar";
        }

        function buildEntries(propType, propName, v1, v2, delayStr, durationStr, cubic, entries) {
            var arrow = " -> ";
            if (propType === "color") {
                entries.push(
                    "Property: " + propName + "\n" +
                    "Value Change: " + toHex(v1) + arrow + toHex(v2) + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else if (propType === "spatial") {
                var axes = ["X", "Y", "Z"];
                for (var ax = 0; ax < v1.length && ax < axes.length; ax++) {
                    var delta = round2(v2[ax] - v1[ax]);
                    if (Math.abs(delta) > 0.001) {
                        entries.push(
                            "Property: " + axes[ax] + " " + propName + "\n" +
                            "Value Change: " + (delta >= 0 ? "+" : "") + delta + "dp\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                }
            } else if (propType === "multi") {
                var unit = (propName === "Scale" || propName === "Size") ? "%" : "";
                var axes = ["X", "Y", "Z"];
                var isUniform = (propName === "Scale" || propName === "Size") &&
                    v1.length >= 2 &&
                    Math.abs(v1[0] - v1[1]) < 0.001 && Math.abs(v2[0] - v2[1]) < 0.001 &&
                    Math.abs(v1[0] - v2[0]) > 0.001;
                if (isUniform) {
                    entries.push(
                        "Property: " + propName + "\n" +
                        "Value Change: " + round2(v1[0]) + unit + arrow + round2(v2[0]) + unit + "\n" +
                        "Delay: " + delayStr + "\n" +
                        "Duration: " + durationStr + "\n" +
                        "Interpolation: " + cubic
                    );
                } else {
                    for (var ax = 0; ax < v1.length && ax < axes.length; ax++) {
                        if (Math.abs(v1[ax] - v2[ax]) > 0.001) {
                            entries.push(
                                "Property: " + axes[ax] + " " + propName + "\n" +
                                "Value Change: " + round2(v1[ax]) + unit + arrow + round2(v2[ax]) + unit + "\n" +
                                "Delay: " + delayStr + "\n" +
                                "Duration: " + durationStr + "\n" +
                                "Interpolation: " + cubic
                            );
                        }
                    }
                }
            } else {
                var fv1 = (propName === "Opacity") ? round2(v1) + "%" : round2(v1);
                var fv2 = (propName === "Opacity") ? round2(v2) + "%" : round2(v2);
                entries.push(
                    "Property: " + propName + "\n" +
                    "Value Change: " + fv1 + arrow + fv2 + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            }
        }

        // ── processProperty ───────────────────────────────────────────

        function processProperty(prop, entries, rangeStart, rangeEnd) {
            if (!(prop instanceof Property)) return;
            if (prop.numKeys < 2) return;
            if (rangeStart === undefined) rangeStart = waStart;
            if (rangeEnd === undefined) rangeEnd = waEnd;
            var propType = getPropertyType(prop);
            for (var k = 1; k < prop.numKeys; k++) {
                var t1 = prop.keyTime(k);
                var t2 = prop.keyTime(k + 1);
                if (t1 < rangeStart || t2 > rangeEnd) continue;
                var v1 = prop.keyValue(k);
                var v2 = prop.keyValue(k + 1);
                if (!hasValueChange(v1, v2)) continue;
                var delay = (t1 - waStart) * 1000;
                var duration = (t2 - t1) * 1000;
                buildEntries(propType, prop.name, v1, v2,
                    Math.round(delay) + "ms", Math.round(duration) + "ms",
                    computeCubic(prop, k, t1, t2, v1, v2), entries);
            }
        }

        // ── collectKeyframeTimes ──────────────────────────────────────

        function collectKeyframeTimes() {
            var timesMap = {};
            timesMap[waStart.toFixed(6)] = waStart;
            timesMap[waEnd.toFixed(6)] = waEnd;
            function scanForTimes(group) {
                for (var i = 1; i <= group.numProperties; i++) {
                    var p; try { p = group.property(i); } catch (e) { continue; }
                    if (p instanceof PropertyGroup) { scanForTimes(p); }
                    else if (p instanceof Property) {
                        for (var k = 1; k <= p.numKeys; k++) {
                            var t = p.keyTime(k);
                            if (t >= waStart && t <= waEnd) timesMap[t.toFixed(6)] = t;
                        }
                    }
                }
            }
            for (var L = 1; L <= comp.numLayers; L++) {
                try { scanForTimes(comp.layer(L)); } catch (e) { }
            }
            var result = [];
            for (var key in timesMap) result.push(timesMap[key]);
            result.sort(function (a, b) { return a - b; });
            return result;
        }

        var allKeyframeTimes = collectKeyframeTimes();

        // ── findSourceProperty ────────────────────────────────────────

        function findSourceProperty(expression) {
            var srcLayer = null;
            var nameMatch = expression.match(/thisComp\.layer\(["']([^"']+)["']\)/);
            if (nameMatch) { try { srcLayer = comp.layer(nameMatch[1]); } catch (e) { } }
            if (!srcLayer) {
                var idxMatch = expression.match(/thisComp\.layer\((\d+)\)/);
                if (idxMatch) { try { srcLayer = comp.layer(parseInt(idxMatch[1], 10)); } catch (e) { } }
            }
            if (!srcLayer) return null;
            var propMatch = expression.match(/\.transform\.(\w+)/);
            if (!propMatch) return null;
            var propMap = {
                "opacity": "ADBE Opacity", "position": "ADBE Position",
                "scale": "ADBE Scale", "rotation": "ADBE Rotate Z",
                "xRotation": "ADBE Rotate X", "yRotation": "ADBE Rotate Y",
                "anchorPoint": "ADBE Anchor Point",
                "xPosition": "ADBE Position_0", "yPosition": "ADBE Position_1", "zPosition": "ADBE Position_2"
            };
            var matchName = propMap[propMatch[1]];
            if (!matchName) return null;
            var tg = srcLayer.property("ADBE Transform Group");
            if (!tg) return null;
            var srcProp = tg.property(matchName);
            if (!srcProp || !(srcProp instanceof Property) || srcProp.numKeys < 2) return null;
            return srcProp;
        }

        // ── processExpressionProperty ─────────────────────────────────

        function processExpressionProperty(prop, entries, rangeStart, rangeEnd) {
            if (!(prop instanceof Property)) return;
            if (!prop.expressionEnabled || prop.expression === "") return;
            if (rangeStart === undefined) rangeStart = waStart;
            if (rangeEnd === undefined) rangeEnd = waEnd;
            var propType = getPropertyType(prop);
            var srcProp = findSourceProperty(prop.expression);
            if (srcProp) {
                for (var k = 1; k < srcProp.numKeys; k++) {
                    var t1 = srcProp.keyTime(k);
                    var t2 = srcProp.keyTime(k + 1);
                    if (t1 < rangeStart || t2 > rangeEnd) continue;
                    var v1 = prop.valueAtTime(t1, false);
                    var v2 = prop.valueAtTime(t2, false);
                    if (!hasValueChange(v1, v2)) continue;
                    buildEntries(propType, prop.name, v1, v2,
                        Math.round((t1 - waStart) * 1000) + "ms",
                        Math.round((t2 - t1) * 1000) + "ms",
                        computeCubic(srcProp, k, t1, t2, srcProp.keyValue(k), srcProp.keyValue(k + 1)), entries);
                }
            } else {
                for (var i = 0; i < allKeyframeTimes.length - 1; i++) {
                    var t1 = allKeyframeTimes[i];
                    var t2 = allKeyframeTimes[i + 1];
                    if (t1 < rangeStart || t2 > rangeEnd) continue;
                    var v1 = prop.valueAtTime(t1, false);
                    var v2 = prop.valueAtTime(t2, false);
                    if (!hasValueChange(v1, v2)) continue;
                    buildEntries(propType, prop.name, v1, v2,
                        Math.round((t1 - waStart) * 1000) + "ms",
                        Math.round((t2 - t1) * 1000) + "ms",
                        "expression", entries);
                }
            }
        }

        // ── scanProperties ────────────────────────────────────────────

        function scanProperties(group, entries, rs, re) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p; try { p = group.property(i); } catch (e) { continue; }
                if (p instanceof PropertyGroup) { scanProperties(p, entries, rs, re); }
                else if (p instanceof Property && p.numKeys >= 2) {
                    // Expression takes priority: use source property timing/values
                    var hasExpr = false;
                    try { hasExpr = p.expressionEnabled && p.expression !== ""; } catch (e) { }
                    if (hasExpr) {
                        processExpressionProperty(p, entries, rs, re);
                    } else {
                        processProperty(p, entries, rs, re);
                    }
                }
            }
        }

        // ── scanExpressionProperties ──────────────────────────────────

        function scanExpressionProperties(layer, entries, rs, re) {
            function scan(group) {
                for (var i = 1; i <= group.numProperties; i++) {
                    var p; try { p = group.property(i); } catch (e) { continue; }
                    if (p instanceof PropertyGroup) { scan(p); }
                    else if (p instanceof Property && p.numKeys < 2) {
                        try {
                            if (p.canSetExpression && p.expressionEnabled && p.expression !== "") {
                                processExpressionProperty(p, entries, rs, re);
                            }
                        } catch (e) { }
                    }
                }
            }
            try { scan(layer); } catch (e) { }
        }

        // ── collectInheritedAnimations ────────────────────────────────

        function collectInheritedAnimations(layer, entries, rs, re) {
            if (rs === undefined) rs = waStart;
            if (re === undefined) re = waEnd;
            var parent = layer.parent;
            while (parent !== null) {
                var pStart = Math.max(rs, parent.inPoint);
                var pEnd = Math.min(re, parent.outPoint);
                if (pStart >= pEnd) { parent = parent.parent; continue; }
                var tg = parent.property("ADBE Transform Group");
                if (tg) {
                    var pe = [];
                    for (var i = 1; i <= tg.numProperties; i++) {
                        var p = tg.property(i);
                        if (p instanceof Property) {
                            if (p.matchName === "ADBE Opacity") continue;
                            if (p.numKeys >= 2) { processProperty(p, pe, pStart, pEnd); }
                            else { try { if (p.expressionEnabled && p.expression !== "") processExpressionProperty(p, pe, pStart, pEnd); } catch (e) { } }
                        }
                    }
                    var label = " (from " + parent.name + ")";
                    for (var j = 0; j < pe.length; j++) {
                        var nl = pe[j].indexOf("\n");
                        entries.push(pe[j].substring(0, nl) + label + pe[j].substring(nl));
                    }
                }
                parent = parent.parent;
            }
        }

        // ── shouldSkipLayer ───────────────────────────────────────────

        function shouldSkipLayer(layer) {
            if (layer.name.indexOf("//") === 0) return true;
            var op = layer.property("ADBE Transform Group").property("ADBE Opacity");
            if (op) {
                if (op.numKeys === 0) {
                    if (op.expressionEnabled) {
                        var allZero = true;
                        for (var t = 0; t < allKeyframeTimes.length; t++) {
                            try { if (Math.round(op.valueAtTime(allKeyframeTimes[t], false)) !== 0) { allZero = false; break; } } catch (e) { }
                        }
                        if (allZero) return true;
                    } else {
                        if (Math.round(op.value) === 0) return true;
                    }
                } else {
                    var allZero = true;
                    if (Math.round(op.valueAtTime(waStart, false)) !== 0) allZero = false;
                    if (allZero && Math.round(op.valueAtTime(waEnd, false)) !== 0) allZero = false;
                    if (allZero) {
                        for (var k = 1; k <= op.numKeys; k++) {
                            var kt = op.keyTime(k);
                            if (kt >= waStart && kt <= waEnd) {
                                if (Math.round(op.keyValue(k)) !== 0) { allZero = false; break; }
                            }
                        }
                    }
                    if (allZero) return true;
                }
            }
            return false;
        }

        // ── Sorting helpers ───────────────────────────────────────────

        function delayMs(entry) {
            var m = entry.match(/\nDelay: (-?\d+)ms/);
            return m ? parseInt(m[1], 10) : 0;
        }

        function entryPropName(entry) {
            var m = entry.match(/^Property: (.+)/);
            return m ? m[1] : "";
        }

        function groupAndSort(entries) {
            var groups = {}, order = [];
            for (var i = 0; i < entries.length; i++) {
                var key = entryPropName(entries[i]);
                var d = delayMs(entries[i]);
                if (!groups[key]) { groups[key] = []; order.push(key); }
                groups[key].push({ delay: d, entry: entries[i] });
            }
            for (var k in groups) {
                groups[k].sort(function (a, b) { return a.delay - b.delay; });
            }
            order.sort(function (a, b) { return groups[a][0].delay - groups[b][0].delay; });
            var result = [];
            for (var g = 0; g < order.length; g++) {
                var grp = groups[order[g]];
                for (var j = 0; j < grp.length; j++) result.push(grp[j].entry);
            }
            return result;
        }

        // ── buildLayerBlock ───────────────────────────────────────────

        function buildLayerBlock(layer, num) {
            var lrStart = Math.max(waStart, layer.inPoint);
            var lrEnd = Math.min(waEnd, layer.outPoint);
            var le = [];
            scanProperties(layer, le, lrStart, lrEnd);
            scanExpressionProperties(layer, le, lrStart, lrEnd);
            collectInheritedAnimations(layer, le, lrStart, lrEnd);
            if (le.length === 0) return null;
            le = groupAndSort(le);
            return num + ". " + layer.name + "\n\n" + le.join("\n\n");
        }

        // ── scanForSelectedKeys ───────────────────────────────────────

        function scanForSelectedKeys(group, layerEntries, firstSelTime, layerHasKeysRef) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p; try { p = group.property(i); } catch (e) { continue; }
                if (p instanceof PropertyGroup) {
                    scanForSelectedKeys(p, layerEntries, firstSelTime, layerHasKeysRef);
                } else if (p instanceof Property && p.numKeys >= 2) {
                    var selKeys = p.selectedKeys;
                    if (!selKeys || selKeys.length < 2) continue;
                    var propType = getPropertyType(p);
                    for (var ki = 0; ki < selKeys.length - 1; ki++) {
                        var k1 = selKeys[ki], k2 = selKeys[ki + 1];
                        var t1 = p.keyTime(k1), t2 = p.keyTime(k2);
                        var v1 = p.keyValue(k1), v2 = p.keyValue(k2);
                        if (!hasValueChange(v1, v2)) continue;
                        buildEntries(propType, p.name, v1, v2,
                            Math.round((t1 - firstSelTime) * 1000) + "ms",
                            Math.round((t2 - t1) * 1000) + "ms",
                            computeCubic(p, k1, t1, t2, v1, v2), layerEntries);
                        layerHasKeysRef.value = true;
                    }
                }
            }
        }

        // ═════════════════════════════════════════════════════════════
        //  MODE DETECTION
        // ═════════════════════════════════════════════════════════════

        var selectedLayers = comp.selectedLayers;
        var output = null;
        var modeUsed = "";

        // ── Mode 0: Selected keyframes ────────────────────────────────

        if (forceMode === 0 || forceMode === undefined) {
            var globalFirstTime = Infinity;
            var anyKeySelected = false;
            for (var L = 0; L < selectedLayers.length; L++) {
                function findEarliestKeys(group) {
                    for (var i = 1; i <= group.numProperties; i++) {
                        var p; try { p = group.property(i); } catch (e) { continue; }
                        if (p instanceof PropertyGroup) { findEarliestKeys(p); }
                        else if (p instanceof Property && p.numKeys >= 2) {
                            var sk = p.selectedKeys;
                            if (sk && sk.length >= 1) anyKeySelected = true;
                            if (sk && sk.length >= 2) {
                                var t = p.keyTime(sk[0]);
                                if (t < globalFirstTime) globalFirstTime = t;
                            }
                        }
                    }
                }
                try { findEarliestKeys(selectedLayers[L]); } catch (e) { }
            }
            if (globalFirstTime === Infinity) globalFirstTime = waStart;

            var sortedLayers = selectedLayers.slice(0);
            sortedLayers.sort(function (a, b) { return b.index - a.index; });

            var skBlocks = [];
            for (var L = 0; L < sortedLayers.length; L++) {
                var layer = sortedLayers[L];
                var le = [];
                var hasKeys = { value: false };
                try { scanForSelectedKeys(layer, le, globalFirstTime, hasKeys); } catch (e) { }
                if (hasKeys.value) {
                    le = groupAndSort(le);
                    skBlocks.push((skBlocks.length + 1) + ". " + layer.name + "\n\n" + le.join("\n\n"));
                }
            }
            if (skBlocks.length > 0) {
                output = skBlocks.join("\n\n\n");
                modeUsed = "Selected Keyframes";
            } else if (anyKeySelected) {
                // Single keyframe selected — not enough for a transition pair
                return jsonStr({ error: "Select at least 2 keyframes to extract a transition." });
            } else if (forceMode === 0) {
                // Keys button forced but nothing selected
                return jsonStr({ error: "Select at least 2 keyframes to extract a transition." });
            }
        }

        // ── Mode 1: Single property ───────────────────────────────────

        if (output === null && forceMode !== 2 && forceMode !== 3) {
            if (selectedLayers.length === 1) {
                var selProps = selectedLayers[0].selectedProperties;
                var animatedProps = [];
                for (var p = 0; p < selProps.length; p++) {
                    if (selProps[p] instanceof Property) {
                        if (selProps[p].numKeys >= 2) {
                            animatedProps.push(selProps[p]);
                        } else {
                            try { if (selProps[p].expressionEnabled && selProps[p].expression !== "") animatedProps.push(selProps[p]); } catch (e) { }
                        }
                    }
                }
                if (animatedProps.length === 1) {
                    var sp = animatedProps[0];
                    var entries = [];
                    if (sp.numKeys >= 2) processProperty(sp, entries);
                    else processExpressionProperty(sp, entries);
                    if (entries.length > 0) {
                        output = selectedLayers[0].name + "\n\n" + entries.join("\n\n");
                        modeUsed = "Single Property";
                    } else {
                        return jsonStr({ error: "No value changes detected on this property." });
                    }
                }
            }
        }

        // ── Mode 2: Selected layers ───────────────────────────────────

        if (output === null && forceMode !== 3 && selectedLayers.length > 0) {
            var layerOutputs = [];
            for (var L = selectedLayers.length - 1; L >= 0; L--) {
                var layer = selectedLayers[L];
                if (shouldSkipLayer(layer)) continue;
                var block = buildLayerBlock(layer, layerOutputs.length + 1);
                if (block) layerOutputs.push(block);
            }
            if (layerOutputs.length > 0) {
                output = layerOutputs.join("\n\n\n");
                modeUsed = "Selected Layers";
            } else if (forceMode === 2) {
                return jsonStr({ error: "No animated value changes detected on selected layers." });
            }
        }

        // If Layers mode was forced but no layers were selected, tell the user
        if (output === null && forceMode === 2) {
            return jsonStr({ error: "Select at least 1 layer to extract specs." });
        }

        // ── Mode 3: Full comp ─────────────────────────────────────────

        if (output === null) {
            var layerOutputs = [];
            for (var L = comp.numLayers; L >= 1; L--) {
                var layer = comp.layer(L);
                if (shouldSkipLayer(layer)) continue;
                var block = buildLayerBlock(layer, layerOutputs.length + 1);
                if (block) layerOutputs.push(block);
            }
            if (layerOutputs.length > 0) {
                output = layerOutputs.join("\n\n\n");
                modeUsed = "Full Comp";
            } else {
                return jsonStr({ error: "No animated value changes detected in this composition." });
            }
        }

        return jsonStr({ output: output, modeUsed: modeUsed });

    } catch (e) {
        return jsonStr({ error: "Error: " + e.toString() });
    } finally {
        app.endUndoGroup();
    }
}
