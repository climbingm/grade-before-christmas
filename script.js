
// --- Global configuration & error handling ---
// Shared API and Baserow credentials used across the app.
let API_URL = "";
let BASEROW_TOKEN = "";
let BASEROW_TABLE_ID = "";
let BASEROW_FIELD_IDS = {}; // Cache for field name to ID mapping

// Global error handlers - show overlay for easier debugging in the browser
window.addEventListener('error', (ev) => {
    try {
        const overlay = document.getElementById('error-overlay');
        const msg = document.getElementById('error-overlay-msg');
        if (overlay && msg) {
            overlay.style.display = 'block';
            msg.textContent = `${ev.message}\nAt ${ev.filename}:${ev.lineno}:${ev.colno}`;
        }
    } catch (e) { }
});
window.addEventListener('unhandledrejection', (ev) => {
    try {
        const overlay = document.getElementById('error-overlay');
        const msg = document.getElementById('error-overlay-msg');
        if (overlay && msg) {
            overlay.style.display = 'block';
            msg.textContent = `UnhandledPromiseRejection: ${ev.reason}`;
        }
    } catch (e) { }
});
const today = new Date();
let day = today.getDate();
let month = today.getMonth();
// Optional: allow testing by overriding day/month via URL query params, e.g. ?mockDay=21&mockMonth=12
try {
    const params = new URLSearchParams(window.location.search);
    const mockDay = parseInt(params.get('mockDay'));
    if (!isNaN(mockDay) && mockDay >= 1 && mockDay <= 31) {
        console.log('Mock day override active:', mockDay);
        day = mockDay;
    }
    const mockMonth = parseInt(params.get('mockMonth'));
    if (!isNaN(mockMonth) && mockMonth >= 1 && mockMonth <= 12) {
        console.log('Mock month override active:', mockMonth);
        month = mockMonth - 1;
    }
} catch (e) {
    // ignore
}
if (day >= 25) {
    day = 25; //Cap at 25 to prevent statistics becoming random
}
let currentPopupDay = null;

function updateLeaderboardTitle() {
    const titleEl = document.getElementById('scores-title');
    if (!titleEl) return;
    titleEl.textContent = day >= 25 ? 'Final Leaderboard' : 'Leaderboard';
}

updateLeaderboardTitle();

// --- Baserow configuration & API helpers ---
// Load shared credentials and resolve field IDs needed for API requests.
async function loadConfig() {
    const res = await fetch('config.json');
    if (!res.ok) throw new Error('Could not load config.json');

    const config = await res.json();
    BASEROW_TOKEN = config.Baserow_Token || BASEROW_TOKEN;
    BASEROW_TABLE_ID = config.Baserow_TableId || config.Baserow_TableID || BASEROW_TABLE_ID;
    API_URL = config.API_URL || API_URL;

    if (Array.isArray(config.gradeOrder) && config.gradeOrder.length > 0) {
        gradeOrder = config.gradeOrder.map(g => String(g).trim()).filter(Boolean);
    } else {
        throw new Error('Missing gradeOrder in config.json. Please define the available grades there.');
    }

    if (!BASEROW_TOKEN || !BASEROW_TABLE_ID) {
        throw new Error('Missing Baserow configuration in config.json. Please set Baserow_Token and Baserow_TableId.');
    }
}

function populateGradeSelectOptions() {
    const select = document.getElementById('popup-grade');
    if (!select) return;

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Grade --';
    select.appendChild(placeholder);

    gradeOrder.forEach(grade => {
        const option = document.createElement('option');
        option.value = grade;
        option.textContent = grade;
        select.appendChild(option);
    });
}

async function loadFreezeMessage() {
    const msgEl = document.getElementById('popup-21-text');
    if (!msgEl) return;

    try {
        const res = await fetch('Leaderboard-Froze-Msg.txt');
        if (!res.ok) {
            msgEl.textContent = 'Freeze notification message missing.';
            return;
        }
        const text = await res.text();
        msgEl.innerHTML = text
            .trim()
            .split(/\r?\n/)
            .map(line => line ? line : '')
            .join('<br>');
    } catch (err) {
        console.warn('Could not load leaderboard freeze message:', err);
        msgEl.textContent = 'Failed to load the freeze message.';
    }
}

