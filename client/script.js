// =========================
// DOM REFERENCES
// =========================

const lobby = document.getElementById("lobby");
const gameScreen = document.getElementById("gameScreen");
const gameOverScreen = document.getElementById("gameOver");
const gameOverText = document.getElementById("gameOverText");

const serverUrlInput = document.getElementById("serverUrl");
const roomCodeInput = document.getElementById("roomCode");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const lobbyStatus = document.getElementById("lobbyStatus");
const restartBtn = document.getElementById("restartBtn");

const scoreElement = document.getElementById("score");
const roleLabel = document.getElementById("roleLabel");

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");


// =========================
// PERSISTED LOBBY VALUES
// (real hosted files, not a sandbox artifact, so localStorage is fine here)
// =========================

serverUrlInput.value = localStorage.getItem("etfg_serverUrl") || "";
roomCodeInput.value = localStorage.getItem("etfg_roomCode") || "";


// =========================
// GAME / NETWORK STATE
// =========================

let ws = null;
let role = null; // "runner" or "chaser"

let MAZE_COLS = 19;
let MAZE_ROWS = 13;
let CELL_SIZE = 50;

let maze = null;
let dots = [];

const PLAYER_SIZE = 40;
const PLAYER_SPEED = 5;

let runnerPos = { x: 0, y: 0 };
let chaserPos = { x: 0, y: 0 };

let score = 0;
let gameRunning = false;
let connected = false;


// =========================
// LOAD IMAGES
// (drop images/player.jpg for the runner and images/friend1.jpg
// for the chaser to replace the plain colored circles)
// =========================

const runnerImage = new Image();
runnerImage.src = "images/player.jpg";

const chaserImage = new Image();
chaserImage.src = "images/friend1.jpg";


// =========================
// RANDOM ROOM CODE
// =========================

function randomRoomCode() {

    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let i = 0; i < 5; i++) {
        code += letters[Math.floor(Math.random() * letters.length)];
    }

    return code;

}


// =========================
// CONNECT / JOIN
// =========================

function setStatus(text) {
    lobbyStatus.textContent = text;
}

function connectAndJoin(roomCode) {

    const url = serverUrlInput.value.trim();

    if (!url) {
        setStatus("Enter the server address first.");
        return;
    }

    if (!roomCode) {
        setStatus("Enter or generate a room code first.");
        return;
    }

    localStorage.setItem("etfg_serverUrl", url);
    localStorage.setItem("etfg_roomCode", roomCode);

    setStatus("Connecting...");

    try {
        ws = new WebSocket(url);
    } catch (err) {
        setStatus("That doesn't look like a valid server address.");
        return;
    }

    ws.onopen = () => {
        connected = true;
        ws.send(JSON.stringify({ type: "join", room: roomCode }));
    };

    ws.onmessage = event => {
        handleMessage(JSON.parse(event.data));
    };

    ws.onclose = () => {
        if (gameRunning || gameScreen.classList.contains("hidden") === false) {
            setStatus("Disconnected from server.");
        } else {
            setStatus("Could not reach the server. Check the address and try again.");
        }
        connected = false;
    };

    ws.onerror = () => {
        // onclose will usually follow and show a message
    };

}

createBtn.addEventListener("click", () => {
    const code = randomRoomCode();
    roomCodeInput.value = code;
    setStatus(`Room code: ${code} — share this with your friend.`);
    connectAndJoin(code);
});

joinBtn.addEventListener("click", () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    connectAndJoin(code);
});


// =========================
// SERVER MESSAGE HANDLING
// =========================

