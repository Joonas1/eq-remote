// --- Helpers ---
const $ = id => document.getElementById(id);
const setStyle = (el, styles) => Object.assign(el.style, styles);
const gainToY = gain => eqCanvas.height / 2 - (gain / 12) * (eqCanvas.height / 2.5);
function quantizeField(key, value) {
    switch (key) {
        case 'freq':
            // integer Hz
            return Math.round(value);
        case 'gain':
            // one decimal
            return Math.round(value * 10) / 10;
        case 'Q':
            // one decimal
            return Math.round(value * 10) / 10;
        default:
            return value;
    }
}

// Normalize lastSeen (could be epoch seconds, epoch millis, or millis since boot)
function normalizeLastSeen(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 0;

    // epoch millis (e.g., 1_7xx_xxx_xxx_000)
    if (v > 1e11) return v;

    // epoch seconds (e.g., 1_7xx_xxx_xxx)
    if (v > 3e8) return v * 1000;

    // millis since boot (e.g., a few million to a few billion)
    return v;
}

// --- Settings and Firebase URL ---Helper
let FIREBASE_BASE = localStorage.getItem('firebaseBase') || '';
let STATE_URL = FIREBASE_BASE ? FIREBASE_BASE + '/state.json' : null;

function getAuthQuery() {
    const auth = localStorage.getItem('firebaseAuth');
    return auth ? `?auth=${auth}` : '';
}

function getFirebaseUrl() {
    if (!FIREBASE_BASE) {
        console.warn("No Firebase URL set. Running in offline mode.");
        return null;
    }
    return FIREBASE_BASE + '/state.json' + getAuthQuery();
}

// generic field updater (granular writes!)
async function updateFirebaseField(path, value) {
    if (!FIREBASE_BASE) return;

    // extract the last segment of the path (e.g. "bands/3/freq" -> "freq")
    const parts = path.split('/');
    const leafKey = parts[parts.length - 1];

    // snap outgoing value according to rules
    const snapped = quantizeField(leafKey, value);

    const url = `${FIREBASE_BASE}/state/${path}.json${getAuthQuery()}`;

    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapped)
        });
        if (!res.ok) {
            console.error('Firebase update failed:', res.status, await res.text());
        }
    } catch (err) {
        console.error('Firebase update error:', err);
    }
}


function setFirebaseUrl(newUrl) {
    if (newUrl && newUrl.endsWith('/')) newUrl = newUrl.slice(0, -1);
    FIREBASE_BASE = newUrl;
    STATE_URL = FIREBASE_BASE ? (FIREBASE_BASE + '/state.json' + getAuthQuery()) : null;
    localStorage.setItem('firebaseBase', newUrl);
    showToast("✅ Firebase URL saved locally", "success");
    loadStateFromServer();
    updateFullConnectionStatus();
}

async function deleteProfile(nameWithJson) {
    if (!FIREBASE_BASE) {
        showToast('❌ Firebase URL not set', 'error');
        return false;
    }
    const url = `${FIREBASE_BASE}/profiles/${nameWithJson}.json${getAuthQuery()}`;
    try {
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return true;
    } catch (err) {
        console.error('Failed to delete profile:', err);
        showToast('❌ Failed to delete profile', 'error');
        return false;
    }
}

// --- DOM ---
const eqContainer = $('eqContainer');
const eqCanvas = $('eqCanvas');
const controlsContainer = $('controlsContainer');
const ctx = eqCanvas.getContext('2d');
const dbContainer = $('dbContainer');
const topControls = $('topControls');
const controlButtons = $('topControls').querySelectorAll('button');
const settingButtons = $('topSettings').querySelectorAll('button');
const controls = $('controls');
const gainSlider = $('gainSlider');
const gainValue = $('gainValue');
const powerButton = $('powerButton');
const gainInput = $('gainInput');
const powerOverlay = $('powerOverlay');
const topSettings = $('topSettings');
const closeSettingsModal = $('closeSettingsModal');
const settingsModal = $('settingsModal');
const saveModal = $('saveModal');
const saveFileName = $('saveFileName');
const confirmSaveButton = $('confirmSaveButton');
const closeSaveModal = $('closeSaveModal');
const loadModal = $('loadModal');
const closeLoadModal = $('closeLoadModal');
const bandInfo = $('bandInfo');
const listItems = $('scrollList').querySelectorAll('.listItem');
const connectionOverlay = $('connectionOverlay');
const downloadStateButton = $('downloadJSON');
const firebaseUrlInput = $('firebaseUrlInput');
const firebaseAuthInput = $('firebaseAuthInput');
const saveSettingsButton = $('saveSettingsButton');
const openConstantsModal = $('openConstantsModal');
const constantsModal = $('constantsModal');
const constantsForm = $('constantsForm');
const saveConstantsButton = $('saveConstantsButton');
const closeConstantsModal = $('closeConstantsModal');
const resetConstantsButton = $('resetConstantsButton');


// Load user overrides first
const savedConstants = JSON.parse(localStorage.getItem('userConstants') || '{}');
Object.assign(window.CONSTANTS, savedConstants);