// Fetch field IDs from Baserow table
async function getBaserowFieldIds() {
    if (Object.keys(BASEROW_FIELD_IDS).length > 0) return; // Already cached

    await loadConfig();
    const tableId = BASEROW_TABLE_ID;
    const fieldsEndpoint = `https://api.baserow.io/api/database/fields/table/${tableId}/`;

    try {
        const response = await fetch(fieldsEndpoint, {
            method: "GET",
            headers: {
                "Authorization": `Token ${BASEROW_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch field IDs: ${response.status}`);
        }

        const data = await response.json();
        // console.log('All Baserow fields:', data);
        data.forEach(field => {
            BASEROW_FIELD_IDS[field.name] = field.id;
        });
        // console.log('Baserow field IDs mapping:', BASEROW_FIELD_IDS);
    } catch (err) {
        console.error('Error fetching field IDs:', err);
    }
}
// --- Calendar data and grade mappings ---
// grade ordering is loaded from config.json and used for scoring and display
let gradeOrder = [];

let trueGrades = {};
let routeNames = {};
// map day (1-24) -> image path
let imageForDay = {};

// Load all necessary calendar data before generating the calendar UI.
async function loadCalendarData() {
    try {
        // Load route entries from calendar.json. App configuration is loaded separately from config.json.
        const combinedRes = await fetch('calendar.json');
        if (combinedRes.ok) {
            const data = await combinedRes.json();
            let entries = [];
            if (Array.isArray(data)) {
                entries = data;
            } else if (data && Array.isArray(data.entries)) {
                entries = data.entries;
            } else {
                throw new Error('calendar.json must be an array of entries or an object containing entries.');
            }

            // reset maps
            trueGrades = {};
            routeNames = {};
            imageForDay = {};
            entries.forEach(entry => {
                const d = parseInt(entry.day_to_display);
                if (!isNaN(d) && d >= 1 && d <= 24) {
                    routeNames[d] = entry.name || '';
                    // keep same shape as previous code: either string or array allowed
                    trueGrades[d] = entry.grade ? (Array.isArray(entry.grade) ? entry.grade : [entry.grade]) : [];
                    imageForDay[d] = entry.image || `images/Bild (${d}).jpg`;
                }
            });
            return;
        }



    } catch (err) {
        console.error('Error loading calendar data:', err);
        alert('Failed to load calendar data. Please reload the page & contact the admin if the issue persists.');
    }
}

// After loading the calendar data, generate the doors using the combined mapping
function getImageForDay(d) {
    return imageForDay[d] || `images/Bild (${d}).jpg`;
}

function preloadCalendarImages() {
    Object.values(imageForDay).forEach(src => {
        const img = new Image();
        img.src = src;
    });
}

// --- Calendar initialization ---
// Load calendar JSON and generate the door grid on first page load.
(async () => {
    console.log('Calendar init: loadConfig() starting');
    try {
        await loadConfig();
        populateGradeSelectOptions();
        await loadFreezeMessage();
        console.log('Calendar init: loadCalendarData() starting');
        await loadCalendarData();
        console.log('Calendar init: loadCalendarData() done, generating calendar');
        generateCalendar();
        console.log('Calendar generated');
    } catch (err) {
        console.error('Calendar init error:', err);
        const overlay = document.getElementById('error-overlay');
        const msg = document.getElementById('error-overlay-msg');
        if (overlay && msg) { overlay.style.display = 'block'; msg.textContent = `Calendar init error: ${err.message || err}`; }
    }
})();


// --- Info panel and popup helpers ---
// Load static information text into the info tab.
fetch('information.txt')
    .then(r => r.ok ? r.text() : Promise.reject(r.status))
    .then(text => {
        // preserve newlines by setting textContent (not innerHTML)
        document.getElementById('infoText').textContent = text;
    })
    .catch(err => {
        document.getElementById('infoText').textContent = 'Information file not found.';
        console.warn('Could not load information.txt:', err);
    });

function openInfoPopup() {
    document.getElementById('infoPopup').style.display = 'flex';
    document.addEventListener('keydown', handleInfoEscClose);
}

function closeInfoPopup() {
    document.getElementById('infoPopup').style.display = 'none';
    document.removeEventListener('keydown', handleInfoEscClose);
}

function handleInfoEscClose(event) {
    if (event.key === 'Escape') {
        closeInfoPopup();
    }
}

// helper to create a storage key per browser per day
function todayKey() {
    const d = new Date();
    return `advent_guess_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hasGuessedToday() {
    return !!localStorage.getItem(todayKey());
}

function markGuessedToday() {
    localStorage.setItem(todayKey(), '1');
}

// --- Local storage and cookie helpers ---
// Keep track of which day was guessed and remember player names.
function setPlayerNameCookie(name) {
    // set cookie to expire in 365 days
    const date = new Date();
    date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    document.cookie = "playerName=" + encodeURIComponent(name) + ";" + expires + ";path=/";
}

function getPlayerNameCookie() {
    const nameEQ = "playerName=";
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i].trim();
        if (cookie.indexOf(nameEQ) === 0) {
            return decodeURIComponent(cookie.substring(nameEQ.length));
        }
    }
    return '';
}

// --- Guess submission and scoring logic ---
// Validate user input, compute points against the true grade, then save to Baserow.
async function saveScore(day) {
    // allow calling without parameter (from popup button)
    day = day || currentPopupDay;
    if (!day) return alert('No day selected.');

    // read values from popup inputs
    const player = document.getElementById('popup-player').value;
    const grade = document.getElementById('popup-grade').value;

    if (!player || !grade) return alert("Enter username and grade!");

    // save player name to cookie
    setPlayerNameCookie(player);

    // prevent more than one guess per browser per day
    if (hasGuessedToday()) {
        return alert('Only one submission per browser and day.');
    }

    // compute points based on true grade(s) for this day
    const guessedIndex = gradeOrder.indexOf(grade);
    const trueGradeData = trueGrades[day];

    if (!trueGrades[day]) return alert('Error: True grade not found! Please contact the admin if the issue persists.');

    // Handle multiple correct grades (array) or single grade (string)
    let trueGrades_array = [];
    if (Array.isArray(trueGradeData)) {
        trueGrades_array = trueGradeData;
    } else if (typeof trueGradeData === 'string') {
        trueGrades_array = [trueGradeData];
    }

    let points = 0;
    if (guessedIndex === -1) return alert('Climbing grade not valid');

    if (trueGrades_array.length > 0) {
        // find the minimum difference to any of the correct grades
        let minDiff = Infinity;
        trueGrades_array.forEach(trueGrade => {
            const trueIndex = gradeOrder.indexOf(trueGrade);
            if (trueIndex !== -1) {
                const diff = Math.abs(guessedIndex - trueIndex);
                minDiff = Math.min(minDiff, diff);
            }
        });

        if (minDiff === 0) points = 3; // exact match with one of the correct grades
        else if (minDiff === 1) points = 2; // off by one from the closest correct grade
        else if (minDiff === 2) points = 1; // off by two from the closest correct grade
        else points = 0;
    } else {
        // fallback: if true grade unknown, assign 0 points (before points = guessedIndex + 1;)
        points = 0;
    }

    // send grade and computed points to Baserow API
    await loadConfig();
    const tableId = BASEROW_TABLE_ID;
    const rowsEndpoint = `https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true`;
    // Build payload using field names, trueGrades always as string
    const payload = {
        player,
        day,
        points,
        grade,
        trueGrades: trueGrades_array.length > 0 ? trueGrades_array.join(', ') : ''
    };
    // console.log('Saving payload:', payload);
    try {
        const response = await fetch(rowsEndpoint, {
            method: "POST",
            headers: {
                "Authorization": `Token ${BASEROW_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Baserow error response:', errorText);
            throw new Error(`Baserow API error: ${response.status}`);
        }
        const responseData = await response.json();
        // console.log('Row created successfully:', responseData);
    } catch (err) {
        console.error('Error saving to Baserow:', err);
        return alert('Error submitting your guess. Please check your connection or contact the admin for troubleshooting.');
    }

    // mark as guessed so this browser cannot guess again today
    markGuessedToday();

    alert(`Score submitted for day ${day}!`);
    // clear popup inputs
    document.getElementById('popup-player').value = '';
    document.getElementById('popup-grade').value = '';
    // Probably not needed: 
    loadHighscores();
    closePopup();
}

