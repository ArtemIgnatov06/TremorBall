const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Для генерации уникальных ссылок

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище комнат: { roomId: { players: [], score: {}, ball: {} } }
let rooms = {};
let queue = []; // Очередь для случайного поиска

const SPAWN = {
    ball: { x: 400, y: 150 },
    left: { x: 200, y: 500 },
    right: { x: 600, y: 500 }
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Игрок ищет матч или создает приватный
    socket.on('findMatch', ({ skin, mode, roomId }) => {
        let roomID;
        let side = 'left';

        if (mode === 'random') {
            // Логика быстрого поиска
            if (queue.length > 0) {
                roomID = queue.shift();
                side = 'right';
            } else {
                roomID = uuidv4();
                queue.push(roomID);
            }
        } else if (mode === 'private') {
            // Если roomId пришел с клиентом (он прошел по ссылке)
            if (roomId && rooms[roomId] && rooms[roomId].players.length < 2) {
                roomID = roomId;
                side = 'right';
            } else {
                // Создаем новую комнату
                roomID = uuidv4();
            }
        }

        joinRoom(socket, roomID, side, skin);
    });

    function joinRoom(socket, roomID, side, skin) {
        socket.join(roomID);

        // Инициализация комнаты, если нет
        if (!rooms[roomID]) {
            rooms[roomID] = {
                players: [],
                score: { left: 0, right: 0 }
            };
        }

        const player = { id: socket.id, side, skin, x: side === 'left' ? 200 : 600, y: 500 };
        rooms[roomID].players.push(player);

        // Сообщаем клиенту, что он в игре
        socket.emit('gameStart', { 
            roomId: roomID, 
            self: player, 
            opponents: rooms[roomID].players.filter(p => p.id !== socket.id) 
        });

        // Если это второй игрок — уведомляем первого
        if (rooms[roomID].players.length === 2) {
            socket.to(roomID).emit('playerJoined', player);
            io.to(roomID).emit('ready', true); // Начинаем
        } else {
            // Ждем игрока
            socket.emit('waiting', { link: roomID });
        }
        
        // Обработка дисконнекта
        socket.on('disconnect', () => {
            leaveRoom(socket, roomID);
        });
        
        // Обработка движений внутри комнаты
        socket.on('move', (data) => {
            socket.to(roomID).emit('updatePlayer', { id: socket.id, ...data });
        });

        socket.on('syncBall', (data) => {
            socket.to(roomID).emit('updateBall', data);
        });

        socket.on('goal', (winnerSide) => {
            if (rooms[roomID]) {
                rooms[roomID].score[winnerSide]++;
                io.to(roomID).emit('scoreUpdate', rooms[roomID].score);
                io.to(roomID).emit('resetRound', SPAWN.ball);
            }
        });
    }

    function leaveRoom(socket, roomID) {
        // Убираем из очереди, если он там был
        queue = queue.filter(id => id !== roomID);

        if (rooms[roomID]) {
            rooms[roomID].players = rooms[roomID].players.filter(p => p.id !== socket.id);
            io.to(roomID).emit('playerLeft', socket.id);
            
            // Если комната пуста, удаляем её
            if (rooms[roomID].players.length === 0) {
                delete rooms[roomID];
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`TremorBall Server v2 running on port ${PORT}`);
});