// Destructure after merging (so new values apply)
const {
  DB_LINE_COLOR, FREQ_LINE_COLOR, CENTER_LINE_COLOR, LABEL_COLOR,
  CURVE_COLOR, CURVE_COLOR_OFF, REFERENCE_GAINS, FREQ_LABELS,
  FREQ_LABELS_TO_SHOW, LINE_WIDTH, CANVAS_WIDTH, CANVAS_HEIGHT,
  CIRCLE_RADIUS, BANDS, LABEL_FONT, POWER, DEFAULT_NAME
} = window.CONSTANTS;


// set theme vars
const root = document.documentElement;
root.style.setProperty('--color-accent', window.CONSTANTS.CURVE_COLOR);
root.style.setProperty('--color-inactive', window.CONSTANTS.CURVE_COLOR_OFF);
root.style.setProperty('--color-muted', window.CONSTANTS.LABEL_COLOR);

// --- State ---
let bands = BANDS.map(b => ({ ...b, x: freqToPixel(b.freq), y: gainToY(b.gain) }));
let overallGain = 0;
let selectedBand = null;
let draggingBand = null;
let power = POWER;
let connection = false;
let currentProfile = DEFAULT_NAME;

// --- Load state from Firebase (full GET once) ---
async function loadStateFromServer() {
    try {
        const url = getFirebaseUrl();
        if (!url) return;

        const res = await fetch(url);
        const data = await res.json();

        if (!data) {
            console.warn("No state found in Firebase");
            return;
        }

        overallGain = data.gain ?? 0;
        power = data.power ?? true;

        if (data.bands) {
            data.bands.forEach((bandData, i) => {
                if (bands[i]) {
                    bands[i].type = bandData.type;
                    bands[i].freq = bandData.freq;
                    bands[i].gain = bandData.gain;
                    bands[i].Q = bandData.Q;
                    bands[i].enabled = bandData.enabled;
                }
            });
        }

        gainSlider.value = overallGain;
        gainInput.value = overallGain.toFixed(1);
        gainValue.innerText = `${overallGain.toFixed(1)} dB`;

        powerButton.classList.toggle('active', power);
        controlButtons.forEach((btn, i) =>
            btn.classList.toggle('active', bands[i].enabled && power)
        );

        drawScene();
    } catch (err) {
        console.error("Failed to load state from Firebase:", err);
    }
}

// --- Save full state to Firebase (full PUT) ---
async function saveFullStateToServer(filename = "default.json") {
    try {
        if (!FIREBASE_BASE) return;

        const newState = {
            gain: Math.round(overallGain * 10) / 10,
            power: power,
            bands: bands.map(b => ({
                type: b.type,
                freq: Math.round(b.freq),
                gain: Math.round(b.gain * 10) / 10,
                Q: Math.round(b.Q * 10) / 10,
                enabled: b.enabled
            })),
            filename,
            version: 1
        };

        const url = `${FIREBASE_BASE}/state.json${getAuthQuery()}`;

        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newState)
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log("Saved full state to Firebase successfully");
    } catch (err) {
        console.error("Failed to save full state:", err);
    }
}

function buildCurrentStateObject(filename = "state.json") {
    return {
        gain: Math.round(overallGain * 10) / 10,
        power: power,
        bands: bands.map(b => ({
            type: b.type,
            freq: Math.round(b.freq),
            gain: Math.round(b.gain * 10) / 10,
            Q: Math.round(b.Q * 10) / 10,
            enabled: b.enabled
        })),
        filename,
        version: 1
    };
}

