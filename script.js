// --- Configuration & State ---
const width = window.innerWidth - 300; // Account for UI panel
const height = window.innerHeight;
const initialScale = 350;

let geoData = null; 
let capitalsMap = {}; // Will hold data from RestCountries API

let gameState = {
    isPlaying: false,
    currentLetter: 'A',
    remainingCountries: [],
    correct: 0,
    incorrect: 0,
    hints: 0,
    startTime: null,
    timerInterval: null
};

// --- DOM Elements ---
const startBtn = document.getElementById('start-btn');
const hintBtn = document.getElementById('hint-btn');
const gameStatus = document.getElementById('game-status');
const targetLetterEl = document.getElementById('target-letter');
const remainingCountEl = document.getElementById('remaining-count');
const timerEl = document.getElementById('timer');
const correctEl = document.getElementById('correct-clicks');
const incorrectEl = document.getElementById('incorrect-clicks');
const hintCountEl = document.getElementById('hint-count');
const tooltip = document.getElementById('tooltip');

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

// --- Initialization ---
// 1. Fetch map shapes
d3.json("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson").then(data => {
    geoData = data.features;
    drawMap();
    setupInteraction();
});

// 2. Fetch capitals (to map names to capitals)
fetch("https://restcountries.com/v3.1/all?fields=name,capital")
    .then(res => res.json())
    .then(data => {
        data.forEach(c => {
            // Map common names to their capital cities
            capitalsMap[c.name.common] = c.capital ? c.capital[0] : "Data unavailable";
        });
    })
    .catch(err => console.error("Error fetching capitals:", err));

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

// Handles both dragging (rotation) and scrolling (zoom)
function setupInteraction() {
    // 1. Dragging spins the globe
    const drag = d3.drag()
        .on("drag", (event) => {
            const rotate = projection.rotate();
            projection.rotate([rotate[0] + event.dx * 0.5, rotate[1] - event.dy * 0.5]);
            g.selectAll("path").attr("d", path);
        });
    
    svg.call(drag);

    // 2. Zooming scales the globe (Wheel only)
    const zoom = d3.zoom()
        .scaleExtent([0.5, 5]) // Can zoom out half-size or in 5x size
        .on("zoom", (event) => {
            projection.scale(initialScale * event.transform.k);
            g.selectAll("path").attr("d", path);
            ocean.attr("r", projection.scale());
        });

    svg.call(zoom)
       .on("mousedown.zoom", null) // Disable zoom panning so drag can rotate
       .on("touchstart.zoom", null);
}

// --- Game Logic ---

startBtn.addEventListener('click', startGame);
hintBtn.addEventListener('click', giveHint);

function startGame() {
    gameState.isPlaying = true;
    gameState.currentLetter = 'A';
    gameState.correct = 0;
    gameState.incorrect = 0;
    gameState.hints = 0;
    gameState.startTime = Date.now();
    
    setupLetter(gameState.currentLetter);

    startBtn.innerText = "Restart Game";
    hintBtn.disabled = false;
    gameStatus.classList.remove('hidden');
    d3.selectAll(".country").classed("found", false).classed("hinted", false);
    
    clearInterval(gameState.timerInterval);
    gameState.timerInterval = setInterval(() => {
        const elapsed = (Date.now() - gameState.startTime) / 1000;
        timerEl.innerText = elapsed.toFixed(1);
    }, 100);
}

function setupLetter(letter) {
    gameState.currentLetter = letter;
    gameState.remainingCountries = geoData.filter(d => {
        const name = d.properties.name || "";
        return name.toUpperCase().startsWith(letter);
    });

    targetLetterEl.innerText = gameState.currentLetter;
    updateStatsUI();
}

function handleCountryClick(event, d) {
    const countryName = d.properties.name;
    // Some names differ slightly between the map API and capital API, fallback handles mismatches
    const capital = capitalsMap[countryName] || "Data unavailable";
    
    // 1. Show Tooltip
    tooltip.classList.remove('hidden');
    tooltip.style.left = (event.pageX + 15) + 'px';
    tooltip.style.top = (event.pageY + 15) + 'px';
    tooltip.innerHTML = `<h3>${countryName}</h3><p>Capital: ${capital}</p>`;

    // Hide tooltip automatically after 2.5 seconds
    setTimeout(() => { tooltip.classList.add('hidden'); }, 2500);

    // 2. Game Logic
    if (!gameState.isPlaying) return;
    
    const countryNode = d3.select(this);
    if (countryNode.classed("found")) return; // Ignore if already found

    if (countryName.toUpperCase().startsWith(gameState.currentLetter)) {
        // Correct click
        countryNode.classed("found", true);
        gameState.remainingCountries = gameState.remainingCountries.filter(c => c.id !== d.id);
        gameState.correct++;
        
        if (gameState.remainingCountries.length === 0) {
            advanceToNextLetter();
        }
    } else {
        // Incorrect click
        gameState.incorrect++;
    }
    updateStatsUI();
}

function advanceToNextLetter() {
    if (gameState.currentLetter === 'Z') {
        endGame();
        return;
    }

    let nextCharCode = gameState.currentLetter.charCodeAt(0);
    let nextCountries = [];
    
    // Loop forward in alphabet to find the next letter that actually has countries
    while (nextCountries.length === 0 && nextCharCode < 90) {
        nextCharCode++;
        const candidateLetter = String.fromCharCode(nextCharCode);
        nextCountries = geoData.filter(d => {
            const name = d.properties.name || "";
            return name.toUpperCase().startsWith(candidateLetter);
        });
    }

    if (nextCountries.length === 0) {
        endGame(); // Reached the end with no more countries
        return;
    }

    setupLetter(String.fromCharCode(nextCharCode));
}

function giveHint() {
    if (!gameState.isPlaying || gameState.remainingCountries.length === 0) return;
    
    gameState.hints++;
    updateStatsUI();

    const randomCountry = gameState.remainingCountries[Math.floor(Math.random() * gameState.remainingCountries.length)];
    const countryEl = d3.select("#country-" + randomCountry.id);
    countryEl.classed("hinted", true);
    
    const centroid = d3.geoCentroid(randomCountry);
    d3.transition().duration(1000).tween("rotate", () => {
        const r = d3.interpolate(projection.rotate(), [-centroid[0], -centroid[1]]);
        return function(t) {
            projection.rotate(r(t));
            g.selectAll("path").attr("d", path);
        };
    });

    setTimeout(() => {
        countryEl.classed("hinted", false);
    }, 2000);
}

function endGame() {
    gameState.isPlaying = false;
    clearInterval(gameState.timerInterval);
    hintBtn.disabled = true;
    alert(`Incredible! You finished the entire alphabet in ${timerEl.innerText} seconds!`);
}

function updateStatsUI() {
    correctEl.innerText = gameState.correct;
    incorrectEl.innerText = gameState.incorrect;
    hintCountEl.innerText = gameState.hints;
    remainingCountEl.innerText = gameState.remainingCountries.length;
}