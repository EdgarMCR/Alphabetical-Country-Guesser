// --- Configuration & State ---
const isMobile = window.innerWidth <= 768;
const width = isMobile ? window.innerWidth : window.innerWidth - 300;
const height = window.innerHeight;
const initialScale = isMobile ? 250 : 350;

let geoData = null; 
let capitalsMap = {}; 


// Mapping dictionary to normalize D3/GeoJSON feature names
const nameMapping = {
    "England": "United Kingdom",
    "French Southern and Antarctic Lands": "France",
    "Republic of Serbia": "Serbia",
    "United Republic of Tanzania": "Tanzania",
    "West Bank": "Palenstine"
};

const ignoredAreas = new Set(["Antarctica"]);

/**
 * Looks up the normalized/corrected country name for a given D3 GeoJSON feature name.
 * 
 * @param {string} d3Name - The original name property from the D3 GeoJSON feature.
 * @returns {string} The corrected name if mapped, otherwise the original d3Name.
 */
function getCorrectName(d3Name) {
    return nameMapping[d3Name] || d3Name;
}

/**
 * Gets the primary starting letter of a name, ignoring a leading "The ".
 * 
 * @param {string} name - The country or feature name (e.g., "The Bahamas").
 * @returns {string} The uppercase starting letter (e.g., "B").
 */
function getStartingLetter(name) {
    if (!name) return "";

    // Remove leading "The " (case-insensitive) and any extra whitespace
    const normalized = name.replace(/^the\s+/i, "").trim();

    return normalized.charAt(0).toUpperCase();
}

let gameState = {
    isPlaying: false,
    mode: 'country-en',
    currentLetter: 'A',
    remainingCountries: [],
    correct: 0,
    incorrect: 0,
    hints: 0,
    startTime: null,
    timerInterval: null
};

// --- Helper Functions for Data Resolution ---
function getMeta(d) {
    // Resolve the name using the lookup function
    const key = getCorrectName(d.properties.name);


    const jsonEntry = capitalsMap[key];

    return {
        countryEn: jsonEntry?.countryEn || key || "Unknown",
        countryPl: jsonEntry?.countryPl || key || "Unknown",
        capitalEn: jsonEntry?.capitalEn || "Unknown",
        capitalPl: jsonEntry?.capitalPl || "Unknown"
    };
}

function getTargetValue(d, mode) {
    const meta = getMeta(d);
    switch (mode) {
        case 'country-en': return meta.countryEn;
        case 'country-pl': return meta.countryPl;
        case 'capital-en': return meta.capitalEn;
        case 'capital-pl': return meta.capitalPl;
        default: return meta.countryEn;
    }
}

// --- DOM Elements ---
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const hintBtn = document.getElementById('hint-btn');
const gameModeSelect = document.getElementById('game-mode');
const gameStatus = document.getElementById('game-status');
const targetModeLabel = document.getElementById('target-mode-label');
const targetLetterEl = document.getElementById('target-letter');
const remainingCountEl = document.getElementById('remaining-count');
const timerEl = document.getElementById('timer');
const correctEl = document.getElementById('correct-clicks');
const incorrectEl = document.getElementById('incorrect-clicks');
const hintCountEl = document.getElementById('hint-count');
const tooltip = document.getElementById('tooltip');
const globeHud = document.getElementById('globe-hud');
const hudLetter = document.getElementById('hud-letter');
const hudCount = document.getElementById('hud-count');
const completionModal = document.getElementById('completion-modal');
const completedLetterEl = document.getElementById('completed-letter');
const closeModalBtn = document.getElementById('close-modal-btn');
const uiPanel = document.getElementById('ui-panel');

// --- D3 Setup ---
const svg = d3.select("#globe-container")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

const projection = d3.geoOrthographic()
    .scale(initialScale)
    .translate([width / 2, height / 2])
    .clipAngle(90);

const path = d3.geoPath().projection(projection);

const ocean = svg.append("circle")
    .attr("cx", width / 2)
    .attr("cy", height / 2)
    .attr("r", projection.scale())
    .style("fill", "#0f2545");

const g = svg.append("g");

// Load map shapes
d3.json("data/D3world.geojson").then(data => {
    geoData = data.features;
    drawMap();
    setupInteraction();
});

// Fetch fallback capitals
fetch("data/country_to_capital_en_pl.json")
    .then(res => res.json())
    .then(data => {
        capitalsMap = data;
    })
    .catch(err => console.warn("Could not load local capitals file:", err));