function downloadStateJson() {
    // Build the current quantized state
    const stateObj = buildCurrentStateObject(currentProfile || "state.json");

    // Pretty-print JSON for readability
    const jsonStr = JSON.stringify(stateObj, null, 2);

    // Create a Blob and a temporary <a> to trigger download
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'state.json'; // final filename user gets
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

let firebaseReachable = false;
let esp32Online = false;
let esp32LastSeen = 0;

async function updateFullConnectionStatus() {
    const el = document.getElementById("connectionStatus");
    if (!el) return;

    // 1) Check Firebase reachability (use shallow GET; HEAD isn’t allowed)
    try {
        const url = getFirebaseUrl();
        if (!url) throw new Error("No URL");
        const joiner = url.includes("?") ? "&" : "?";
        const res = await fetch(url + joiner + "shallow=true", { method: "GET", cache: "no-store" });
        firebaseReachable = res.ok;
    } catch {
        firebaseReachable = false;
    }

    // 2) Heartbeat data
    if (firebaseReachable) {
        try {
            const [resOnline, resLast] = await Promise.all([
                fetch(`${FIREBASE_BASE}/status/esp32Online.json${getAuthQuery()}`, { cache: "no-store" }),
                fetch(`${FIREBASE_BASE}/status/lastSeen.json${getAuthQuery()}`, { cache: "no-store" })
            ]);
            esp32Online = await resOnline.json();
            esp32LastSeen = await resLast.json();
        } catch {
            esp32Online = false;
            esp32LastSeen = 0;
        }
    } else {
        esp32Online = false;
        esp32LastSeen = 0;
    }

    // 3) Convert lastSeen to ms for comparison
    const lastSeenMs = normalizeLastSeen(esp32LastSeen);
    const fresh = (Date.now() - lastSeenMs) < 15000; // 15s window

    // 4) UI text + classes
    if (!firebaseReachable) {
        el.textContent = "⚠️ Firebase unreachable";
        el.classList.add("disconnected");
        el.classList.remove("connected");
    } else if (esp32Online && fresh) {
        el.textContent = "🟢 ESP32 Connected (via Firebase)";
        el.classList.add("connected");
        el.classList.remove("disconnected");
    } else {
        let text = "?";
        if (lastSeenMs) {
            const diffSec = Math.floor((Date.now() - lastSeenMs) / 1000);

            if (diffSec < 60) {
                // under a minute
                text = `${diffSec}s`;
            } else if (diffSec < 3600) {
                // 1–59 minutes
                const mins = Math.floor(diffSec / 60);
                const secs = diffSec % 60;
                text = `${mins}m ${secs}s`;
            } else if (diffSec < 86400) {
                // 1–23 hours
                const hours = Math.floor(diffSec / 3600);
                const mins = Math.floor((diffSec % 3600) / 60);
                text = `${hours}h ${mins}m`;
            } else {
                // over a day
                const days = Math.floor(diffSec / 86400);
                const hours = Math.floor((diffSec % 86400) / 3600);
                text = `${days}d ${hours}h`;
            }
        }

        el.textContent = `🔴 ESP32 Offline (last seen ${text} ago)`;
        el.classList.add("disconnected");
        el.classList.remove("connected");
    }


    // 5) Logical connection affects controls/overlays
    connection = firebaseReachable; // DB reachability gates UI interactivity
    powerStateUpdate();
}

// Small wrapper so your init() call remains valid
function updateConnectionStatus() {
    return updateFullConnectionStatus();
}

// keep your existing polling
setInterval(updateFullConnectionStatus, 3000);

// --- Layout ---
function setContainerSize() {
    setStyle(eqContainer, { width: CANVAS_WIDTH * 1.15 + 'px', height: CANVAS_HEIGHT * 1.2 + 'px' });
    setStyle(dbContainer, { width: CANVAS_WIDTH * 1.38 + 'px', height: CANVAS_HEIGHT + 'px', margin: '0 ' + CANVAS_WIDTH * 0.01 + 'px' });
    Object.assign(eqCanvas, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    eqCanvas.style.margin = '0 ' + CANVAS_WIDTH * 0.04 + 'px';

    setStyle(topControls, { width: CANVAS_WIDTH + 'px', margin: CANVAS_HEIGHT * 0.04 + 'px ' + CANVAS_WIDTH * 0.05 + 'px' });
    controlButtons.forEach(btn => setStyle(btn, {
        width: CANVAS_WIDTH / 7 + 'px',
        height: CANVAS_HEIGHT * 0.05 + 'px',
        fontSize: CANVAS_HEIGHT * 0.025 + 'px'
    }));

    setStyle(controlsContainer, { width: CANVAS_WIDTH * 0.25 + 'px', height: CANVAS_HEIGHT * 1.2 + 'px' });
    setStyle(topSettings, { width: CANVAS_WIDTH * 0.20 + 'px', margin: CANVAS_HEIGHT * 0.04 + 'px ' + CANVAS_WIDTH * 0.025 + 'px' });
    settingButtons.forEach(btn => setStyle(btn, {
        width: (CANVAS_WIDTH * 0.20) / 4 + 'px',
        height: CANVAS_HEIGHT * 0.05 + 'px',
        fontSize: CANVAS_HEIGHT * 0.025 + 'px'
    }));

    setStyle(bandInfo, {
        width: CANVAS_WIDTH * 0.20 + 'px',
        height: CANVAS_HEIGHT + 'px',
        margin: '0 ' + CANVAS_WIDTH * 0.025 + 'px',
    });

    setStyle(powerButton, {
        position: 'absolute',
        top: CANVAS_HEIGHT * 0.05 + 'px',
        right: CANVAS_WIDTH * 0.03 + 'px',
        width: CANVAS_WIDTH * 0.05 + 'px',
        height: CANVAS_HEIGHT * 0.07 + 'px',
    });

    setStyle(controls, {
        position: 'absolute',
        left: CANVAS_WIDTH * 1.065 + 'px',
        top: '0px',
        height: CANVAS_HEIGHT + 'px',
        width: CANVAS_WIDTH * 0.05 + 'px'
    });

    setStyle(gainSlider, {
        transform: 'rotate(-90deg)',
        width: CANVAS_HEIGHT * 0.82 + 'px',
        position: 'absolute',
        top: CANVAS_HEIGHT * 0.485 + 'px',
        left: -CANVAS_WIDTH * 0.181 + 'px'
    });

    setStyle(gainInput, {
        position: 'absolute',
        top: CANVAS_HEIGHT * 0.94 + 'px',
        left: CANVAS_WIDTH * 0.0035 + 'px',
        width: CANVAS_WIDTH * 0.04 + 'px',
    });

    dbContainer.querySelectorAll('.db-label, .hz-label').forEach(el => el.remove());
    drawDBLabels();
    drawFreqLabels();
    drawScene();
}

// --- Drawing ---
function drawScene() {
    ctx.clearRect(0, 0, eqCanvas.width, eqCanvas.height);
    drawDBLines();
    drawFreqLines();
    drawEQCurve();
}

function drawDBLines() {
    REFERENCE_GAINS.forEach(gain => {
        const y = gainToY(gain * 12 / REFERENCE_GAINS[0]);
        ctx.beginPath();
        ctx.strokeStyle = gain === 0 ? CENTER_LINE_COLOR : DB_LINE_COLOR;
        ctx.lineWidth = gain === 0 ? LINE_WIDTH + 1 : LINE_WIDTH;
        ctx.moveTo(0, y);
        ctx.lineTo(eqCanvas.width, y);
        ctx.stroke();
    });
}

function drawFreqLines() {
    FREQ_LABELS.forEach(freq => {
        const x = freqToPixel(freq);
        ctx.beginPath();
        ctx.strokeStyle = FREQ_LINE_COLOR;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, eqCanvas.height);
        ctx.stroke();
    });
}

function drawDBLabels() {
    REFERENCE_GAINS.forEach(gain => {
        const label = document.createElement('div');
        setStyle(label, {
            position: 'absolute',
            left: '0px',
            top: gainToY(gain * 12 / REFERENCE_GAINS[0]) - 8 + 'px',
            width: CANVAS_WIDTH * 0.035 + 'px',
            textAlign: 'right',
            color: LABEL_COLOR,
            font: LABEL_FONT
        });
        label.className = 'db-label';
        label.innerText = `${gain}`;
        dbContainer.appendChild(label);
    });
}

function drawFreqLabels() {
    FREQ_LABELS_TO_SHOW.forEach(freq => {
        const label = document.createElement('div');
        setStyle(label, {
            position: 'absolute',
            top: (eqCanvas.height * 1.01) + 'px',
            left: freqToPixel(freq) + CANVAS_WIDTH * 0.035 + 'px',
            width: '50px',
            textAlign: 'left',
            color: LABEL_COLOR,
            font: LABEL_FONT
        });
        label.className = 'hz-label';
        label.innerText = freq >= 1000 ? (freq / 1000) + 'k' : freq;
        dbContainer.appendChild(label);
    });
}

function drawEQCurve() {
    ctx.beginPath();
    ctx.strokeStyle = power && connection ? CURVE_COLOR : CURVE_COLOR_OFF;
    ctx.lineWidth = 3;

    const minF = 10, maxF = 30000, steps = 500;
    for (let i = 0; i <= steps; i++) {
        const freq = minF * Math.pow(maxF / minF, i / steps);
        const x = freqToPixel(freq);
        const y = gainToY(totalGainAtFreq(freq));
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();

    bands.forEach(band => {
        if (!band.enabled) return;
        const totalBandGain = band.gain + overallGain;
        band.x = freqToPixel(band.freq);
        band.y = gainToY(totalBandGain);

        ctx.beginPath();
        ctx.fillStyle = power && connection ? CURVE_COLOR : CURVE_COLOR_OFF;
        ctx.arc(band.x, band.y, CIRCLE_RADIUS, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        if (selectedBand === band) {
            ctx.beginPath();
            ctx.arc(band.x, band.y, CIRCLE_RADIUS * 1.5, 0, 2 * Math.PI);
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    });
}

// --- Math helpers ---
function bandGainAtFreq(f, band) {
    const ratio = f / band.freq;
    const dist = Math.log2(ratio);

    switch (band.type) {
        case "bell":
            return band.gain * Math.exp(-0.5 * (dist * band.Q) ** 2);
        case "lowshelf":
            return band.gain / (1 + Math.exp(8 * dist));
        case "highshelf":
            return band.gain / (1 + Math.exp(-8 * dist));
        case "lowcut":
            return -60 / (1 + Math.exp(8 * dist * band.Q));
        case "highcut":
            return -60 / (1 + Math.exp(-8 * dist * band.Q));
        default:
            return 0;
    }
}

function totalGainAtFreq(f) {
    return bands.reduce((sum, b) => b.enabled ? sum + bandGainAtFreq(f, b) : sum, 0) + overallGain;
}

function freqToPixel(freq) {
    const minF = 10, maxF = 30000;
    const frac = (Math.log10(freq) - Math.log10(minF)) / (Math.log10(maxF) - Math.log10(minF));
    return frac * eqCanvas.width;
}

function freqSliderToFreq(sliderValue, minFreq = 10, maxFreq = 30000) {
    return minFreq * Math.pow(maxFreq / minFreq, sliderValue); // slider 0–1
}

function freqToSliderValue(freq, minFreq = 10, maxFreq = 30000) {
    return Math.log(freq / minFreq) / Math.log(maxFreq / minFreq);
}

function qSliderToQ(sliderValue, minQ = 0.1, maxQ = 10) {
    return minQ * Math.pow(maxQ / minQ, sliderValue);
}

function qToSliderValue(Q, minQ = 0.1, maxQ = 10) {
    return Math.log(Q / minQ) / Math.log(maxQ / minQ);
}

// --- UI helpers ---
function highlightBandListItem(band) {
    listItems.forEach((item, i) => {
        if (bands[i] === band && bands[i].enabled) {
            item.classList.add('highlighted');
        } else {
            item.classList.remove('highlighted');
        }
    });
}

function updateListItemState() {
    listItems.forEach((item, i) => {
        if (bands[i].enabled && power && connection) {
            item.classList.remove('inactive');
            if (bands[i] === selectedBand) {
                item.classList.add('highlighted');
            }
        } else {
            item.classList.add('inactive');
            item.classList.remove('highlighted');
        }
    });
}

// --- Events ---

// toggle band enable
controlButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
        if (!power || !connection) return;
        bands[i].enabled = !bands[i].enabled;
        button.classList.toggle('active', bands[i].enabled);
        updateListItemState();
        drawScene();
        updateFirebaseField(`bands/${i}/enabled`, bands[i].enabled);
    });
});

