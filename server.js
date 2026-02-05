const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаем файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let score = { left: 0, right: 0 };

// Начальные позиции
const SPAWN = {
    ball: { x: 400, y: 100 },
    left: { x: 200, y: 500 },
    right: { x: 600, y: 500 }
};

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Определяем сторону: первый - слева, второй - справа
    const side = Object.keys(players).length === 0 ? 'left' : 'right';
    
    // Если уже 2 игрока, третий будет зрителем (spectator)
    if (Object.keys(players).length >= 2) {
        socket.emit('full', true);
        return;
    }

    players[socket.id] = { 
        id: socket.id,
        side: side, 
        x: side === 'left' ? SPAWN.left.x : SPAWN.right.x, 
        y: 500 
    };

    // Отправляем игроку текущее состояние мира
    socket.emit('init', { 
        self: players[socket.id], 
        players: players, 
        score: score 
    });

    // Сообщаем всем, что зашел новый игрок
    socket.broadcast.emit('playerJoined', players[socket.id]);

    // Обработка движения
    socket.on('move', (coords) => {
        if (players[socket.id]) {
            players[socket.id].x = coords.x;
            players[socket.id].y = coords.y;
            socket.broadcast.emit('updatePlayer', { id: socket.id, x: coords.x, y: coords.y });
        }
    });

    // Синхронизация мяча (от клиента к остальным)
    socket.on('syncBall', (data) => {
        socket.broadcast.emit('updateBall', data);
    });

    // Обработка гола (Клиент сообщает "Я увидел гол")
    socket.on('goal', (winnerSide) => {
        score[winnerSide]++;
        io.emit('scoreUpdate', score);
        io.emit('resetRound', SPAWN.ball); // Сброс мяча в центр
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
        // Сброс счета если все вышли
        if (Object.keys(players).length === 0) {
            score = { left: 0, right: 0 };
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TremorBall server running on port ${PORT}`));