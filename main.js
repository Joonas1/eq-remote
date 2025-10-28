// --- Helpers ---
const $ = id => document.getElementById(id);
const setStyle = (el, styles) => Object.assign(el.style, styles);
const gainToY = gain => eqCanvas.height / 2 - (gain / 12) * (eqCanvas.height / 2.5);

// --- Settings and Firebase URL ---
let FIREBASE_BASE = localStorage.getItem('firebaseBase') || '';
let STATE_URL = FIREBASE_BASE ? FIREBASE_BASE + '/state.json' : null;

function getFirebaseUrl() {
    if (!FIREBASE_BASE) {
        console.warn("No Firebase URL set. Running in offline mode.");
        return null;
    }

    const auth = localStorage.getItem('firebaseAuth');
    const url = FIREBASE_BASE + '/state.json';
    return auth ? `${url}?auth=${auth}` : url;
}


function setFirebaseUrl(newUrl) {
    if (newUrl && newUrl.endsWith('/')) newUrl = newUrl.slice(0, -1);
    FIREBASE_BASE = newUrl;
    STATE_URL = newUrl + '/state.json';
    localStorage.setItem('firebaseBase', newUrl);
    showToast("✅ Firebase URL saved locally", "success");
    loadStateFromServer();
    checkServerConnection();
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

// --- Constants ---
const {
    DB_LINE_COLOR, FREQ_LINE_COLOR, CENTER_LINE_COLOR, LABEL_COLOR,
    CURVE_COLOR, CURVE_COLOR_OFF, REFERENCE_GAINS, FREQ_LABELS,
    FREQ_LABELS_TO_SHOW, LINE_WIDTH, CANVAS_WIDTH, CANVAS_HEIGHT,
    CIRCLE_RADIUS, BANDS, LABEL_FONT, POWER
} = window.CONSTANTS;

// Get the root element
const root = document.documentElement;

// Set --color-accent using CURVE_COLOR from CONSTANTS
root.style.setProperty('--color-accent', window.CONSTANTS.CURVE_COLOR);
root.style.setProperty('--color-inactive', window.CONSTANTS.CURVE_COLOR_OFF);
root.style.setProperty('--color-muted', window.CONSTANTS.LABEL_COLOR);

// --- Persistent State ---
// --- Persistent State Helpers ---
const BAND_KEYS = ['type', 'freq', 'gain', 'Q', 'enabled'];

// Load EQ state from Firebase
async function loadStateFromServer() {
    try {
        const url = getFirebaseUrl();
        if (!url) return; // skip if not set

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

// Save current EQ state to Firebase
async function saveStateToServer() {
    try {
        const newState = {
            gain: overallGain,
            power: power,
            bands: bands.map(b => ({
                type: b.type,
                freq: b.freq,
                gain: b.gain,
                Q: b.Q,
                enabled: b.enabled
            })),
            filename: "41.json",
            version: 1
        };

        const url = getFirebaseUrl();
        if (!url) return;

        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newState)
        });



        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log("Saved state to Firebase successfully");
    } catch (err) {
        console.error("Failed to save state:", err);
    }
}

async function checkServerConnection() {
    try {
        const url = getFirebaseUrl();
        if (!url) return; // skip if not set

        const res = await fetch(url);

        connection = res.ok;
    } catch (e) {
        connection = false;
    }
    console.log('Firebase connection status:', connection);
    powerStateUpdate();
}

// --- State ---
let bands = BANDS.map(b => ({ ...b, x: freqToPixel(b.freq), y: gainToY(b.gain) }));
let overallGain = 0;
let selectedBand = null;
let draggingBand = null;
let power = POWER;
let connection = false;

setInterval(checkServerConnection, 1000);

