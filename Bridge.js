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

        if (layer.selectedProperties.length !== 1) {
            alert("Please select exactly ONE animated property.");
            return;
        }

        var prop = layer.selectedProperties[0];

        if (prop.numKeys < 2) {
            alert("Property must have at least 2 keyframes.");
            return;
        }

        app.beginUndoGroup("Export Motion Spec");

        // --- PROPERTY DETECTION ---
        var mn = prop.matchName;
        var isCombinedPosition = (mn === "ADBE Position" || mn === "ADBE Anchor Point" || prop.name === "Position" || prop.name === "Anchor Point");
        var isSeparatedPosition = (mn === "ADBE Position_0" || mn === "ADBE Position_1" || mn === "ADBE Position_2");
        var isScale = (mn === "ADBE Scale" || prop.name === "Scale");
        var isOpacity = (mn === "ADBE Opacity" || prop.name === "Opacity");
        var isRotation = (mn === "ADBE Rotate Z" || mn === "ADBE Rotate X" || mn === "ADBE Rotate Y" || mn === "ADBE Orientation" || prop.name === "Rotation" || prop.name === "X Rotation" || prop.name === "Y Rotation" || prop.name === "Z Rotation");

        // --- SAFE UNICODE CHARS ---
        var arrow = " \u2192 ";

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

        // --- LOOP THROUGH KEYFRAME PAIRS ---
        var outputEntries = [];
        var axisLabels = ["X", "Y", "Z"];
        var numKeys = prop.numKeys;

        for (var k = 1; k < numKeys; k++) {
            var t1 = prop.keyTime(k);
            var t2 = prop.keyTime(k + 1);
            var v1 = prop.keyValue(k);
            var v2 = prop.keyValue(k + 1);

            // Skip pairs with no value change
            if (!hasValueChange(v1, v2)) continue;

            var delay = t1 * 1000;
            var duration = (t2 - t1) * 1000;
            var delayStr = Math.round(delay) + "ms";
            var durationStr = Math.round(duration) + "ms";
            var cubic = computeCubic(prop, k, t1, t2, v1, v2);

            if (isCombinedPosition && v1 instanceof Array) {
                // Split combined position into separate entries per changed axis
                for (var i = 0; i < v1.length && i < axisLabels.length; i++) {
                    var delta = Math.round(v2[i] - v1[i]);
                    if (delta !== 0) {
                        var sign = delta > 0 ? "+" : "";
                        outputEntries.push(
                            "Layer: " + layer.name + "\n" +
                            "Property: " + axisLabels[i] + " Position\n" +
                            "Value Change: " + sign + delta + "dp\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                }
            } else if (isSeparatedPosition) {
                var delta = Math.round(v2 - v1);
                var sign = delta > 0 ? "+" : "";
                outputEntries.push(
                    "Layer: " + layer.name + "\n" +
                    "Property: " + prop.name + "\n" +
                    "Value Change: " + sign + delta + "dp\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else if (isScale && v1 instanceof Array) {
                var sx1 = Math.round(v1[0]);
                var sy1 = Math.round(v1[1]);
                var sx2 = Math.round(v2[0]);
                var sy2 = Math.round(v2[1]);
                var xChanged = (sx1 !== sx2);
                var yChanged = (sy1 !== sy2);
                var sameChange = (sx1 === sy1 && sx2 === sy2);

                if (sameChange) {
                    outputEntries.push(
                        "Layer: " + layer.name + "\n" +
                        "Property: Scale\n" +
                        "Value Change: " + sx1 + "%" + arrow + sx2 + "%\n" +
                        "Delay: " + delayStr + "\n" +
                        "Duration: " + durationStr + "\n" +
                        "Interpolation: " + cubic
                    );
                } else {
                    if (xChanged) {
                        outputEntries.push(
                            "Layer: " + layer.name + "\n" +
                            "Property: X Scale\n" +
                            "Value Change: " + sx1 + "%" + arrow + sx2 + "%\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                    if (yChanged) {
                        outputEntries.push(
                            "Layer: " + layer.name + "\n" +
                            "Property: Y Scale\n" +
                            "Value Change: " + sy1 + "%" + arrow + sy2 + "%\n" +
                            "Delay: " + delayStr + "\n" +
                            "Duration: " + durationStr + "\n" +
                            "Interpolation: " + cubic
                        );
                    }
                }
            } else if (isOpacity) {
                outputEntries.push(
                    "Layer: " + layer.name + "\n" +
                    "Property: Opacity\n" +
                    "Value Change: " + Math.round(v1) + "%" + arrow + Math.round(v2) + "%\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else if (isRotation) {
                outputEntries.push(
                    "Layer: " + layer.name + "\n" +
                    "Property: " + prop.name + "\n" +
                    "Value Change: " + Math.round(v1) + arrow + Math.round(v2) + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else {
                outputEntries.push(
                    "Layer: " + layer.name + "\n" +
                    "Property: " + prop.name + "\n" +
                    "Value Change: " + formatValue(v1) + arrow + formatValue(v2) + "\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            }
        }

        if (outputEntries.length === 0) {
            alert("No value changes detected between keyframes.");
            app.endUndoGroup();
            return;
        }

        var output = outputEntries.join("\n\n");

        // Copy to clipboard (Mac only)
        try {
            var escapedOutput = output.replace(/"/g, '\\"');
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
