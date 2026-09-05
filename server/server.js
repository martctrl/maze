const http = require("http");
const { WebSocketServer } = require("ws");


// =========================
// GAME CONSTANTS
// (must match the client's rendering assumptions)
// =========================

const CELL_SIZE = 50;

const ROOM_COLS = 9;
const ROOM_ROWS = 6;

const MAZE_COLS = ROOM_COLS * 2 + 1; // 19
const MAZE_ROWS = ROOM_ROWS * 2 + 1; // 13

const PLAYER_SIZE = 40;
const PLAYER_SPEED = 5;

const TICK_MS = 1000 / 30; // 30 updates per second


// =========================
// MAZE GENERATION
// (recursive backtracker + extra loop connections)
// =========================

function generateMaze() {

    const maze = [];

    for (let r = 0; r < MAZE_ROWS; r++) {
        maze.push(new Array(MAZE_COLS).fill(1));
    }

    const visited = [];

    for (let ry = 0; ry < ROOM_ROWS; ry++) {
        visited.push(new Array(ROOM_COLS).fill(false));
    }

    function roomToGrid(rx, ry) {
        return { col: rx * 2 + 1, row: ry * 2 + 1 };
    }

    const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];

    const stack = [[0, 0]];

    visited[0][0] = true;

    const start = roomToGrid(0, 0);
    maze[start.row][start.col] = 0;

    while (stack.length > 0) {

        const [rx, ry] = stack[stack.length - 1];

        const neighbors = [];

        directions.forEach(([dx, dy]) => {

            const nx = rx + dx;
            const ny = ry + dy;

            if (
                nx >= 0 && nx < ROOM_COLS &&
                ny >= 0 && ny < ROOM_ROWS &&
                !visited[ny][nx]
            ) {
                neighbors.push([nx, ny, dx, dy]);
            }

        });

        if (neighbors.length === 0) {
            stack.pop();
            continue;
        }

        const [nx, ny, dx, dy] =
            neighbors[Math.floor(Math.random() * neighbors.length)];

        const from = roomToGrid(rx, ry);
        const to = roomToGrid(nx, ny);

        maze[from.row + dy][from.col + dx] = 0;
        maze[to.row][to.col] = 0;

        visited[ny][nx] = true;
        stack.push([nx, ny]);

    }

    for (let ry = 0; ry < ROOM_ROWS; ry++) {

        for (let rx = 0; rx < ROOM_COLS; rx++) {

            const { col, row } = roomToGrid(rx, ry);

            if (
                rx < ROOM_COLS - 1 &&
                maze[row][col + 1] === 1 &&
                Math.random() < 0.18
            ) {
                maze[row][col + 1] = 0;
            }

            if (
                ry < ROOM_ROWS - 1 &&
                maze[row + 1][col] === 1 &&
                Math.random() < 0.18
            ) {
                maze[row + 1][col] = 0;
            }

        }

    }

    return maze;

}


// =========================
// SPAWN / DOT HELPERS
// =========================

function roomPixel(rx, ry, size) {

    const col = rx * 2 + 1;
    const row = ry * 2 + 1;

    return {
        col,
        row,
        x: col * CELL_SIZE + CELL_SIZE / 2 - size / 2,
        y: row * CELL_SIZE + CELL_SIZE / 2 - size / 2
    };

}

function buildDots(maze, skipSpawns) {

    const dots = [];

    const skip = new Set(
        skipSpawns.map(s => `${s.row},${s.col}`)
    );

    for (let row = 0; row < MAZE_ROWS; row++) {

        for (let col = 0; col < MAZE_COLS; col++) {

            if (maze[row][col] === 0 && !skip.has(`${row},${col}`)) {

                dots.push({
                    x: col * CELL_SIZE + CELL_SIZE / 2,
                    y: row * CELL_SIZE + CELL_SIZE / 2,
                    collected: false
                });

            }

        }

    }

    return dots;

}


// =========================
// COLLISION
// =========================

function isWalkable(maze, x, y, size) {

    const corners = [
        [x, y],
        [x + size - 1, y],
        [x, y + size - 1],
        [x + size - 1, y + size - 1]
    ];

    for (const [cx, cy] of corners) {

        const col = Math.floor(cx / CELL_SIZE);
        const row = Math.floor(cy / CELL_SIZE);

        if (
            row < 0 || row >= MAZE_ROWS ||
            col < 0 || col >= MAZE_COLS ||
            maze[row][col] === 1
        ) {
            return false;
        }

    }

    return true;

}

function moveEntity(maze, entity) {

    const newX = entity.x + entity.dx;

    if (isWalkable(maze, newX, entity.y, PLAYER_SIZE)) {
        entity.x = newX;
    }

    const newY = entity.y + entity.dy;

    if (isWalkable(maze, entity.x, newY, PLAYER_SIZE)) {
        entity.y = newY;
    }

}


// =========================
// ROOM MANAGEMENT
// =========================

const rooms = new Map();

function freshRoomState(code) {

    const maze = generateMaze();

    const runnerSpawn = roomPixel(0, 0, PLAYER_SIZE);
    const chaserSpawn = roomPixel(ROOM_COLS - 1, ROOM_ROWS - 1, PLAYER_SIZE);

    const dots = buildDots(maze, [runnerSpawn, chaserSpawn]);

    return {
        code,
        maze,
        dots,
        runner: {
            x: runnerSpawn.x, y: runnerSpawn.y,
            dx: 0, dy: 0,
            socket: null
        },
        chaser: {
            x: chaserSpawn.x, y: chaserSpawn.y,
            dx: 0, dy: 0,
            socket: null
        },
        score: 0,
        gameRunning: true,
        interval: null
    };

}