// --- Layout ---
function setContainerSize() {

    setStyle(eqContainer, { width: CANVAS_WIDTH * 1.15 + 'px', height: CANVAS_HEIGHT * 1.2 + 'px' });
    setStyle(dbContainer, { width: CANVAS_WIDTH * 1.38 + 'px', height: CANVAS_HEIGHT + 'px', margin: '0 ' + CANVAS_WIDTH * 0.01 + 'px' });
    Object.assign(eqCanvas, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    eqCanvas.style.margin = '0 ' + CANVAS_WIDTH * 0.04 + 'px';

    setStyle(topControls, { width: CANVAS_WIDTH + 'px', margin: CANVAS_HEIGHT * 0.04 + 'px ' + CANVAS_WIDTH * 0.05 + 'px' });
    controlButtons.forEach(btn => setStyle(btn, {
        width: CANVAS_WIDTH / 7 + 'px', height: CANVAS_HEIGHT * 0.05 + 'px', fontSize: CANVAS_HEIGHT * 0.025 + 'px'
    }));

    setStyle(controlsContainer, { width: CANVAS_WIDTH * 0.25 + 'px', height: CANVAS_HEIGHT * 1.2 + 'px' });
    setStyle(topSettings, { width: CANVAS_WIDTH * 0.20 + 'px', margin: CANVAS_HEIGHT * 0.04 + 'px ' + CANVAS_WIDTH * 0.025 + 'px' });
    settingButtons.forEach(btn => setStyle(btn, {
        width: (CANVAS_WIDTH * 0.20) / 4 + 'px', height: CANVAS_HEIGHT * 0.05 + 'px', fontSize: CANVAS_HEIGHT * 0.025 + 'px'
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

};

// --- Logic ---
function bandGainAtFreq(f, band) {
    const ratio = f / band.freq;
    const dist = Math.log2(ratio);

    switch (band.type) {
        case "bell":
            // Q controls bandwidth: higher Q = narrower peak
            return band.gain * Math.exp(-0.5 * (dist * band.Q) ** 2);

        case "lowshelf":
            return band.gain / (1 + Math.exp(8 * dist)); // Q not used

        case "highshelf":
            return band.gain / (1 + Math.exp(-8 * dist)); // Q not used

        case "lowcut":
            // Q affects slope sharpness
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
    // sliderValue: 0–1
    return minFreq * Math.pow(maxFreq / minFreq, sliderValue);
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
controlButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
        if (!power || !connection) return;
        bands[i].enabled = !bands[i].enabled;
        button.classList.toggle('active', bands[i].enabled);
        updateListItemState();
        drawScene();
        saveStateToServer();
    });
});

powerButton.addEventListener('click', () => {
    if (!connection) return;
    power = !power;
    powerButton.classList.toggle('active', power);
    powerStateUpdate();
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
    saveStateToServer();
};

closeSettingsModal.addEventListener('click', () => {
    settingsModal.style.display = 'none';
});

settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) settingsModal.style.display = 'none';
});

closeSaveModal.addEventListener('click', () => {
    saveModal.style.display = 'none';
});

saveModal.addEventListener('click', e => {
    if (e.target === saveModal) saveModal.style.display = 'none';
});

closeLoadModal.addEventListener('click', () => {
    loadModal.style.display = 'none';
});

loadModal.addEventListener('click', e => {
    if (e.target === loadModal) loadModal.style.display = 'none';
});

settingButtons.forEach((button, i) => {
    button.addEventListener('click', () => {
        if (!connection && i != 3) return;
        switch (i) {
            case 0: // Save
                saveFileName.value = '';
                saveModal.style.display = 'flex';
                saveFileName.focus();
                break;
            case 1: // Load
                openLoadModal();
                break;
            case 2: // Reset
                resetEQ();
                break;
            case 3: // Settings
                settingsModal.style.display = 'flex';
                break;
        }
    });
});

// --- Settings Modal Logic ---
const firebaseUrlInput = document.getElementById('firebaseUrlInput');
const firebaseAuthInput = document.getElementById('firebaseAuthInput');
const saveSettingsButton = document.getElementById('saveSettingsButton');

// Load current saved URL + Auth Secret
if (firebaseUrlInput) firebaseUrlInput.value = localStorage.getItem('firebaseBase') || '';
if (firebaseAuthInput) firebaseAuthInput.value = localStorage.getItem('firebaseAuth') || '';

if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', () => {
        const newUrl = firebaseUrlInput.value.trim();
        const newAuth = firebaseAuthInput.value.trim();

        // Save both locally
        localStorage.setItem('firebaseBase', newUrl);
        localStorage.setItem('firebaseAuth', newAuth);

        // Update runtime variables
        FIREBASE_BASE = newUrl;
        STATE_URL = `${newUrl}/state.json`;
        showToast("✅ Firebase settings saved", "success");

        settingsModal.style.display = 'none';

        // Reload data after saving
        loadStateFromServer();
        checkServerConnection();
    });
}