// power toggle
powerButton.addEventListener('click', () => {
    if (!connection) return;
    power = !power;
    powerButton.classList.toggle('active', power);
    powerStateUpdate();
    updateFirebaseField('power', power);
});

function powerStateUpdate() {
    controlButtons.forEach((btn, i) => {
        if (power && connection && bands[i].enabled) {
            btn.classList.remove('stby');
            btn.classList.add('active');
        } else if (!power && bands[i].enabled) {
            btn.classList.add('stby');
            btn.classList.remove('active');
        } else {
            btn.classList.remove('stby');
            btn.classList.remove('active');
        }
    });

    gainInput.disabled = !power || !connection;
    gainSlider.disabled = !power || !connection;

    powerOverlay.classList.toggle('active', !power);
    connectionOverlay.classList.toggle('active', !connection);

    updateListItemState();
    drawScene();
}

// settings modals etc (unchanged except no saveStateToServer calls)
closeSettingsModal.addEventListener('click', () => { settingsModal.style.display = 'none'; });
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.style.display = 'none'; });
closeSaveModal.addEventListener('click', () => { saveModal.style.display = 'none'; });
saveModal.addEventListener('click', e => { if (e.target === saveModal) saveModal.style.display = 'none'; });
closeLoadModal.addEventListener('click', () => { loadModal.style.display = 'none'; });
loadModal.addEventListener('click', e => { if (e.target === loadModal) loadModal.style.display = 'none'; });
closeConstantsModal.addEventListener('click', () => { constantsModal.style.display = 'none'; });
constantsModal.addEventListener('click', e => { if (e.target === constantsModal) constantsModal.style.display = 'none'; });

settingButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
        if (!connection && i !== 3) return;
        switch (i) {
            case 0: // Save profile (opens modal)
                saveFileName.value = '';
                saveModal.style.display = 'flex';
                saveFileName.focus();
                break;
            case 1: // Load profile
                openLoadModal();
                break;
            case 2: // Reset EQ to defaults
                resetEQ();
                break;
            case 3: // Settings modal
                settingsModal.style.display = 'flex';
                break;
        }
    });
});

// --- Settings Modal Logic ---
if (firebaseUrlInput) firebaseUrlInput.value = localStorage.getItem('firebaseBase') || '';
if (firebaseAuthInput) firebaseAuthInput.value = localStorage.getItem('firebaseAuth') || '';

if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', () => {
        const newUrl = (firebaseUrlInput.value || '').trim().replace(/\/$/, '');
        const newAuth = (firebaseAuthInput.value || '').trim();

        localStorage.setItem('firebaseBase', newUrl);
        localStorage.setItem('firebaseAuth', newAuth);

        FIREBASE_BASE = newUrl;
        STATE_URL = FIREBASE_BASE ? (FIREBASE_BASE + '/state.json' + getAuthQuery()) : null;

        showToast("✅ Firebase settings saved", "success");
        settingsModal.style.display = 'none';

        loadStateFromServer();
        updateFullConnectionStatus();
    });
}

if (downloadStateButton) {
    downloadStateButton.addEventListener('click', () => {
        downloadStateJson();
        showToast("⬇ Downloaded state.json", "success");
    });
}

// --- Save profile to /profiles/filename.json ---
confirmSaveButton.addEventListener('click', async () => {
    const filename = saveFileName.value.trim();
    if (!filename) {
        showToast('❌ No filename provided', 'error');
        return;
    }

    const newState = {
        gain: Math.round(overallGain * 10) / 10,
        power: power,
        bands: bands.map(b => ({
            type: b.type,
            freq: Math.round(b.freq),
            gain: Math.round(b.gain * 10) / 10,
            Q: Math.round(b.Q * 10) / 10,
            enabled: b.enabled
        })),
        savedAt: new Date().toISOString()
    };

    try {
        if (!FIREBASE_BASE) {
            showToast('❌ Firebase URL not set', 'error');
            return;
        }

        const url = `${FIREBASE_BASE}/profiles/${filename}.json${getAuthQuery()}`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newState)
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        currentProfile = filename;
        updateProfileNameDisplay();
        localStorage.setItem('lastProfile', currentProfile);
        showToast(`✅ Saved as "${filename}"`, 'success');

        saveModal.style.display = 'none';
    } catch (err) {
        console.error('Failed to save profile:', err);
        showToast('❌ Failed to save', 'error');
    }
});