// --- Leaderboard rendering & Baserow row fetching ---
// Fetch all guess rows, compute totals, then render the main leaderboard.
async function loadHighscores() {
    await loadConfig(); // keep this if it sets other needed variables like `day`

    try {
        const tableId = BASEROW_TABLE_ID;
        const rows = await fetchAllRows(tableId, 100); // fetch all rows with pagination

        // cache rows globally for histogram usage
        window.__cachedGuessRows = rows;

        const scoresDiv = document.getElementById("scores");
        if (!scoresDiv) {
            console.warn('Scores container not found, skipping highscores render');
            return;
        }
        scoresDiv.innerHTML = "";

        // only include guesses up to yesterday (one day delay)
        let allowedMaxDay = (typeof day !== 'undefined') ? (day - 1) : 0;
        if (typeof day !== 'undefined' && day > 20 && day <= 24) {
            allowedMaxDay = 20;
            console.log("AllowedMaxDay set to 20 due to persistent snowfall.");
        }
        if (allowedMaxDay < 1) {
            scoresDiv.textContent = 'Leaderboard will be shown starting December 2nd';
            return;
        }

        const scoresMap = {};
        const countedEntries = new Set(); // track (player, day) pairs already counted

        rows.forEach(entry => {
            const entryDay = parseInt(entry.day) || 0;
            const playerName = entry.player || '';
            const pointsValue = parseInt(entry.points) || 0;

            if (entryDay <= allowedMaxDay && playerName) {
                const player = playerName.toLowerCase();
                const key = `${player}-${entryDay}`; // unique key for player-day combo
                if (!countedEntries.has(key)) {
                    countedEntries.add(key);
                    if (!scoresMap[player]) scoresMap[player] = 0;
                    scoresMap[player] += pointsValue;
                }
            }
        });

        if (Object.keys(scoresMap).length === 0) {
            scoresDiv.textContent = 'Noch keine Highscores verfügbar.';
            return;
        }

        Object.entries(scoresMap)
            .sort((a, b) => b[1] - a[1])
            .forEach(([player, score], index, sortedArray) => {
                const div = document.createElement("div");
                // Determine rank: same score gets same rank
                let rank = index + 1;
                if (index > 0 && sortedArray[index][1] === sortedArray[index - 1][1]) {
                    const prevRank = scoresDiv.lastChild.textContent.split('.')[0];
                    rank = parseInt(prevRank);
                }
                div.textContent = `${rank}. ${player}: ${score}`;
                scoresDiv.appendChild(div);
            });

    } catch (err) {
        console.error('Error loading highscores from Baserow:', err);
        const scoresDiv = document.getElementById("scores");
        if (scoresDiv) scoresDiv.textContent = 'Error Loading Highscores.';
    }
}

