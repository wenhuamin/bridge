{
    function main() {

        if (!app.project || !app.project.activeItem) {
            alert("No active composition.");
            return;
        }

        var comp = app.project.activeItem;

        if (!(comp instanceof CompItem)) {
            alert("Please open a composition.");
            return;
        }

        app.beginUndoGroup("Export Motion Spec");

        // --- SAFE UNICODE CHARS ---
        var arrow = " \u2192 ";
        var axisLabels = ["X", "Y", "Z"];

        // --- WORK AREA BOUNDS ---
        var waStart = comp.workAreaStart;
        var waEnd = waStart + comp.workAreaDuration;

        // --- HELPER FUNCTIONS ---
        function clamp(v) {
            return Math.min(Math.max(v, 0), 1);
        }

        function round2(n) {
            var v = Math.round(n * 100) / 100;
            var s = v.toString();
            var dot = s.indexOf(".");
            if (dot === -1) {
                s += ".00";
            } else {
                var decimals = s.length - dot - 1;
                if (decimals === 1) s += "0";
            }
            return s;
        }

        function formatValue(val) {
            if (val instanceof Array) {
                return val.join(", ");
            }
            return val;
        }

        function toHex(c) {
            var h = Math.round(c * 255).toString(16);
            if (h.length < 2) h = "0" + h;
            return h;
        }

        function computeCubic(prop, k, t1, t2, v1, v2) {
            var outType = prop.keyOutInterpolationType(k);
            var inType = prop.keyInInterpolationType(k + 1);
            var isLin = (outType === KeyframeInterpolationType.LINEAR && inType === KeyframeInterpolationType.LINEAR);

            if (isLin) {
                return "0.00, 0.00, 1.00, 1.00";
            }

            var easeOut = prop.keyOutTemporalEase(k)[0];
            var easeIn = prop.keyInTemporalEase(k + 1)[0];

            var deltaValue;
            if (v1 instanceof Array) {
                deltaValue = v2[0] - v1[0];
            } else {
                deltaValue = v2 - v1;
            }

            var deltaTime = t2 - t1;
            var avgSpeed = deltaValue / deltaTime;

            var x1 = easeOut.influence / 100;
            var x2 = 1 - (easeIn.influence / 100);
            var y1 = 0;
            var y2 = 1;

            if (avgSpeed !== 0) {
                y1 = (easeOut.speed / avgSpeed) * x1;
                y2 = 1 - ((easeIn.speed / avgSpeed) * (1 - x2));
            }

            x1 = clamp(x1);
            y1 = clamp(y1);
            x2 = clamp(x2);
            y2 = clamp(y2);

            return round2(x1) + ", " + round2(y1) + ", " + round2(x2) + ", " + round2(y2);
        }

        function hasValueChange(v1, v2) {
            if (v1 instanceof Array) {
                for (var i = 0; i < v1.length; i++) {
                    if (Math.round(v1[i]) !== Math.round(v2[i])) return true;
                }
                return false;
            }
            return Math.round(v1) !== Math.round(v2);
        }

        // --- DETECT PROPERTY TYPE ---
        function getPropertyType(prop) {
            var mn = prop.matchName;
            var nm = prop.name;
            if (mn === "ADBE Position" || mn === "ADBE Anchor Point" || nm === "Position" || nm === "Anchor Point") return "combinedPosition";
            if (mn === "ADBE Position_0" || mn === "ADBE Position_1" || mn === "ADBE Position_2") return "separatedPosition";
            if (mn === "ADBE Scale" || nm === "Scale") return "scale";
            if (mn === "ADBE Opacity" || nm === "Opacity") return "opacity";
            if (mn === "ADBE Rotate Z" || mn === "ADBE Rotate X" || mn === "ADBE Rotate Y" || mn === "ADBE Orientation" || nm === "Rotation" || nm === "X Rotation" || nm === "Y Rotation" || nm === "Z Rotation") return "rotation";
            if (prop.propertyValueType === PropertyValueType.COLOR) return "color";
            return "other";
        }

        // --- BUILD FORMATTED ENTRIES (shared by keyframe and expression processing) ---
        function buildEntries(propType, propName, v1, v2, delayStr, durationStr, cubic, entries) {
            if (propType === "combinedPosition" && v1 instanceof Array) {
                for (var i = 0; i < v1.length && i < axisLabels.length; i++) {
                    var delta = Math.round(v2[i] - v1[i]);
                    if (delta !== 0) {
                        var sign = delta > 0 ? "+" : "";
                        entries.push(
                            "Property: " + axisLabels[i] + " Position\n" +
                            "Value Change: " + sign + delta + "dp\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                }
            } else if (propType === "separatedPosition") {
                var delta = Math.round(v2 - v1);
                var sign = delta > 0 ? "+" : "";
                entries.push(
                    "Property: " + propName + "\n" +
                    "Value Change: " + sign + delta + "dp\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else if (propType === "scale" && v1 instanceof Array) {
                var sx1 = Math.round(v1[0]);
                var sy1 = Math.round(v1[1]);
                var sx2 = Math.round(v2[0]);
                var sy2 = Math.round(v2[1]);
                var xChanged = (sx1 !== sx2);
                var yChanged = (sy1 !== sy2);
                var sameChange = (sx1 === sy1 && sx2 === sy2);

                if (sameChange) {
                    entries.push(
                        "Property: Scale\n" +
                        "Value Change: " + sx1 + "%" + arrow + sx2 + "%\n" +
                        "Delay: " + delayStr + "\n" +
                        "Duration: " + durationStr + "\n" +
                        "Interpolation: " + cubic
                    );
                } else {
                    if (xChanged) {
                        entries.push(
                            "Property: X Scale\n" +
                            "Value Change: " + sx1 + "%" + arrow + sx2 + "%\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                    if (yChanged) {
                        entries.push(
                            "Property: Y Scale\n" +
                            "Value Change: " + sy1 + "%" + arrow + sy2 + "%\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                }
            } else if (propType === "opacity") {
                entries.push(
                    "Property: Opacity\n" +
                    "Value Change: " + Math.round(v1) + "%" + arrow + Math.round(v2) + "%\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else if (propType === "rotation") {
                entries.push(
                    "Property: " + propName + "\n" +
                    "Value Change: " + Math.round(v1) + arrow + Math.round(v2) + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else if (propType === "color" && v1 instanceof Array) {
                var hex1 = "#" + toHex(v1[0]) + toHex(v1[1]) + toHex(v1[2]);
                var hex2 = "#" + toHex(v2[0]) + toHex(v2[1]) + toHex(v2[2]);
                entries.push(
                    "Property: " + propName + "\n" +
                    "Value Change: " + hex1.toUpperCase() + arrow + hex2.toUpperCase() + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else {
                entries.push(
                    "Property: " + propName + "\n" +
                    "Value Change: " + formatValue(v1) + arrow + formatValue(v2) + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            }
        }

        // --- PROCESS A KEYFRAMED PROPERTY ---
        function processProperty(prop, entries, rangeStart, rangeEnd) {
            if (!(prop instanceof Property)) return;
            if (prop.numKeys < 2) return;
            if (rangeStart === undefined) rangeStart = waStart;
            if (rangeEnd === undefined) rangeEnd = waEnd;

            var propType = getPropertyType(prop);
            var numKeys = prop.numKeys;

            for (var k = 1; k < numKeys; k++) {
                var t1 = prop.keyTime(k);
                var t2 = prop.keyTime(k + 1);

                // Skip keyframe pairs outside the work area or layer in/out
                if (t1 < rangeStart || t2 > rangeEnd) continue;

                var v1 = prop.keyValue(k);
                var v2 = prop.keyValue(k + 1);

                if (!hasValueChange(v1, v2)) continue;

                var delay = (t1 - waStart) * 1000;
                var duration = (t2 - t1) * 1000;
                var delayStr = Math.round(delay) + "ms";
                var durationStr = Math.round(duration) + "ms";
                var cubic = computeCubic(prop, k, t1, t2, v1, v2);

                buildEntries(propType, prop.name, v1, v2, delayStr, durationStr, cubic, entries);
            }
        }

        // --- COLLECT ALL KEYFRAME TIMES IN THE COMP (within work area) ---
        function collectKeyframeTimes() {
            var timesMap = {};
            // Always include work area boundaries
            timesMap[waStart.toFixed(6)] = waStart;
            timesMap[waEnd.toFixed(6)] = waEnd;

            function scanForTimes(group) {
                for (var i = 1; i <= group.numProperties; i++) {
                    var p;
                    try { p = group.property(i); } catch (e) { continue; }
                    if (p instanceof PropertyGroup) {
                        scanForTimes(p);
                    } else if (p instanceof Property && p.numKeys >= 2) {
                        for (var k = 1; k <= p.numKeys; k++) {
                            var t = p.keyTime(k);
                            if (t >= waStart && t <= waEnd) {
                                timesMap[t.toFixed(6)] = t;
                            }
                        }
                    }
                }
            }

            for (var L = 1; L <= comp.numLayers; L++) {
                try { scanForTimes(comp.layer(L)); } catch (e) { /* skip locked/erroring layers */ }
            }

            // Sort unique times
            var result = [];
            for (var key in timesMap) {
                result.push(timesMap[key]);
            }
            result.sort(function (a, b) { return a - b; });
            return result;
        }

        var allKeyframeTimes = collectKeyframeTimes();

        // --- FIND SOURCE PROPERTY FROM EXPRESSION TEXT ---
        function findSourceProperty(expression) {
            var srcLayer = null;

            // Match thisComp.layer("Name") or thisComp.layer('Name')
            var nameMatch = expression.match(/thisComp\.layer\(["']([^"']+)["']\)/);
            if (nameMatch) {
                try { srcLayer = comp.layer(nameMatch[1]); } catch (e) { }
            }

            // Match thisComp.layer(index)
            if (!srcLayer) {
                var idxMatch = expression.match(/thisComp\.layer\((\d+)\)/);
                if (idxMatch) {
                    try { srcLayer = comp.layer(parseInt(idxMatch[1], 10)); } catch (e) { }
                }
            }

            if (!srcLayer) return null;

            // Match .transform.propertyName
            var propMatch = expression.match(/\.transform\.(\w+)/);
            if (!propMatch) return null;

            var propMap = {
                "opacity": "ADBE Opacity",
                "position": "ADBE Position",
                "scale": "ADBE Scale",
                "rotation": "ADBE Rotate Z",
                "xRotation": "ADBE Rotate X",
                "yRotation": "ADBE Rotate Y",
                "anchorPoint": "ADBE Anchor Point",
                "xPosition": "ADBE Position_0",
                "yPosition": "ADBE Position_1",
                "zPosition": "ADBE Position_2"
            };

            var matchName = propMap[propMatch[1]];
            if (!matchName) return null;

            var transformGroup = srcLayer.property("ADBE Transform Group");
            if (!transformGroup) return null;

            var srcProp = transformGroup.property(matchName);
            if (!srcProp || !(srcProp instanceof Property) || srcProp.numKeys < 2) return null;

            return srcProp;
        }

        // --- PROCESS AN EXPRESSION-DRIVEN PROPERTY (no keyframes of its own) ---
        function processExpressionProperty(prop, entries, rangeStart, rangeEnd) {
            if (!(prop instanceof Property)) return;
            if (!prop.expressionEnabled || prop.expression === "") return;
            if (prop.numKeys >= 2) return;
            if (rangeStart === undefined) rangeStart = waStart;
            if (rangeEnd === undefined) rangeEnd = waEnd;

            var propType = getPropertyType(prop);
            var srcProp = findSourceProperty(prop.expression);

            if (srcProp) {
                var numKeys = srcProp.numKeys;
                for (var k = 1; k < numKeys; k++) {
                    var t1 = srcProp.keyTime(k);
                    var t2 = srcProp.keyTime(k + 1);

                    if (t1 < rangeStart || t2 > rangeEnd) continue;

                    var v1 = prop.valueAtTime(t1, false);
                    var v2 = prop.valueAtTime(t2, false);

                    if (!hasValueChange(v1, v2)) continue;

                    var delay = (t1 - waStart) * 1000;
                    var duration = (t2 - t1) * 1000;
                    var delayStr = Math.round(delay) + "ms";
                    var durationStr = Math.round(duration) + "ms";
                    var cubic = computeCubic(srcProp, k, t1, t2, srcProp.keyValue(k), srcProp.keyValue(k + 1));

                    buildEntries(propType, prop.name, v1, v2, delayStr, durationStr, cubic, entries);
                }
            } else {
                // Fallback: sample at all collected keyframe times within range
                for (var i = 0; i < allKeyframeTimes.length - 1; i++) {
                    var t1 = allKeyframeTimes[i];
                    var t2 = allKeyframeTimes[i + 1];

                    if (t1 < rangeStart || t2 > rangeEnd) continue;

                    var v1 = prop.valueAtTime(t1, false);
                    var v2 = prop.valueAtTime(t2, false);

                    if (!hasValueChange(v1, v2)) continue;

                    var delay = (t1 - waStart) * 1000;
                    var duration = (t2 - t1) * 1000;
                    var delayStr = Math.round(delay) + "ms";
                    var durationStr = Math.round(duration) + "ms";
                    var cubic = "expression";

                    buildEntries(propType, prop.name, v1, v2, delayStr, durationStr, cubic, entries);
                }
            }
        }

        // --- RECURSIVELY SCAN ALL PROPERTIES (keyframed only) ---
        function scanProperties(group, entries, rangeStart, rangeEnd) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p;
                try { p = group.property(i); } catch (e) { continue; }
                if (p instanceof PropertyGroup) {
                    scanProperties(p, entries, rangeStart, rangeEnd);
                } else if (p instanceof Property) {
                    if (p.numKeys >= 2) {
                        processProperty(p, entries, rangeStart, rangeEnd);
                    }
                }
            }
        }

        // --- SCAN A LAYER FOR EXPRESSION-DRIVEN PROPERTIES ---
        function scanExpressionProperties(layer, entries, rangeStart, rangeEnd) {
            function scanGroupForExpressions(group) {
                for (var i = 1; i <= group.numProperties; i++) {
                    var p;
                    try { p = group.property(i); } catch (e) { continue; }
                    if (p instanceof PropertyGroup) {
                        scanGroupForExpressions(p);
                    } else if (p instanceof Property && p.numKeys < 2) {
                        try {
                            if (p.canSetExpression && p.expressionEnabled && p.expression !== "") {
                                processExpressionProperty(p, entries, rangeStart, rangeEnd);
                            }
                        } catch (e) { /* skip */ }
                    }
                }
            }
            try {
                scanGroupForExpressions(layer);
            } catch (e) { /* skip layer on error */ }
        }

        // --- COLLECT INHERITED ANIMATIONS FROM PARENT CHAIN ---
        // AE parenting inherits Position, Scale, Rotation (NOT Opacity)
        function collectInheritedAnimations(layer, entries, rangeStart, rangeEnd) {
            if (rangeStart === undefined) rangeStart = waStart;
            if (rangeEnd === undefined) rangeEnd = waEnd;
            var parent = layer.parent;
            while (parent !== null) {
                // Intersect with parent's own in/out point
                var pStart = Math.max(rangeStart, parent.inPoint);
                var pEnd = Math.min(rangeEnd, parent.outPoint);
                if (pStart >= pEnd) { parent = parent.parent; continue; }

                var transformGroup = parent.property("ADBE Transform Group");
                if (transformGroup) {
                    var parentEntries = [];
                    for (var i = 1; i <= transformGroup.numProperties; i++) {
                        var p = transformGroup.property(i);
                        if (p instanceof Property) {
                            // Skip opacity - not inherited through parenting
                            if (p.matchName === "ADBE Opacity") continue;
                            if (p.numKeys >= 2) {
                                processProperty(p, parentEntries, pStart, pEnd);
                            } else {
                                try {
                                    if (p.expressionEnabled && p.expression !== "") {
                                        processExpressionProperty(p, parentEntries, pStart, pEnd);
                                    }
                                } catch (e) { /* property doesn't support expressions */ }
                            }
                        }
                    }
                    // Label each inherited entry with the parent's name
                    var label = " (from " + parent.name + ")";
                    for (var j = 0; j < parentEntries.length; j++) {
                        var entry = parentEntries[j];
                        var firstNewline = entry.indexOf("\n");
                        entries.push(entry.substring(0, firstNewline) + label + entry.substring(firstNewline));
                    }
                }
                parent = parent.parent;
            }
        }

        // --- CHECK IF LAYER SHOULD BE SKIPPED ---
        function shouldSkipLayer(layer) {
            // Skip layers with names starting with "//"
            if (layer.name.indexOf("//") === 0) return true;

            // Skip layers with 0% opacity throughout the work area
            var opacityProp = layer.property("ADBE Transform Group").property("ADBE Opacity");
            if (opacityProp) {
                if (opacityProp.numKeys === 0) {
                    // Static or expression-driven opacity - sample across all keyframe times
                    if (opacityProp.expressionEnabled) {
                        var allZero = true;
                        for (var t = 0; t < allKeyframeTimes.length; t++) {
                            try {
                                var val = opacityProp.valueAtTime(allKeyframeTimes[t], false);
                                if (Math.round(val) !== 0) { allZero = false; break; }
                            } catch (e) { }
                        }
                        if (allZero) return true;
                    } else {
                        // Truly static, no expression - just check the value
                        if (Math.round(opacityProp.value) === 0) return true;
                    }
                } else {
                    // Keyframed opacity: check value at work area start, end, and all keyframes in between
                    var allZero = true;
                    if (Math.round(opacityProp.valueAtTime(waStart, false)) !== 0) allZero = false;
                    if (allZero && Math.round(opacityProp.valueAtTime(waEnd, false)) !== 0) allZero = false;
                    if (allZero) {
                        for (var k = 1; k <= opacityProp.numKeys; k++) {
                            var kt = opacityProp.keyTime(k);
                            if (kt >= waStart && kt <= waEnd) {
                                if (Math.round(opacityProp.keyValue(k)) !== 0) {
                                    allZero = false;
                                    break;
                                }
                            }
                        }
                    }
                    if (allZero) return true;
                }
            }

            return false;
        }

        // --- DETERMINE SELECTION MODE ---
        var output;
        var selectedLayers = comp.selectedLayers;
        var hasPropSelected = false;
        var selectedProp = null;
        var propLayer = null;

        // --- MODE 0: Selected keyframes on any property/layer ---
        // If 2+ keyframes are selected anywhere, spec only those — ignore all filtering.
        var selectedKeyframeEntries = [];
        var selectedKeyframeLayers = []; // ordered list of unique layers with selected keys

        (function () {
            // Collect all layers that have any selected keyframes
            for (var L = 0; L < selectedLayers.length; L++) {
                var layer = selectedLayers[L];
                var layerHasKeys = false;
                var layerEntries = [];

                function scanForSelectedKeys(group) {
                    for (var i = 1; i <= group.numProperties; i++) {
                        var p;
                        try { p = group.property(i); } catch (e) { continue; }
                        if (p instanceof PropertyGroup) {
                            scanForSelectedKeys(p);
                        } else if (p instanceof Property && p.numKeys >= 2) {
                            var selKeys = p.selectedKeys; // array of 1-based key indices
                            if (!selKeys || selKeys.length < 2) continue;

                            var propType = getPropertyType(p);
                            // Find first selected keyframe time for delay baseline
                            var firstSelTime = p.keyTime(selKeys[0]);

                            for (var ki = 0; ki < selKeys.length - 1; ki++) {
                                var k1 = selKeys[ki];
                                var k2 = selKeys[ki + 1];
                                var t1 = p.keyTime(k1);
                                var t2 = p.keyTime(k2);
                                var v1 = p.keyValue(k1);
                                var v2 = p.keyValue(k2);

                                if (!hasValueChange(v1, v2)) continue;

                                var delay = (t1 - firstSelTime) * 1000;
                                var duration = (t2 - t1) * 1000;
                                var delayStr = Math.round(delay) + "ms";
                                var durationStr = Math.round(duration) + "ms";
                                var cubic = computeCubic(p, k1, t1, t2, v1, v2);

                                buildEntries(propType, p.name, v1, v2, delayStr, durationStr, cubic, layerEntries);
                                layerHasKeys = true;
                            }
                        }
                    }
                }

                try { scanForSelectedKeys(layer); } catch (e) { }

                if (layerHasKeys) {
                    selectedKeyframeLayers.push({ layer: layer, entries: layerEntries });
                }
            }
        })();

        if (selectedKeyframeLayers.length > 0) {
            // MODE 0: Output only the selected keyframe specs
            var layerOutputs = [];
            for (var lk = 0; lk < selectedKeyframeLayers.length; lk++) {
                var item = selectedKeyframeLayers[lk];
                var layerNum = layerOutputs.length + 1;
                layerOutputs.push(layerNum + ". " + item.layer.name + "\n\n" + item.entries.join("\n\n"));
            }
            output = layerOutputs.join("\n\n\n");

        } else {
            // Check if a single animated property is selected on a selected layer
            // (selectedProperties includes parent PropertyGroups in the hierarchy,
            //  so filter down to actual Property instances with keyframes or expressions)
            if (selectedLayers.length === 1) {
                var selProps = selectedLayers[0].selectedProperties;
                var animatedProps = [];
                for (var p = 0; p < selProps.length; p++) {
                    if (selProps[p] instanceof Property) {
                        if (selProps[p].numKeys >= 2) {
                            animatedProps.push(selProps[p]);
                        } else if (selProps[p].expressionEnabled && selProps[p].expression !== "") {
                            animatedProps.push(selProps[p]);
                        }
                    }
                }
                if (animatedProps.length === 1) {
                    hasPropSelected = true;
                    selectedProp = animatedProps[0];
                    propLayer = selectedLayers[0];
                }
            }
        } // end else (no selected keyframes)

        if (selectedKeyframeLayers.length === 0) {
            if (hasPropSelected) {
                // MODE 1: Single property selected
                var entries = [];
                if (selectedProp.numKeys >= 2) {
                    processProperty(selectedProp, entries);
                } else {
                    processExpressionProperty(selectedProp, entries);
                }

                if (entries.length === 0) {
                    alert("No value changes detected on this property.");
                    app.endUndoGroup();
                    return;
                }

                output = propLayer.name + "\n\n" + entries.join("\n\n");

            } else if (selectedLayers.length > 0) {
                // MODE 2: Layer(s) selected - scan all properties on selected layers
                var layerOutputs = [];

                for (var L = selectedLayers.length - 1; L >= 0; L--) {
                    var layer = selectedLayers[L];
                    if (shouldSkipLayer(layer)) continue;
                    var layerEntries = [];
                    var lrStart = Math.max(waStart, layer.inPoint);
                    var lrEnd = Math.min(waEnd, layer.outPoint);
                    scanProperties(layer, layerEntries, lrStart, lrEnd);
                    scanExpressionProperties(layer, layerEntries, lrStart, lrEnd);
                    collectInheritedAnimations(layer, layerEntries, lrStart, lrEnd);

                    if (layerEntries.length > 0) {
                        var layerNum = layerOutputs.length + 1;
                        var layerBlock = layerNum + ". " + layer.name + "\n\n" + layerEntries.join("\n\n");
                        layerOutputs.push(layerBlock);
                    }
                }

                if (layerOutputs.length === 0) {
                    alert("No animated value changes detected on selected layers.");
                    app.endUndoGroup();
                    return;
                }

                output = layerOutputs.join("\n\n\n");

            } else {
                // MODE 3: Nothing selected - scan all layers in comp
                var layerOutputs = [];

                for (var L = comp.numLayers; L >= 1; L--) {
                    var layer = comp.layer(L);
                    if (shouldSkipLayer(layer)) continue;
                    var layerEntries = [];
                    var lrStart = Math.max(waStart, layer.inPoint);
                    var lrEnd = Math.min(waEnd, layer.outPoint);
                    scanProperties(layer, layerEntries, lrStart, lrEnd);
                    scanExpressionProperties(layer, layerEntries, lrStart, lrEnd);
                    collectInheritedAnimations(layer, layerEntries, lrStart, lrEnd);

                    if (layerEntries.length > 0) {
                        var layerNum = layerOutputs.length + 1;
                        var layerBlock = layerNum + ". " + layer.name + "\n\n" + layerEntries.join("\n\n");
                        layerOutputs.push(layerBlock);
                    }
                }

                if (layerOutputs.length === 0) {
                    alert("No animated value changes detected in this composition.");
                    app.endUndoGroup();
                    return;
                }

                output = layerOutputs.join("\n\n\n");
            }
        } // end if (selectedKeyframeLayers.length === 0)

        // Copy to clipboard (Mac only) - use ASCII arrow for clipboard compatibility
        try {
            var clipOutput = output.replace(/\u2192/g, "->");
            var escapedOutput = clipOutput.replace(/"/g, '\\"');
            var cmd = 'echo "' + escapedOutput + '" | pbcopy';
            system.callSystem(cmd);
        } catch (e) {
            alert("Could not copy to clipboard. Ensure 'Allow Scripts to Write Files and Access Network' is enabled in Preferences.\n\nError: " + e.toString());
        }

        // Show alert (capped at 50 lines, full output is on clipboard)
        var lines = output.split("\n");
        if (lines.length > 50) {
            var truncated = lines.slice(0, 50).join("\n");
            alert(truncated + "\n\n... (" + lines.length + " total lines, full output copied to clipboard)");
        } else {
            alert(output);
        }

        app.endUndoGroup();
    }

    main();
}