// --- Load profile list ---
async function openLoadModal() {
    try {
        if (!FIREBASE_BASE) {
            showToast('❌ Firebase URL not set', 'error');
            return;
        }

        const url = `${FIREBASE_BASE}/profiles.json${getAuthQuery()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const profileList = $('profileList');
        profileList.innerHTML = '';

        if (!data) {
            profileList.innerHTML = '<li style="color:#888;">No profiles saved</li>';
        } else {
            Object.keys(data).forEach(name => {
                // Visual name without ".json"
                const cleanName = name.replace('.json', '');

                // Row
                const li = document.createElement('li');
                li.style.position = 'relative'; // for absolute-positioned delete button

                // Click row to load
                li.addEventListener('click', () => {
                    loadProfile(name);
                    loadModal.style.display = 'none';
                });

                // Label
                const label = document.createElement('span');
                label.textContent = cleanName;

                // Delete button (×), same vibe as modal close
                const delBtn = document.createElement('button');
                delBtn.className = 'profile-delete-btn';
                delBtn.setAttribute('aria-label', `Delete ${cleanName}`);
                delBtn.title = `Delete ${cleanName}`;
                delBtn.innerHTML = '&times;';

                delBtn.addEventListener('click', async (e) => {
                    e.stopPropagation(); // don't trigger row load
                    const ok = confirm(`Delete profile "${cleanName}"?`);
                    if (!ok) return;

                    const success = await deleteProfile(name);
                    if (!success) return;

                    // Remove from list
                    li.remove();

                    // If it was the active profile, reset
                    if (currentProfile === name || currentProfile === cleanName) {
                        localStorage.removeItem('lastProfile');
                        currentProfile = DEFAULT_NAME;
                        updateProfileNameDisplay();
                    }

                    // If list became empty, show placeholder
                    if (!profileList.querySelector('li')) {
                        profileList.innerHTML = '<li style="color:#888;">No profiles saved</li>';
                    }

                    showToast(`🗑️ Deleted "${cleanName}"`, 'success');
                });

                li.appendChild(label);
                li.appendChild(delBtn);
                profileList.appendChild(li);
            });
        }

        loadModal.style.display = 'flex';
    } catch (err) {
        console.error('Failed to load profile list:', err);
        showToast('❌ Failed to list profiles', 'error');
    }
}

// --- Load one profile ---
async function loadProfile(filename) {
    try {
        if (!FIREBASE_BASE) {
            showToast('❌ Firebase URL not set', 'error');
            return;
        }

        const url = `${FIREBASE_BASE}/profiles/${filename}.json${getAuthQuery()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data) throw new Error('Profile not found');

        overallGain = data.gain ?? 0;
        power = data.power ?? true;
        if (data.bands) {
            data.bands.forEach((bandData, i) => {
                if (bands[i]) Object.assign(bands[i], bandData);
            });
        }

        gainSlider.value = overallGain;
        gainInput.value = overallGain.toFixed(1);
        gainValue.innerText = `${overallGain.toFixed(1)} dB`;

        powerButton.classList.toggle('active', power);
        drawScene();

        currentProfile = filename;
        updateProfileNameDisplay();
        localStorage.setItem('lastProfile', currentProfile);
        showToast(`✅ Loaded "${filename}"`, 'success');

        // 🔁 Push loaded profile into live /state.json
        await saveFullStateToServer(filename);

    } catch (err) {
        console.error('Failed to load profile:', err);
        showToast('❌ Failed to load profile', 'error');
    }
}

// toast helper
function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 50);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// Reset EQ to defaults (and push full new preset to /state)
function resetEQ() {
    bands = BANDS.map(b => ({ ...b, x: freqToPixel(b.freq), y: gainToY(b.gain) }));
    overallGain = 0;
    selectedBand = null;
    draggingBand = null;

    gainSlider.value = overallGain;
    gainValue.innerText = `${overallGain.toFixed(1)} dB`;
    gainInput.value = overallGain.toFixed(1);

    controlButtons.forEach(btn => {
        btn.classList.remove('stby');
        btn.classList.remove('active');
    });

    bands.forEach((band, index) => updateBandControls(index));
    updateListItemState();
    currentProfile = DEFAULT_NAME;
    updateProfileNameDisplay();
    showToast("✅ EQ reset to defaults", "success");

    drawScene();

    // after a hard reset we *do* send the full snapshot
    saveFullStateToServer("reset.json");
}