function drawMap() {
    g.selectAll("path")
        .data(geoData)
        .enter()
        .append("path")
        .attr("class", "country")
        .attr("d", path)
        .attr("id", d => "country-" + d.id)
        .on("click", handleCountryClick);
}

function setupInteraction() {
    const zoom = d3.zoom()
        .scaleExtent([0.5, 5])
        .filter((event) => {
            if (event.type === 'touchstart' && event.touches && event.touches.length === 1) return false;
            return (!event.ctrlKey || event.type === 'wheel') && !event.button;
        })
        .on("zoom", (event) => {
            projection.scale(initialScale * event.transform.k);
            g.selectAll("path").attr("d", path);
            ocean.attr("r", projection.scale());
        });

    const drag = d3.drag()
        .on("drag", (event) => {
            const rotate = projection.rotate();
            projection.rotate([
                rotate[0] + event.dx * (0.5 / (projection.scale() / initialScale)), 
                rotate[1] - event.dy * (0.5 / (projection.scale() / initialScale))
            ]);
            g.selectAll("path").attr("d", path);
        });

    svg.call(zoom).on("mousedown.zoom", null);
    g.call(drag);
    ocean.call(drag);

    d3.select('#zoom-in').on('click', () => {
        svg.transition().duration(300).call(zoom.scaleBy, 1.4);
    });

    d3.select('#zoom-out').on('click', () => {
        svg.transition().duration(300).call(zoom.scaleBy, 0.7);
    });
}

// --- Game Logic ---
startBtn.addEventListener('click', startGame);
stopBtn.addEventListener('click', stopGame);
hintBtn.addEventListener('click', giveHint);

function toggleMenu() {
    uiPanel.classList.toggle('minimized');
}

function startGame() {
    gameState.isPlaying = true;
    gameState.mode = gameModeSelect.value;
    gameState.currentLetter = 'A';
    gameState.correct = 0;
    gameState.incorrect = 0;
    gameState.hints = 0;
    gameState.startTime = Date.now();
    
    gameModeSelect.disabled = true;
    
    targetModeLabel.innerText = gameState.mode.includes('capital') ? 'Capitals' : 'Countries';

    setupLetter(gameState.currentLetter);

    startBtn.innerText = "Restart Game";
    stopBtn.disabled = false;
    hintBtn.disabled = false;
    gameStatus.classList.remove('hidden');
    globeHud.classList.remove('hidden');
    d3.selectAll(".country").classed("found", false).classed("hinted", false);
    
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = setInterval(() => {
        const elapsed = (Date.now() - gameState.startTime) / 1000;
        timerEl.innerText = elapsed.toFixed(1);
    }, 100);

    if (window.innerWidth <= 768) {
        uiPanel.classList.add('minimized');
    }
}

function stopGame() {
    gameState.isPlaying = false;
    clearInterval(gameState.timerInterval);

    // Re-enable settings and disable in-game controls
    gameModeSelect.disabled = false;
    startBtn.innerText = "Start Game";
    stopBtn.disabled = true;
    hintBtn.disabled = true;

    // Hide active status UI and clear highlights
    gameStatus.classList.add('hidden');
    globeHud.classList.add('hidden');
    d3.selectAll(".country").classed("found", false).classed("hinted", false);
}

function setupLetter(letter) {
    gameState.currentLetter = letter;
    hudLetter.innerText = gameState.currentLetter;
    
    // Filter features matching letter for selected game mode
    gameState.remainingCountries = geoData.filter(d => {
        const d3Name = d.properties.name;
        if (ignoredAreas.has(d3Name)) return false; // Exclude from count

        const targetVal = getTargetValue(d, gameState.mode);
        const startingLetter = getStartingLetter(targetVal);
        return startingLetter === letter;
    });

    targetLetterEl.innerText = gameState.currentLetter;
    updateStatsUI();
}