function getOrCreateRoom(code) {

    if (!rooms.has(code)) {
        rooms.set(code, freshRoomState(code));
    }

    return rooms.get(code);

}

function send(socket, message) {

    if (socket && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
    }

}

function broadcastToRoom(room, message) {

    send(room.runner.socket, message);
    send(room.chaser.socket, message);

}

function startRoomLoop(room) {

    if (room.interval) return;

    room.interval = setInterval(() => {

        if (!room.gameRunning) return;

        moveEntity(room.maze, room.runner);
        moveEntity(room.maze, room.chaser);

        const collectedIndices = [];

        room.dots.forEach((dot, index) => {

            if (dot.collected) return;

            const dx = room.runner.x + PLAYER_SIZE / 2 - dot.x;
            const dy = room.runner.y + PLAYER_SIZE / 2 - dot.y;

            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PLAYER_SIZE / 2 + 4) {
                dot.collected = true;
                room.score++;
                collectedIndices.push(index);
            }

        });

        const cdx = room.runner.x - room.chaser.x;
        const cdy = room.runner.y - room.chaser.y;
        const catchDistance = Math.sqrt(cdx * cdx + cdy * cdy);

        if (catchDistance < PLAYER_SIZE) {
            room.gameRunning = false;
            broadcastToRoom(room, { type: "gameOver" });
        }

        broadcastToRoom(room, {
            type: "state",
            runner: { x: room.runner.x, y: room.runner.y },
            chaser: { x: room.chaser.x, y: room.chaser.y },
            score: room.score,
            collected: collectedIndices,
            gameRunning: room.gameRunning
        });

    }, TICK_MS);

}

function stopRoomLoopIfEmpty(room) {

    if (!room.runner.socket && !room.chaser.socket) {

        if (room.interval) {
            clearInterval(room.interval);
            room.interval = null;
        }

        rooms.delete(room.code);

    }

}


// =========================
// HTTP + WEBSOCKET SERVER
// =========================

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Escape the Friend Group - multiplayer server is running.\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", socket => {

    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });

    let joinedRoom = null;
    let role = null;

    socket.on("message", raw => {

        let msg;

        try {
            msg = JSON.parse(raw);
        } catch (err) {
            return;
        }

        if (msg.type === "join") {

            const code = String(msg.room || "").trim().toUpperCase().slice(0, 8);

            if (!code) {
                send(socket, { type: "error", message: "Room code is required." });
                return;
            }

            const room = getOrCreateRoom(code);

            if (!room.runner.socket) {
                room.runner.socket = socket;
                role = "runner";
            } else if (!room.chaser.socket) {
                room.chaser.socket = socket;
                role = "chaser";
            } else {
                send(socket, { type: "error", message: "That room already has two players." });
                return;
            }

            joinedRoom = room;

            send(socket, {
                type: "joined",
                role,
                mazeCols: MAZE_COLS,
                mazeRows: MAZE_ROWS,
                cellSize: CELL_SIZE,
                maze: room.maze,
                dots: room.dots,
                waiting: !(room.runner.socket && room.chaser.socket)
            });

            if (room.runner.socket && room.chaser.socket) {
                broadcastToRoom(room, { type: "start" });
                startRoomLoop(room);
            }

            return;

        }

        if (!joinedRoom) return;

        if (msg.type === "input") {

            const entity = role === "runner" ? joinedRoom.runner : joinedRoom.chaser;

            const dx = Number(msg.dx) || 0;
            const dy = Number(msg.dy) || 0;

            entity.dx = Math.max(-PLAYER_SPEED, Math.min(PLAYER_SPEED, dx));
            entity.dy = Math.max(-PLAYER_SPEED, Math.min(PLAYER_SPEED, dy));

            return;

        }

        if (msg.type === "restart") {

            const fresh = freshRoomState(joinedRoom.code);

            fresh.runner.socket = joinedRoom.runner.socket;
            fresh.chaser.socket = joinedRoom.chaser.socket;

            if (joinedRoom.interval) {
                clearInterval(joinedRoom.interval);
            }

            rooms.set(joinedRoom.code, fresh);
            joinedRoom = fresh;

            broadcastToRoom(joinedRoom, {
                type: "restarted",
                maze: joinedRoom.maze,
                dots: joinedRoom.dots
            });

            startRoomLoop(joinedRoom);

            return;

        }

    });

    socket.on("close", () => {

        if (!joinedRoom) return;

        if (joinedRoom.runner.socket === socket) {
            joinedRoom.runner.socket = null;
        }

        if (joinedRoom.chaser.socket === socket) {
            joinedRoom.chaser.socket = null;
        }

        joinedRoom.gameRunning = false;

        broadcastToRoom(joinedRoom, { type: "opponentLeft" });

        stopRoomLoopIfEmpty(joinedRoom);

    });

});

// Ping clients periodically so idle connections don't get dropped by proxies
const heartbeat = setInterval(() => {

    wss.clients.forEach(socket => {

        if (socket.isAlive === false) {
            return socket.terminate();
        }

        socket.isAlive = false;
        socket.ping();

    });

}, 25000);

wss.on("close", () => clearInterval(heartbeat));

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Multiplayer server listening on port ${PORT}`);
});


module.exports = {
    generateMaze,
    isWalkable,
    buildDots,
    roomPixel,
    MAZE_COLS,
    MAZE_ROWS,
    ROOM_COLS,
    ROOM_ROWS,
    PLAYER_SIZE
};
