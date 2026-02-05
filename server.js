const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
// Используем старый формат require для совместимости с версией 8.3.2
const { v4: uuidv4 } = require('uuid'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};
let queue = [];

const SPAWN = { ball: { x: 400, y: 150 } };

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('findMatch', ({ mode, roomId, skin }) => {
        let targetRoomID;
        let side = 'left';

        // 1. Случайный поиск
        if (mode === 'random') {
            if (queue.length > 0) {
                targetRoomID = queue.shift();
                side = 'right';
            } else {
                targetRoomID = uuidv4();
                queue.push(targetRoomID);
            }
        } 
        // 2. Игра с другом
        else if (mode === 'private') {
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
            rooms[roomID] = { players: [], score: { left: 0, right: 0 } };
        }

        const player = { id: socket.id, side, skin, x: side === 'left' ? 200 : 600, y: 500 };
        rooms[roomID].players.push(player);

        // Если это первый игрок - ждем
        if (rooms[roomID].players.length === 1) {
            socket.emit('waiting', { roomId: roomID });
        } else {
            // Если второй - начинаем
            const opponent = rooms[roomID].players.find(p => p.id !== socket.id);
            
            // Стартуем нас
            socket.emit('gameStart', { roomId: roomID, self: player, opponents: [opponent] });
            
            // Стартуем соперника
            socket.to(roomID).emit('gameStart', { roomId: roomID, self: opponent, opponents: [player] });
        }
        
        socket.on('disconnect', () => {
            if (rooms[roomID]) {
                rooms[roomID].players = rooms[roomID].players.filter(p => p.id !== socket.id);
                socket.to(roomID).emit('playerLeft', socket.id);
                if (rooms[roomID].players.length === 0) {
                    delete rooms[roomID];
                    // Убрать из очереди, если он там был
                    queue = queue.filter(id => id !== roomID);
                }
            }
        });

        socket.on('move', d => socket.to(roomID).emit('updatePlayer', { id: socket.id, ...d }));
        socket.on('syncBall', d => socket.to(roomID).emit('updateBall', d));
        socket.on('goal', side => {
            if (rooms[roomID]) {
                rooms[roomID].score[side]++;
                io.to(roomID).emit('scoreUpdate', rooms[roomID].score);
                io.to(roomID).emit('resetRound', SPAWN.ball);
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));