// Helper: fetch all rows with pagination
async function fetchAllRows(tableId, size = 100) {
    let rows = [];
    let nextUrl = `https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true&size=${size}`;

    while (nextUrl) {

        nextUrl = nextUrl.replace(/^http:/, 'https:'); // enforce https
        console.log("CURLING: ", nextUrl);
        const response = await fetch(nextUrl, {
            method: "GET",
            headers: {
                "Authorization": `Token ${BASEROW_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Baserow API error: ${response.status}`);
        }

        const data = await response.json();
        rows = rows.concat(data.results);
        nextUrl = data.next; // null when done
        console.log(`Fetched ${data.results.length} rows, total so far: ${rows.length}`);
    }

    return rows;
}

// --- Histogram and trend chart helpers ---
// These helpers power the per-day histogram and cumulative trend chart in stats popups.
async function ensureGuessRows() {
    if (window.__cachedGuessRows) return window.__cachedGuessRows;
    try {
        await loadConfig();
        const tableId = BASEROW_TABLE_ID;
        const rows = await fetchAllRows(tableId, 100);
        window.__cachedGuessRows = rows;
        return rows;
    } catch (err) {
        console.warn('Could not fetch guess rows for histogram:', err);
        return [];
    }
}

function getGuessDistributionForDay(rows, d) {
    const counts = {};
    let total = 0;
    rows.forEach(r => {
        const entryDay = parseInt(r.day) || 0;
        if (entryDay !== d) return;
        let g = (r.grade || '').toString().trim();
        if (!g) {
            g = 'unknown';
        }
        // normalize to lowercase for matching
        const gLower = g.toLowerCase();
        counts[gLower] = (counts[gLower] || 0) + 1;
        total++;
    });
    let max = 0;
    Object.values(counts).forEach(v => { if (v > max) max = v; });
    return { counts, total, max };
}

async function renderHistogramForDay(d) {
    const histEl = document.getElementById('popup-histogram');
    if (!histEl) return;
    histEl.innerHTML = '';
    histEl.className = 'histogram';

    const rows = await ensureGuessRows();
    const dist = getGuessDistributionForDay(rows, d);
    if (dist.total === 0) {
        histEl.textContent = 'Noch keine Einschätzungen.';
        return;
    }

    // compute set of true grades for highlighting
    const trueGradesArr = (trueGrades[d] || []).map(g => (g || '').toString().toLowerCase());
    const trueSet = new Set(trueGradesArr);

    // render rows in the grade order (preferred ordering)
    const gradesToShow = gradeOrder.slice().map(g => g.toLowerCase()).concat(['unknown']);
    const maxCount = dist.max || 1;

    gradesToShow.forEach(g => {
        const count = dist.counts[g] || 0;
        // build row
        const row = document.createElement('div'); row.className = 'histogram-row';

        const isTrue = trueSet.has(g);
        if (isTrue) row.classList.add('histogram-true');

        const label = document.createElement('div'); label.className = 'histogram-label';
        label.textContent = g === 'unknown' ? 'andere' : g;

        const bar = document.createElement('div'); bar.className = 'histogram-bar';
        const fill = document.createElement('div'); fill.className = 'histogram-fill';
        const pct = Math.round((count / maxCount) * 100);
        fill.style.width = pct + '%';

        const cnt = document.createElement('div'); cnt.className = 'histogram-count'; cnt.textContent = String(count);
        bar.appendChild(fill);
        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(cnt);
        histEl.appendChild(row);
    });
}

// --- Trend chart for leaderboard (accumulated points per player over days 1..24) ---
function colorFromString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 80% 50%)`;
}

// Convert HSL to hex (simple conversion, good enough for color inputs)
function hslToHex(h, s = 80, l = 50) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const x = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return Math.round(255 * x).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function colorHexFromString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
    const hue = Math.abs(h) % 360;
    return hslToHex(hue, 80, 50);
}



async function renderTrendChart() {
    const canvas = document.getElementById('trend-canvas');
    const legend = document.getElementById('trend-legend');
    if (!canvas || !canvas.getContext) return;
    legend.innerHTML = '';

    const rows = await ensureGuessRows();
    // compute allowedMaxDay (same logic as leaderboard)
    let allowedMaxDay = (typeof day !== 'undefined') ? day - 1 : 0;
    if (typeof day !== 'undefined' && day > 20 && day <= 24) allowedMaxDay = 20;

    if (!rows || rows.length === 0 || allowedMaxDay < 1) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'gold';
        ctx.fillText('Noch keine Daten zum Anzeigen.', 20, 20);
        legend.innerHTML = '';
        return;
    }

    // build per-player per-day totals up to allowedMaxDay, deduplicating player-day pairs
    const players = new Set();
    const perPlayerDay = {}; // player -> array[allowedMaxDay+1], index 1..allowedMaxDay
    const displayNames = {}; // lowercase -> original display name
    const seen = new Set();
    rows.forEach(r => {
        const dayNum = parseInt(r.day) || 0;
        if (dayNum < 1 || dayNum > allowedMaxDay) return; // skip future days
        const rawPlayer = (r.player || '').toString().trim();
        const player = rawPlayer.toLowerCase();
        if (!player) return;
        const key = `${player}-${dayNum}`;
        if (seen.has(key)) return; // first entry wins
        seen.add(key);
        players.add(player);
        if (!perPlayerDay[player]) {
            perPlayerDay[player] = new Array(allowedMaxDay + 1).fill(0);
        }
        if (!displayNames[player]) displayNames[player] = rawPlayer;
        const pts = parseInt(r.points) || 0;
        perPlayerDay[player][dayNum] += pts;
    });

    // compute cumulative sums up to allowedMaxDay
    const cumulative = {};
    let maxY = 0;
    Array.from(players).forEach(p => {
        const arr = perPlayerDay[p] || new Array(allowedMaxDay + 1).fill(0);
        const c = new Array(allowedMaxDay + 1).fill(0);
        for (let d = 1; d <= allowedMaxDay; d++) {
            c[d] = c[d - 1] + (arr[d] || 0);
        }
        cumulative[p] = c;
        if (c[allowedMaxDay] > maxY) maxY = c[allowedMaxDay];
    });
    if (maxY === 0) maxY = 1;

    // prepare canvas
    const ctx = canvas.getContext('2d');
    const DPR = window.devicePixelRatio || 1;
    const W = Math.min(canvas.clientWidth, 900);
    const H = Math.max(240, canvas.clientHeight);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, W, H);

    // chart margins
    const margin = { left: 48, right: 12, top: 12, bottom: 36 };
    const chartW = W - margin.left - margin.right;
    const chartH = H - margin.top - margin.bottom;

    // helper to draw axes (clears area first)
    function drawAxes() {
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.fillStyle = 'gold';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, margin.top + chartH);
        ctx.lineTo(margin.left + chartW, margin.top + chartH);
        ctx.stroke();

        // y grid and labels (5 ticks)
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(255,215,0,0.9)';
        const ticks = 5;
        for (let t = 0; t <= ticks; t++) {
            const yVal = Math.round((maxY / ticks) * t);
            const y = margin.top + chartH - (chartH * (yVal / maxY));
            ctx.fillStyle = 'rgba(255,215,0,0.6)';
            ctx.fillText(String(yVal), 6, y + 4);
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + chartW, y);
            ctx.stroke();
        }

        // x axis ticks days 1..allowedMaxDay
        const xStep = (allowedMaxDay === 1) ? chartW : (chartW / Math.max(1, (allowedMaxDay - 1)));
        ctx.fillStyle = 'rgba(255,215,0,0.7)';
        for (let d = 1; d <= allowedMaxDay; d++) {
            const x = margin.left + (d - 1) * xStep;
            if (d % 2 === 1) { ctx.fillText(String(d), x - 6, margin.top + chartH + 18); }
        }
    }

    // sort players by final score asc so leaders draw last
    const playersSorted = Array.from(players).sort((a, b) => (cumulative[a][allowedMaxDay] || 0) - (cumulative[b][allowedMaxDay] || 0));

    // store computed trend data for redraws
    window.__trendData = { cumulative, playersSorted, displayNames, maxY, allowedMaxDay };

    // draw chart for a set of players
    function drawChart(selectedPlayersSet) {
        drawAxes();
        const xStep = (allowedMaxDay === 1) ? chartW : (chartW / Math.max(1, (allowedMaxDay - 1)));

        // draw players in order
        playersSorted.forEach((p, idx) => {
            if (selectedPlayersSet && !selectedPlayersSet.has(p)) return;
            const c = cumulative[p];
            const chosenColor = (window.__trendColors && window.__trendColors[p]) ? window.__trendColors[p] : colorFromString(p);

            // halo for contrast
            ctx.beginPath();
            for (let d = 1; d <= allowedMaxDay; d++) {
                const x = margin.left + (d - 1) * xStep;
                const y = margin.top + chartH - (chartH * (c[d] / maxY));
                if (d === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.lineWidth = (selectedPlayersSet && selectedPlayersSet.size === 1) ? 5.0 : 4.0;
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.stroke();

            // colored line
            ctx.beginPath();
            for (let d = 1; d <= allowedMaxDay; d++) {
                const x = margin.left + (d - 1) * xStep;
                const y = margin.top + chartH - (chartH * (c[d] / maxY));
                if (d === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.lineWidth = (selectedPlayersSet && selectedPlayersSet.size === 1) ? 3.0 : 2.2;
            ctx.strokeStyle = chosenColor;
            ctx.stroke();

            // draw points with small white outline
            for (let d = 1; d <= allowedMaxDay; d++) {
                const x = margin.left + (d - 1) * xStep;
                const y = margin.top + chartH - (chartH * (c[d] / maxY));
                ctx.beginPath(); ctx.fillStyle = chosenColor; ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.9; ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.stroke();
            }
        });
    }

    // initial draw (all players)
    drawChart(new Set(playersSorted));

    // build legend with checkboxes and color pickers
    legend.innerHTML = '';
    // controls: select/deselect all and reset colors
    const controls = document.createElement('div'); controls.className = 'legend-controls';
    const selectAllBtn = document.createElement('button'); selectAllBtn.textContent = 'Select all';
    const deselectAllBtn = document.createElement('button'); deselectAllBtn.textContent = 'Deselect all';
    const resetBtn = document.createElement('button'); resetBtn.textContent = 'Reset colors'; resetBtn.style.marginLeft = 'auto';
    controls.appendChild(selectAllBtn); controls.appendChild(deselectAllBtn); controls.appendChild(resetBtn);
    legend.appendChild(controls);

    // helper to update color inputs when palette changes
    function updateColorInputs() {
        legend.querySelectorAll('.color-input').forEach(inp => {
            const p = inp.dataset.player;
            const col = (window.__trendColors && window.__trendColors[p]) ? window.__trendColors[p] : colorHexFromString(p);
            inp.value = col;
            const box = inp.nextSibling; // the color box div follows input
            if (box && box.classList && box.classList.contains('legend-color')) box.style.background = col;
        });
    }

    // reset behavior
    resetBtn.addEventListener('click', () => { window.__trendColors = {}; drawChart(new Set(playersSorted)); updateColorInputs(); });

    selectAllBtn.addEventListener('click', () => {
        legend.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
        drawChart(new Set(playersSorted));
    });
    deselectAllBtn.addEventListener('click', () => {
        legend.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
        drawChart(new Set());
    });

    playersSorted.slice().reverse().forEach(p => {
        const c = cumulative[p];
        const row = document.createElement('div'); row.className = 'legend-row';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.style.marginRight = '8px'; cb.dataset.player = p;
        const colorInput = document.createElement('input'); colorInput.type = 'color'; colorInput.className = 'color-input'; colorInput.dataset.player = p;
        const colorHex = (window.__trendColors && window.__trendColors[p]) ? window.__trendColors[p] : colorHexFromString(p);
        colorInput.value = colorHex;
        const colorBox = document.createElement('div'); colorBox.className = 'legend-color'; colorBox.style.background = colorHex;
        colorInput.style.marginRight = '6px';
        colorInput.addEventListener('input', (ev) => {
            window.__trendColors = window.__trendColors || {};
            window.__trendColors[p] = ev.target.value;
            colorBox.style.background = ev.target.value;
            drawChart(new Set(Array.from(legend.querySelectorAll('input[type=checkbox]:checked')).map(i => i.dataset.player)));
        });
        const label = document.createElement('label'); label.className = 'legend-label'; label.textContent = `${(displayNames && displayNames[p]) ? displayNames[p] : p} (${c[allowedMaxDay] || 0})`;
        row.appendChild(cb); row.appendChild(colorInput); row.appendChild(colorBox); row.appendChild(label);
        legend.appendChild(row);
    });

    // attach change handler after legend is in DOM
    legend.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const checked = Array.from(legend.querySelectorAll('input[type=checkbox]:checked')).map(i => i.dataset.player);
            drawChart(new Set(checked));
        });
    });
}





// --- Calendar UI generation ---
// Create the advent calendar door elements and wire click handlers.
function generateCalendar() {
    const container = document.querySelector('.calendar');
    if (!container) return console.warn('Calendar container not found');
    // clear any existing generated doors
    container.innerHTML = '';
    for (let i = 1; i <= 24; i++) {
        const imgSrc = getImageForDay(i);

        const doorContainer = document.createElement('div');
        doorContainer.className = 'door-container';

        const door = document.createElement('div');
        door.className = 'door';
        door.setAttribute('data-day', String(i));
        // event handler instead of document.write inline onclick
        door.addEventListener('click', function () { openDoor(i, this); });

        const span = document.createElement('span');
        span.textContent = String(i);

        const img = document.createElement('img');
        img.setAttribute('data-src', imgSrc);
        img.alt = `Türchen ${i}`;

        door.appendChild(span);
        door.appendChild(img);
        doorContainer.appendChild(door);
        container.appendChild(doorContainer);
    }
    // preload mapped images for smoother UX
    preloadCalendarImages();
}

// --- Waiting image support for unopened doors ---
// Preload a set of fallback waiting images shown for future days.
let waitingImages = [];
async function preloadWaitingImages() {
    const images = [];

    // Try to load images numbered 1.jpg, 2.jpg, etc. up to 50
    for (let i = 1; i <= 50; i++) {
        const src = `images/waiting/${i}.jpg`;
        try {
            const response = await fetch(src, { method: 'HEAD' });
            if (response.ok) {
                images.push(src);
            } else {
                //Stop loading more images after first was missed
                break;
            }
        } catch (err) {
            // Image not found, continue
        }
    }

    waitingImages = images.length > 0 ? images : ['images/waiting/1.jpg'];
}

// Start preloading immediately
preloadWaitingImages();

function getRandomWaitingImage() {
    // If images are still loading, use fallback
    if (waitingImages.length === 0) {
        return 'images/waiting/1.jpg';
    }
    return waitingImages[Math.floor(Math.random() * waitingImages.length)];
}

function openDoor(doorDay, doorElement) {
    const doorImage = doorElement.querySelector("img");

    // Month check: only allow advent in November/December
        if (month < 11) {
        doorImage.style.display = 'block';
        setTimeout(() => {
            doorImage.style.display = 'none';
        }, 2000);
        return;
    }

    // Case A: Past days - show image + true grade, no guess form
    if (doorDay < day) {
        const popup = document.getElementById('popup');
        const popupImage = document.getElementById('popup-image');
        const guessForm = document.querySelector('#popup .guess-form');
        const gradeDisplay = document.getElementById('popup-grade-display');

        popupImage.src = getImageForDay(doorDay);
        currentPopupDay = doorDay;

        // hide guess form for past days
        if (guessForm) guessForm.style.display = 'none';

        // show true grade display with route name
        const trueGradeData = trueGrades[doorDay];
        const routeName = routeNames[doorDay];

        // Handle multiple correct grades or single grade, with route name
        let gradeText = 'Schwierigkeit: Unbekannt';
        if (Array.isArray(trueGradeData)) {
            const grades = trueGradeData.join(' / ');
            gradeText = routeName ? `${routeName} (${grades})` : `Korrekte Schwierigkeit: ${grades}`;
        } else if (typeof trueGradeData === 'string') {
            gradeText = routeName ? `${routeName} (${trueGradeData})` : `Korrekte Schwierigkeit: ${trueGradeData}`;
        }

        gradeDisplay.textContent = gradeText;
        gradeDisplay.style.display = 'block';

        // show histogram placeholder while loading actual data
        const histEl = document.getElementById('popup-histogram');
        if (histEl) {
            histEl.style.display = 'block';
            histEl.textContent = 'Lade Verteilung...';
        }

        popup.style.display = 'flex';
        document.addEventListener('keydown', handleEscClose);

        // render histogram async (doesn't block popup display)
        renderHistogramForDay(doorDay).catch(err => {
            console.warn('Error rendering histogram:', err);
            if (histEl) histEl.textContent = 'Konnte Verteilung nicht laden.';
        });

        return;
    }

    // Case B: Today - show image + guess form
    if (doorDay === day) {
        const popup = document.getElementById('popup');
        const popupImage = document.getElementById('popup-image');
        const guessForm = document.querySelector('#popup .guess-form');
        const gradeDisplay = document.getElementById('popup-grade-display');

        popupImage.src = getImageForDay(doorDay);

        // set current popup day and prepare form
        currentPopupDay = doorDay;
        const playerInput = document.getElementById('popup-player');
        const gradeInput = document.getElementById('popup-grade');

        // pre-fill name from cookie if available
        let savedName = getPlayerNameCookie();
        if (playerInput) playerInput.value = savedName;
        if (gradeInput) gradeInput.value = '';

        // show guess form for today
        if (guessForm) guessForm.style.display = 'flex';
        if (gradeDisplay) gradeDisplay.style.display = 'none';

        // update submit button state if browser already guessed today
        const saveBtn = document.querySelector('#popup .guess-form button');
        if (saveBtn) {
            if (hasGuessedToday()) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Already guessed today';
            } else {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Submit';
            }
        }

        popup.style.display = 'flex';
        // focus name field if available
        if (playerInput) playerInput.focus();

        document.addEventListener('keydown', handleEscClose);
        return;
    }

    // Case C: Future days - show waiting image
    doorImage.src = getRandomWaitingImage();
    doorImage.style.display = 'block';
    setTimeout(() => {
        doorImage.style.display = 'none';
    }, 2000);
}

function closePopup() {
    const popup = document.getElementById('popup');
    popup.style.display = 'none';

    // hide and clear histogram
    const histEl = document.getElementById('popup-histogram');
    if (histEl) {
        histEl.style.display = 'none';
        histEl.innerHTML = '';
    }

    // clear current day state and remove esc handler
    currentPopupDay = null;
    document.removeEventListener('keydown', handleEscClose);
}

// Trend popup handlers
function openTrendPopup() {
    const backdrop = document.getElementById('trendPopup');
    backdrop.style.display = 'flex';
    document.addEventListener('keydown', handleTrendEscClose);
    renderTrendChart().catch(err => console.warn('Trend chart error', err));
}

function closeTrendPopup() {
    const backdrop = document.getElementById('trendPopup');
    backdrop.style.display = 'none';
    document.removeEventListener('keydown', handleTrendEscClose);
    const canvas = document.getElementById('trend-canvas');
    if (canvas && canvas.getContext) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const legend = document.getElementById('trend-legend');
    if (legend) legend.innerHTML = '';
}

function handleTrendEscClose(event) {
    if (event.key === 'Escape') closeTrendPopup();
}

function handleEscClose(event) {
    if (event.key === 'Escape') {
        closePopup();
    }
}

// Stats popup handlers
function openStatsPopup() {
    const backdrop = document.getElementById('statsPopup');
    backdrop.style.display = 'flex';
    document.addEventListener('keydown', handleStatsEscClose);
    renderStats().catch(err => console.warn('Stats render error', err));
}

function closeStatsPopup() {
    const backdrop = document.getElementById('statsPopup');
    backdrop.style.display = 'none';
    document.removeEventListener('keydown', handleStatsEscClose);
    document.getElementById('stats-table').querySelector('tbody').innerHTML = '';
    document.getElementById('stats-player-wrap').style.display = 'none';
}

function handleStatsEscClose(event) {
    if (event.key === 'Escape') closeStatsPopup();
}

// --- Statistics popup rendering ---
// Render the stats view, including table, player details, and records.
async function renderStats() {
    const rows = await ensureGuessRows();
    let allowedMaxDay = (typeof day !== 'undefined') ? Math.max(0, day - 1) : 0;
    if (typeof day !== 'undefined' && day > 20 && day <= 24) allowedMaxDay = 20;
    const stats = computeStats(rows, allowedMaxDay);
    // renderStatsSummary(stats);  // one-line summary removed - records shown in Records tab instead
    renderStatsTable(stats);
    populatePlayerSelect(stats);

    // view toggle
    const radios = document.querySelectorAll('input[name=statsView]');
    function updateView() {
        const v = document.querySelector('input[name=statsView]:checked').value;
        document.getElementById('stats-table-wrap').style.display = (v === 'table') ? '' : 'none';
        document.getElementById('stats-player-wrap').style.display = (v === 'player') ? '' : 'none';
        document.getElementById('stats-records-wrap').style.display = (v === 'records') ? '' : 'none';
        document.getElementById('stats-player-select').style.display = (v === 'player') ? '' : 'none';
    }
    radios.forEach(r => r.addEventListener('change', updateView));
    // set initial view
    updateView();

    document.getElementById('stats-player-select').addEventListener('change', (ev) => {
        renderPlayerDetails(stats, ev.target.value);
    });

    // render records list for the Records tab
    const recWrap = document.getElementById('stats-records-list');
    recWrap.innerHTML = '';
    const minPlayedForRecords = 5;

    function findWinnersByMetric(metric, cmpFn, opts = {}) {
        // candidates: entries [playerKey, info]
        const items = Object.entries(stats).filter(([k]) => k !== '__titles');
        const valid = items.filter(([p, info]) => info[metric] !== null && info[metric] !== undefined && !Number.isNaN(info[metric]));

        // prefer players who played at least minPlayedForRecords
        const preferred = valid.filter(([p, info]) => (info.played || 0) >= minPlayedForRecords);
        const pool = preferred.length ? preferred : valid;
        if (!pool.length) return [];

        // find best value using cmpFn
        let bestVal = pool[0][1][metric];
        pool.forEach(([p, info]) => {
            const v = info[metric];
            if (cmpFn(v, bestVal)) bestVal = v;
        });

        const eps = 1e-9;
        const winners = pool.filter(([p, info]) => {
            const v = info[metric];
            if (typeof v === 'number') return Math.abs(v - bestVal) <= eps;
            return v === bestVal;
        }).map(([p, info]) => p);

        return winners;
    }

    const recordsOrder = [
        { key: '🌞 Optimist', metric: 'meanDev', cmp: (a, b) => a > b },
        { key: '🐢 Sandbagger', metric: 'meanDev', cmp: (a, b) => a < b },
        { key: '🎯 Sniper', metric: 'exact', cmp: (a, b) => a > b },
        { key: '🤪 Chaos-Climber', metric: 'stdDev', cmp: (a, b) => a > b },
        { key: '⏱️🔥 Late-Game-Clutch', metric: 'lateSum', cmp: (a, b) => a > b }
    ];

    recordsOrder.forEach(rec => {
        const winnerKeys = findWinnersByMetric(rec.metric, rec.cmp);
        if (!winnerKeys || winnerKeys.length === 0) return;
        const names = winnerKeys.map(k => stats[k] ? stats[k].name : k).join(', ');
        const div = document.createElement('div'); div.style.margin = '6px 0';
        div.innerHTML = `<strong>${rec.key}</strong>: ${names}`;
        recWrap.appendChild(div);
    });

    const expl = document.getElementById('stats-records-explanation');
    expl.innerHTML = '<strong>Records:</strong> Players must play at least 5 days to be preferred; if none qualify, the best available player is shown.<br>Optimist: highest average overestimation<br>Sandbagger: lowest average estimation<br>Sniper: most exact guesses<br>Chaos-Climber: highest standard deviation in guesses<br>Late-Game-Clutch: highest total points from days 15-24.';
}

// --- Statistics computation helpers ---
// Build player-level metrics from raw guess rows.
function computeStats(rows, allowedMaxDay) {
    // Map players
    const players = {};
    const grades = {};
    rows.forEach(r => {
        const dayNum = parseInt(r.day) || 0;
        if (dayNum < 1 || dayNum > allowedMaxDay) return;
        const playerRaw = (r.player || '').toString().trim();
        const player = playerRaw.toLowerCase();
        if (!player) return;
        players[player] = players[player] || { name: playerRaw, deviations: [], points: [], days: new Set(), exact: 0, latePoints: [] };

        // compute deviation if true grade exists and guessed grade exists
        const guessed = (r.grade || '').toString().trim().toLowerCase();
        if (guessed && guessed !== 'unknown') {
            const guessedIdx = gradeOrder.indexOf(guessed);
            const trueG = trueGrades[dayNum];
            if (typeof trueG !== 'undefined' && trueG !== null) {
                const trueArr = Array.isArray(trueG) ? trueG : [trueG];
                // pick nearest true grade with sign
                let bestDiff = null;
                trueArr.forEach(tg => {
                    const t = (tg || '').toString().toLowerCase();
                    const tIdx = gradeOrder.indexOf(t);
                    if (tIdx >= 0 && guessedIdx >= 0) {
                        const diff = guessedIdx - tIdx;
                        if (bestDiff === null || Math.abs(diff) < Math.abs(bestDiff)) bestDiff = diff;
                    }
                });
                if (bestDiff !== null) players[player].deviations.push(bestDiff);
            }
        }

        // points & days
        const pts = parseInt(r.points) || 0;
        players[player].points.push(pts);
        players[player].days.add(dayNum);
        if (r.grade && r.grade.toString().trim().toLowerCase() !== 'unknown') {
            const guessedIdx = gradeOrder.indexOf((r.grade || '').toString().trim().toLowerCase());
            const trueG = trueGrades[parseInt(r.day)];
            const trueArr = Array.isArray(trueG) ? trueG : [trueG];
            trueArr.forEach(tg => {
                const tIdx = gradeOrder.indexOf((tg || '').toString().toLowerCase());
                if (tIdx >= 0 && guessedIdx >= 0 && tIdx === guessedIdx) players[player].exact++;
            });
        }
        if (dayNum >= 15) players[player].latePoints.push(pts);
    });

    const out = {};
    Object.entries(players).forEach(([p, info]) => {
        const devs = info.deviations;
        const meanDev = devs.length ? (devs.reduce((a, b) => a + b, 0) / devs.length) : 0;
        const variance = devs.length ? (devs.reduce((a, b) => a + Math.pow(b - meanDev, 2), 0) / devs.length) : 0;
        const stdDev = Math.sqrt(variance);
        const overCount = devs.filter(d => d > 0).length;
        const underCount = devs.filter(d => d < 0).length;
        const bias = devs.length ? (overCount > underCount ? 'Over' : (underCount > overCount ? 'Under' : 'Neutral')) : 'Neutral';
        const lateSum = info.latePoints.length ? info.latePoints.reduce((a, b) => a + b, 0) : null;
        const lateAvg = info.latePoints.length ? (lateSum / info.latePoints.length) : null;
        out[p] = {
            name: info.name,
            meanDev: meanDev,
            stdDev: stdDev,
            exact: info.exact || 0,
            played: info.days.size,
            possible: allowedMaxDay,
            bias: bias,
            lateAvg: lateAvg,
            lateSum: lateSum,
            totalPoints: info.points.reduce((a, b) => a + b, 0),
            deviations: info.deviations
        };
    });

    // compute titles
    const playersList = Object.keys(out);
    if (playersList.length) {
        // Optimist: highest meanDev
        let optimist = playersList[0];
        playersList.forEach(p => { if ((out[p].meanDev || 0) > (out[optimist].meanDev || 0)) optimist = p; });
        // Sandbagger: lowest meanDev
        let sandbagger = playersList[0];
        playersList.forEach(p => { if ((out[p].meanDev || 0) < (out[sandbagger].meanDev || 0)) sandbagger = p; });
        // Sniper: most exact
        let sniper = playersList[0];
        playersList.forEach(p => { if ((out[p].exact || 0) > (out[sniper].exact || 0)) sniper = p; });
        // Chaos-Climber: highest stdDev
        let chaos = playersList[0];
        playersList.forEach(p => { if ((out[p].stdDev || 0) > (out[chaos].stdDev || 0)) chaos = p; });
        // Late-Game-Clutch: highest lateSum (total late points)
        let clutch = null; let bestLate = -Infinity;
        playersList.forEach(p => { if (out[p].lateSum !== null && out[p].lateSum > bestLate) { bestLate = out[p].lateSum; clutch = p; } });
        out.__titles = {
            Optimist: out[optimist] ? out[optimist].name : null,
            Sandbagger: out[sandbagger] ? out[sandbagger].name : null,
            Sniper: out[sniper] ? out[sniper].name : null,
            'Chaos-Climber': out[chaos] ? out[chaos].name : null,
            'Late-Game-Clutch': clutch ? out[clutch].name : null
        };
    } else {
        out.__titles = {};
    }

    return out;
}

function renderStatsSummary(stats) {
    const s = document.getElementById('stats-summary');
    const titles = stats.__titles || {};
    let html = '<strong>Titel:</strong> ';
    const pairs = Object.entries(titles).map(([k, v]) => `${k}: ${v || '-'}`);
    html += pairs.join(' | ');
    s.innerHTML = html;
}

function renderStatsTable(stats) {
    const tbody = document.getElementById('stats-table').querySelector('tbody');
    tbody.innerHTML = '';
    Object.entries(stats).filter(([k]) => k !== '__titles').sort((a, b) => (b[1].totalPoints || 0) - (a[1].totalPoints || 0)).forEach(([p, info]) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${info.name}</td><td>${(info.meanDev).toFixed(2)}</td><td>${(info.stdDev).toFixed(2)}</td><td>${info.exact}</td><td>${info.played}/${info.possible}</td><td>${info.bias}</td><td>${info.lateAvg !== null ? info.lateAvg.toFixed(2) : '-'}</td>`;
        tbody.appendChild(tr);
    });
}