function handleCountryClick(event, d) {
    const meta = getMeta(d);
    const clickedTarget = getTargetValue(d, gameState.mode);
    

    // Determine language from the active game mode
    const isPolish = gameState.mode.endsWith('-pl');
    const countryName = isPolish ? meta.countryPl : meta.countryEn;
    const capitalName = isPolish ? meta.capitalPl : meta.capitalEn;
    const capitalLabel = isPolish ? 'Stolica' : 'Capital';

    // Render detailed tooltip
    tooltip.classList.remove('hidden');
    tooltip.style.left = (event.pageX + 15) + 'px';
    tooltip.style.top = (event.pageY + 15) + 'px';
    tooltip.innerHTML = `
        <h3>${countryName}</h3>
        <p>${capitalLabel}: <b>${capitalName}</b></p>
    `;

    setTimeout(() => { tooltip.classList.add('hidden'); }, 2500);

    if (!gameState.isPlaying || !completionModal.classList.contains('hidden')) return;
    
    const countryNode = d3.select(this);
    if (countryNode.classed("found")) return;

    const startingLetter = getStartingLetter(clickedTarget.toUpperCase());
    if (startingLetter.startsWith(gameState.currentLetter)) {
        // Correct click: mark all areas sharing this target value as found (e.g., Falklands + UK)
        g.selectAll("path")
            .filter(nodeD => getTargetValue(nodeD, gameState.mode) === clickedTarget)
            .classed("found", true);

        gameState.remainingCountries = gameState.remainingCountries.filter(
            c => getTargetValue(c, gameState.mode) !== clickedTarget
        );
        gameState.correct++;
        
        if (gameState.remainingCountries.length === 0) {
            showCompletionModal();
        }
    } else {
        gameState.incorrect++;
    }
    updateStatsUI();

    if (window.innerWidth <= 768 && gameState.isPlaying) {
        uiPanel.classList.add('minimized');
    }
}

function advanceToNextLetter() {
    if (gameState.currentLetter === 'Z') {
        endGame();
        return;
    }

    let nextCharCode = gameState.currentLetter.charCodeAt(0);
    let nextCountries = [];
    
    while (nextCountries.length === 0 && nextCharCode < 90) {
        nextCharCode++;
        const candidateLetter = String.fromCharCode(nextCharCode);
        nextCountries = geoData.filter(d => {
            const targetVal = getTargetValue(d, gameState.mode);
            return targetVal.toUpperCase().startsWith(candidateLetter);
        });
    }

    if (nextCountries.length === 0) {
        endGame();
        return;
    }

    setupLetter(String.fromCharCode(nextCharCode));
}

function showCompletionModal() {
    completedLetterEl.innerText = gameState.currentLetter;
    completionModal.classList.remove('hidden');
}

closeModalBtn.addEventListener('click', () => {
    completionModal.classList.add('hidden');
    advanceToNextLetter();
});

function giveHint() {
    if (!gameState.isPlaying || gameState.remainingCountries.length === 0) return;
    
    gameState.hints++;
    updateStatsUI();

    const randomCountry = gameState.remainingCountries[Math.floor(Math.random() * gameState.remainingCountries.length)];
    const targetVal = getTargetValue(randomCountry, gameState.mode);

    const countryEls = g.selectAll("path").filter(nodeD => getTargetValue(nodeD, gameState.mode) === targetVal);
    countryEls.classed("hinted", true);
    
    const centroid = d3.geoCentroid(randomCountry);
    d3.transition().duration(1000).tween("rotate", () => {
        const r = d3.interpolate(projection.rotate(), [-centroid[0], -centroid[1]]);
        return function(t) {
            projection.rotate(r(t));
            g.selectAll("path").attr("d", path);
        };
    });

    setTimeout(() => {
        countryEls.classed("hinted", false);
    }, 2000);
}

function endGame() {
    gameState.isPlaying = false;
    gameModeSelect.disabled = false;
    clearInterval(gameState.timerInterval);
    stopBtn.disabled = true;
    hintBtn.disabled = true;
    alert(`Incredible! You finished the entire alphabet in ${timerEl.innerText} seconds!`);
}

function updateStatsUI() {
    correctEl.innerText = gameState.correct;
    incorrectEl.innerText = gameState.incorrect;
    hintCountEl.innerText = gameState.hints;
    
    // Count distinct remaining targets rather than individual geometries
    const uniqueRemainingTargets = new Set(gameState.remainingCountries.map(c => getTargetValue(c, gameState.mode)));
    remainingCountEl.innerText = uniqueRemainingTargets.size;
    hudCount.innerText = `${uniqueRemainingTargets.size} left`;
}

window.addEventListener('resize', () => {
    const newWidth = window.innerWidth <= 768 ? window.innerWidth : window.innerWidth - 300;
    const newHeight = window.innerHeight;
    svg.attr("width", newWidth).attr("height", newHeight);
    projection.translate([newWidth / 2, newHeight / 2]);
    ocean.attr("cx", newWidth / 2).attr("cy", newHeight / 2);
    g.selectAll("path").attr("d", path);
});
