/**
 * Bridge — CEP Panel Logic
 * Communicates with Bridge.jsx via CSInterface.evalScript()
 */

var csInterface = new CSInterface();

// ── DOM refs ─────────────────────────────────────────────────

var elOutput = document.getElementById('output');
var elModeDesc = document.getElementById('mode-desc');
var elCopy = document.getElementById('copy-btn');
var elClear = document.getElementById('clear-btn');
var elBtnAuto = document.getElementById('btn-auto');
var elBtnKeys = document.getElementById('btn-keys');
var elBtnLayers = document.getElementById('btn-layers');
var elBtnComp = document.getElementById('btn-comp');
var elHelp = document.getElementById('help-btn');

// ── Status helpers ────────────────────────────────────────────

function setDesc(msg, cls) {
    elModeDesc.textContent = msg;
    elModeDesc.className = cls || '';
}

// ── Run extraction ────────────────────────────────────────────

function run(forceMode, label) {
    // Highlight active button
    [elBtnAuto, elBtnKeys, elBtnLayers, elBtnComp].forEach(function (b) {
        b.classList.remove('active');
    });
    var activeBtn = { undefined: elBtnAuto, 0: elBtnKeys, 2: elBtnLayers, 3: elBtnComp }[forceMode];
    if (activeBtn) activeBtn.classList.add('active');

    var modeArg = (forceMode === undefined) ? 'undefined' : String(forceMode);
    var script = 'runExtraction(' + modeArg + ')';

    csInterface.evalScript(script, function (resultStr) {
        try {
            var result = JSON.parse(resultStr);
            if (result.error) {
                elOutput.value = '';
                setDesc('⚠ ' + result.error, 'error');
            } else {
                elOutput.value = result.output || '';
                var lines = (result.output || '').split('\n').length;
                setDesc('Mode: ' + result.modeUsed + '  —  ' + lines + ' lines');
            }
        } catch (e) {
            setDesc('⚠ Could not parse result from ExtendScript.', 'error');
        }
    });
}

// ── Button handlers ───────────────────────────────────────────

elBtnAuto.addEventListener('click', function () { run(undefined); });
elBtnKeys.addEventListener('click', function () { run(0); });
elBtnLayers.addEventListener('click', function () { run(2); });
elBtnComp.addEventListener('click', function () { run(3); });

elClear.addEventListener('click', function () {
    elOutput.value = '';
    setDesc('Select keyframes, a layer, or nothing — then press Auto.');
    [elBtnAuto, elBtnKeys, elBtnLayers, elBtnComp].forEach(function (b) {
        b.classList.remove('active');
    });
});

elCopy.addEventListener('click', function () {
    var text = elOutput.value;
    if (!text) return;
    // Try modern clipboard API first, fall back to execCommand
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
            elCopy.textContent = '✓ Copied!';
        }).catch(function () {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
});

elCopy.addEventListener('mouseleave', function () {
    elCopy.textContent = 'Copy to Clipboard';
});

function fallbackCopy(text) {
    elOutput.select();
    try {
        document.execCommand('copy');
        elCopy.textContent = '✓ Copied!';
    } catch (e) {
        elCopy.textContent = '⚠ Copy failed';
    }
}

// ── Help button ───────────────────────────────────────────────

elHelp.addEventListener('click', function () {
    csInterface.openURLInDefaultBrowser('https://www.notion.so/Bridge-js-Designer-Workflow-Guide-30e5f0c09a8080a39a98d5176c915c7f?source=copy_link');
});
