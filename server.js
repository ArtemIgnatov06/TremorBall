const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let players = {};

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Assign player side (Left or Right)
    const side = Object.keys(players).length === 0 ? 'left' : 'right';
    players[socket.id] = { x: side === 'left' ? 100 : 700, y: 500, side: side };

    socket.emit('init', { id: socket.id, side: side, players });
    socket.broadcast.emit('playerJoined', { id: socket.id, player: players[socket.id] });

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            socket.broadcast.emit('update', { id: socket.id, x: data.x, y: data.y });
        }
    });

    socket.on('ballSync', (data) => {
        // Simple authority: the player who hit the ball updates it for others
        socket.broadcast.emit('ballUpdate', data);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`TremorBall running on port ${PORT}`));