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

        if (prop.numKeys !== 2) {
            alert("This script currently supports exactly 2 keyframes.");
            return;
        }

        app.beginUndoGroup("Export Motion Spec");

        // --- KEYFRAME DATA ---
        var t1 = prop.keyTime(1);
        var t2 = prop.keyTime(2);

        var v1 = prop.keyValue(1);
        var v2 = prop.keyValue(2);

        var easeOut = prop.keyOutTemporalEase(1)[0];
        var easeIn = prop.keyInTemporalEase(2)[0];

        var influenceOut = easeOut.influence;
        var speedOut = easeOut.speed;

        var influenceIn = easeIn.influence;
        var speedIn = easeIn.speed;

        // --- TIMING ---
        var delay = t1 * 1000; // from 0s timeline
        var duration = (t2 - t1) * 1000;

        // --- PROPERTY DETECTION ---
        var mn = prop.matchName;
        var isCombinedPosition = (mn === "ADBE Position" || mn === "ADBE Anchor Point" || prop.name === "Position" || prop.name === "Anchor Point") && (v1 instanceof Array);
        var isSeparatedPosition = (mn === "ADBE Position_0" || mn === "ADBE Position_1" || mn === "ADBE Position_2");
        var isScale = (mn === "ADBE Scale" || prop.name === "Scale");
        var isOpacity = (mn === "ADBE Opacity" || prop.name === "Opacity");
        var isRotation = (mn === "ADBE Rotate Z" || mn === "ADBE Rotate X" || mn === "ADBE Rotate Y" || mn === "ADBE Orientation" || prop.name === "Rotation" || prop.name === "X Rotation" || prop.name === "Y Rotation" || prop.name === "Z Rotation");

        // --- CHECK INTERPOLATION TYPE ---
        var outType = prop.keyOutInterpolationType(1);
        var inType = prop.keyInInterpolationType(2);
        var isLinear = (outType === KeyframeInterpolationType.LINEAR && inType === KeyframeInterpolationType.LINEAR);

        // --- SAFE UNICODE CHARS ---
        var arrow = " \u2192 ";

        // --- CUBIC BEZIER CONVERSION ---
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

        var cubic;

        if (isLinear) {
            cubic = "0.00, 0.00, 1.00, 1.00";
        } else {
            var deltaValue;

            if (v1 instanceof Array) {
                deltaValue = v2[0] - v1[0];
            } else {
                deltaValue = v2 - v1;
            }

            var deltaTime = t2 - t1;
            var avgSpeed = deltaValue / deltaTime;

            var x1 = influenceOut / 100;
            var x2 = 1 - (influenceIn / 100);

            var y1 = 0;
            var y2 = 1;

            if (avgSpeed !== 0) {
                y1 = (speedOut / avgSpeed) * x1;
                y2 = 1 - ((speedIn / avgSpeed) * (1 - x2));
            }

            x1 = clamp(x1);
            y1 = clamp(y1);
            x2 = clamp(x2);
            y2 = clamp(y2);

            cubic = round2(x1) + ", " +
                round2(y1) + ", " +
                round2(x2) + ", " +
                round2(y2);
        }

        // --- BUILD OUTPUT ---
        var outputEntries = [];
        var axisLabels = ["X", "Y", "Z"];
        var delayStr = Math.round(delay) + "ms";
        var durationStr = Math.round(duration) + "ms";

        if (isCombinedPosition) {
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
            if (outputEntries.length === 0) {
                outputEntries.push("No position change detected.");
            }
        } else if (isSeparatedPosition) {
            // Separated dimension: single delta
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
            // Scale property: only X (index 0) and Y (index 1), ignore Z
            var sx1 = Math.round(v1[0]);
            var sy1 = Math.round(v1[1]);
            var sx2 = Math.round(v2[0]);
            var sy2 = Math.round(v2[1]);
            var xChanged = (sx1 !== sx2);
            var yChanged = (sy1 !== sy2);
            var sameChange = (sx1 === sy1 && sx2 === sy2);

            if (sameChange) {
                // X and Y change identically: single Scale entry
                outputEntries.push(
                    "Layer: " + layer.name + "\n" +
                    "Property: Scale\n" +
                    "Value Change: " + sx1 + "%" + arrow + sx2 + "%\n" +
                    "Delay: " + delayStr + "\n" +
                    "Duration: " + durationStr + "\n" +
                    "Interpolation: " + cubic
                );
            } else {
                // X and Y differ: separate entries for each changed axis
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
                if (outputEntries.length === 0) {
                    outputEntries.push("No scale change detected.");
                }
            }
        } else if (isOpacity) {
            // Opacity: start -> end with %
            outputEntries.push(
                "Layer: " + layer.name + "\n" +
                "Property: Opacity\n" +
                "Value Change: " + Math.round(v1) + "%" + arrow + Math.round(v2) + "%\n" +
                "Delay: " + delayStr + "\n" +
                "Duration: " + durationStr + "\n" +
                "Interpolation: " + cubic
            );
        } else if (isRotation) {
            // Rotation: start -> end
            outputEntries.push(
                "Layer: " + layer.name + "\n" +
                "Property: " + prop.name + "\n" +
                "Value Change: " + Math.round(v1) + arrow + Math.round(v2) + "\n" +
                "Delay: " + delayStr + "\n" +
                "Duration: " + durationStr + "\n" +
                "Interpolation: " + cubic
            );
        } else {
            // Other properties: start -> end
            function formatValue(val) {
                if (val instanceof Array) {
                    return val.join(", ");
                }
                return val;
            }
            outputEntries.push(
                "Layer: " + layer.name + "\n" +
                "Property: " + prop.name + "\n" +
                "Value Change: " + formatValue(v1) + arrow + formatValue(v2) + "\n" +
                "Delay: " + delayStr + "\n" +
                "Duration: " + durationStr + "\n" +
                "Interpolation: " + cubic
            );
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
