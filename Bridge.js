/**
 * Bridge.js
 * Motion Spec Exporter for After Effects
 * ScriptUI Dockable Panel
 */

(function (thisObj) {

    // ═══════════════════════════════════════════════════════════════════
    //  EXTRACTION ENGINE
    // ═══════════════════════════════════════════════════════════════════

    function runExtraction(forceMode) {
        var comp = app.project.activeItem;
        if (!(comp instanceof CompItem)) {
            return { error: "No active composition found." };
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

            function formatPropName(prop) {
                var name = prop.name;
                var topLevel = (prop.parentProperty && prop.parentProperty.matchName === "ADBE Transform Group");
                if (!topLevel) {
                    var n = name.toLowerCase();
                    if (n === "position" || n === "scale" || n === "rotation" || n === "opacity" || n === "anchor point" ||
                        n === "x position" || n === "y position" || n === "z position" ||
                        n === "x rotation" || n === "y rotation" || n === "z rotation") {
                        name += " (Nested)";
                    }
                }
                return name;
            }

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
                    // Positional values: show delta per axis
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
                    var isScale = propName.indexOf("Scale") !== -1;
                    var isSize = propName.indexOf("Size") !== -1;
                    var unit = isScale ? "%" : "";
                    var axes = ["X", "Y", "Z"];
                    var isUniform = (isScale || isSize) &&
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
                                var axName = axes[ax] + " " + propName;
                                if (propName.indexOf(" (Nested)") !== -1) {
                                    axName = axes[ax] + " " + propName.replace(" (Nested)", "") + " (Nested)";
                                }
                                entries.push(
                                    "Property: " + axName + "\n" +
                                    "Value Change: " + round2(v1[ax]) + unit + arrow + round2(v2[ax]) + unit + "\n" +
                                    "Delay: " + delayStr + "\n" +
                                    "Duration: " + durationStr + "\n" +
                                    "Interpolation: " + cubic
                                );
                            }
                        }
                    }
                } else {
                    var isOpacity = propName.indexOf("Opacity") !== -1;
                    var fv1 = isOpacity ? round2(v1) + "%" : round2(v1);
                    var fv2 = isOpacity ? round2(v2) + "%" : round2(v2);
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
                    buildEntries(propType, formatPropName(prop), v1, v2,
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

            function findSourceProperty(prop) {
                var expression = prop.expression;
                var srcLayer = null;
                try {
                    var p = prop;
                    while (p && p.parentProperty) { p = p.parentProperty; }
                    srcLayer = p;
                } catch (e) { }

                var nameMatch = expression.match(/thisComp\.layer\(["']([^"']+)["']\)/);
                if (nameMatch) { try { srcLayer = comp.layer(nameMatch[1]); } catch (e) { } }
                else {
                    var idxMatch = expression.match(/thisComp\.layer\((\d+)\)/);
                    if (idxMatch) { try { srcLayer = comp.layer(parseInt(idxMatch[1], 10)); } catch (e) { } }
                }
                if (!srcLayer) return null;

                var propMatch = expression.match(/\.transform\.(\w+)/);
                if (propMatch) {
                    var propMap = {
                        "opacity": "ADBE Opacity", "position": "ADBE Position",
                        "scale": "ADBE Scale", "rotation": "ADBE Rotate Z",
                        "xRotation": "ADBE Rotate X", "yRotation": "ADBE Rotate Y",
                        "anchorPoint": "ADBE Anchor Point",
                        "xPosition": "ADBE Position_0", "yPosition": "ADBE Position_1", "zPosition": "ADBE Position_2"
                    };
                    var matchName = propMap[propMatch[1]];
                    if (matchName) {
                        var tg = srcLayer.property("ADBE Transform Group");
                        if (tg) {
                            var srcProp = tg.property(matchName);
                            if (srcProp && (srcProp instanceof Property) && srcProp.numKeys >= 2) return srcProp;
                        }
                    }
                }

                // Fallback: Fuzzy match against ALL animated properties on srcLayer
                var candidates = [];
                function scanAnimatedProps(group) {
                    for (var i = 1; i <= group.numProperties; i++) {
                        var child; try { child = group.property(i); } catch (e) { continue; }
                        if (child instanceof PropertyGroup) { scanAnimatedProps(child); }
                        else if (child instanceof Property && child.numKeys >= 2) {
                            candidates.push(child);
                        }
                    }
                }
                try { scanAnimatedProps(srcLayer); } catch (e) { }

                var bestProp = null;
                var bestScore = 0;
                var exprLower = expression.toLowerCase();

                for (var c = 0; c < candidates.length; c++) {
                    var score = 0;
                    var cand = candidates[c];
                    var nLower = cand.name.toLowerCase();

                    if (exprLower.indexOf(nLower) !== -1 || exprLower.indexOf(cand.matchName.toLowerCase()) !== -1) {
                        score += 10;
                    } else {
                        var mapped = "";
                        var mN = cand.matchName;
                        if (mN === "ADBE Vector Rect Size" || mN === "ADBE Vector Ellipse Size") mapped = "size";
                        else if (mN === "ADBE Vector Rect Position" || mN === "ADBE Vector Ellipse Position") mapped = "position";
                        else if (mN === "ADBE Vector Rect Roundness") mapped = "roundness";
                        else if (mN.indexOf("Slider") !== -1) mapped = "slider";
                        else if (mN.indexOf("Color") !== -1) mapped = "color";

                        if (mapped && exprLower.indexOf(mapped) !== -1) score += 10;
                    }

                    var parent = cand.parentProperty;
                    while (parent && parent.name !== srcLayer.name) {
                        var parentName = parent.name.toLowerCase();
                        if (parentName !== "contents" && parentName !== "transform" && parentName !== "effects") {
                            if (exprLower.indexOf(parentName) !== -1) score += 5;
                        }
                        parent = parent.parentProperty;
                    }

                    if (score > bestScore && score >= 10) {
                        bestScore = score;
                        bestProp = cand;
                    }
                }
                return bestProp;
            }

            // ── processExpressionProperty ─────────────────────────────────

            function processExpressionProperty(prop, entries, rangeStart, rangeEnd) {
                if (!(prop instanceof Property)) return;
                if (!prop.expressionEnabled || prop.expression === "") return;
                if (rangeStart === undefined) rangeStart = waStart;
                if (rangeEnd === undefined) rangeEnd = waEnd;
                var propType = getPropertyType(prop);
                var srcProp = findSourceProperty(prop);
                if (srcProp) {
                    for (var k = 1; k < srcProp.numKeys; k++) {
                        var t1 = srcProp.keyTime(k);
                        var t2 = srcProp.keyTime(k + 1);
                        if (t1 < rangeStart || t2 > rangeEnd) continue;
                        var v1 = prop.valueAtTime(t1, false);
                        var v2 = prop.valueAtTime(t2, false);
                        if (!hasValueChange(v1, v2)) continue;
                        buildEntries(propType, formatPropName(prop), v1, v2,
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
                        buildEntries(propType, formatPropName(prop), v1, v2,
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

            // ── buildLayerBlock ───────────────────────────────────────────

            function delayMs(entry) {
                var m = entry.match(/\nDelay: (-?\d+)ms/);
                return m ? parseInt(m[1], 10) : 0;
            }

            function isTopLevelProp(name) {
                if (name.indexOf("(Nested)") !== -1) return false;
                var n = name.toLowerCase();
                return (n === "anchor point" || n === "position" || n === "scale" ||
                    n === "rotation" || n === "opacity" ||
                    n === "x position" || n === "y position" || n === "z position" ||
                    n === "x rotation" || n === "y rotation" || n === "z rotation");
            }

            function getPropPriority(name) {
                var n = name.toLowerCase();
                var isNested = !isTopLevelProp(name);

                if (!isNested) {
                    if (n.indexOf("anchor point") !== -1) return 1;
                    if (n.indexOf("x position") !== -1) return 2;
                    if (n.indexOf("y position") !== -1) return 3;
                    if (n.indexOf("z position") !== -1) return 4;
                    if (n.indexOf("position") !== -1) return 5;
                    if (n.indexOf("scale") !== -1) return 6;
                    if (n.indexOf("rotation") !== -1) return 7;
                    if (n.indexOf("opacity") !== -1) return 8;
                    return 10;
                } else {
                    if (n.indexOf("size") !== -1) {
                        if (n.indexOf("x size") !== -1) return 20;
                        if (n.indexOf("y size") !== -1) return 21;
                        return 22;
                    }
                    if (n.indexOf("x position") !== -1) return 23;
                    if (n.indexOf("y position") !== -1) return 24;
                    if (n.indexOf("z position") !== -1) return 25;
                    if (n.indexOf("position") !== -1) return 26;
                    if (n.indexOf("roundness") !== -1) return 27;
                    if (n.indexOf("color") !== -1) return 28;
                    return 100;
                }
            }

            function propName(entry) {
                var m = entry.match(/^Property: (.+)/);
                if (!m) return "";
                return m[1].replace(/^\s+|\s+$/g, "");
            }

            // Group entries by property, order groups by their earliest delay,
            // list all entries for each property before moving to the next.
            function groupAndSort(entries) {
                var groups = {};   // propName -> [{delay, entry}]
                var order = [];   // propName in first-appearance order
                for (var i = 0; i < entries.length; i++) {
                    var key = propName(entries[i]);
                    var d = delayMs(entries[i]);
                    if (!groups[key]) { groups[key] = []; order.push(key); }
                    groups[key].push({ delay: d, entry: entries[i] });
                }
                // Sort within each group by delay
                for (var k in groups) {
                    groups[k].sort(function (a, b) { return a.delay - b.delay; });
                }
                // Order groups by the earliest delay of each group
                order.sort(function (a, b) {
                    var aTop = isTopLevelProp(a);
                    var bTop = isTopLevelProp(b);
                    if (aTop && !bTop) return -1;
                    if (!aTop && bTop) return 1;

                    var dA = groups[a][0].delay;
                    var dB = groups[b][0].delay;
                    if (dA !== dB) return dA - dB;
                    // Secondary sort: Priority hierarchy
                    return getPropPriority(a) - getPropPriority(b);
                });
                // Flatten
                var result = [];
                for (var g = 0; g < order.length; g++) {
                    var grp = groups[order[g]];
                    for (var j = 0; j < grp.length; j++) result.push(grp[j].entry);
                }
                return result;
            }

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

            // ── scanForSelectedKeys (hoisted) ─────────────────────────────

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
            var anyKeySelected = false;

            // ── Mode 0: Selected keyframes ────────────────────────────────

            if (forceMode === 0 || forceMode === undefined) {
                // First pass: find the globally earliest selected keyframe across all layers
                var globalFirstTime = Infinity;
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

                // Sort selected layers bottom-to-top (descending layer index)
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
                } else if (forceMode === 0) {
                    statusText = "Select at least 2 keyframes to extract a transition.";
                    return { output: null, modeUsed: "" };
                }
            }

            // ── Mode 1: Single property ───────────────────────────────────

            if (output === null && forceMode !== 2 && forceMode !== 3 && !anyKeySelected) {
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
                            return { error: "No value changes detected on this property." };
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
                    return { error: "No animated value changes detected on selected layers." };
                }
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
                    return { error: "No animated value changes detected in this composition." };
                }
            }

            return { output: output, modeUsed: modeUsed };

        } catch (e) {
            return { error: "Error: " + e.toString() };
        } finally {
            app.endUndoGroup();
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CLIPBOARD
    // ═══════════════════════════════════════════════════════════════════

    function copyToClipboard(text) {
        try {
            var escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            system.callSystem('echo "' + escaped + '" | pbcopy');
            return true;
        } catch (e) {
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  UI
    // ═══════════════════════════════════════════════════════════════════

    function buildUI(thisObj) {
        var w = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", "Bridge", undefined, { resizable: true });

        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.spacing = 0;
        w.margins = 0;

        // ── Header ────────────────────────────────────────────────────
        var header = w.add("group");
        header.orientation = "column";
        header.alignChildren = ["left", "center"];
        header.margins = [16, 16, 16, 12];
        header.spacing = 3;

        var titleRow = header.add("group");
        titleRow.orientation = "row";
        titleRow.alignChildren = ["left", "center"];
        titleRow.spacing = 8;

        var titleText = titleRow.add("statictext", undefined, "BRIDGE");
        titleText.graphics.font = ScriptUI.newFont("Arial", "BOLD", 20);

        var versionText = titleRow.add("statictext", undefined, "v2.0");
        versionText.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10);

        var subtitleText = header.add("statictext", undefined, "Motion Spec Exporter");
        subtitleText.graphics.font = ScriptUI.newFont("Arial", "REGULAR", 10);

        // ── Divider ───────────────────────────────────────────────────
        var div1 = w.add("panel");
        div1.alignment = ["fill", "top"];
        div1.maximumSize.height = 1;

        // ── Mode section ──────────────────────────────────────────────
        var modeSection = w.add("group");
        modeSection.orientation = "column";
        modeSection.alignChildren = ["fill", "top"];
        modeSection.margins = [14, 12, 14, 10];
        modeSection.spacing = 8;

        var modeLabel = modeSection.add("statictext", undefined, "EXTRACT MODE");
        modeLabel.graphics.font = ScriptUI.newFont("Arial", "BOLD", 9);

        var btnRow = modeSection.add("group");
        btnRow.orientation = "row";
        btnRow.alignChildren = ["fill", "center"];
        btnRow.spacing = 6;

        var btnAuto = btnRow.add("button", undefined, "Auto");
        var btnKeys = btnRow.add("button", undefined, "Keys");
        var btnLayers = btnRow.add("button", undefined, "Layers");
        var btnComp = btnRow.add("button", undefined, "Comp");

        btnAuto.preferredSize.width = 52;
        btnKeys.preferredSize.width = 52;
        btnLayers.preferredSize.width = 52;
        btnComp.preferredSize.width = 52;

        btnAuto.helpTip = "Auto-detect mode based on your current AE selection";
        btnKeys.helpTip = "Spec only the keyframes selected in the timeline (2+ required)";
        btnLayers.helpTip = "Spec all animated properties on selected layer(s)";
        btnComp.helpTip = "Spec every animated layer in the full composition";

        // ── Mode description ──────────────────────────────────────────
        var modeDesc = modeSection.add("statictext", undefined,
            "Select keyframes, a layer, or nothing — then press Auto.", { multiline: true });
        modeDesc.graphics.font = ScriptUI.newFont("Arial", "ITALIC", 9);

        // ── Divider ───────────────────────────────────────────────────
        var div2 = w.add("panel");
        div2.alignment = ["fill", "top"];
        div2.maximumSize.height = 1;

        // ── Output section ────────────────────────────────────────────
        var outSection = w.add("group");
        outSection.orientation = "column";
        outSection.alignChildren = ["fill", "top"];
        outSection.margins = [14, 12, 14, 6];
        outSection.spacing = 6;

        var outHeader = outSection.add("group");
        outHeader.orientation = "row";
        outHeader.alignChildren = ["fill", "center"];
        outHeader.spacing = 6;

        var outLabel = outHeader.add("statictext", undefined, "OUTPUT");
        outLabel.graphics.font = ScriptUI.newFont("Arial", "BOLD", 9);
        outLabel.alignment = ["left", "center"];

        var clearBtn = outHeader.add("button", undefined, "Clear");
        clearBtn.preferredSize = [46, 18];
        clearBtn.alignment = ["right", "center"];
        clearBtn.helpTip = "Clear output";

        var outputBox = outSection.add("edittext", undefined, "", {
            multiline: true,
            scrollable: true
        });
        outputBox.minimumSize = [240, 200];
        outputBox.preferredSize = [280, 280];
        outputBox.graphics.font = ScriptUI.newFont("Courier New", "REGULAR", 10);

        // ── Footer ────────────────────────────────────────────────────
        var div3 = w.add("panel");
        div3.alignment = ["fill", "top"];
        div3.maximumSize.height = 1;

        var footer = w.add("group");
        footer.orientation = "row";
        footer.alignChildren = ["fill", "center"];
        footer.margins = [14, 8, 14, 14];
        footer.spacing = 8;

        var copyBtn = footer.add("button", undefined, "Copy to Clipboard");
        copyBtn.alignment = ["fill", "center"];
        copyBtn.helpTip = "Copy full output to clipboard";

        var statusText = footer.add("statictext", undefined, "Ready");
        statusText.alignment = ["right", "center"];
        statusText.preferredSize.width = 120;
        statusText.graphics.font = ScriptUI.newFont("Arial", "ITALIC", 9);

        // ── Logic ─────────────────────────────────────────────────────

        function setStatus(msg) {
            statusText.text = msg;
            w.update();
        }

        function run(forceMode, label) {
            setStatus("Working...");
            var result = runExtraction(forceMode);
            if (result.error) {
                outputBox.text = "";
                setStatus("\u26A0 " + result.error);
                modeDesc.text = "Error. " + result.error;
            } else {
                outputBox.text = result.output;
                setStatus("\u2713 Done");
                modeDesc.text = "Mode: " + result.modeUsed + "  \u2014  "
                    + result.output.split("\n").length + " lines";
            }
        }

        btnAuto.onClick = function () { run(undefined); };
        btnKeys.onClick = function () { run(0, "Keys"); };
        btnLayers.onClick = function () { run(2, "Layers"); };
        btnComp.onClick = function () { run(3, "Comp"); };

        clearBtn.onClick = function () {
            outputBox.text = "";
            modeDesc.text = "Select keyframes, a layer, or nothing — then press Auto.";
            setStatus("Ready");
        };

        copyBtn.onClick = function () {
            if (outputBox.text === "") {
                setStatus("Nothing to copy");
                return;
            }
            var ok = copyToClipboard(outputBox.text);
            setStatus(ok ? "\u2713 Copied!" : "\u26A0 Clipboard failed");
        };

        return w;
    }

    // ── Launch ────────────────────────────────────────────────────────

    var panel = buildUI(thisObj);
    if (panel instanceof Window) {
        panel.center();
        panel.show();
    } else {
        panel.layout.layout(true);
    }

})(this);
