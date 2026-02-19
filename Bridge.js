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

        if (comp.selectedLayers.length !== 1) {
            alert("Please select exactly ONE layer.");
            return;
        }

        var layer = comp.selectedLayers[0];

        app.beginUndoGroup("Export Motion Spec");

        // --- SAFE UNICODE CHARS ---
        var arrow = " \u2192 ";
        var axisLabels = ["X", "Y", "Z"];

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
            return "other";
        }

        // --- PROCESS A SINGLE PROPERTY ---
        function processProperty(prop, entries) {
            if (!(prop instanceof Property)) return;
            if (prop.numKeys < 2) return;

            var propType = getPropertyType(prop);
            var numKeys = prop.numKeys;

            for (var k = 1; k < numKeys; k++) {
                var t1 = prop.keyTime(k);
                var t2 = prop.keyTime(k + 1);
                var v1 = prop.keyValue(k);
                var v2 = prop.keyValue(k + 1);

                if (!hasValueChange(v1, v2)) continue;

                var delay = t1 * 1000;
                var duration = (t2 - t1) * 1000;
                var delayStr = Math.round(delay) + "ms";
                var durationStr = Math.round(duration) + "ms";
                var cubic = computeCubic(prop, k, t1, t2, v1, v2);

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
                        "Property: " + prop.name + "\n" +
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
                        "Property: " + prop.name + "\n" +
                        "Value Change: " + Math.round(v1) + arrow + Math.round(v2) + "\n" +
                        "Delay: " + delayStr + "\n" +
                        "Duration: " + durationStr + "\n" +
                        "Interpolation: " + cubic
                    );
                } else {
                    entries.push(
                        "Property: " + prop.name + "\n" +
                        "Value Change: " + formatValue(v1) + arrow + formatValue(v2) + "\n" +
                        "Delay: " + delayStr + "\n" +
                        "Duration: " + durationStr + "\n" +
                        "Interpolation: " + cubic
                    );
                }
            }
        }

        // --- RECURSIVELY SCAN ALL PROPERTIES ---
        function scanProperties(group, entries) {
            for (var i = 1; i <= group.numProperties; i++) {
                var p = group.property(i);
                if (p instanceof PropertyGroup) {
                    scanProperties(p, entries);
                } else if (p instanceof Property) {
                    processProperty(p, entries);
                }
            }
        }

        // --- COLLECT ALL ANIMATED PROPERTY ENTRIES ---
        var outputEntries = [];
        scanProperties(layer, outputEntries);

        if (outputEntries.length === 0) {
            alert("No animated value changes detected on this layer.");
            app.endUndoGroup();
            return;
        }

        // --- BUILD OUTPUT WITH LAYER NAME AT TOP ---
        var output = "Layer: " + layer.name + "\n\n" + outputEntries.join("\n\n");

        // Copy to clipboard (Mac only) - use ASCII arrow for clipboard compatibility
        try {
            var clipOutput = output.replace(/\u2192/g, "->");
            var escapedOutput = clipOutput.replace(/"/g, '\\"');
            var cmd = 'echo "' + escapedOutput + '" | pbcopy';
            system.callSystem(cmd);
        } catch (e) {
            alert("Could not copy to clipboard. Ensure 'Allow Scripts to Write Files and Access Network' is enabled in Preferences.\n\nError: " + e.toString());
        }

        alert(output);

        app.endUndoGroup();
    }

    main();
}