// per-band control panel bindings (gain/freq/Q sliders + inputs)
listItems.forEach((item, i) => {
    const listGainInput = item.querySelector('.gainInput');
    const listGainSlider = item.querySelector('.gainSlider');
    const listFreqInput = item.querySelector('.freqInput');
    const listFreqSlider = item.querySelector('.freqSlider');
    const listQInput = item.querySelector('.qInput');
    const listQSlider = item.querySelector('.qSlider');

    // gain slider
    listGainSlider.addEventListener('input', () => {
        bands[i].gain = +listGainSlider.value;
        listGainInput.value = listGainSlider.value;
        drawScene();
        updateFirebaseField(`bands/${i}/gain`, bands[i].gain);
    });

    // gain input
    listGainInput.addEventListener('change', () => {
        let val = parseFloat(listGainInput.value);
        if (isNaN(val)) val = 0;
        val = Math.min(Math.max(val, -15), 15);
        bands[i].gain = val;
        listGainInput.value = val;
        listGainSlider.value = val;
        drawScene();
        updateFirebaseField(`bands/${i}/gain`, bands[i].gain);
    });

    // freq slider (log)
    listFreqSlider.addEventListener('input', () => {
        const fraction = listFreqSlider.value / 100;
        const freq = freqSliderToFreq(fraction);
        bands[i].freq = freq;
        listFreqInput.value = Math.round(freq);
        drawScene();
        updateFirebaseField(`bands/${i}/freq`, bands[i].freq);
    });

    // freq input
    listFreqInput.addEventListener('change', () => {
        let val = parseFloat(listFreqInput.value);
        if (isNaN(val)) val = 20;
        val = Math.min(Math.max(val, 10), 30000);
        bands[i].freq = val;
        listFreqInput.value = Math.round(val);
        listFreqSlider.value = freqToSliderValue(val) * 100;
        drawScene();
        updateFirebaseField(`bands/${i}/freq`, bands[i].freq);
    });

    // Q slider
    listQSlider.addEventListener('input', () => {
        const Q = qSliderToQ(listQSlider.value / 100);
        bands[i].Q = Q;
        listQInput.value = (Math.round(Q * 10) / 10).toFixed(1);
        drawScene();
        updateFirebaseField(`bands/${i}/Q`, bands[i].Q);
    });

    // Q input
    listQInput.addEventListener('change', () => {
        let val = parseFloat(listQInput.value);
        if (isNaN(val)) val = 1;
        val = Math.min(Math.max(val, 0.1), 10);
        bands[i].Q = val;

        listQInput.value = (Math.round(bands[i].Q * 10) / 10).toFixed(1);
        listQSlider.value = qToSliderValue(val) * 100;

        drawScene();
        updateFirebaseField(`bands/${i}/Q`, bands[i].Q);
    });
});

// click row to select band / highlight
listItems.forEach((item, i) => {
    item.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;

        const band = bands[i];
        if (!band.enabled) return;

        selectedBand = (selectedBand === band) ? null : band;

        highlightBandListItem(selectedBand);
        drawScene();
        updateBandControls(i);
    });
});

function updateBandControls(index) {
    const band = bands[index];
    const listItem = document.querySelectorAll('.scrollList .listItem')[index];

    const listGainInput = listItem.querySelector('.gainInput');
    const listGainSlider = listItem.querySelector('.gainSlider');
    const listFreqInput = listItem.querySelector('.freqInput');
    const listFreqSlider = listItem.querySelector('.freqSlider');
    const listQInput = listItem.querySelector('.qInput');
    const listQSlider = listItem.querySelector('.qSlider');

    listGainInput.value = band.gain.toFixed(1);
    listGainSlider.value = band.gain.toFixed(1);

    listFreqInput.value = Math.round(band.freq);
    listFreqSlider.value = freqToSliderValue(band.freq) * 100;

    listQInput.value = (Math.round(band.Q * 10) / 10).toFixed(1);
    listQSlider.value = qToSliderValue(band.Q) * 100;
}

// canvas drag + wheel to edit band
eqCanvas.addEventListener('mousedown', e => {
    if (!power || !connection) return;
    const rect = eqCanvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * eqCanvas.width / rect.width;
    const mouseY = (e.clientY - rect.top) * eqCanvas.height / rect.height;

    const hitRadius = CIRCLE_RADIUS * 2;
    const clickedBand = bands.find(b => b.enabled && Math.hypot(mouseX - b.x, mouseY - b.y) <= hitRadius);

    if (clickedBand) {
        selectedBand = clickedBand;
        draggingBand = clickedBand;
    } else {
        selectedBand = null;
        draggingBand = null;
    }

    highlightBandListItem(selectedBand);
    drawScene();
});

// scroll to adjust Q
eqCanvas.addEventListener('wheel', e => {
    if (!power || !connection) return;
    e.preventDefault();

    const rect = eqCanvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * eqCanvas.width / rect.width;
    const mouseY = (e.clientY - rect.top) * eqCanvas.height / rect.height;

    const hitRadius = CIRCLE_RADIUS * 1.5;
    const band = bands.find(b => b.enabled && Math.hypot(mouseX - b.x, mouseY - b.y) <= hitRadius);
    if (!band) return;

    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    band.Q = Math.min(Math.max(band.Q + delta, 0.1), 10);

    drawScene();

    const bandIndex = bands.indexOf(band);
    if (bandIndex !== -1) {
        updateBandControls(bandIndex);
        updateFirebaseField(`bands/${bandIndex}/Q`, band.Q);
    }
});

