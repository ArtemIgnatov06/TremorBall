const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
// Используем старую версию uuid для совместимости
const { v4: uuidv4 } = require('uuid'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};
let queue = [];

// Координаты спавна мяча (теперь зависят от стороны)
const SPAWN_HEIGHT = 200;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('findMatch', ({ mode, roomId, skin }) => {
        let targetRoomID;
        let side = 'left';

        // Логика поиска (Random / Private)
        if (mode === 'random') {
            if (queue.length > 0) {
                targetRoomID = queue.shift();
                side = 'right';
            } else {
                targetRoomID = uuidv4();
                queue.push(targetRoomID);
            }
        } else if (mode === 'private') {
            if (roomId && rooms[roomId] && rooms[roomId].players.length < 2) {
                targetRoomID = roomId;
                side = 'right';
            } else {
                targetRoomID = uuidv4();
            }
        }

        joinRoom(socket, targetRoomID, side, skin);
    });

    function joinRoom(socket, roomID, side, skin) {
        socket.join(roomID);

        if (!rooms[roomID]) {
            rooms[roomID] = { players: [], score: { left: 0, right: 0 }, gameActive: true };
        }

        const player = { id: socket.id, side, skin, x: side === 'left' ? 200 : 600, y: 500 };
        rooms[roomID].players.push(player);

        // Старт игры или ожидание
        if (rooms[roomID].players.length === 1) {
            socket.emit('waiting', { roomId: roomID });
        } else {
            const opponent = rooms[roomID].players.find(p => p.id !== socket.id);
            socket.emit('gameStart', { roomId: roomID, self: player, opponents: [opponent] });
            socket.to(roomID).emit('gameStart', { roomId: roomID, self: opponent, opponents: [player] });
        }
        
        socket.on('disconnect', () => {
            if (rooms[roomID]) {
                rooms[roomID].players = rooms[roomID].players.filter(p => p.id !== socket.id);
                socket.to(roomID).emit('playerLeft', socket.id);
                if (rooms[roomID].players.length === 0) {
                    delete rooms[roomID];
                    queue = queue.filter(id => id !== roomID);
                }
            }
        });

        // Движение игроков
        socket.on('move', d => socket.to(roomID).emit('updatePlayer', { id: socket.id, ...d }));
        
        // Синхронизация мяча
        socket.on('syncBall', d => socket.to(roomID).emit('updateBall', d));
        
        // Разморозка мяча (подача)
        socket.on('serve', () => {
            io.to(roomID).emit('ballServed');
        });

        // Гол
        socket.on('goal', (loserSide) => {
            if (!rooms[roomID]) return;

            // Очко получает ПРОТИВНИК проигравшего
            const winnerSide = loserSide === 'left' ? 'right' : 'left';
            rooms[roomID].score[winnerSide]++;
            
            // Проверка победы (до 11)
            if (rooms[roomID].score[winnerSide] >= 11) {
                io.to(roomID).emit('gameOver', winnerSide);
                rooms[roomID].score = { left: 0, right: 0 }; // Сброс счета
                io.to(roomID).emit('scoreUpdate', rooms[roomID].score);
                // Мяч в центр после конца игры
                io.to(roomID).emit('resetRound', { x: 400, y: 150, serveSide: null });
            } else {
                io.to(roomID).emit('scoreUpdate', rooms[roomID].score);
                
                // Мяч спавнится над ПРОИГРАВШИМ (loserSide)
                const spawnX = loserSide === 'left' ? 200 : 600;
                
                // Отправляем команду рестарта раунда с указанием, чья очередь подавать (двигаться)
                io.to(roomID).emit('resetRound', { 
                    x: spawnX, 
                    y: SPAWN_HEIGHT, 
                    serveSide: loserSide 
                });
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));