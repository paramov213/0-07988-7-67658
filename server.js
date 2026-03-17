const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');

const DB_FILE = './users.json';
let db = { users: {} };

if (fs.existsSync(DB_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { console.log("Ошибка БД"); }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

app.use(express.static(__dirname));

const activeSockets = {}; 
const userStatus = {};    

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        const login = data.login.trim();
        if (data.type === 'register') {
            if (db.users[login]) return socket.emit('auth-error', 'Логин занят');
            db.users[login] = data.password;
            saveDB();
        } else {
            if (!db.users[login] || db.users[login] !== data.password) return socket.emit('auth-error', 'Ошибка входа');
        }
        socket.userName = login;
        activeSockets[login] = socket.id;
        userStatus[login] = 'online';
        io.emit('user-status-update', { user: login, status: 'online' });
        socket.emit('auth-success', { user: login });
    });

    socket.on('search-user', (searchName) => {
        const query = searchName.replace('@', '').toLowerCase().trim();
        const found = Object.keys(db.users).find(name => name.toLowerCase() === query);
        if (found) {
            socket.emit('search-result', { exists: true, username: found, status: userStatus[found] || 'был(а) недавно' });
        } else {
            socket.emit('search-result', { exists: false });
        }
    });

    socket.on('get-status', (username) => {
        socket.emit('status-result', { 
            user: username, 
            status: userStatus[username] || 'был(а) недавно' 
        });
    });

    socket.on('typing', (data) => {
        if (activeSockets[data.to]) {
            io.to(activeSockets[data.to]).emit('user-typing', { from: socket.userName });
        }
    });

    socket.on('private-message', (data) => {
        const msg = {
            from: socket.userName,
            to: data.to,
            text: data.text,
            image: data.image, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (activeSockets[data.to]) io.to(activeSockets[data.to]).emit('msg-receive', msg);
        socket.emit('msg-receive', msg);
    });

    socket.on('disconnect', () => {
        if (socket.userName) {
            userStatus[socket.userName] = `был(а) в ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
            io.emit('user-status-update', { user: socket.userName, status: userStatus[socket.userName] });
            delete activeSockets[socket.userName];
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => console.log(`Celestra Server: ${PORT}`));