// --- Save file (to /profiles/{filename}.json) ---
confirmSaveButton.addEventListener('click', async () => {
    const filename = saveFileName.value.trim();
    if (!filename) {
        showToast('❌ No filename provided', 'error');
        return;
    }

    const newState = {
        gain: overallGain,
        power: power,
        bands: bands.map(b => ({
            type: b.type,
            freq: b.freq,
            gain: b.gain,
            Q: b.Q,
            enabled: b.enabled
        })),
        savedAt: new Date().toISOString()
    };

    try {
        const base = localStorage.getItem('firebaseBase');
        const auth = localStorage.getItem('firebaseAuth') || '';
        if (!base) {
            showToast('❌ Firebase URL not set', 'error');
            return;
        }

        const url = `${base}/profiles/${filename}.json${auth ? `?auth=${auth}` : ''}`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newState)
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showToast(`✅ Saved as "${filename}"`, 'success');
        saveModal.style.display = 'none';
    } catch (err) {
        console.error('Failed to save profile:', err);
        showToast('❌ Failed to save', 'error');
    }
});


// --- Load Profiles (list all under /profiles/) ---
async function openLoadModal() {
    try {
        const base = localStorage.getItem('firebaseBase');
        const auth = localStorage.getItem('firebaseAuth') || '';
        if (!base) {
            showToast('❌ Firebase URL not set', 'error');
            return;
        }

        const url = `${base}/profiles.json${auth ? `?auth=${auth}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const profileList = $('profileList');
        profileList.innerHTML = '';

        if (!data) {
            profileList.innerHTML = '<li style="color:#888;">No profiles saved</li>';
        } else {
            Object.keys(data).forEach(name => {
                const li = document.createElement('li');
                li.textContent = name.replace('.json', '');
                li.style.cursor = 'pointer';
                li.addEventListener('click', () => {
                    loadProfile(name);
                    loadModal.style.display = 'none';
                });
                profileList.appendChild(li);
            });
        }

        loadModal.style.display = 'flex';
    } catch (err) {
        console.error('Failed to load profile list:', err);
        showToast('❌ Failed to list profiles', 'error');
    }
}


// --- Load a single profile from Firebase ---
async function loadProfile(filename) {
    try {
        const base = localStorage.getItem('firebaseBase');
        const auth = localStorage.getItem('firebaseAuth') || '';
        if (!base) {
            showToast('❌ Firebase URL not set', 'error');
            return;
        }

        const url = `${base}/profiles/${filename}.json${auth ? `?auth=${auth}` : ''}`;
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

        showToast(`✅ Loaded "${filename}"`, 'success');
    } catch (err) {
        console.error('Failed to load profile:', err);
        showToast('❌ Failed to load profile', 'error');
    }
}




function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 50);

    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// --- Reset EQ ---
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

    drawScene();
    saveStateToServer();
}

listItems.forEach((item, i) => {
    const listGainInput = item.querySelector('.gainInput');
    const listGainSlider = item.querySelector('.gainSlider');
    const listFreqInput = item.querySelector('.freqInput');
    const listFreqSlider = item.querySelector('.freqSlider');
    const listQInput = item.querySelector('.qInput');
    const listQSlider = item.querySelector('.qSlider');

    // Sync gain
    listGainSlider.addEventListener('input', () => {
        listGainInput.value = listGainSlider.value;
        bands[i].gain = +listGainSlider.value;
        drawScene();
        saveStateToServer();
    });
    listGainInput.addEventListener('change', () => {
        let val = parseFloat(listGainInput.value);
        if (isNaN(val)) val = 0;
        val = Math.min(Math.max(val, -15), 15);
        listGainInput.value = val;
        listGainSlider.value = val;
        bands[i].gain = val;
        drawScene();
        saveStateToServer();
    });

    // --- Frequency sync (logarithmic) ---
    listFreqSlider.addEventListener('input', () => {
        const fraction = listFreqSlider.value / 100; // 0–100 slider
        const freq = freqSliderToFreq(fraction); // logarithmic mapping
        listFreqInput.value = Math.round(freq);
        bands[i].freq = freq;
        drawScene();
        saveStateToServer();
    });
    listFreqInput.addEventListener('change', () => {
        let val = parseFloat(listFreqInput.value);
        if (isNaN(val)) val = 20;
        val = Math.min(Math.max(val, 10), 30000); // clamp to min/max frequency
        listFreqInput.value = Math.round(val);
        const fraction = freqToSliderValue(val);
        listFreqSlider.value = fraction * 100;
        bands[i].freq = val;
        drawScene();
        saveStateToServer();
    });


    // --- Q sync ---
    listQSlider.addEventListener('input', () => {
        const Q = qSliderToQ(listQSlider.value / 100); // map slider fraction → Q
        listQInput.value = Q.toFixed(2);
        bands[i].Q = Q;
        drawScene();
        saveStateToServer();
    });
    listQInput.addEventListener('change', () => {
        let val = parseFloat(listQInput.value);
        if (isNaN(val)) val = 1;
        val = Math.min(Math.max(val, 0.1), 10); // clamp Q
        listQInput.value = val.toFixed(2);
        listQSlider.value = qToSliderValue(val) * 100;
        bands[i].Q = val;
        drawScene();
        saveStateToServer();
    });

});