function populatePlayerSelect(stats) {
    const sel = document.getElementById('stats-player-select');
    sel.innerHTML = '';
    Object.entries(stats).filter(([k]) => k !== '__titles').forEach(([p, info]) => {
        const opt = document.createElement('option'); opt.value = p; opt.textContent = info.name; sel.appendChild(opt);
    });
}

function renderPlayerDetails(stats, playerKey) {
    const wrap = document.getElementById('stats-player-details');
    const info = stats[playerKey];
    if (!info) { wrap.innerHTML = 'Spieler nicht gefunden.'; return; }
    let html = `<h4 style="margin:6px 0 8px 0;">${info.name}</h4>`;
    html += `<div>Mean deviation: ${info.meanDev.toFixed(2)}</div>`;
    html += `<div>StdDev: ${info.stdDev.toFixed(2)}</div>`;
    html += `<div>Exact hits: ${info.exact}</div>`;
    html += `<div>Played: ${info.played} / ${info.possible}</div>`;
    html += `<div>Bias: ${info.bias}</div>`;
    html += `<div>Late-game avg points: ${info.lateAvg !== null ? info.lateAvg.toFixed(2) : '-'}</div>`;
    // small deviations list
    html += '<div style="margin-top:8px;"><strong>Deviations:</strong> ' + (info.deviations.length ? info.deviations.join(', ') : '-') + '</div>';
    wrap.innerHTML = html;
}