function handleMessage(msg) {

    if (msg.type === "error") {
        setStatus(msg.message);
        return;
    }

    if (msg.type === "joined") {

        role = msg.role;
        MAZE_COLS = msg.mazeCols;
        MAZE_ROWS = msg.mazeRows;
        CELL_SIZE = msg.cellSize;
        maze = msg.maze;
        dots = msg.dots;

        canvas.width = MAZE_COLS * CELL_SIZE;
        canvas.height = MAZE_ROWS * CELL_SIZE;

        roleLabel.textContent = role === "runner"
            ? "You are the Runner 🏃 (get away!)"
            : "You are the Chaser 👹 (catch them!)";

        if (msg.waiting) {
            setStatus("Waiting for your friend to join this room...");
        } else {
            setStatus("Both players connected!");
        }

        return;

    }

    if (msg.type === "start") {

        lobby.classList.add("hidden");
        gameScreen.classList.remove("hidden");
        gameOverScreen.classList.add("hidden");

        gameRunning = true;

        requestAnimationFrame(renderLoop);

        return;

    }

    if (msg.type === "state") {

        runnerPos = msg.runner;
        chaserPos = msg.chaser;
        score = msg.score;
        gameRunning = msg.gameRunning;

        scoreElement.textContent = score;

        msg.collected.forEach(index => {
            if (dots[index]) dots[index].collected = true;
        });

        return;

    }

    if (msg.type === "gameOver") {

        gameRunning = false;

        gameOverText.textContent = role === "runner"
            ? "Your friend caught you!"
            : "You caught them!";

        gameOverScreen.classList.remove("hidden");

        return;

    }

    if (msg.type === "restarted") {

        maze = msg.maze;
        dots = msg.dots;
        score = 0;
        scoreElement.textContent = 0;

        gameRunning = true;
        gameOverScreen.classList.add("hidden");

        return;

    }

    if (msg.type === "opponentLeft") {

        gameRunning = false;
        gameOverText.textContent = "Your friend disconnected.";
        gameOverScreen.classList.remove("hidden");

        return;

    }

}


// =========================
// INPUT -> SERVER
// =========================

function sendInput(dx, dy) {

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", dx, dy }));
    }

}

document.addEventListener("keydown", event => {

    if (!connected) return;

    if (event.key === "ArrowUp" || event.key === "w") {
        sendInput(0, -PLAYER_SPEED);
    }

    if (event.key === "ArrowDown" || event.key === "s") {
        sendInput(0, PLAYER_SPEED);
    }

    if (event.key === "ArrowLeft" || event.key === "a") {
        sendInput(-PLAYER_SPEED, 0);
    }

    if (event.key === "ArrowRight" || event.key === "d") {
        sendInput(PLAYER_SPEED, 0);
    }

});

function setupTouchControls() {

    const btnUp = document.getElementById("btnUp");
    const btnDown = document.getElementById("btnDown");
    const btnLeft = document.getElementById("btnLeft");
    const btnRight = document.getElementById("btnRight");

    function bind(button, dx, dy) {

        if (!button) return;

        button.addEventListener("touchstart", event => {
            event.preventDefault();
            sendInput(dx, dy);
        }, { passive: false });

        button.addEventListener("mousedown", event => {
            event.preventDefault();
            sendInput(dx, dy);
        });

    }

    bind(btnUp, 0, -PLAYER_SPEED);
    bind(btnDown, 0, PLAYER_SPEED);
    bind(btnLeft, -PLAYER_SPEED, 0);
    bind(btnRight, PLAYER_SPEED, 0);

}

setupTouchControls();

restartBtn.addEventListener("click", () => {

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "restart" }));
    }

});


// =========================
// DRAWING
// =========================

function drawCircularImage(image, x, y, size) {

    ctx.save();

    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(image, x, y, size, size);

    ctx.restore();

}

function drawMaze() {

    ctx.fillStyle = "#1c1cd6";

    for (let row = 0; row < MAZE_ROWS; row++) {

        for (let col = 0; col < MAZE_COLS; col++) {

            if (maze[row][col] === 1) {
                ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }

        }

    }

}

function drawDots() {

    ctx.fillStyle = "yellow";

    dots.forEach(dot => {

        if (dot.collected) return;

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 4, 0, Math.PI * 2);
        ctx.fill();

    });

}

function drawCharacter(image, pos, fallbackColor, isYou) {

    if (image.complete && image.naturalWidth > 0) {
        drawCircularImage(image, pos.x, pos.y, PLAYER_SIZE);
    } else {
        ctx.beginPath();
        ctx.arc(pos.x + PLAYER_SIZE / 2, pos.y + PLAYER_SIZE / 2, PLAYER_SIZE / 2, 0, Math.PI * 2);
        ctx.fillStyle = fallbackColor;
        ctx.fill();
    }

    if (isYou) {
        ctx.beginPath();
        ctx.arc(pos.x + PLAYER_SIZE / 2, pos.y + PLAYER_SIZE / 2, PLAYER_SIZE / 2 + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "gold";
        ctx.lineWidth = 3;
        ctx.stroke();
    }

}

function renderLoop() {

    if (!maze) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawMaze();
    drawDots();

    drawCharacter(runnerImage, runnerPos, "lime", role === "runner");
    drawCharacter(chaserImage, chaserPos, "red", role === "chaser");

    requestAnimationFrame(renderLoop);

}