// drag to move freq / gain
const onDocMouseMove = e => {
    if (!power || !connection) return;
    if (!draggingBand) return;

    const rect = eqCanvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * eqCanvas.width / rect.width;
    const mouseY = (e.clientY - rect.top) * eqCanvas.height / rect.height;

    const minF = 10, maxF = 30000;
    const frac = Math.min(Math.max(mouseX / eqCanvas.width, 0), 1);
    draggingBand.freq = minF * Math.pow(maxF / minF, frac);
    draggingBand.x = freqToPixel(draggingBand.freq);

    const maxDb = 15;
    const yCenter = eqCanvas.height / 2;
    draggingBand.gain = Math.min(
        Math.max(((yCenter - mouseY) / (eqCanvas.height / 2)) * maxDb - overallGain, -maxDb),
        maxDb
    );
    draggingBand.y = gainToY(draggingBand.gain + overallGain);

    drawScene();

    const bandIndex = bands.indexOf(draggingBand);
    if (bandIndex !== -1) {
        updateBandControls(bandIndex);
    }
};

const onDocMouseUp = () => {
    if (draggingBand) {
        const bandIndex = bands.indexOf(draggingBand);
        if (bandIndex !== -1) {
            updateFirebaseField(`bands/${bandIndex}/freq`, bands[bandIndex].freq);
            updateFirebaseField(`bands/${bandIndex}/gain`, bands[bandIndex].gain);
        }
    }
    draggingBand = null;
};

document.addEventListener('mousemove', onDocMouseMove);
document.addEventListener('mouseup', onDocMouseUp);

// master gain slider
gainSlider.addEventListener('input', () => {
    if (!power || !connection) return;
    overallGain = +gainSlider.value;
    gainInput.value = overallGain.toFixed(1);
    gainValue.innerText = `${overallGain.toFixed(1)} dB`;
    drawScene();
    updateFirebaseField('gain', overallGain);
});

// master gain text box
gainInput.addEventListener('change', () => {
    if (!power || !connection) return;
    let val = parseFloat(gainInput.value);
    if (isNaN(val)) val = 0;
    if (val < -12) val = -12;
    if (val > 12) val = 12;
    overallGain = val;
    gainSlider.value = overallGain;
    gainValue.innerText = `${overallGain.toFixed(1)} dB`;
    gainInput.value = overallGain.toFixed(1);
    drawScene();
    updateFirebaseField('gain', overallGain);
});

// cursor hinting
const updateCanvasCursor = e => {
    if (!power || !connection) {
        eqCanvas.style.cursor = 'default';
        return;
    }
    const rect = eqCanvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * eqCanvas.width / rect.width;
    const mouseY = (e.clientY - rect.top) * eqCanvas.height / rect.height;

    const hitRadius = CIRCLE_RADIUS * 2;
    const hoveredBand = bands.find(b => b.enabled && Math.hypot(mouseX - b.x, mouseY - b.y) <= hitRadius);

    eqCanvas.style.cursor = hoveredBand ? 'pointer' : 'default';
};
eqCanvas.addEventListener('mousemove', updateCanvasCursor);

function updateProfileNameDisplay() {
    const el = document.getElementById('activeProfileName');
    if (el) el.textContent = currentProfile;
}

// Open editor
openConstantsModal.addEventListener('click', () => {
    constantsForm.innerHTML = '';

    Object.entries(window.CONSTANTS).forEach(([key, value]) => {
        // Only expose editable values (skip arrays or nested objects)
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            const div = document.createElement('div');
            div.className = 'formRow';
            div.innerHTML = `
                <label>${key}</label>
                <input type="text" id="const-${key}" value="${value}">
            `;
            constantsForm.appendChild(div);
        }
    });

    constantsModal.style.display = 'flex';
});


// Close modal
closeConstantsModal.addEventListener('click', () => {
    constantsModal.style.display = 'none';
});

// Save constants to localStorage
saveConstantsButton.addEventListener('click', () => {
    const updatedConstants = { ...window.CONSTANTS };

    Object.keys(updatedConstants).forEach(key => {
        const input = document.getElementById(`const-${key}`);
        if (!input) return;
        const val = input.value.trim();

        // Try to parse numbers and booleans
        if (val === 'true' || val === 'false') updatedConstants[key] = val === 'true';
        else if (!isNaN(parseFloat(val)) && isFinite(val)) updatedConstants[key] = parseFloat(val);
        else updatedConstants[key] = val;
    });

    localStorage.setItem('userConstants', JSON.stringify(updatedConstants));
    showToast('✅ Constants saved! Reloading...', 'success');
    setTimeout(() => location.reload(), 1000);
});

// Reset constants
resetConstantsButton.addEventListener('click', () => {
    localStorage.removeItem('userConstants');
    showToast('✅ Constants reset. Reloading...', 'success');
    setTimeout(() => location.reload(), 1000);
});

// --- Init ---
async function init() {
    await loadStateFromServer();
    await updateFullConnectionStatus();
    bands.forEach((band, index) => updateBandControls(index));
    powerStateUpdate();
    setContainerSize(CANVAS_WIDTH, CANVAS_HEIGHT);
    currentProfile = localStorage.getItem('lastProfile') || DEFAULT_NAME;
    updateProfileNameDisplay();
    updateConnectionStatus();
}

init();