// --- Snow animation ---
// Generate falling snowflakes and adjust spawn rate on resize.
const snowContainer = document.querySelector('.snow');
console.log('Snow script initialized, snowContainer:', snowContainer);

function spawnFlake() {
    if (!snowContainer) return;
    const flake = document.createElement('div');
    flake.classList.add('snowflake');
    flake.textContent = '❄';

    flake.style.left = Math.random() * 100 + 'vw';
    flake.style.animationDuration = 5 + Math.random() * 10 + 's';
    let fontSize = Math.random() * 20;
    fontSize = 10 + fontSize + 10 * (window.innerWidth / 1600);
    flake.style.fontSize = fontSize + 'px';

    snowContainer.appendChild(flake);

    // remove flakes after they fall off screen
    setTimeout(() => flake.remove(), 20000);
}
function getSpawnInterval() {
    const dayLocal = (typeof day !== 'undefined') ? day : (new Date()).getDate();
    const baseInterval = Math.max(10, 410 - (-5 * ((dayLocal - 20) * (dayLocal - 20)) + 400));
    console.log("Base snowflake spawn interval (ms): ", baseInterval, "(day:", dayLocal, ")");

    const referenceArea = 1200 * 800;
    const currentArea = window.innerWidth * window.innerHeight;

    const scaleFactor = referenceArea / currentArea;

    return Math.max(10, baseInterval * scaleFactor);
}

let snowInterval = setInterval(spawnFlake, getSpawnInterval());

window.addEventListener("resize", () => {
    clearInterval(snowInterval);
    snowInterval = setInterval(spawnFlake, getSpawnInterval());
});


if (typeof day !== 'undefined' && day > 20 && day <= 24) {
    console.log("Leaderboard froze due to persistent snowfall");
    document.getElementById("ScoresPanel").classList.add("frozen");
} else {
    console.log("Leaderboard active; day = " + day);
}
// Highscores laden, sobald die Seite fertig geladen ist
loadHighscores();


const popupKey = "popup-shown-day21";

// Only show the "Leaderboard froze" popup during the freeze window (21..24).
if (typeof day !== 'undefined' && day > 20 && day <= 24 && !localStorage.getItem(popupKey)) {
    console.log("Showing Frozen Popup");

    const backdrop = document.getElementById("popup-21-backdrop");
    backdrop.classList.remove("hidden");

    document.getElementById("closePopup").addEventListener("click", () => {
        backdrop.classList.add("hidden");
        localStorage.setItem(popupKey, "true");
    });

} else {
    console.log("Not showing Frozen Popup. day: " + day + " popUpKey:" + localStorage.getItem(popupKey));
}
