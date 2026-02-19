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

        // --- VALUE CHANGE ---
        function formatValue(val) {
            if (val instanceof Array) {
                return val.join(", ");
            }
            return val;
        }

        var valueChange = formatValue(v1) + " → " + formatValue(v2);

        // --- CHECK INTERPOLATION TYPE ---
        var outType = prop.keyOutInterpolationType(1);
        var inType = prop.keyInInterpolationType(2);
        var isLinear = (outType === KeyframeInterpolationType.LINEAR && inType === KeyframeInterpolationType.LINEAR);

        // --- CUBIC BEZIER CONVERSION ---
        var cubic;

        if (isLinear) {
            cubic = "cubic-bezier(0.00, 0.00, 1.00, 1.00)";
        } else {
            var deltaValue;

            if (v1 instanceof Array) {
                deltaValue = v2[0] - v1[0]; // use first dimension for speed calc
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

            function clamp(v) {
                return Math.min(Math.max(v, 0), 1);
            }

            x1 = clamp(x1);
            y1 = clamp(y1);
            x2 = clamp(x2);
            y2 = clamp(y2);

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

            cubic = "cubic-bezier(" +
                round2(x1) + ", " +
                round2(y1) + ", " +
                round2(x2) + ", " +
                round2(y2) + ")";
        }

        // --- OUTPUT ---
        var output =
            "Layer: " + layer.name + "\n" +
            "Property: " + prop.name + "\n" +
            "Value Change: " + valueChange + "\n" +
            "Delay: " + Math.round(delay) + "ms\n" +
            "Duration: " + Math.round(duration) + "ms\n" +
            "Interpolation: " + cubic;

        // Copy to clipboard (Mac + Windows compatible hack)
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