listItems.forEach((item, i) => {
    item.addEventListener('click', e => {
        // Ignore clicks on inputs or sliders
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;

        const band = bands[i];
        if (!band.enabled) return;

        // Toggle selection
        selectedBand = (selectedBand === band) ? null : band;

        highlightBandListItem(selectedBand);
        drawScene();
        updateBandControls(i);
        saveStateToServer();
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

    // Update gain
    listGainInput.value = band.gain.toFixed(1);
    listGainSlider.value = band.gain.toFixed(1);

    // Update frequency (logarithmic)
    listFreqInput.value = Math.round(band.freq);
    listFreqSlider.value = freqToSliderValue(band.freq) * 100;

    // Update Q (optional logarithmic)
    listQInput.value = band.Q.toFixed(2);
    listQSlider.value = qToSliderValue(band.Q) * 100;
}

// --- Dragging and Selection ---
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

    highlightBandListItem(selectedBand); // <-- highlight corresponding list item
    drawScene();
});



// --- Scroll to adjust Q ---
eqCanvas.addEventListener('wheel', e => {
    if (!power || !connection) return;
    e.preventDefault(); // prevent page scroll

    const rect = eqCanvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * eqCanvas.width / rect.width;
    const mouseY = (e.clientY - rect.top) * eqCanvas.height / rect.height;

    // Check if mouse is over any enabled band
    const hitRadius = CIRCLE_RADIUS * 1.5;
    const band = bands.find(b => b.enabled && Math.hypot(mouseX - b.x, mouseY - b.y) <= hitRadius);

    if (!band) return;

    // Adjust Q
    const delta = e.deltaY < 0 ? 0.1 : -0.1; // scroll up increases, down decreases
    band.Q = Math.min(Math.max(band.Q + delta, 0.1), 10); // clamp between 0.1 and 10

    drawScene();

    // Update controls
    const bandIndex = bands.indexOf(band);
    if (bandIndex !== -1) updateBandControls(bandIndex);

    saveStateToServer();
});

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
    draggingBand.gain = Math.min(Math.max(((yCenter - mouseY) / (eqCanvas.height / 2)) * maxDb - overallGain, -maxDb), maxDb);
    draggingBand.y = gainToY(draggingBand.gain + overallGain);

    drawScene();

    const bandIndex = bands.indexOf(draggingBand);
    if (bandIndex !== -1) updateBandControls(bandIndex);
};

const onDocMouseUp = () => {
    if (draggingBand) saveStateToServer();
    draggingBand = null;
};

document.addEventListener('mousemove', onDocMouseMove);
document.addEventListener('mouseup', onDocMouseUp);

gainSlider.addEventListener('input', () => {
    if (!power || !connection) return;
    overallGain = +gainSlider.value;
    gainInput.value = overallGain.toFixed(1);
    gainValue.innerText = `${overallGain.toFixed(1)} dB`;
    drawScene();
    saveStateToServer();
});

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
    saveStateToServer();
});

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

// --- Init ---
async function init() {
    await loadStateFromServer();
    await checkServerConnection();
    bands.forEach((band, index) => updateBandControls(index));
    powerStateUpdate();
    setContainerSize(CANVAS_WIDTH, CANVAS_HEIGHT);
}

init();